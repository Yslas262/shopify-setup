import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const SCOPES = [
  "read_products",
  "write_products",
  "read_themes",
  "write_themes",
  "read_files",
  "write_files",
  "read_content",
  "write_content",
  "read_online_store_navigation",
  "write_online_store_navigation",
  "read_publications",
  "write_publications",
].join(",");

export async function GET(request: NextRequest) {
  const shop = request.nextUrl.searchParams.get("shop");

  if (!shop || !shop.match(/^[a-z0-9-]+\.myshopify\.com$/)) {
    return NextResponse.json(
      { error: "Parâmetro 'shop' inválido ou ausente." },
      { status: 400 }
    );
  }

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!clientId || !appUrl) {
    return NextResponse.json(
      { error: "Variáveis de ambiente não configuradas." },
      { status: 500 }
    );
  }

  const nonce = crypto.randomUUID();
  const redirectUri = `${appUrl}/api/auth/callback`;

  const installUrl =
    `https://${shop}/admin/oauth/authorize?` +
    `client_id=${clientId}&` +
    `scope=${SCOPES}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `state=${nonce}`;

  const response = NextResponse.json({ installUrl });

  response.cookies.set("shopify_nonce", nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes
  });

  return response;
}
