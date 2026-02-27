"use client";

import { useState, FormEvent } from "react";

const SCOPES = [
  "read_products",
  "write_products",
  "read_themes",
  "write_themes",
  "read_files",
  "write_files",
  "write_content",
  "read_content",
  "read_online_store_navigation",
  "write_online_store_navigation",
  "read_publications",
  "write_publications",
].join(",");

export default function HomePage() {
  const [shopUrl, setShopUrl] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function normalizeShop(input: string): string {
    let cleaned = input.trim().toLowerCase();
    cleaned = cleaned.replace(/^https?:\/\//, "");
    cleaned = cleaned.replace(/\/.*$/, "");
    if (!cleaned.endsWith(".myshopify.com")) {
      cleaned = `${cleaned}.myshopify.com`;
    }
    return cleaned;
  }

  async function handleConnect(e: FormEvent) {
    e.preventDefault();
    setError("");

    const shop = normalizeShop(shopUrl);
    if (!shop.match(/^[a-z0-9-]+\.myshopify\.com$/)) {
      setError("URL inválida. Use o formato: minha-loja.myshopify.com");
      return;
    }
    if (!clientId.trim()) {
      setError("Client ID é obrigatório.");
      return;
    }
    if (!clientSecret.trim()) {
      setError("Client Secret é obrigatório.");
      return;
    }

    setLoading(true);

    const state = crypto.randomUUID();

    sessionStorage.setItem(
      "shopify_temp",
      JSON.stringify({ shop, clientId: clientId.trim(), clientSecret: clientSecret.trim() })
    );

    try {
      const res = await fetch("/api/auth/store-temp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop,
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          state,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Erro ao salvar credenciais temporárias.");
        setLoading(false);
        return;
      }

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
      const redirectUri = `${appUrl.replace(/\/$/, "")}/api/auth/callback`;

      const installUrl =
        `https://${shop}/admin/oauth/authorize?` +
        `client_id=${encodeURIComponent(clientId.trim())}&` +
        `scope=${encodeURIComponent(SCOPES)}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `state=${state}`;

      window.location.href = installUrl;
    } catch {
      setError("Erro de conexão. Tente novamente.");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 p-8 shadow-2xl">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/20 mb-4">
              <svg
                className="w-8 h-8 text-emerald-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">
              Shopify Store Setup
            </h1>
            <p className="text-slate-300 text-sm">
              Conecte sua loja com as credenciais do seu app
            </p>
          </div>

          <form onSubmit={handleConnect} className="space-y-4">
            <div>
              <label
                htmlFor="shop-url"
                className="block text-sm font-medium text-slate-200 mb-1.5"
              >
                Store URL
              </label>
              <input
                id="shop-url"
                type="text"
                placeholder="minha-loja.myshopify.com"
                value={shopUrl}
                onChange={(e) => setShopUrl(e.target.value)}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                required
              />
            </div>

            <div>
              <label
                htmlFor="client-id"
                className="block text-sm font-medium text-slate-200 mb-1.5"
              >
                Client ID
              </label>
              <input
                id="client-id"
                type="text"
                placeholder="ID do app criado no Dev Dashboard"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition font-mono text-sm"
                required
              />
            </div>

            <div>
              <label
                htmlFor="client-secret"
                className="block text-sm font-medium text-slate-200 mb-1.5"
              >
                Client Secret
              </label>
              <input
                id="client-secret"
                type="password"
                placeholder="Secret do app criado no Dev Dashboard"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition font-mono text-sm"
                required
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                <p className="text-red-300 text-sm">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !shopUrl.trim() || !clientId.trim() || !clientSecret.trim()}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <svg
                    className="animate-spin h-5 w-5"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Redirecionando...
                </span>
              ) : (
                "Conectar Loja"
              )}
            </button>
          </form>

          <p className="text-center text-xs text-slate-400 mt-6">
            Suas credenciais são usadas apenas para esta sessão OAuth
          </p>
        </div>
      </div>
    </main>
  );
}
