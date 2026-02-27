"use client";

import { useState, useRef, FormEvent } from "react";

interface CollectionField {
  name: string;
  image: File | null;
}

interface StepDef {
  id: number;
  label: string;
  endpoint: string;
}

const STEPS: StepDef[] = [
  { id: 1, label: "Validar CSV", endpoint: "/api/onboarding/step1-csv" },
  { id: 2, label: "Importar Produtos", endpoint: "/api/onboarding/step2-products" },
  { id: 3, label: "Criar Coleções", endpoint: "/api/onboarding/step3-collections" },
  { id: 4, label: "Upload do Tema", endpoint: "/api/onboarding/step4-theme" },
  { id: 5, label: "Upload de Imagens", endpoint: "/api/onboarding/step5-images" },
  { id: 6, label: "Configurar Tema", endpoint: "/api/onboarding/step7-configure" },
  { id: 7, label: "Publicar Tema", endpoint: "/api/onboarding/step6-publish" },
  { id: 8, label: "Menus e Políticas", endpoint: "/api/onboarding/step8-menus" },
];

interface PipelineData {
  csvText: string;
  totalProducts: number;
  productIds: string[];
  collections: { id: string; handle: string; name: string }[];
  bestSellersId: string;
  themeId: string;
  logoUrl: string;
  faviconUrl: string;
  bannerDesktopUrl: string;
  bannerMobileUrl: string;
  collectionImages: { handle: string; url: string }[];
}

export default function OnboardingPage() {
  const [logo, setLogo] = useState<File | null>(null);
  const [favicon, setFavicon] = useState<File | null>(null);
  const [primaryColor, setPrimaryColor] = useState("#6d388b");
  const [secondaryColor, setSecondaryColor] = useState("#a7d92f");
  const [bannerDesktop, setBannerDesktop] = useState<File | null>(null);
  const [bannerMobile, setBannerMobile] = useState<File | null>(null);
  const [collections, setCollections] = useState<CollectionField[]>([
    { name: "", image: null },
  ]);
  const [csvFile, setCsvFile] = useState<File | null>(null);

  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [stepErrors, setStepErrors] = useState<Record<number, string>>({});
  const [done, setDone] = useState(false);

  const pipeRef = useRef<PipelineData>({
    csvText: "",
    totalProducts: 0,
    productIds: [],
    collections: [],
    bestSellersId: "",
    themeId: "",
    logoUrl: "",
    faviconUrl: "",
    bannerDesktopUrl: "",
    bannerMobileUrl: "",
    collectionImages: [],
  });

  function addCollection() {
    if (collections.length >= 7) return;
    setCollections([...collections, { name: "", image: null }]);
  }

  function removeCollection(idx: number) {
    setCollections(collections.filter((_, i) => i !== idx));
  }

  function updateCollection(
    idx: number,
    field: "name" | "image",
    value: string | File | null
  ) {
    const updated = [...collections];
    if (field === "name") updated[idx].name = value as string;
    else updated[idx].image = value as File | null;
    setCollections(updated);
  }

  async function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  async function runStep(stepDef: StepDef): Promise<boolean> {
    const pipe = pipeRef.current;
    let body: BodyInit;
    let headers: Record<string, string> = {};

    switch (stepDef.id) {
      case 1: {
        body = JSON.stringify({ csvText: pipe.csvText });
        headers["Content-Type"] = "application/json";
        break;
      }
      case 2: {
        body = JSON.stringify({ csvText: pipe.csvText });
        headers["Content-Type"] = "application/json";
        break;
      }
      case 3: {
        const colNames = collections
          .filter((c) => c.name.trim())
          .map((c) => c.name.trim());
        body = JSON.stringify({
          collections: colNames,
          productIds: pipe.productIds,
        });
        headers["Content-Type"] = "application/json";
        break;
      }
      case 4: {
        body = JSON.stringify({});
        headers["Content-Type"] = "application/json";
        break;
      }
      case 5: {
        const fd = new FormData();
        if (logo) fd.append("logo", logo);
        if (favicon) fd.append("favicon", favicon);
        if (bannerDesktop) fd.append("bannerDesktop", bannerDesktop);
        if (bannerMobile) fd.append("bannerMobile", bannerMobile);
        collections.forEach((col, i) => {
          if (col.image) fd.append(`collection_image_${i}`, col.image);
        });
        fd.append(
          "collectionMeta",
          JSON.stringify(
            pipe.collections.map((c, i) => ({
              ...c,
              imageIndex: collections[i]?.image ? i : null,
            }))
          )
        );
        body = fd;
        break;
      }
      case 6: {
        body = JSON.stringify({
          themeId: pipe.themeId,
          primaryColor,
          secondaryColor,
          logoUrl: pipe.logoUrl,
          faviconUrl: pipe.faviconUrl,
          bannerDesktopUrl: pipe.bannerDesktopUrl,
          bannerMobileUrl: pipe.bannerMobileUrl,
          collections: pipe.collections,
        });
        headers["Content-Type"] = "application/json";
        break;
      }
      case 7: {
        body = JSON.stringify({ themeId: pipe.themeId });
        headers["Content-Type"] = "application/json";
        break;
      }
      case 8: {
        body = JSON.stringify({ collections: pipe.collections });
        headers["Content-Type"] = "application/json";
        break;
      }
      default:
        return false;
    }

    const res = await fetch(stepDef.endpoint, {
      method: "POST",
      headers,
      body,
    });

    const data = await res.json();

    if (!data.success) {
      throw new Error(
        data.errors?.join("; ") || data.error || "Erro desconhecido"
      );
    }

    switch (stepDef.id) {
      case 1:
        pipe.totalProducts = data.totalProducts;
        break;
      case 2:
        pipe.productIds = data.productIds || [];
        break;
      case 3:
        pipe.collections = data.collections || [];
        pipe.bestSellersId = data.bestSellersId || "";
        break;
      case 4:
        pipe.themeId = data.themeId || "";
        break;
      case 5:
        pipe.logoUrl = data.logoUrl || "";
        pipe.faviconUrl = data.faviconUrl || "";
        pipe.bannerDesktopUrl = data.bannerDesktopUrl || "";
        pipe.bannerMobileUrl = data.bannerMobileUrl || "";
        pipe.collectionImages = data.collectionImages || [];
        break;
    }

    return true;
  }

  async function handleStart(e: FormEvent) {
    e.preventDefault();
    if (!csvFile) return;

    setRunning(true);
    setCompletedSteps([]);
    setStepErrors({});
    setDone(false);

    pipeRef.current.csvText = await readFileAsText(csvFile);

    for (const stepDef of STEPS) {
      setCurrentStep(stepDef.id);
      try {
        await runStep(stepDef);
        setCompletedSteps((prev) => [...prev, stepDef.id]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro desconhecido";
        setStepErrors((prev) => ({ ...prev, [stepDef.id]: msg }));
        setRunning(false);
        return;
      }
    }

    setDone(true);
    setRunning(false);
  }

  async function handleRetry() {
    setRunning(true);
    const failedStep = STEPS.find((s) => stepErrors[s.id]);
    if (!failedStep) return;

    setStepErrors((prev) => {
      const next = { ...prev };
      delete next[failedStep.id];
      return next;
    });

    const startIdx = STEPS.indexOf(failedStep);

    for (let i = startIdx; i < STEPS.length; i++) {
      const stepDef = STEPS[i];
      setCurrentStep(stepDef.id);
      try {
        await runStep(stepDef);
        setCompletedSteps((prev) =>
          prev.includes(stepDef.id) ? prev : [...prev, stepDef.id]
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro desconhecido";
        setStepErrors((prev) => ({ ...prev, [stepDef.id]: msg }));
        setRunning(false);
        return;
      }
    }

    setDone(true);
    setRunning(false);
  }

  const hasError = Object.keys(stepErrors).length > 0;
  const formReady =
    csvFile &&
    collections.some((c) => c.name.trim()) &&
    primaryColor &&
    secondaryColor;

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="text-center">
          <h1 className="text-3xl font-bold text-white mb-2">
            Store Onboarding
          </h1>
          <p className="text-slate-300">
            Preencha os dados abaixo e inicie o setup automatizado
          </p>
        </header>

        {/* ── PROGRESS BAR ── */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Progresso</h2>
          <div className="space-y-2">
            {STEPS.map((step) => {
              const isCompleted = completedSteps.includes(step.id);
              const isCurrent = currentStep === step.id && running;
              const error = stepErrors[step.id];

              return (
                <div
                  key={step.id}
                  className={`flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${
                    isCompleted
                      ? "bg-emerald-500/20"
                      : isCurrent
                        ? "bg-blue-500/20"
                        : error
                          ? "bg-red-500/20"
                          : "bg-white/5"
                  }`}
                >
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0">
                    {isCompleted ? (
                      <span className="text-emerald-400 text-lg">&#10003;</span>
                    ) : isCurrent ? (
                      <svg
                        className="animate-spin h-5 w-5 text-blue-400"
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
                    ) : error ? (
                      <span className="text-red-400 text-lg">&#10007;</span>
                    ) : (
                      <span className="text-slate-500">{step.id}</span>
                    )}
                  </div>
                  <span
                    className={`text-sm ${
                      isCompleted
                        ? "text-emerald-300"
                        : isCurrent
                          ? "text-blue-300"
                          : error
                            ? "text-red-300"
                            : "text-slate-400"
                    }`}
                  >
                    Etapa {step.id}: {step.label}
                  </span>
                  {error && (
                    <span className="ml-auto text-xs text-red-400 max-w-xs truncate">
                      {error}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {hasError && !running && (
            <button
              onClick={handleRetry}
              className="mt-4 w-full py-2 px-4 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-xl transition"
            >
              Tentar Novamente
            </button>
          )}

          {done && (
            <div className="mt-4 bg-emerald-500/20 border border-emerald-500/30 rounded-xl px-4 py-3 text-center">
              <p className="text-emerald-300 font-semibold">
                Setup concluído com sucesso!
              </p>
            </div>
          )}
        </div>

        {/* ── FORM ── */}
        {!done && (
          <form
            onSubmit={handleStart}
            className="bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 p-6 space-y-6"
          >
            {/* IDENTIDADE */}
            <fieldset className="space-y-4">
              <legend className="text-lg font-semibold text-white mb-2">
                Identidade
              </legend>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FileInput
                  label="Logo (PNG/SVG)"
                  accept=".png,.svg"
                  onChange={setLogo}
                  fileName={logo?.name}
                  disabled={running}
                />
                <FileInput
                  label="Favicon (PNG)"
                  accept=".png"
                  onChange={setFavicon}
                  fileName={favicon?.name}
                  disabled={running}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ColorInput
                  label="Cor Primária"
                  value={primaryColor}
                  onChange={setPrimaryColor}
                  disabled={running}
                />
                <ColorInput
                  label="Cor Secundária"
                  value={secondaryColor}
                  onChange={setSecondaryColor}
                  disabled={running}
                />
              </div>
            </fieldset>

            {/* BANNER */}
            <fieldset className="space-y-4">
              <legend className="text-lg font-semibold text-white mb-2">
                Banner
              </legend>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FileInput
                  label="Imagem Desktop (JPG/PNG)"
                  accept=".jpg,.jpeg,.png"
                  onChange={setBannerDesktop}
                  fileName={bannerDesktop?.name}
                  disabled={running}
                />
                <FileInput
                  label="Imagem Mobile (JPG/PNG)"
                  accept=".jpg,.jpeg,.png"
                  onChange={setBannerMobile}
                  fileName={bannerMobile?.name}
                  disabled={running}
                />
              </div>
            </fieldset>

            {/* COLEÇÕES */}
            <fieldset className="space-y-4">
              <legend className="text-lg font-semibold text-white mb-2">
                Coleções (máx. 7)
              </legend>
              {collections.map((col, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 bg-white/5 rounded-xl p-3"
                >
                  <div className="flex-1 space-y-2">
                    <input
                      type="text"
                      placeholder="Nome da coleção"
                      value={col.name}
                      onChange={(e) =>
                        updateCollection(idx, "name", e.target.value)
                      }
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      disabled={running}
                    />
                    <FileInput
                      label="Imagem da coleção"
                      accept=".jpg,.jpeg,.png"
                      onChange={(f) => updateCollection(idx, "image", f)}
                      fileName={col.image?.name}
                      disabled={running}
                      compact
                    />
                  </div>
                  {collections.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeCollection(idx)}
                      className="text-red-400 hover:text-red-300 text-xl mt-1"
                      disabled={running}
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
              {collections.length < 7 && (
                <button
                  type="button"
                  onClick={addCollection}
                  className="text-sm text-emerald-400 hover:text-emerald-300"
                  disabled={running}
                >
                  + Adicionar Coleção
                </button>
              )}
            </fieldset>

            {/* CSV */}
            <fieldset className="space-y-4">
              <legend className="text-lg font-semibold text-white mb-2">
                CSV de Produtos
              </legend>
              <FileInput
                label="Arquivo CSV (formato Shopify/DSers)"
                accept=".csv"
                onChange={setCsvFile}
                fileName={csvFile?.name}
                disabled={running}
              />
            </fieldset>

            {/* SUBMIT */}
            <button
              type="submit"
              disabled={running || !formReady}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all duration-200 shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 text-lg"
            >
              {running ? "Processando..." : "INICIAR SETUP"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

/* ── Sub-components ── */

function FileInput({
  label,
  accept,
  onChange,
  fileName,
  disabled,
  compact,
}: {
  label: string;
  accept: string;
  onChange: (file: File | null) => void;
  fileName?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div>
      {!compact && (
        <label className="block text-sm font-medium text-slate-200 mb-1">
          {label}
        </label>
      )}
      <div
        onClick={() => !disabled && ref.current?.click()}
        className={`flex items-center gap-2 px-3 ${compact ? "py-1.5" : "py-2.5"} bg-white/5 border border-white/10 rounded-lg cursor-pointer hover:border-white/20 transition ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <span className="text-xs text-emerald-400 shrink-0">
          {compact ? label : "Selecionar"}
        </span>
        <span className="text-xs text-slate-400 truncate">
          {fileName || "Nenhum arquivo"}
        </span>
        <input
          ref={ref}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

function ColorInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-200 mb-1">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-10 rounded-lg border border-white/10 cursor-pointer bg-transparent"
          disabled={disabled}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          placeholder="#000000"
          disabled={disabled}
        />
      </div>
    </div>
  );
}
