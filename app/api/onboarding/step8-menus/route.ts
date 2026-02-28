import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ShopifyClient } from "@/lib/shopify";
import { UK_POLICIES } from "@/lib/policies";

const SHOP_POLICY_UPDATE = `
  mutation shopPolicyUpdate($shopPolicy: ShopPolicyInput!) {
    shopPolicyUpdate(shopPolicy: $shopPolicy) {
      shopPolicy { id type body }
      userErrors { field message }
    }
  }
`;

const LIST_MENUS = `
  query {
    menus(first: 10) {
      edges {
        node {
          id
          handle
          title
          items { id title type url }
        }
      }
    }
  }
`;

const MENU_UPDATE = `
  mutation menuUpdate($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
    menuUpdate(id: $id, title: $title, items: $items) {
      menu {
        id
        handle
        items { title url }
      }
      userErrors { field message }
    }
  }
`;

interface MenuNode {
  id: string;
  handle: string;
  title: string;
  items: { id: string; title: string; type: string; url: string }[];
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  try {
    await request.json();

    const client = new ShopifyClient(session.shop, session.accessToken);
    const errors: { item: string; reason: string }[] = [];
    const completed: string[] = [];
    const storeName = session.shop.replace(".myshopify.com", "");
    const storeEmail = `support@${session.shop}`;

    // PASSO 1 — Criar políticas
    const policies = [
      { type: "REFUND_POLICY", label: "Refund Policy", body: UK_POLICIES.refund_policy(storeName) },
      { type: "PRIVACY_POLICY", label: "Privacy Policy", body: UK_POLICIES.privacy_policy(storeName, storeEmail) },
      { type: "TERMS_OF_SERVICE", label: "Terms of Service", body: UK_POLICIES.terms_of_service(storeName) },
      { type: "SHIPPING_POLICY", label: "Shipping Policy", body: UK_POLICIES.shipping_policy(storeName) },
    ];

    for (const policy of policies) {
      try {
        const data = await client.graphqlWithRetry(SHOP_POLICY_UPDATE, {
          shopPolicy: { type: policy.type, body: policy.body },
        });
        const result = data as {
          shopPolicyUpdate: { userErrors: { field: string; message: string }[] };
        };
        if (result.shopPolicyUpdate.userErrors.length > 0) {
          const msg = result.shopPolicyUpdate.userErrors.map((e) => e.message).join("; ");
          console.error(`[step8] shopPolicyUpdate ${policy.label} userErrors:`, msg);
          errors.push({ item: policy.label, reason: msg });
        } else {
          completed.push(policy.label);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Erro";
        console.error(`[step8] Erro na política ${policy.label}:`, reason);
        errors.push({ item: policy.label, reason });
      }
    }

    // PASSO 2 — Buscar menus existentes
    let menus: MenuNode[] = [];
    try {
      const menuData = await client.graphql(LIST_MENUS);
      const result = menuData as {
        menus: { edges: { node: MenuNode }[] };
      };
      menus = result.menus.edges.map((e) => e.node);
      console.log("[step8] Menus encontrados:", menus.map((m) => `${m.handle} (${m.id})`).join(", "));
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Erro";
      console.error("[step8] Erro ao listar menus:", reason);
      errors.push({ item: "Listar menus", reason });
    }

    // PASSO 3 — Atualizar Footer menu com links de políticas
    const footerMenu = menus.find((m) => m.handle === "footer");
    if (footerMenu) {
      try {
        const existingItems = footerMenu.items.map((item) => ({
          id: item.id,
          title: item.title,
          type: item.type,
          url: item.url,
        }));

        const policyItems = [
          { title: "Refund Policy", type: "HTTP", url: "/policies/refund-policy" },
          { title: "Privacy Policy", type: "HTTP", url: "/policies/privacy-policy" },
          { title: "Terms of Service", type: "HTTP", url: "/policies/terms-of-service" },
          { title: "Shipping Policy", type: "HTTP", url: "/policies/shipping-policy" },
        ];

        const existingUrls = new Set(existingItems.map((i) => i.url));
        const newPolicyItems = policyItems.filter((p) => !existingUrls.has(p.url));

        const allItems = [
          ...existingItems,
          ...newPolicyItems,
        ];

        const data = await client.graphqlWithRetry(MENU_UPDATE, {
          id: footerMenu.id,
          title: footerMenu.title,
          items: allItems,
        });

        const result = data as {
          menuUpdate: { userErrors: { field: string; message: string }[] };
        };

        if (result.menuUpdate.userErrors.length > 0) {
          const msg = result.menuUpdate.userErrors.map((e) => e.message).join("; ");
          console.error("[step8] menuUpdate footer userErrors:", msg);
          errors.push({ item: "Footer menu", reason: msg });
        } else {
          completed.push(`Footer menu (${newPolicyItems.length} itens adicionados)`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Erro";
        console.error("[step8] Erro ao atualizar footer menu:", reason);
        errors.push({ item: "Footer menu", reason });
      }
    } else {
      console.error("[step8] Menu footer não encontrado.");
      errors.push({ item: "Footer menu", reason: "Menu com handle 'footer' não encontrado." });
    }

    // PASSO 4 — Verificar Main menu (não alterar)
    const mainMenu = menus.find((m) => m.handle === "main-menu");
    if (mainMenu) {
      console.log(`[step8] Main menu encontrado: ${mainMenu.id} (${mainMenu.items.length} itens)`);
      completed.push(`Main menu verificado (${mainMenu.items.length} itens)`);
    } else {
      console.error("[step8] Main menu não encontrado.");
      errors.push({ item: "Main menu", reason: "Menu com handle 'main-menu' não encontrado." });
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
