import { NextRequest, NextResponse } from "next/server";
import { sealData } from "iron-session";

export interface TempCredentials {
  shop: string;
  clientId: string;
  clientSecret: string;
  state: string;
}

const COOKIE_NAME = "shopify_temp_creds";

export async function POST(request: NextRequest) {
  try {
    const { shop, clientId, clientSecret, state } = await request.json();

    if (!shop || !clientId || !clientSecret || !state) {
      return NextResponse.json(
        { error: "Todos os campos são obrigatórios." },
        { status: 400 }
      );
    }

    const password = process.env.SESSION_SECRET;
    if (!password) {
      return NextResponse.json(
        { error: "SESSION_SECRET não configurado." },
        { status: 500 }
      );
    }

    const sealed = await sealData(
      { shop, clientId, clientSecret, state } satisfies TempCredentials,
      { password }
    );

    const response = NextResponse.json({ ok: true });

    response.cookies.set(COOKIE_NAME, sealed, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 300,
    });

    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
