import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ShopifyClient } from "@/lib/shopify";
import { UK_POLICIES } from "@/lib/policies";

const MENU_CREATE = `
  mutation menuCreate($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
    menuCreate(title: $title, handle: $handle, items: $items) {
      menu {
        id
        handle
        items { title url }
      }
      userErrors { field message }
    }
  }
`;

const SHOP_POLICY_UPDATE = `
  mutation shopPolicyUpdate($shopPolicy: ShopPolicyInput!) {
    shopPolicyUpdate(shopPolicy: $shopPolicy) {
      shopPolicy { id type body }
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
    const { collections } = (await request.json()) as {
      collections: { id: string; handle: string; name: string }[];
    };

    const client = new ShopifyClient(session.shop, session.accessToken);
    const errors: string[] = [];
    const storeName = session.shop.replace(".myshopify.com", "");
    const storeEmail = `support@${session.shop}`;

    const menuItems = (collections || []).map((col) => ({
      title: col.name,
      type: "COLLECTION",
      resourceId: col.id,
    }));

    try {
      await client.graphqlWithRetry(MENU_CREATE, {
        title: "Main Menu",
        handle: "main-menu",
        items: menuItems,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro";
      errors.push(`Menu principal: ${msg}`);
    }

    const policies = [
      { type: "REFUND_POLICY", body: UK_POLICIES.refund_policy(storeName) },
      {
        type: "PRIVACY_POLICY",
        body: UK_POLICIES.privacy_policy(storeName, storeEmail),
      },
      {
        type: "TERMS_OF_SERVICE",
        body: UK_POLICIES.terms_of_service(storeName),
      },
      {
        type: "SHIPPING_POLICY",
        body: UK_POLICIES.shipping_policy(storeName),
      },
    ];

    for (const policy of policies) {
      try {
        await client.graphqlWithRetry(SHOP_POLICY_UPDATE, {
          shopPolicy: { type: policy.type, body: policy.body },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro";
        errors.push(`Política ${policy.type}: ${msg}`);
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
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
