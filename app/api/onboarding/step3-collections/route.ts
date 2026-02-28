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

const GET_COLLECTION_BY_HANDLE = `
  query getCollectionByHandle($handle: String!) {
    collectionByHandle(handle: $handle) {
      id
      handle
      title
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

const GET_ONLINE_STORE_PUBLICATION = `
  query {
    publications(first: 10) {
      edges {
        node {
          id
          name
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
    console.error("[step3] Erro ao buscar publicationId:", err);
    return null;
  }
}

async function publishToOnlineStore(client: ShopifyClient, resourceId: string, publicationId: string): Promise<void> {
  try {
    await client.graphqlWithRetry(PUBLISHABLE_PUBLISH, {
      id: resourceId,
      input: [{ publicationId }],
    });
  } catch (err) {
    console.error(`[step3] Publish ${resourceId}:`, err instanceof Error ? err.message : err);
  }
}

async function findOrCreateCollection(
  client: ShopifyClient,
  name: string,
  handle: string
): Promise<{ id: string; handle: string; name: string } | null> {
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

    if (result.collectionCreate.collection) {
      return {
        id: result.collectionCreate.collection.id,
        handle: result.collectionCreate.collection.handle,
        name,
      };
    }

    const hasDuplicate = result.collectionCreate.userErrors.some(
      (e) => e.message.toLowerCase().includes("taken") || e.message.toLowerCase().includes("already")
    );

    if (hasDuplicate) {
      console.error(`[step3] Coleção "${name}" já existe, buscando existente...`);
      return await fetchExistingCollection(client, name, handle);
    }

    console.error(`[step3] Erro ao criar coleção "${name}":`, result.collectionCreate.userErrors);
    return null;
  } catch (err) {
    console.error(`[step3] Exceção ao criar coleção "${name}":`, err);
    return await fetchExistingCollection(client, name, handle);
  }
}

async function fetchExistingCollection(
  client: ShopifyClient,
  name: string,
  handle: string
): Promise<{ id: string; handle: string; name: string } | null> {
  try {
    const data = await client.graphqlWithRetry(GET_COLLECTION_BY_HANDLE, { handle });
    const result = data as {
      collectionByHandle: { id: string; handle: string; title: string } | null;
    };
    if (result.collectionByHandle) {
      return {
        id: result.collectionByHandle.id,
        handle: result.collectionByHandle.handle,
        name,
      };
    }
  } catch (err) {
    console.error(`[step3] Falha ao buscar coleção existente "${handle}":`, err);
  }
  return null;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  try {
    const { collections: collectionNames, productIds } = await request.json();
    const client = new ShopifyClient(session.shop, session.accessToken);
    const errors: { name: string; reason: string }[] = [];
    const createdCollections: { id: string; handle: string; name: string }[] = [];

    const publicationId = await fetchOnlineStorePublicationId(client);
    if (publicationId) {
      console.error(`[step3] Online Store publication: ${publicationId}`);
    } else {
      console.error("[step3] Online Store publication não encontrada.");
    }

    for (const name of collectionNames as string[]) {
      const handle = slugify(name);
      const col = await findOrCreateCollection(client, name, handle);
      if (col) {
        createdCollections.push(col);
        if (publicationId) await publishToOnlineStore(client, col.id, publicationId);
      } else {
        errors.push({ name, reason: "Falha ao criar e coleção existente não encontrada" });
      }
    }

    let bestSellersId = "";
    const bs = await findOrCreateCollection(client, "Best Sellers", "best-sellers");
    if (bs) {
      bestSellersId = bs.id;
      if (publicationId) await publishToOnlineStore(client, bs.id, publicationId);
    } else {
      errors.push({ name: "Best Sellers", reason: "Falha ao criar/encontrar coleção" });
    }

    if (bestSellersId && productIds && productIds.length > 0) {
      const batches = chunkArray(productIds as string[], 250);
      for (let i = 0; i < batches.length; i++) {
        try {
          await client.graphqlWithRetry(ADD_PRODUCTS_TO_COLLECTION, {
            id: bestSellersId,
            productIds: batches[i],
          });
        } catch (err) {
          const reason = err instanceof Error ? err.message : "Erro";
          console.error(`[step3] Vincular batch ${i + 1} ao Best Sellers:`, reason);
          errors.push({ name: `Best Sellers batch ${i + 1}`, reason });
        }
      }
    }

    return NextResponse.json({
      success: createdCollections.length > 0 || bestSellersId !== "",
      collections: createdCollections,
      bestSellersId,
      created: createdCollections.length,
      errors,
      message:
        errors.length === 0
          ? `${createdCollections.length} coleções criadas com sucesso`
          : `${createdCollections.length} coleções OK, ${errors.length} com problema`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro interno";
    console.error("[step3] Erro fatal:", msg);
    return NextResponse.json(
      { success: false, errors: [{ name: "_global", reason: msg }], message: msg },
      { status: 500 }
    );
  }
}
