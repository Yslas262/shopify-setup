import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ShopifyClient } from "@/lib/shopify";

const THEME_FILES_READ = `
  query themeFiles($themeId: ID!) {
    theme(id: $themeId) {
      files(filenames: ["config/settings_data.json", "templates/index.json"], first: 2) {
        nodes {
          filename
          body {
            ... on OnlineStoreThemeFileBodyText { content }
          }
        }
      }
    }
  }
`;

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

function stripJsonComments(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) return text;
  return text.substring(start);
}

function toShopifyImageRef(cdnUrl: string): string {
  const withoutQuery = cdnUrl.split("?")[0];
  const segments = withoutQuery.split("/");
  return `shopify://shop_images/${segments[segments.length - 1]}`;
}

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

async function readThemeFile(
  client: ShopifyClient,
  themeId: string
): Promise<{ settingsData: string | null; indexJson: string | null }> {
  const data = await client.graphql(THEME_FILES_READ, { themeId });
  const result = data as {
    theme: { files: { nodes: { filename: string; body?: { content?: string } }[] } };
  };

  let settingsData: string | null = null;
  let indexJson: string | null = null;

  for (const node of result.theme.files.nodes) {
    const content = node.body?.content || null;
    if (node.filename === "config/settings_data.json") settingsData = content;
    if (node.filename === "templates/index.json") indexJson = content;
  }

  return { settingsData, indexJson };
}

function patchSettingsData(
  raw: string,
  patches: { logo?: string; favicon?: string; primaryColor?: string; secondaryColor?: string }
): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = JSON.parse(stripJsonComments(raw)) as any;
  const current = obj.current || obj;

  if (patches.logo) current.logo = patches.logo;
  if (patches.favicon) current.favicon = patches.favicon;
  if (patches.primaryColor) {
    current.colors_accent_1 = patches.primaryColor;
    current.colors_outline_button_labels = patches.primaryColor;
  }
  if (patches.secondaryColor) {
    current.colors_accent_2 = patches.secondaryColor;
  }

  return JSON.stringify(obj);
}

function patchIndexJson(
  raw: string,
  patches: { bannerDesktop?: string; bannerMobile?: string; collections?: { handle: string }[] }
): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = JSON.parse(stripJsonComments(raw)) as any;
  const sections = obj.sections || {};

  for (const sectionId of Object.keys(sections)) {
    const section = sections[sectionId];
    if (section.type !== "slideshow") continue;

    const blocks = section.blocks || {};
    for (const blockId of Object.keys(blocks)) {
      const block = blocks[blockId];
      if (block.type !== "slide") continue;
      if (!block.settings) block.settings = {};
      if (patches.bannerDesktop) block.settings.image = patches.bannerDesktop;
      if (patches.bannerMobile) block.settings.mobile_image = patches.bannerMobile;
      break;
    }
    break;
  }

  if (patches.collections && patches.collections.length > 0) {
    for (const sectionId of Object.keys(sections)) {
      const section = sections[sectionId];
      if (section.type !== "collection-list") continue;

      const newBlocks: Record<string, object> = {};
      const newOrder: string[] = [];

      patches.collections.forEach((col) => {
        const blockId = `featured_collection_${Math.random().toString(36).substring(2, 8)}`;
        newBlocks[blockId] = {
          type: "featured_collection",
          settings: { collection: col.handle, custom_title: "" },
        };
        newOrder.push(blockId);
      });

      section.blocks = newBlocks;
      section.block_order = newOrder;
      if (section.settings) {
        section.settings.columns_desktop = Math.max(1, Math.min(patches.collections.length, 5));
      }
      break;
    }
  }

  return JSON.stringify(obj);
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

    // PASSO 1 — Ler os arquivos atuais do tema
    const themeFiles = await readThemeFile(client, themeId);
    if (!themeFiles.settingsData || !themeFiles.indexJson) {
      return NextResponse.json({
        success: false,
        message: "Não foi possível ler os arquivos atuais do tema.",
        errors: [],
      });
    }

    // PASSO 2 — Upload das imagens para Files API e converter para shopify://shop_images/
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
        const shopifyRef = toShopifyImageRef(result.imageUrl);
        console.log(`[step7] ${entry.key}: CDN=${result.imageUrl} → ${shopifyRef}`);
        imageMap[entry.key] = shopifyRef;
      } else {
        imageWarnings.push(`Imagem "${entry.key}" não pôde ser processada pela Files API.`);
      }
    }

    // PASSO 3 — Patch dos arquivos (ler → modificar → salvar)
    const patchedSettings = patchSettingsData(themeFiles.settingsData, {
      logo: imageMap["logo"],
      favicon: imageMap["favicon"],
      primaryColor: primaryColor || undefined,
      secondaryColor: secondaryColor || undefined,
    });

    const patchedIndex = patchIndexJson(themeFiles.indexJson, {
      bannerDesktop: imageMap["bannerDesktop"],
      bannerMobile: imageMap["bannerMobile"],
      collections: collections || [],
    });

    console.log("[step7] PATCHED settings_data.json (logo/favicon):",
      imageMap["logo"] || "(não alterado)", imageMap["favicon"] || "(não alterado)");
    console.log("[step7] PATCHED index.json (image/mobile_image):",
      imageMap["bannerDesktop"] || "(não alterado)", imageMap["bannerMobile"] || "(não alterado)");

    // PASSO 4 — Upsert
    const errors: { file: string; reason: string }[] = [];
    const upserted: string[] = [];

    const settingsResult = await upsertFileWithRetry(
      client, themeId, "config/settings_data.json", patchedSettings
    );
    if (settingsResult.ok) {
      upserted.push("config/settings_data.json");
    } else {
      errors.push({ file: "config/settings_data.json", reason: settingsResult.error || "Falha" });
    }

    const indexResult = await upsertFileWithRetry(
      client, themeId, "templates/index.json", patchedIndex
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
