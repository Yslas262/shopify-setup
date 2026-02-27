import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { validateCSV } from "@/lib/csv-parser";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  try {
    const { csvText } = await request.json();

    if (!csvText || typeof csvText !== "string") {
      return NextResponse.json(
        { success: false, errors: ["CSV não fornecido."], warnings: [], message: "CSV não fornecido." },
        { status: 400 }
      );
    }

    const result = validateCSV(csvText);
    return NextResponse.json({
      ...result,
      message: result.success
        ? `${result.totalProducts} produtos encontrados no CSV`
        : `Validação falhou: ${(result.errors || []).join("; ")}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro interno";
    console.error("[step1] Erro:", msg);
    return NextResponse.json(
      { success: false, errors: [msg], warnings: [], message: msg },
      { status: 500 }
    );
  }
}
