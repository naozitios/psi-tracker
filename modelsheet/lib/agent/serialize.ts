import { cellKey, colToLetters, parseAddress } from "../sheet/address";
import type { Values } from "../sheet/engine";
import { isCellError, type Cell, type CellValue, type Workbook } from "../sheet/types";

function formatNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toFixed(1);
  if (abs >= 1) return n.toFixed(3);
  return Number(n.toPrecision(4)).toString();
}

function formatValue(v: CellValue | undefined): string {
  if (v === undefined || v === null) return "blank";
  if (isCellError(v)) return v.error;
  if (typeof v === "number") return formatNumber(v);
  return JSON.stringify(v);
}

function describeCell(address: string, cell: Cell, value: CellValue | undefined): string {
  if (cell.formula !== undefined) {
    const tag = cell.role === "assumption" ? " [assumption]" : "";
    return `${address}: =${cell.formula} → ${formatValue(value)}${tag}`;
  }
  if (cell.value === undefined || cell.value === null) {
    if (cell.note?.startsWith("Missing")) return `${address}: blank [missing from filings]`;
    if (cell.note?.startsWith("Left blank")) return `${address}: blank [${cell.note}]`;
    return `${address}: blank`;
  }
  const tag = cell.source ? " [from filing]" : cell.role === "manual" ? " [typed by user]" : "";
  return `${address}=${formatValue(cell.value)}${tag}`;
}

/**
 * Plain-text rendering of the workbook for the agent: one line per row,
 * with each cell's formula and current value so the model can reason about
 * references without guessing.
 */
export function serializeWorkbook(workbook: Workbook, values: Values): string {
  const actual = workbook.periods.filter((p) => p.kind === "actual");
  const projected = workbook.periods.filter((p) => p.kind === "projected");
  const col = (i: number) => colToLetters(2 + i);

  const lines: string[] = [
    `Company: ${workbook.company.name} (${workbook.company.ticker}), CIK ${workbook.company.cik}.`,
    `Units: ${workbook.units}. Percentages are stored as decimals (0.12 = 12%).`,
    `Actual years (from 10-K filings): ${actual.map((p, i) => `${col(i)}=${p.label}`).join(", ")}.`,
    `Projected years (Income sheet only): ${projected.map((p, i) => `${col(actual.length + i)}=${p.label}`).join(", ")}.`,
  ];

  for (const sheet of workbook.sheets) {
    lines.push("", `## Sheet ${sheet.name} (${sheet.title}), rows 1-${sheet.rowCount}, columns A-${colToLetters(sheet.colCount)}`);
    const byRow = new Map<number, string[]>();
    const addresses = Object.keys(sheet.cells)
      .map((a) => ({ a, pos: parseAddress(a)! }))
      .filter((x) => x.pos)
      .sort((x, y) => x.pos.row - y.pos.row || x.pos.col - y.pos.col);
    for (const { a, pos } of addresses) {
      const cell = sheet.cells[a];
      const text =
        pos.col === 1
          ? `"${String(cell.value ?? "")}"`
          : describeCell(a, cell, values[cellKey(sheet.name, a)]);
      const row = byRow.get(pos.row) ?? [];
      row.push(text);
      byRow.set(pos.row, row);
    }
    for (const [row, parts] of byRow) {
      lines.push(`Row ${row}: ${parts.join(" | ")}`);
    }
    lines.push(`(Next free row: ${sheet.rowCount + 1})`);
  }
  return lines.join("\n");
}
