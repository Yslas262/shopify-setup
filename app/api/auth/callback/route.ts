import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const shop = searchParams.get("shop");
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const hmac = searchParams.get("hmac");

  if (!shop || !code || !state || !hmac) {
    return NextResponse.json(
      { error: "Parâmetros obrigatórios ausentes." },
      { status: 400 }
    );
  }

  // 1. Validate state (anti-CSRF)
  const savedNonce = request.cookies.get("shopify_nonce")?.value;
  if (!savedNonce || savedNonce !== state) {
    return NextResponse.json(
      { error: "Validação CSRF falhou — state inválido." },
      { status: 403 }
    );
  }

  // 2. Validate HMAC
  if (!verifyHmac(searchParams)) {
    return NextResponse.json(
      { error: "Validação HMAC falhou." },
      { status: 403 }
    );
  }

  // 3. Exchange code for access_token
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!clientId || !clientSecret || !appUrl) {
    return NextResponse.json(
      { error: "Variáveis de ambiente não configuradas." },
      { status: 500 }
    );
  }

  const tokenResponse = await fetch(
    `https://${shop}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    }
  );

  if (!tokenResponse.ok) {
    return NextResponse.json(
      { error: "Falha ao obter access_token da Shopify." },
      { status: 502 }
    );
  }

  const { access_token } = await tokenResponse.json();

  if (!access_token) {
    return NextResponse.json(
      { error: "access_token não retornado pela Shopify." },
      { status: 502 }
    );
  }

  // 4. Encrypt and store session in httpOnly cookie
  const sessionData = JSON.stringify({ shop, accessToken: access_token });
  const encryptedSession = encrypt(sessionData);

  const redirectUrl = new URL("/onboarding", appUrl);
  const response = NextResponse.redirect(redirectUrl);

  response.cookies.set("shopify_session", encryptedSession, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 86400, // 24 hours
  });

  response.cookies.delete("shopify_nonce");

  return response;
}

function verifyHmac(params: URLSearchParams): boolean {
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!secret) return false;

  const entries: [string, string][] = [];
  params.forEach((value, key) => {
    if (key !== "hmac") {
      entries.push([key, value]);
    }
  });
  entries.sort(([a], [b]) => a.localeCompare(b));

  const message = entries.map(([k, v]) => `${k}=${v}`).join("&");
  const hmac = params.get("hmac") || "";

  const computed = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(hmac, "hex"),
    Buffer.from(computed, "hex")
  );
}

function encrypt(text: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET não configurado");

  const key = crypto.scryptSync(secret, "shopify-setup-salt", 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  return iv.toString("hex") + ":" + encrypted;
}
