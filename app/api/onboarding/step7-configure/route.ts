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
        { success: false, errors: ["themeId não fornecido."] },
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

    const files = [
      {
        filename: "config/settings_data.json",
        body: { type: "TEXT", value: JSON.stringify(settingsData) },
      },
      {
        filename: "templates/index.json",
        body: { type: "TEXT", value: JSON.stringify(indexJson) },
      },
    ];

    const data = await client.graphqlWithRetry(THEME_FILES_UPSERT, {
      themeId,
      files,
    });

    const result = data as {
      themeFilesUpsert: {
        upsertedThemeFiles: { filename: string }[] | null;
        userErrors: { field: string; message: string }[];
      };
    };

    if (result.themeFilesUpsert.userErrors.length > 0) {
      return NextResponse.json({
        success: false,
        errors: result.themeFilesUpsert.userErrors.map((e) => e.message),
      });
    }

    return NextResponse.json({
      success: true,
      files: result.themeFilesUpsert.upsertedThemeFiles?.map(
        (f) => f.filename
      ),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json(
      { success: false, errors: [msg] },
      { status: 500 }
    );
  }
}
