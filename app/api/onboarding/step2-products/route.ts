import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ShopifyClient } from "@/lib/shopify";
import { parseCSV, groupProductsByHandle } from "@/lib/csv-parser";
import { chunkArray } from "@/lib/validators";

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
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  try {
    const { csvText } = await request.json();
    const { rows } = parseCSV(csvText);
    const grouped = groupProductsByHandle(rows);

    const client = new ShopifyClient(session.shop, session.accessToken);
    const productIds: string[] = [];
    const errors: string[] = [];

    const batches = chunkArray(Array.from(grouped.entries()), 10);

    for (const batch of batches) {
      const promises = batch.map(async ([handle, productRows]) => {
        const first = productRows[0];

        const variants = productRows
          .filter((r) => r["Variant Price"])
          .map((r) => ({
            price: r["Variant Price"],
            sku: r["Variant SKU"] || undefined,
            inventoryQuantities: r["Variant Inventory Qty"]
              ? [
                  {
                    availableQuantity: parseInt(
                      r["Variant Inventory Qty"],
                      10
                    ),
                    locationId: "gid://shopify/Location/1",
                  },
                ]
              : undefined,
          }));

        const images = productRows
          .filter((r) => r["Image Src"])
          .map((r) => r["Image Src"]);

        const media = images.map((url) => ({
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
            first["Published"]?.toLowerCase() === "true"
              ? "ACTIVE"
              : "DRAFT",
          variants: variants.length > 0 ? variants : [{ price: "0.00" }],
        };

        try {
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
            const msgs = result.productCreate.userErrors
              .map((e) => e.message)
              .join("; ");
            errors.push(`${handle}: ${msgs}`);
            return;
          }

          if (result.productCreate.product) {
            productIds.push(result.productCreate.product.id);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Erro";
          errors.push(`${handle}: ${msg}`);
        }
      });

      await Promise.all(promises);
    }

    return NextResponse.json({
      success: errors.length === 0,
      totalImported: productIds.length,
      productIds,
      errors,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json(
      { success: false, errors: [msg] },
      { status: 500 }
    );
  }
}
