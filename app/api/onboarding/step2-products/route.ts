import { NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { ShopifyClient } from "@/lib/shopify";
import { parseCSV, groupProductsByHandle } from "@/lib/csv-parser";

const CREATE_PRODUCT = `
  mutation productCreate($input: ProductInput!, $media: [CreateMediaInput!]) {
    productCreate(input: $input, media: $media) {
      product {
        id
        handle
        title
      }
      userErrors { field message }
    }
  }
`;

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
    const productIds: string[] = [];
    const errors: { handle: string; reason: string }[] = [];
    let processed = 0;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        for (const [handle, productRows] of entries) {
          try {
            const first = productRows[0];

            const variants = productRows
              .filter((r: Record<string, string>) => r["Variant Price"]?.trim())
              .map((r: Record<string, string>) => ({
                price: r["Variant Price"],
                sku: r["Variant SKU"] || undefined,
                inventoryQuantities: r["Variant Inventory Qty"]
                  ? [
                      {
                        availableQuantity: parseInt(r["Variant Inventory Qty"], 10),
                        locationId: "gid://shopify/Location/1",
                      },
                    ]
                  : undefined,
              }));

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
              handle,
              bodyHtml: first["Body (HTML)"] || "",
              vendor: first["Vendor"] || "",
              productType: first["Type"] || "",
              tags: first["Tags"]
                ? first["Tags"].split(",").map((t: string) => t.trim())
                : [],
              status:
                first["Published"]?.toLowerCase() === "true" ? "ACTIVE" : "DRAFT",
              variants: variants.length > 0 ? variants : [{ price: "0.00" }],
            };

            const data = await client.graphqlWithRetry(CREATE_PRODUCT, {
              input,
              media,
            });

            const result = data as {
              productCreate: {
                product: { id: string } | null;
                userErrors: { field: string; message: string }[];
              };
            };

            if (result.productCreate.userErrors.length > 0) {
              const reason = result.productCreate.userErrors
                .map((e) => e.message)
                .join("; ");
              errors.push({ handle, reason });
              console.error(`[step2] Produto ${handle} falhou:`, reason);
            } else if (result.productCreate.product) {
              productIds.push(result.productCreate.product.id);
            }
          } catch (err) {
            const reason = err instanceof Error ? err.message : "Erro desconhecido";
            errors.push({ handle, reason });
            console.error(`[step2] Produto ${handle} exceção:`, reason);
          }

          processed++;
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ type: "progress", processed, total }) + "\n"
            )
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
    return Response.json({ success: false, errors: [{ handle: "_global", reason: msg }] }, { status: 500 });
  }
}
