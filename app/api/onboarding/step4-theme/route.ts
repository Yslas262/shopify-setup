import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ShopifyClient } from "@/lib/shopify";
import { put, del } from "@vercel/blob";

const THEME_CREATE = `
  mutation themeCreate($name: String!, $source: URL!, $role: ThemeRole!) {
    themeCreate(name: $name, source: $source, role: $role) {
      theme {
        id
        name
        processing
      }
      userErrors { field message }
    }
  }
`;

const THEME_STATUS = `
  query getTheme($id: ID!) {
    theme(id: $id) {
      id
      processing
    }
  }
`;

const LIST_THEMES = `
  query listThemes {
    themes(first: 50) {
      nodes { id name role }
    }
  }
`;

async function findExistingTheme(
  client: ShopifyClient,
  themeName: string
): Promise<string | null> {
  try {
    const data = await client.graphql(LIST_THEMES);
    const result = data as {
      themes: { nodes: { id: string; name: string; role: string }[] };
    };
    const match = result.themes.nodes.find((t) => t.name === themeName);
    return match?.id || null;
  } catch (err) {
    console.error("[step4] Erro ao listar temas:", err);
    return null;
  }
}

async function waitForProcessing(
  client: ShopifyClient,
  themeId: string
): Promise<boolean> {
  const MAX_POLLS = 60;
  const POLL_INTERVAL = 3000;

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    try {
      const data = await client.graphql(THEME_STATUS, { id: themeId });
      const result = data as { theme: { id: string; processing: boolean } };
      if (!result.theme.processing) return true;
    } catch (err) {
      console.error(`[step4] Erro no polling ${i + 1}:`, err);
    }
  }
  return false;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  let blobUrl: string | null = null;

  try {
    const formData = await request.formData();
    const themeZip = formData.get("themeZip") as File | null;

    if (!themeZip) {
      return NextResponse.json(
        { success: false, message: "Arquivo .zip do tema não fornecido.", errors: [] },
        { status: 400 }
      );
    }

    const client = new ShopifyClient(session.shop, session.accessToken);
    const storeName = session.shop.replace(".myshopify.com", "");
    const themeName = `VT-PRO - ${storeName}`;

    const existingId = await findExistingTheme(client, themeName);
    if (existingId) {
      console.error(`[step4] Tema "${themeName}" já existe (${existingId}), reutilizando.`);
      return NextResponse.json({
        success: true,
        themeId: existingId,
        message: `Tema existente reutilizado: ${themeName}`,
      });
    }

    // PASSO 1 — Upload do .zip para Vercel Blob Storage
    const blob = await put(`themes/${storeName}-${Date.now()}.zip`, themeZip, {
      access: "public",
    });
    blobUrl = blob.url;
    console.error(`[step4] Blob upload OK: ${blobUrl}`);

    // PASSO 2 — themeCreate com a URL pública do blob
    const createData = await client.graphqlWithRetry(THEME_CREATE, {
      name: themeName,
      source: blobUrl,
      role: "UNPUBLISHED",
    });

    const createResult = createData as {
      themeCreate: {
        theme: { id: string; processing: boolean } | null;
        userErrors: { field: string; message: string }[];
      };
    };

    if (createResult.themeCreate.userErrors.length > 0) {
      const msgs = createResult.themeCreate.userErrors.map((e) => e.message);
      console.error("[step4] themeCreate userErrors:", msgs);
      return NextResponse.json({
        success: false,
        message: msgs.join("; "),
        errors: msgs,
      });
    }

    const themeId = createResult.themeCreate.theme?.id;
    if (!themeId) {
      return NextResponse.json({
        success: false,
        message: "themeCreate não retornou ID.",
        errors: [],
      });
    }

    // PASSO 3 — Polling até processing = false
    const ready = await waitForProcessing(client, themeId);
    if (!ready) {
      return NextResponse.json({
        success: false,
        themeId,
        message: "Timeout: tema ainda processando após 3 minutos.",
        errors: [],
      });
    }

    // PASSO 4 — Limpar blob após sucesso
    try {
      await del(blobUrl);
      blobUrl = null;
      console.error("[step4] Blob deletado com sucesso.");
    } catch (delErr) {
      console.error("[step4] Falha ao deletar blob (não crítico):", delErr);
    }

    return NextResponse.json({
      success: true,
      themeId,
      message: `Tema "${themeName}" enviado e processado.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro interno";
    console.error("[step4] Erro fatal:", msg);
    return NextResponse.json(
      { success: false, message: msg, errors: [] },
      { status: 500 }
    );
  } finally {
    if (blobUrl) {
      try { await del(blobUrl); } catch { /* best effort cleanup */ }
    }
  }
}
