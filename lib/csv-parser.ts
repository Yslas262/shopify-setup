import type { CsvProduct, CsvValidationResult } from "@/types/onboarding";

const REQUIRED_COLUMNS = ["Handle", "Title", "Variant Price"];

const OPTIONAL_COLUMNS = [
  "Body (HTML)",
  "Vendor",
  "Type",
  "Tags",
  "Published",
  "Image Src",
  "Image Position",
];

export function parseCSV(text: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const lines = splitCSVLines(text);
  if (lines.length < 2) {
    return { headers: [], rows: [] };
  }

  const headers = parseCSVRow(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVRow(lines[i]);
    if (values.length === 0 || (values.length === 1 && values[0] === "")) {
      continue;
    }
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] ?? "";
    });
    rows.push(row);
  }

  return { headers, rows };
}

export function validateCSV(text: string): CsvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { headers, rows } = parseCSV(text);

  if (headers.length === 0) {
    return {
      success: false,
      totalProducts: 0,
      errors: ["CSV vazio ou formato inválido."],
      warnings: [],
      preview: [],
    };
  }

  const missingRequired = REQUIRED_COLUMNS.filter(
    (col) => !headers.includes(col)
  );
  if (missingRequired.length > 0) {
    return {
      success: false,
      totalProducts: 0,
      errors: [`Colunas obrigatórias ausentes: ${missingRequired.join(", ")}`],
      warnings: [],
      preview: [],
    };
  }

  const missingOptional = OPTIONAL_COLUMNS.filter(
    (col) => !headers.includes(col)
  );
  if (missingOptional.length > 0) {
    warnings.push(
      `Colunas opcionais ausentes (não impedem importação): ${missingOptional.join(", ")}`
    );
  }

  const productMap = new Map<string, Record<string, string>[]>();

  rows.forEach((row) => {
    const handle = row["Handle"]?.trim();
    if (!handle) return;
    if (!productMap.has(handle)) productMap.set(handle, []);
    productMap.get(handle)!.push(row);
  });

  const entries = Array.from(productMap.entries());
  for (const [handle, productRows] of entries) {
    const firstRow = productRows[0];
    const lineNum = rows.indexOf(firstRow) + 2;

    if (!firstRow["Title"]?.trim()) {
      errors.push(`Linha ${lineNum}: Handle "${handle}" sem Title na linha principal`);
    }

    const hasPrice = productRows.some((r: Record<string, string>) => {
      const price = r["Variant Price"]?.trim();
      return price !== "" && price !== undefined;
    });

    if (!hasPrice) {
      errors.push(
        `Handle "${handle}": nenhuma linha possui Variant Price`
      );
    }
  }

  const rowsWithoutHandle = rows.filter((r) => !r["Handle"]?.trim());
  if (rowsWithoutHandle.length > 0) {
    warnings.push(
      `${rowsWithoutHandle.length} linha(s) ignoradas por não terem Handle`
    );
  }

  const uniqueProducts = Array.from(productMap.entries());
  const preview: CsvProduct[] = uniqueProducts.slice(0, 5).map(([, group]) => {
    const first = group[0];
    return {
      handle: first["Handle"] || "",
      title: first["Title"] || "",
      bodyHtml: first["Body (HTML)"] || "",
      vendor: first["Vendor"] || "",
      type: first["Type"] || "",
      tags: first["Tags"] || "",
      published: first["Published"] || "",
      variantPrice: first["Variant Price"] || "",
      imageSrc: first["Image Src"] || "",
      imagePosition: first["Image Position"] || "",
    };
  });

  return {
    success: errors.length === 0,
    totalProducts: uniqueProducts.length,
    errors,
    warnings,
    preview,
  };
}

export function groupProductsByHandle(
  rows: Record<string, string>[]
): Map<string, Record<string, string>[]> {
  const map = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const handle = row["Handle"]?.trim();
    if (!handle) continue;
    if (!map.has(handle)) map.set(handle, []);
    map.get(handle)!.push(row);
  }
  return map;
}

function splitCSVLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      if (current.trim()) lines.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) lines.push(current);
  return lines;
}

function parseCSVRow(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}
