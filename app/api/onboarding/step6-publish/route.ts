import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ShopifyClient } from "@/lib/shopify";

const THEME_PUBLISH = `
  mutation themePublish($id: ID!) {
    themePublish(id: $id) {
      theme {
        id
        role
      }
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
    const { themeId } = await request.json();

    if (!themeId) {
      return NextResponse.json(
        { success: false, errors: ["themeId não fornecido."] },
        { status: 400 }
      );
    }

    const client = new ShopifyClient(session.shop, session.accessToken);

    const data = await client.graphqlWithRetry(THEME_PUBLISH, { id: themeId });

    const result = data as {
      themePublish: {
        theme: { id: string; role: string } | null;
        userErrors: { field: string; message: string }[];
      };
    };

    if (result.themePublish.userErrors.length > 0) {
      return NextResponse.json({
        success: false,
        errors: result.themePublish.userErrors.map((e) => e.message),
      });
    }

    const role = result.themePublish.theme?.role || "";

    return NextResponse.json({
      success: role === "MAIN",
      themeRole: role,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json(
      { success: false, errors: [msg] },
      { status: 500 }
    );
  }
}
