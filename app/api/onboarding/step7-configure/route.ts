import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ShopifyClient } from "@/lib/shopify";
import { buildSettingsData, buildIndexJson } from "@/lib/theme-builder";
import type { ThemeConfig } from "@/types/onboarding";

const THEME_FILES_UPSERT = `
  mutation themeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
    themeFilesUpsert(themeId: $themeId, files: $files) {
      upsertedThemeFiles { filename }
      userErrors { field message }
    }
  }
`;

const FILE_CREATE = `
  mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        ... on MediaImage {
          id
          fileStatus
          image { url }
        }
      }
      userErrors { field message }
    }
  }
`;

const FILE_STATUS = `
  query node($id: ID!) {
    node(id: $id) {
      ... on MediaImage {
        id
        fileStatus
        image { url }
      }
    }
  }
`;

async function uploadAndResolveImage(
  client: ShopifyClient,
  url: string,
  alt: string
): Promise<{ id: string; imageUrl: string } | null> {
  try {
    const data = await client.graphqlWithRetry(FILE_CREATE, {
      files: [{ originalSource: url, contentType: "IMAGE", alt }],
    });

    const result = data as {
      fileCreate: {
        files: { id: string; fileStatus?: string; image?: { url: string } }[];
        userErrors: { field: string; message: string }[];
      };
    };

    if (result.fileCreate.userErrors.length > 0) {
      const msgs = result.fileCreate.userErrors.map((e) => e.message);
      console.error(`[step7] fileCreate userErrors para "${alt}":`, msgs);
      return null;
    }

    const file = result.fileCreate.files[0];
    if (!file?.id) {
      console.error(`[step7] fileCreate não retornou ID para "${alt}".`);
      return null;
    }

    if (file.fileStatus === "READY" && file.image?.url) {
      return { id: file.id, imageUrl: file.image.url };
    }

    const MAX_POLLS = 30;
    const POLL_INTERVAL = 2000;

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
      try {
        const pollData = await client.graphql(FILE_STATUS, { id: file.id });
        const node = (pollData as { node: { id: string; fileStatus: string; image?: { url: string } } }).node;

        if (node.fileStatus === "READY") {
          return { id: node.id, imageUrl: node.image?.url || "" };
        }
        if (node.fileStatus === "FAILED") {
          console.error(`[step7] Arquivo "${alt}" falhou no processamento.`);
          return null;
        }
      } catch (err) {
        console.error(`[step7] Polling ${i + 1} erro para "${alt}":`, err);
      }
    }

    console.error(`[step7] Timeout esperando processamento de "${alt}".`);
    return null;
  } catch (err) {
    console.error(`[step7] Exceção ao enviar "${alt}":`, err);
    return null;
  }
}

async function upsertFileWithRetry(
  client: ShopifyClient,
  themeId: string,
  filename: string,
  content: string,
  maxAttempts = 3
): Promise<{ ok: boolean; error?: string }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const data = await client.graphqlWithRetry(THEME_FILES_UPSERT, {
        themeId,
        files: [{ filename, body: { type: "TEXT", value: content } }],
      });

      const result = data as {
        themeFilesUpsert: {
          upsertedThemeFiles: { filename: string }[] | null;
          userErrors: { field: string; message: string }[];
        };
      };

      if (result.themeFilesUpsert.userErrors.length > 0) {
        const msg = result.themeFilesUpsert.userErrors.map((e) => e.message).join("; ");
        console.error(`[step7] ${filename} tentativa ${attempt}/${maxAttempts} userErrors:`, msg);
        if (attempt === maxAttempts) return { ok: false, error: msg };
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }

      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro";
      console.error(`[step7] ${filename} tentativa ${attempt}/${maxAttempts} exceção:`, msg);
      if (attempt === maxAttempts) return { ok: false, error: msg };
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  return { ok: false, error: "Max attempts reached" };
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      themeId,
      primaryColor,
      secondaryColor,
      logoUrl,
      faviconUrl,
      bannerDesktopUrl,
      bannerMobileUrl,
      collections,
    } = body;

    if (!themeId) {
      return NextResponse.json(
        { success: false, message: "themeId não fornecido.", errors: [] },
        { status: 400 }
      );
    }

    const client = new ShopifyClient(session.shop, session.accessToken);

    const imageMap: Record<string, string> = {};
    const imageEntries: { key: string; url: string }[] = [];

    if (logoUrl) imageEntries.push({ key: "logo", url: logoUrl });
    if (faviconUrl) imageEntries.push({ key: "favicon", url: faviconUrl });
    if (bannerDesktopUrl) imageEntries.push({ key: "bannerDesktop", url: bannerDesktopUrl });
    if (bannerMobileUrl) imageEntries.push({ key: "bannerMobile", url: bannerMobileUrl });

    const imageWarnings: string[] = [];

    for (const entry of imageEntries) {
      const result = await uploadAndResolveImage(client, entry.url, entry.key);
      if (result) {
        imageMap[entry.key] = result.imageUrl;
      } else {
        imageWarnings.push(`Imagem "${entry.key}" não pôde ser processada pela Files API.`);
      }
    }

    const themeConfig: ThemeConfig = {
      shop: session.shop,
      accessToken: session.accessToken,
      primaryColor: primaryColor || "#6d388b",
      secondaryColor: secondaryColor || "#a7d92f",
      logoUrl: imageMap["logo"] || undefined,
      faviconUrl: imageMap["favicon"] || undefined,
      bannerDesktopUrl: imageMap["bannerDesktop"] || undefined,
      bannerMobileUrl: imageMap["bannerMobile"] || undefined,
      collections: collections || [],
    };

    const settingsData = buildSettingsData(themeConfig);
    const indexJson = buildIndexJson(themeConfig);

    const errors: { file: string; reason: string }[] = [];
    const upserted: string[] = [];

    const settingsResult = await upsertFileWithRetry(
      client,
      themeId,
      "config/settings_data.json",
      JSON.stringify(settingsData)
    );
    if (settingsResult.ok) {
      upserted.push("config/settings_data.json");
    } else {
      errors.push({ file: "config/settings_data.json", reason: settingsResult.error || "Falha" });
    }

    const indexResult = await upsertFileWithRetry(
      client,
      themeId,
      "templates/index.json",
      JSON.stringify(indexJson)
    );
    if (indexResult.ok) {
      upserted.push("templates/index.json");
    } else {
      errors.push({ file: "templates/index.json", reason: indexResult.error || "Falha" });
    }

    return NextResponse.json({
      success: upserted.length > 0,
      files: upserted,
      errors,
      imageWarnings,
      message:
        errors.length === 0
          ? `${upserted.length} arquivos configurados com sucesso`
          : `${upserted.length} OK, ${errors.length} falharam após retentativas`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro interno";
    console.error("[step7] Erro fatal:", msg);
    return NextResponse.json(
      { success: false, message: msg, errors: [] },
      { status: 500 }
    );
  }
}
