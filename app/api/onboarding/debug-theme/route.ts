import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ShopifyClient } from "@/lib/shopify";

const THEME_FILES_QUERY = `
  query themeFiles($themeId: ID!) {
    theme(id: $themeId) {
      id
      name
      role
      files(filenames: [
        "config/settings_data.json",
        "config/settings_schema.json",
        "templates/index.json",
        "layout/theme.liquid"
      ], first: 10) {
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

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  try {
    const { themeId } = await request.json();

    if (!themeId) {
      return NextResponse.json({ error: "themeId não fornecido." }, { status: 400 });
    }

    const client = new ShopifyClient(session.shop, session.accessToken);
    const data = await client.graphql(THEME_FILES_QUERY, { themeId });

    const result = data as {
      theme: {
        id: string;
        name: string;
        role: string;
        files: {
          nodes: { filename: string; body?: { content?: string } }[];
        };
      };
    };

    const files: Record<string, string | null> = {};
    for (const node of result.theme.files.nodes) {
      const content = node.body?.content || null;
      files[node.filename] = content;
      console.log(`\n========== ${node.filename} ==========`);
      console.log(content || "(sem conteúdo)");
      console.log(`========== FIM ${node.filename} ==========\n`);
    }

    return NextResponse.json({
      theme: {
        id: result.theme.id,
        name: result.theme.name,
        role: result.theme.role,
      },
      files,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro interno";
    console.error("[debug-theme] Erro:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
