"use client";

import { useState, FormEvent } from "react";

export default function HomePage() {
  const [shopUrl, setShopUrl] = useState("");
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
    if (!shop || !shop.match(/^[a-z0-9-]+\.myshopify\.com$/)) {
      setError("URL inválida. Use o formato: minha-loja.myshopify.com");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(
        `/api/auth/install?shop=${encodeURIComponent(shop)}`
      );
      const data = await res.json();

      if (data.installUrl) {
        window.location.href = data.installUrl;
      } else {
        setError(data.error || "Erro ao gerar link de instalação.");
      }
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
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
              Conecte sua loja para iniciar o onboarding automatizado
            </p>
          </div>

          <form onSubmit={handleConnect} className="space-y-5">
            <div>
              <label
                htmlFor="shop-url"
                className="block text-sm font-medium text-slate-200 mb-2"
              >
                Shopify Store URL
              </label>
              <div className="relative">
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
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                <p className="text-red-300 text-sm">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !shopUrl.trim()}
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
                  Conectando...
                </span>
              ) : (
                "Conectar Loja"
              )}
            </button>
          </form>

          <p className="text-center text-xs text-slate-400 mt-6">
            Conexão segura via OAuth 2.0 &mdash; Shopify Partner App
          </p>
        </div>
      </div>
    </main>
  );
}
