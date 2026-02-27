import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { unsealData } from "iron-session";
import { sealSession, sessionOptions } from "@/lib/session";
import type { TempCredentials } from "@/app/api/auth/store-temp/route";

const TEMP_COOKIE_NAME = "shopify_temp_creds";

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

  const password = process.env.SESSION_SECRET;
  if (!password) {
    return NextResponse.json(
      { error: "SESSION_SECRET não configurado." },
      { status: 500 }
    );
  }

  const tempCookie = request.cookies.get(TEMP_COOKIE_NAME)?.value;
  if (!tempCookie) {
    return NextResponse.json(
      { error: "Credenciais temporárias ausentes. Refaça a conexão." },
      { status: 403 }
    );
  }

  let creds: TempCredentials;
  try {
    creds = await unsealData<TempCredentials>(tempCookie, { password });
  } catch {
    return NextResponse.json(
      { error: "Cookie temporário inválido. Refaça a conexão." },
      { status: 403 }
    );
  }

  if (creds.state !== state) {
    return NextResponse.json(
      { error: "Validação CSRF falhou — state inválido." },
      { status: 403 }
    );
  }

  if (!verifyHmac(searchParams, creds.clientSecret)) {
    return NextResponse.json(
      { error: "Validação HMAC falhou." },
      { status: 403 }
    );
  }

  const tokenResponse = await fetch(
    `https://${shop}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
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

  const sealed = await sealSession({ shop, accessToken: access_token });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${request.nextUrl.host}`;
  const response = NextResponse.redirect(
    new URL("/onboarding", appUrl.replace(/\/$/, ""))
  );

  response.cookies.set(sessionOptions.cookieName, sealed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 86400,
  });

  response.cookies.delete(TEMP_COOKIE_NAME);

  return response;
}

function verifyHmac(params: URLSearchParams, secret: string): boolean {
  const entries: [string, string][] = [];
  params.forEach((value, key) => {
    if (key !== "hmac" && key !== "signature") {
      entries.push([key, value]);
    }
  });
  entries.sort(([a], [b]) => a.localeCompare(b));

  const message = entries.map(([k, v]) => `${k}=${v}`).join("&");
  const hmacParam = params.get("hmac") || "";

  const computed = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  if (hmacParam.length !== computed.length) return false;

  return crypto.timingSafeEqual(
    Buffer.from(hmacParam, "utf8"),
    Buffer.from(computed, "utf8")
  );
}
