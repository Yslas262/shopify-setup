import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ShopifyClient } from "@/lib/shopify";
import { UK_POLICIES } from "@/lib/policies";

const GET_EXISTING_PAGES = `
  query {
    pages(first: 50) {
      edges {
        node {
          id
          title
          handle
        }
      }
    }
  }
`;

const PAGE_CREATE = `
  mutation pageCreate($page: PageCreateInput!) {
    pageCreate(page: $page) {
      page {
        id
        title
        handle
      }
      userErrors { field message }
    }
  }
`;

const GET_COLLECTIONS = `
  query {
    collections(first: 50) {
      edges {
        node {
          id
          title
          handle
        }
      }
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

const MENU_CREATE = `
  mutation menuCreate($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
    menuCreate(title: $title, handle: $handle, items: $items) {
      menu {
        id
        handle
        title
        items { id title url }
      }
      userErrors { field message }
    }
  }
`;

const MENU_UPDATE = `
  mutation menuUpdate($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
    menuUpdate(id: $id, title: $title, items: $items) {
      menu {
        id
        handle
        items { id title url }
      }
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

interface MenuNode {
  id: string;
  handle: string;
  title: string;
  items: { id: string; title: string; type: string; url: string }[];
}

interface PageNode {
  id: string;
  title: string;
  handle: string;
}

function buildPageDefinitions(storeName: string, storeEmail: string) {
  return [
    {
      title: "Privacy Policy",
      handle: "privacy-policy",
      body: UK_POLICIES.privacy_policy(storeName, storeEmail),
    },
    {
      title: "Terms of Service",
      handle: "terms-of-service",
      body: UK_POLICIES.terms_of_service(storeName),
    },
    {
      title: "Refund Policy",
      handle: "refund-policy",
      body: UK_POLICIES.refund_policy(storeName),
    },
    {
      title: "Shipping Policy",
      handle: "shipping-policy",
      body: UK_POLICIES.shipping_policy(storeName),
    },
    {
      title: "Contact Us",
      handle: "contact-us",
      body: `
<h2>Contact Us</h2>
<p>We'd love to hear from you! If you have any questions, concerns or feedback, please don't hesitate to get in touch.</p>
<h3>Email</h3>
<p><a href="mailto:${storeEmail}">${storeEmail}</a></p>
<h3>Response Time</h3>
<p>We aim to respond to all enquiries within 24-48 business hours.</p>
<h3>Business Hours</h3>
<p>Monday to Friday: 9:00 AM – 5:00 PM (GMT)<br>Saturday &amp; Sunday: Closed</p>
      `.trim(),
    },
    {
      title: "Legal Information",
      handle: "legal-information",
      body: `
<h2>Legal Information &mdash; ${storeName}</h2>
<p>This website is operated by ${storeName}.</p>
<h3>Intellectual Property</h3>
<p>All content on this website, including but not limited to text, graphics, logos, images, and software, is the property of ${storeName} or its content suppliers and is protected by UK and international copyright laws.</p>
<h3>Disclaimer</h3>
<p>The information provided on this website is for general informational purposes only. While we strive to keep the information up to date and accurate, we make no representations or warranties of any kind about the completeness, accuracy, reliability, suitability or availability of the website or the information, products, services or related graphics contained on the website.</p>
<h3>External Links</h3>
<p>This website may contain links to external websites. We have no control over the content and nature of these sites and accept no responsibility for them or for any loss or damage that may arise from your use of them.</p>
      `.trim(),
    },
    {
      title: "About Us",
      handle: "about-us",
      body: `
<h2>About ${storeName}</h2>
<p>Welcome to ${storeName}! We are dedicated to providing high-quality products and an exceptional shopping experience.</p>
<h3>Our Mission</h3>
<p>We believe in offering carefully curated products that combine quality, style and value. Our goal is to make your shopping experience as seamless and enjoyable as possible.</p>
<h3>Quality Guarantee</h3>
<p>Every product in our store is selected with care. We work closely with trusted suppliers to ensure that everything we offer meets our high standards.</p>
<h3>Customer First</h3>
<p>Your satisfaction is our top priority. Our dedicated support team is always here to help with any questions or concerns you may have.</p>
      `.trim(),
    },
  ];
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  try {
    const reqBody = await request.json();
    const frontendCollections: { id: string; handle: string; name: string }[] =
      reqBody.collections || [];

    const client = new ShopifyClient(session.shop, session.accessToken);
    const errors: { item: string; reason: string }[] = [];
    const completed: string[] = [];
    const warnings: string[] = [];
    const storeName = session.shop.replace(".myshopify.com", "");
    const storeEmail = `support@${session.shop}`;
    const rawDisplayName =
      (reqBody.storeDisplayName as string | undefined)?.trim() || "";
    const displayName =
      rawDisplayName.length > 0 ? rawDisplayName : storeName;

    // ── PASSO 1: Buscar páginas existentes ──
    let existingPages: PageNode[] = [];
    try {
      const data = await client.graphql(GET_EXISTING_PAGES);
      const result = data as { pages: { edges: { node: PageNode }[] } };
      existingPages = result.pages.edges.map((e) => e.node);
      console.log(
        "[step8] Páginas existentes:",
        existingPages.map((p) => p.handle).join(", ") || "(nenhuma)"
      );
    } catch (err) {
      console.error("[step8] Erro ao buscar páginas:", err);
    }

    // ── PASSO 2: Criar as 7 páginas (skip se já existir) ──
    const pageDefs = buildPageDefinitions(displayName, storeEmail);
    const createdPages: Map<string, PageNode> = new Map();

    for (const existing of existingPages) {
      createdPages.set(existing.handle, existing);
    }

    let publicationId: string | null = null;
    try {
      const pubData = await client.graphql(GET_ONLINE_STORE_PUBLICATION);
      const pubResult = pubData as {
        publications: { edges: { node: { id: string; name: string } }[] };
      };
      const onlineStore = pubResult.publications.edges.find(
        (e) => e.node.name === "Online Store"
      );
      publicationId = onlineStore?.node.id || null;
    } catch {
      console.error("[step8] Não foi possível buscar Online Store publication.");
    }

    for (const pageDef of pageDefs) {
      if (createdPages.has(pageDef.handle)) {
        console.log(`[step8] Página "${pageDef.handle}" já existe, pulando criação.`);
        warnings.push(`${pageDef.title}: já existia`);
        continue;
      }

      try {
        const data = await client.graphqlWithRetry(PAGE_CREATE, {
          page: {
            title: pageDef.title,
            handle: pageDef.handle,
            body: pageDef.body,
            isPublished: true,
          },
        });
        const result = data as {
          pageCreate: {
            page: PageNode | null;
            userErrors: { field: string; message: string }[];
          };
        };

        if (result.pageCreate.userErrors.length > 0) {
          const msg = result.pageCreate.userErrors
            .map((e) => e.message)
            .join("; ");
          console.error(`[step8] pageCreate "${pageDef.handle}":`, msg);
          errors.push({ item: `Página ${pageDef.title}`, reason: msg });
          continue;
        }

        if (result.pageCreate.page) {
          createdPages.set(pageDef.handle, result.pageCreate.page);
          completed.push(`Página: ${pageDef.title}`);

          if (publicationId) {
            try {
              await client.graphqlWithRetry(PUBLISHABLE_PUBLISH, {
                id: result.pageCreate.page.id,
                input: [{ publicationId }],
              });
            } catch (pubErr) {
              console.error(
                `[step8] Publish página ${pageDef.handle}:`,
                pubErr instanceof Error ? pubErr.message : pubErr
              );
            }
          }
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Erro";
        console.error(`[step8] Erro ao criar página "${pageDef.handle}":`, reason);
        errors.push({ item: `Página ${pageDef.title}`, reason });
      }
    }

    // ── PASSO 3: Buscar coleções (do frontend ou da loja) ──
    let collectionsForMenu: { id: string; title: string; handle: string }[] =
      frontendCollections.map((c) => ({
        id: c.id,
        title: c.name,
        handle: c.handle,
      }));

    if (collectionsForMenu.length === 0) {
      try {
        const colData = await client.graphql(GET_COLLECTIONS);
        const colResult = colData as {
          collections: {
            edges: { node: { id: string; title: string; handle: string } }[];
          };
        };
        collectionsForMenu = colResult.collections.edges
          .map((e) => e.node)
          .filter((c) => c.handle !== "best-sellers" && c.handle !== "frontpage");
        console.log(
          "[step8] Coleções da loja:",
          collectionsForMenu.map((c) => c.handle).join(", ")
        );
      } catch (err) {
        console.error("[step8] Erro ao buscar coleções:", err);
      }
    }

    // ── PASSO 4: Buscar menus existentes ──
    let menus: MenuNode[] = [];
    try {
      const menuData = await client.graphql(LIST_MENUS);
      const result = menuData as {
        menus: { edges: { node: MenuNode }[] };
      };
      menus = result.menus.edges.map((e) => e.node);
      console.log(
        "[step8] Menus existentes:",
        menus.map((m) => `${m.handle} (${m.id}, ${m.items.length} itens)`).join(", ") || "(nenhum)"
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Erro";
      console.error("[step8] Erro ao listar menus:", reason);
      errors.push({ item: "Listar menus", reason });
    }

    // ── PASSO 5: Main Menu → links para coleções ──
    const mainMenuItems = collectionsForMenu.map((col) => ({
      title: col.title,
      type: "COLLECTION",
      resourceId: col.id,
    }));

    const existingMain = menus.find((m) => m.handle === "main-menu");
    if (existingMain) {
      try {
        const data = await client.graphqlWithRetry(MENU_UPDATE, {
          id: existingMain.id,
          title: existingMain.title,
          items: mainMenuItems.map((item) => ({
            title: item.title,
            type: item.type,
            resourceId: item.resourceId,
          })),
        });
        const result = data as {
          menuUpdate: { userErrors: { field: string; message: string }[] };
        };
        if (result.menuUpdate.userErrors.length > 0) {
          const msg = result.menuUpdate.userErrors.map((e) => e.message).join("; ");
          console.error("[step8] menuUpdate main-menu:", msg);
          errors.push({ item: "Main Menu (update)", reason: msg });
        } else {
          completed.push(`Main Menu atualizado (${mainMenuItems.length} coleções)`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Erro";
        console.error("[step8] Erro ao atualizar main-menu:", reason);
        errors.push({ item: "Main Menu (update)", reason });
      }
    } else {
      try {
        const data = await client.graphqlWithRetry(MENU_CREATE, {
          title: "Main Menu",
          handle: "main-menu",
          items: mainMenuItems,
        });
        const result = data as {
          menuCreate: { userErrors: { field: string; message: string }[] };
        };
        if (result.menuCreate.userErrors.length > 0) {
          const msg = result.menuCreate.userErrors.map((e) => e.message).join("; ");
          console.error("[step8] menuCreate main-menu:", msg);
          errors.push({ item: "Main Menu (create)", reason: msg });
        } else {
          completed.push(`Main Menu criado (${mainMenuItems.length} coleções)`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Erro";
        console.error("[step8] Erro ao criar main-menu:", reason);
        errors.push({ item: "Main Menu (create)", reason });
      }
    }

    // ── PASSO 6: Footer Menu → links para as páginas criadas ──
    const footerHandles = [
      "privacy-policy",
      "terms-of-service",
      "refund-policy",
      "shipping-policy",
      "contact-us",
      "legal-information",
      "about-us",
    ];

    const footerMenuItems: { title: string; type: string; resourceId: string }[] = [];
    for (const handle of footerHandles) {
      const page = createdPages.get(handle);
      if (page) {
        footerMenuItems.push({
          title: page.title,
          type: "PAGE",
          resourceId: page.id,
        });
      } else {
        console.log(`[step8] Página "${handle}" não encontrada, pulando link no footer.`);
      }
    }

    const existingFooter = menus.find((m) => m.handle === "footer");
    if (existingFooter) {
      try {
        const data = await client.graphqlWithRetry(MENU_UPDATE, {
          id: existingFooter.id,
          title: existingFooter.title,
          items: footerMenuItems.map((item) => ({
            title: item.title,
            type: item.type,
            resourceId: item.resourceId,
          })),
        });
        const result = data as {
          menuUpdate: { userErrors: { field: string; message: string }[] };
        };
        if (result.menuUpdate.userErrors.length > 0) {
          const msg = result.menuUpdate.userErrors.map((e) => e.message).join("; ");
          console.error("[step8] menuUpdate footer:", msg);
          errors.push({ item: "Footer Menu (update)", reason: msg });
        } else {
          completed.push(`Footer Menu atualizado (${footerMenuItems.length} páginas)`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Erro";
        console.error("[step8] Erro ao atualizar footer:", reason);
        errors.push({ item: "Footer Menu (update)", reason });
      }
    } else {
      try {
        const data = await client.graphqlWithRetry(MENU_CREATE, {
          title: "Footer",
          handle: "footer",
          items: footerMenuItems,
        });
        const result = data as {
          menuCreate: { userErrors: { field: string; message: string }[] };
        };
        if (result.menuCreate.userErrors.length > 0) {
          const msg = result.menuCreate.userErrors.map((e) => e.message).join("; ");
          console.error("[step8] menuCreate footer:", msg);
          errors.push({ item: "Footer Menu (create)", reason: msg });
        } else {
          completed.push(`Footer Menu criado (${footerMenuItems.length} páginas)`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Erro";
        console.error("[step8] Erro ao criar footer:", reason);
        errors.push({ item: "Footer Menu (create)", reason });
      }
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
