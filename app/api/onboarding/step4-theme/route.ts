import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ShopifyClient } from "@/lib/shopify";

const STAGED_UPLOADS_CREATE = `
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

const THEME_CREATE = `
  mutation themeCreate($name: String!, $src: URL!, $role: ThemeRole!) {
    themeCreate(name: $name, src: $src, role: $role) {
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

    // PASSO 1 — stagedUploadsCreate
    const stagedData = await client.graphqlWithRetry(STAGED_UPLOADS_CREATE, {
      input: [
        {
          filename: themeZip.name,
          mimeType: "application/zip",
          resource: "THEME",
          fileSize: String(themeZip.size),
        },
      ],
    });

    const stagedResult = stagedData as {
      stagedUploadsCreate: {
        stagedTargets: {
          url: string;
          resourceUrl: string;
          parameters: { name: string; value: string }[];
        }[];
        userErrors: { field: string; message: string }[];
      };
    };

    if (stagedResult.stagedUploadsCreate.userErrors.length > 0) {
      const msgs = stagedResult.stagedUploadsCreate.userErrors.map((e) => e.message);
      console.error("[step4] stagedUploadsCreate userErrors:", msgs);
      return NextResponse.json({
        success: false,
        message: `Staged upload falhou: ${msgs.join("; ")}`,
        errors: msgs,
      });
    }

    const target = stagedResult.stagedUploadsCreate.stagedTargets[0];
    if (!target) {
      return NextResponse.json({
        success: false,
        message: "stagedUploadsCreate não retornou target.",
        errors: [],
      });
    }

    // PASSO 2 — Upload do .zip para a URL retornada
    const uploadForm = new FormData();
    for (const param of target.parameters) {
      uploadForm.append(param.name, param.value);
    }
    uploadForm.append("file", themeZip);

    const uploadRes = await fetch(target.url, {
      method: "POST",
      body: uploadForm,
    });

    if (!uploadRes.ok && uploadRes.status !== 201) {
      const text = await uploadRes.text().catch(() => "");
      console.error(`[step4] Upload S3 falhou: ${uploadRes.status}`, text);
      return NextResponse.json({
        success: false,
        message: `Upload do .zip falhou: HTTP ${uploadRes.status}`,
        errors: [],
      });
    }

    // PASSO 3 — themeCreate com resourceUrl
    const createData = await client.graphqlWithRetry(THEME_CREATE, {
      name: themeName,
      src: target.resourceUrl,
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

    // PASSO 4 — Polling até processing = false
    const ready = await waitForProcessing(client, themeId);
    if (!ready) {
      return NextResponse.json({
        success: false,
        themeId,
        message: "Timeout: tema ainda processando após 3 minutos.",
        errors: [],
      });
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
  }
}
