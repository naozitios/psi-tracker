import { isCellError, type CellFormat, type CellValue } from "./sheet/types";

function withParens(n: number, text: string): string {
  return n < 0 ? `(${text})` : text;
}

export function formatCellValue(value: CellValue | undefined, format: CellFormat = "number"): string {
  if (value === undefined || value === null) return "";
  if (isCellError(value)) return value.error;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") return value;
  if (format === "text") return String(value);

  const abs = Math.abs(value);
  if (format === "percent") {
    return withParens(value, `${(abs * 100).toFixed(1)}%`);
  }
  if (abs < 0.00005) return "–";
  const digits = format === "perShare" ? 2 : 1;
  const text = abs.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return withParens(value, text);
}

export function formatReported(value: number, unit: string): string {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${unit}`;
}
