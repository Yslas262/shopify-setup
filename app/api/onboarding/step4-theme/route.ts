import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ShopifyClient } from "@/lib/shopify";

const THEME_CREATE = `
  mutation themeCreate($name: String!, $source: URL!) {
    themeCreate(name: $name, source: $source) {
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

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const themeZipUrl = process.env.THEME_ZIP_URL;
  if (!themeZipUrl) {
    return NextResponse.json(
      { success: false, errors: ["THEME_ZIP_URL não configurada."] },
      { status: 500 }
    );
  }

  try {
    const client = new ShopifyClient(session.shop, session.accessToken);
    const storeName = session.shop.replace(".myshopify.com", "");
    const themeName = `Shining Pro - ${storeName}`;

    const createData = await client.graphqlWithRetry(THEME_CREATE, {
      name: themeName,
      source: themeZipUrl,
    });

    const createResult = createData as {
      themeCreate: {
        theme: { id: string; processing: boolean } | null;
        userErrors: { field: string; message: string }[];
      };
    };

    if (createResult.themeCreate.userErrors.length > 0) {
      return NextResponse.json({
        success: false,
        errors: createResult.themeCreate.userErrors.map((e) => e.message),
      });
    }

    const themeId = createResult.themeCreate.theme?.id;
    if (!themeId) {
      return NextResponse.json({
        success: false,
        errors: ["themeCreate não retornou ID."],
      });
    }

    const MAX_POLLS = 60;
    const POLL_INTERVAL = 3000;

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));

      const statusData = await client.graphql(THEME_STATUS, { id: themeId });
      const statusResult = statusData as {
        theme: { id: string; processing: boolean };
      };

      if (!statusResult.theme.processing) {
        return NextResponse.json({ success: true, themeId });
      }
    }

    return NextResponse.json({
      success: false,
      themeId,
      errors: ["Timeout: tema ainda processando após 3 minutos."],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json(
      { success: false, errors: [msg] },
      { status: 500 }
    );
  }
}
