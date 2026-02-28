import { NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { ShopifyClient } from "@/lib/shopify";
import { parseCSV, groupProductsByHandle } from "@/lib/csv-parser";

const GET_LOCATIONS = `
  query getLocations {
    locations(first: 1) {
      edges {
        node {
          id
          name
        }
      }
    }
  }
`;

const GET_ONLINE_STORE_PUBLICATION = `
  query {
    publications(first: 10) {
      edges {
        node {
          id
          name
          supportsFuturePublishing
        }
      }
    }
  }
`;

const PUBLISHABLE_PUBLISH = `
  mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      publishable { availablePublicationsCount { count } }
      userErrors { field message }
    }
  }
`;

const CREATE_PRODUCT = `
  mutation productCreate($input: ProductInput!, $media: [CreateMediaInput!]) {
    productCreate(input: $input, media: $media) {
      product {
        id
        handle
        variants(first: 1) {
          edges {
            node {
              id
            }
          }
        }
      }
      userErrors { field message }
    }
  }
`;

const VARIANTS_BULK_CREATE = `
  mutation productVariantsBulkCreate(
    $productId: ID!,
    $strategy: ProductVariantsBulkCreateStrategy,
    $variants: [ProductVariantsBulkInput!]!
  ) {
    productVariantsBulkCreate(
      productId: $productId,
      strategy: $strategy,
      variants: $variants
    ) {
      productVariants {
        id
        title
        price
      }
      userErrors { field message }
    }
  }
`;

async function fetchOnlineStorePublicationId(client: ShopifyClient): Promise<string | null> {
  try {
    const data = await client.graphql(GET_ONLINE_STORE_PUBLICATION);
    const result = data as {
      publications: { edges: { node: { id: string; name: string } }[] };
    };
    const onlineStore = result.publications.edges.find(
      (e) => e.node.name === "Online Store"
    );
    return onlineStore?.node.id || null;
  } catch (err) {
    console.error("[step2] Erro ao buscar publicationId:", err);
    return null;
  }
}

async function fetchLocationId(client: ShopifyClient): Promise<string> {
  const data = await client.graphqlWithRetry(GET_LOCATIONS);
  const result = data as {
    locations: { edges: { node: { id: string; name: string } }[] };
  };
  if (result.locations.edges.length > 0) {
    return result.locations.edges[0].node.id;
  }
  throw new Error("Nenhuma location encontrada na loja.");
}

function findColumn(row: Record<string, string>, name: string): string {
  if (row[name] !== undefined) return row[name];
  const lower = name.toLowerCase();
  for (const key of Object.keys(row)) {
    if (key.toLowerCase() === lower) return row[key];
  }
  return "";
}

function buildVariants(
  productRows: Record<string, string>[]
): {
  price: string;
  compareAtPrice?: string;
  sku?: string;
  optionValues: { name: string; optionName: string }[];
}[] {
  const first = productRows[0];

  const optionNames: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const name = findColumn(first, `Option${i} Name`)?.trim();
    if (name) optionNames.push(name);
    else break;
  }

  const rowsWithPrice = productRows.filter(
    (r) => findColumn(r, "Variant Price")?.trim()
  );

  if (rowsWithPrice.length === 0) {
    console.error(`[step2] buildVariants: 0 rows com preço para "${findColumn(first, "Handle")}". Keys: ${Object.keys(first).join(", ")}`);
    return [
      {
        price: "0.00",
        optionValues: [{ name: "Default Title", optionName: "Title" }],
      },
    ];
  }

  return rowsWithPrice.map((r) => {
    const rawPrice = findColumn(r, "Variant Price").trim();
    const price = rawPrice.replace(",", ".");

    const variant: {
      price: string;
      compareAtPrice?: string;
      sku?: string;
      optionValues: { name: string; optionName: string }[];
    } = {
      price,
      optionValues: [],
    };

    const compareAt = findColumn(r, "Variant Compare At Price")?.trim();
    if (compareAt) {
      variant.compareAtPrice = compareAt.replace(",", ".");
    }

    const sku = findColumn(r, "Variant SKU")?.trim();
    if (sku) {
      variant.sku = sku;
    }

    const optionValues: { name: string; optionName: string }[] = [];
    for (let i = 0; i < optionNames.length; i++) {
      const value = findColumn(r, `Option${i + 1} Value`)?.trim();
      if (value) {
        optionValues.push({ name: value, optionName: optionNames[i] });
      }
    }

    if (optionValues.length === 0) {
      optionValues.push({ name: "Default Title", optionName: "Title" });
    }

    variant.optionValues = optionValues;
    return variant;
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Não autenticado." }, { status: 401 });
  }

  try {
    const { csvText } = await request.json();
    const { rows } = parseCSV(csvText);
    const grouped = groupProductsByHandle(rows);
    const entries = Array.from(grouped.entries());
    const total = entries.length;

    const client = new ShopifyClient(session.shop, session.accessToken);

    let locationId: string;
    try {
      locationId = await fetchLocationId(client);
      console.error(`[step2] Location encontrada: ${locationId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro";
      console.error("[step2] Falha ao buscar locationId:", msg);
      return Response.json({
        type: "complete",
        success: false,
        imported: 0,
        failed: total,
        total,
        productIds: [],
        errors: [{ handle: "_global", reason: `Location não encontrada: ${msg}. Verifique se o app possui o scope read_locations.` }],
        message: `Falha ao buscar location da loja: ${msg}`,
      });
    }

    void locationId;

    const publicationId = await fetchOnlineStorePublicationId(client);
    if (publicationId) {
      console.error(`[step2] Online Store publication: ${publicationId}`);
    } else {
      console.error("[step2] Online Store publication não encontrada — produtos não serão publicados automaticamente.");
    }

    const productIds: string[] = [];
    const errors: { handle: string; reason: string }[] = [];
    let processed = 0;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        for (const [handle, productRows] of entries) {
          try {
            const first = productRows[0];

            if (processed === 0) {
              console.error(`[step2] CSV headers (keys do primeiro row): ${Object.keys(first).join(" | ")}`);
              console.error(`[step2] Primeiro produto "${handle}" Variant Price raw: "${findColumn(first, "Variant Price")}"`);
            }

            const images = productRows
              .filter((r: Record<string, string>) => findColumn(r, "Image Src")?.trim())
              .map((r: Record<string, string>) => findColumn(r, "Image Src"));

            const media = images.map((url: string) => ({
              originalSource: url,
              mediaContentType: "IMAGE" as const,
              alt: findColumn(first, "Title") || handle,
            }));

            const input = {
              title: findColumn(first, "Title") || handle,
              descriptionHtml: findColumn(first, "Body (HTML)") || "",
              vendor: findColumn(first, "Vendor") || "",
              productType: findColumn(first, "Type") || "",
              tags: findColumn(first, "Tags")
                ? findColumn(first, "Tags").split(",").map((t: string) => t.trim())
                : [],
              status:
                findColumn(first, "Status")?.toLowerCase() === "active"
                  ? "ACTIVE"
                  : "DRAFT",
            };

            const createData = await client.graphqlWithRetry(CREATE_PRODUCT, {
              input,
              media: media.length > 0 ? media : undefined,
            });

            const createResult = createData as {
              productCreate: {
                product: {
                  id: string;
                  handle: string;
                  variants: {
                    edges: { node: { id: string } }[];
                  };
                } | null;
                userErrors: { field: string; message: string }[];
              };
            };

            if (createResult.productCreate.userErrors.length > 0) {
              const reason = createResult.productCreate.userErrors
                .map((e) => e.message)
                .join("; ");
              errors.push({ handle, reason });
              console.error(`[step2] productCreate ${handle}:`, reason);
              processed++;
              controller.enqueue(
                encoder.encode(JSON.stringify({ type: "progress", processed, total }) + "\n")
              );
              continue;
            }

            const product = createResult.productCreate.product;
            if (!product) {
              errors.push({ handle, reason: "productCreate não retornou produto" });
              processed++;
              controller.enqueue(
                encoder.encode(JSON.stringify({ type: "progress", processed, total }) + "\n")
              );
              continue;
            }

            productIds.push(product.id);

            if (publicationId) {
              try {
                await client.graphqlWithRetry(PUBLISHABLE_PUBLISH, {
                  id: product.id,
                  input: [{ publicationId }],
                });
              } catch (pubErr) {
                console.error(`[step2] Publish ${handle}:`, pubErr instanceof Error ? pubErr.message : pubErr);
              }
            }

            const variants = buildVariants(productRows);

            if (processed <= 2) {
              console.error(`[step2] Variantes para "${handle}":`, JSON.stringify(variants, null, 2));
            }

            if (variants.length > 0) {
              try {
                const varData = await client.graphqlWithRetry(VARIANTS_BULK_CREATE, {
                  productId: product.id,
                  strategy: "REMOVE_STANDALONE_VARIANT",
                  variants,
                });

                const varResult = varData as {
                  productVariantsBulkCreate: {
                    productVariants: { id: string; price: string }[] | null;
                    userErrors: { field: string; message: string }[];
                  };
                };

                if (varResult.productVariantsBulkCreate.userErrors.length > 0) {
                  const reason = varResult.productVariantsBulkCreate.userErrors
                    .map((e) => `${e.field}: ${e.message}`)
                    .join("; ");
                  console.error(`[step2] variantsBulkCreate ${handle} ERRO:`, reason);
                  console.error(`[step2] Input enviado:`, JSON.stringify(variants));
                } else if (processed <= 2) {
                  console.error(`[step2] variantsBulkCreate ${handle} OK:`,
                    JSON.stringify(varResult.productVariantsBulkCreate.productVariants));
                }
              } catch (varErr) {
                const reason = varErr instanceof Error ? varErr.message : "Erro";
                console.error(`[step2] variantsBulkCreate ${handle} exceção:`, reason);
              }
            }
          } catch (err) {
            const reason = err instanceof Error ? err.message : "Erro desconhecido";
            errors.push({ handle, reason });
            console.error(`[step2] Produto ${handle} exceção:`, reason);
          }

          processed++;
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "progress", processed, total }) + "\n")
          );
        }

        const result = {
          type: "complete",
          success: productIds.length > 0,
          imported: productIds.length,
          failed: errors.length,
          total,
          productIds,
          errors,
          message:
            errors.length === 0
              ? `${productIds.length} produtos importados com sucesso`
              : `${productIds.length} importados, ${errors.length} com erro`,
        };

        controller.enqueue(encoder.encode(JSON.stringify(result) + "\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro interno";
    console.error("[step2] Erro fatal:", msg);
    return Response.json(
      { success: false, errors: [{ handle: "_global", reason: msg }] },
      { status: 500 }
    );
  }
}
