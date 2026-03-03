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

const GET_SHOP_POLICIES = `
  query {
    shop {
      privacyPolicy { id title url }
      refundPolicy { id title url }
      termsOfService { id title url }
      shippingPolicy { id title url }
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
          items { id title type url resourceUrl }
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

interface ShopPolicyNode {
  id: string;
  title: string;
  url: string;
}

interface MenuNode {
  id: string;
  handle: string;
  title: string;
  items: { id: string; title: string; type: string; url: string; resourceUrl?: string }[];
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
    const warnings: string[] = [];
    const completed: string[] = [];
    const storeName = session.shop.replace(".myshopify.com", "");
    const storeEmail = `support@${session.shop}`;

    // PASSO 1 — Criar/atualizar políticas (tratar auto-management como warning)
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
          const isAutoManaged = msg.toLowerCase().includes("automatic management");
          if (isAutoManaged) {
            console.log(`[step8] ${policy.label}: gerenciamento automático ativo — política já existe, pulando.`);
            warnings.push(`${policy.label}: gerenciamento automático ativo (política já existe)`);
            completed.push(`${policy.label} (auto-managed)`);
          } else {
            console.error(`[step8] shopPolicyUpdate ${policy.label} userErrors:`, msg);
            errors.push({ item: policy.label, reason: msg });
          }
        } else {
          completed.push(policy.label);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Erro";
        console.error(`[step8] Erro na política ${policy.label}:`, reason);
        errors.push({ item: policy.label, reason });
      }
    }

    // PASSO 2 — Consultar políticas existentes na loja para obter os IDs
    let shopPolicies: Record<string, ShopPolicyNode | null> = {
      refundPolicy: null,
      privacyPolicy: null,
      termsOfService: null,
      shippingPolicy: null,
    };
    try {
      const polData = await client.graphql(GET_SHOP_POLICIES);
      const result = polData as {
        shop: {
          privacyPolicy: ShopPolicyNode | null;
          refundPolicy: ShopPolicyNode | null;
          termsOfService: ShopPolicyNode | null;
          shippingPolicy: ShopPolicyNode | null;
        };
      };
      shopPolicies = {
        refundPolicy: result.shop.refundPolicy,
        privacyPolicy: result.shop.privacyPolicy,
        termsOfService: result.shop.termsOfService,
        shippingPolicy: result.shop.shippingPolicy,
      };
      console.log("[step8] Políticas na loja:",
        Object.entries(shopPolicies)
          .map(([k, v]) => `${k}: ${v ? v.id : "não existe"}`)
          .join(", ")
      );
    } catch (err) {
      console.error("[step8] Erro ao buscar políticas existentes:", err);
    }

    // PASSO 3 — Buscar menus existentes
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

    // PASSO 4 — Atualizar Footer menu com links de políticas (usando resourceId)
    const footerMenu = menus.find((m) => m.handle === "footer");
    if (footerMenu) {
      try {
        const existingItems = footerMenu.items.map((item) => ({
          id: item.id,
          title: item.title,
          type: item.type,
          url: item.url,
        }));

        const policyMenuEntries: { label: string; key: keyof typeof shopPolicies }[] = [
          { label: "Refund Policy", key: "refundPolicy" },
          { label: "Privacy Policy", key: "privacyPolicy" },
          { label: "Terms of Service", key: "termsOfService" },
          { label: "Shipping Policy", key: "shippingPolicy" },
        ];

        const newPolicyItems: { title: string; type: string; resourceId: string }[] = [];
        for (const entry of policyMenuEntries) {
          const policy = shopPolicies[entry.key];
          if (!policy) {
            console.log(`[step8] Política ${entry.label} não existe na loja, pulando link no menu.`);
            continue;
          }
          const alreadyInMenu = existingItems.some(
            (i) => i.title === entry.label || i.url?.includes(entry.key.replace(/([A-Z])/g, "-$1").toLowerCase())
          );
          if (alreadyInMenu) {
            console.log(`[step8] ${entry.label} já existe no footer menu, pulando.`);
            continue;
          }
          newPolicyItems.push({
            title: entry.label,
            type: "SHOP_POLICY",
            resourceId: policy.id,
          });
        }

        if (newPolicyItems.length === 0) {
          completed.push("Footer menu (todas políticas já presentes)");
        } else {
          const allItems = [
            ...existingItems,
            ...newPolicyItems,
          ];

          console.log("[step8] Footer menu items a enviar:", JSON.stringify(allItems, null, 2));

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

    // PASSO 5 — Verificar Main menu (não alterar)
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
      warnings,
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
