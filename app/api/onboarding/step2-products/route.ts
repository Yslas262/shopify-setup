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
    const name = first[`Option${i} Name`]?.trim();
    if (name) optionNames.push(name);
    else break;
  }

  const rowsWithPrice = productRows.filter(
    (r) => r["Variant Price"]?.trim()
  );

  if (rowsWithPrice.length === 0) {
    return [
      {
        price: "0.00",
        optionValues: [{ name: "Default Title", optionName: "Title" }],
      },
    ];
  }

  return rowsWithPrice.map((r) => {
    const variant: {
      price: string;
      compareAtPrice?: string;
      sku?: string;
      optionValues: { name: string; optionName: string }[];
    } = {
      price: String(r["Variant Price"]),
      optionValues: [],
    };

    const compareAt = r["Variant Compare At Price"]?.trim();
    if (compareAt) {
      variant.compareAtPrice = String(compareAt);
    }

    if (r["Variant SKU"]?.trim()) {
      variant.sku = r["Variant SKU"];
    }

    const optionValues: { name: string; optionName: string }[] = [];
    for (let i = 0; i < optionNames.length; i++) {
      const value = r[`Option${i + 1} Value`]?.trim();
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

    // locationId is used indirectly — kept for future inventory operations
    void locationId;

    const productIds: string[] = [];
    const errors: { handle: string; reason: string }[] = [];
    let processed = 0;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        for (const [handle, productRows] of entries) {
          try {
            const first = productRows[0];

            const images = productRows
              .filter((r: Record<string, string>) => r["Image Src"]?.trim())
              .map((r: Record<string, string>) => r["Image Src"]);

            const media = images.map((url: string) => ({
              originalSource: url,
              mediaContentType: "IMAGE" as const,
              alt: first["Title"] || handle,
            }));

            const input = {
              title: first["Title"] || handle,
              descriptionHtml: first["Body (HTML)"] || "",
              vendor: first["Vendor"] || "",
              productType: first["Type"] || "",
              tags: first["Tags"]
                ? first["Tags"].split(",").map((t: string) => t.trim())
                : [],
              status:
                first["Status"]?.toLowerCase() === "active"
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

            const variants = buildVariants(productRows);

            if (variants.length > 0) {
              try {
                const varData = await client.graphqlWithRetry(VARIANTS_BULK_CREATE, {
                  productId: product.id,
                  strategy: "REMOVE_STANDALONE_VARIANT",
                  variants,
                });

                const varResult = varData as {
                  productVariantsBulkCreate: {
                    productVariants: { id: string }[] | null;
                    userErrors: { field: string; message: string }[];
                  };
                };

                if (varResult.productVariantsBulkCreate.userErrors.length > 0) {
                  const reason = varResult.productVariantsBulkCreate.userErrors
                    .map((e) => e.message)
                    .join("; ");
                  console.error(`[step2] variantsBulkCreate ${handle}:`, reason);
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
