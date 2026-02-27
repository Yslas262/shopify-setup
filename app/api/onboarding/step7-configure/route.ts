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

    const themeConfig: ThemeConfig = {
      shop: session.shop,
      accessToken: session.accessToken,
      primaryColor: primaryColor || "#6d388b",
      secondaryColor: secondaryColor || "#a7d92f",
      logoUrl,
      faviconUrl,
      bannerDesktopUrl,
      bannerMobileUrl,
      collections: collections || [],
    };

    const settingsData = buildSettingsData(themeConfig);
    const indexJson = buildIndexJson(themeConfig);

    const client = new ShopifyClient(session.shop, session.accessToken);
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
