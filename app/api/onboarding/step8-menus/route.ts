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
    const errors: { item: string; reason: string }[] = [];
    const completed: string[] = [];
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
      completed.push("Main Menu");
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Erro";
      console.error("[step8] Erro ao criar menu:", reason);
      errors.push({ item: "Main Menu", reason });
    }

    const policies = [
      { type: "REFUND_POLICY", label: "Refund Policy", body: UK_POLICIES.refund_policy(storeName) },
      { type: "PRIVACY_POLICY", label: "Privacy Policy", body: UK_POLICIES.privacy_policy(storeName, storeEmail) },
      { type: "TERMS_OF_SERVICE", label: "Terms of Service", body: UK_POLICIES.terms_of_service(storeName) },
      { type: "SHIPPING_POLICY", label: "Shipping Policy", body: UK_POLICIES.shipping_policy(storeName) },
    ];

    for (const policy of policies) {
      try {
        await client.graphqlWithRetry(SHOP_POLICY_UPDATE, {
          shopPolicy: { type: policy.type, body: policy.body },
        });
        completed.push(policy.label);
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Erro";
        console.error(`[step8] Erro na política ${policy.label}:`, reason);
        errors.push({ item: policy.label, reason });
      }
    }

    return NextResponse.json({
      success: completed.length > 0,
      completed,
      errors,
      message:
        errors.length === 0
          ? `${completed.length} itens configurados com sucesso`
          : `${completed.length} OK, ${errors.length} falharam`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro interno";
    console.error("[step8] Erro fatal:", msg);
    return NextResponse.json(
      { success: false, message: msg, errors: [] },
      { status: 500 }
    );
  }
}
