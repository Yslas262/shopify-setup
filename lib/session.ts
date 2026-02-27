import { sealData, unsealData } from "iron-session";
import { cookies } from "next/headers";

export interface ShopifySession {
  shop: string;
  accessToken: string;
}

export const sessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: "shopify_session",
};

export async function getSession(): Promise<ShopifySession | null> {
  const cookieStore = cookies();
  const sealed = cookieStore.get(sessionOptions.cookieName)?.value;
  if (!sealed) return null;

  try {
    return await unsealData<ShopifySession>(sealed, {
      password: sessionOptions.password,
    });
  } catch {
    return null;
  }
}

export async function sealSession(data: ShopifySession): Promise<string> {
  return sealData(data, { password: sessionOptions.password });
}
