import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ShopifyClient } from "@/lib/shopify";
import { slugify, chunkArray } from "@/lib/validators";

const CREATE_COLLECTION = `
  mutation collectionCreate($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection {
        id
        handle
        title
      }
      userErrors { field message }
    }
  }
`;

const ADD_PRODUCTS_TO_COLLECTION = `
  mutation collectionAddProducts($id: ID!, $productIds: [ID!]!) {
    collectionAddProducts(id: $id, productIds: $productIds) {
      collection { id }
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
    const { collections: collectionNames, productIds } = await request.json();
    const client = new ShopifyClient(session.shop, session.accessToken);
    const errors: string[] = [];
    const createdCollections: { id: string; handle: string; name: string }[] =
      [];

    for (const name of collectionNames as string[]) {
      const handle = slugify(name);
      try {
        const data = await client.graphqlWithRetry(CREATE_COLLECTION, {
          input: { title: name, handle },
        });

        const result = data as {
          collectionCreate: {
            collection: { id: string; handle: string; title: string } | null;
            userErrors: { field: string; message: string }[];
          };
        };

        if (result.collectionCreate.userErrors.length > 0) {
          errors.push(
            `${name}: ${result.collectionCreate.userErrors.map((e) => e.message).join("; ")}`
          );
          continue;
        }

        if (result.collectionCreate.collection) {
          createdCollections.push({
            id: result.collectionCreate.collection.id,
            handle: result.collectionCreate.collection.handle,
            name,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro";
        errors.push(`${name}: ${msg}`);
      }
    }

    let bestSellersId = "";
    try {
      const bsData = await client.graphqlWithRetry(CREATE_COLLECTION, {
        input: { title: "Best Sellers", handle: "best-sellers" },
      });

      const bsResult = bsData as {
        collectionCreate: {
          collection: { id: string } | null;
          userErrors: { field: string; message: string }[];
        };
      };

      if (bsResult.collectionCreate.collection) {
        bestSellersId = bsResult.collectionCreate.collection.id;
      } else if (bsResult.collectionCreate.userErrors.length > 0) {
        errors.push(
          `Best Sellers: ${bsResult.collectionCreate.userErrors.map((e) => e.message).join("; ")}`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro";
      errors.push(`Best Sellers: ${msg}`);
    }

    if (bestSellersId && productIds && productIds.length > 0) {
      const batches = chunkArray(productIds as string[], 250);
      for (const batch of batches) {
        try {
          await client.graphqlWithRetry(ADD_PRODUCTS_TO_COLLECTION, {
            id: bestSellersId,
            productIds: batch,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Erro";
          errors.push(`Vincular Best Sellers: ${msg}`);
        }
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      collections: createdCollections,
      bestSellersId,
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
