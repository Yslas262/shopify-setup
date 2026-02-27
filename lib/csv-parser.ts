import type { CsvProduct, CsvValidationResult } from "@/types/onboarding";

const REQUIRED_COLUMNS = [
  "Handle",
  "Title",
  "Body (HTML)",
  "Vendor",
  "Type",
  "Tags",
  "Published",
  "Variant Price",
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
  const { headers, rows } = parseCSV(text);

  if (headers.length === 0) {
    return {
      success: false,
      totalProducts: 0,
      errors: ["CSV vazio ou formato inválido."],
      preview: [],
    };
  }

  const missingColumns = REQUIRED_COLUMNS.filter(
    (col) => !headers.includes(col)
  );
  if (missingColumns.length > 0) {
    return {
      success: false,
      totalProducts: 0,
      errors: [`Colunas ausentes: ${missingColumns.join(", ")}`],
      preview: [],
    };
  }

  const productMap = new Map<string, Record<string, string>[]>();

  rows.forEach((row, idx) => {
    const lineNum = idx + 2;

    if (!row["Handle"]?.trim()) {
      errors.push(`Linha ${lineNum}: Handle ausente`);
      return;
    }
    if (!row["Title"]?.trim() && !productMap.has(row["Handle"])) {
      errors.push(`Linha ${lineNum}: Title ausente`);
    }
    if (!row["Variant Price"]?.trim() && row["Variant Price"] !== "0") {
      errors.push(`Linha ${lineNum}: Variant Price ausente`);
    }

    const handle = row["Handle"];
    if (!productMap.has(handle)) {
      productMap.set(handle, []);
    }
    productMap.get(handle)!.push(row);
  });

  const uniqueProducts = Array.from(productMap.entries());
  const preview: CsvProduct[] = uniqueProducts.slice(0, 5).map(([, rows]) => {
    const first = rows[0];
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
    preview,
  };
}

export function groupProductsByHandle(
  rows: Record<string, string>[]
): Map<string, Record<string, string>[]> {
  const map = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const handle = row["Handle"];
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
