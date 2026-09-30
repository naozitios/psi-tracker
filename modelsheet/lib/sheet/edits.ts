import { cellKey, parseAddress } from "./address";
import { checkFormulaSyntax, type Values } from "./engine";
import { isCellError, type Cell, type Scalar, type Workbook } from "./types";

/** A change to one cell, as typed into a spreadsheet: `=B4*2`, `0.12`, `Revenue`. */
export interface CellEdit {
  sheet: string;
  cell: string;
  input: string;
  reason?: string;
}

export interface AppliedEdit extends CellEdit {
  before: Cell | null;
  after: Cell | null;
}

/** Rows and columns an edit may add beyond the current sheet size. */
const MAX_NEW_ROWS = 50;
const MAX_NEW_COLS = 5;
/** Hard caps that keep every workbook small enough to recalculate and send to the agent. */
export const MAX_SHEET_ROWS = 400;
export const MAX_SHEET_COLS = 40;
export const MAX_INPUT_LENGTH = 2000;

export function parseInput(input: string): { formula: string } | { value: Scalar } | null {
  const text = input.trim();
  if (text === "") return null;
  if (text.startsWith("=")) return { formula: text.slice(1).trim() };

  const percent = /^(-?[\d,]*\.?\d+)\s*%$/.exec(text);
  if (percent) return { value: Number(percent[1].replace(/,/g, "")) / 100 };

  const negative = /^\((.+)\)$/.exec(text);
  const numeric = (negative ? negative[1] : text).replace(/,/g, "");
  if (/^-?\d*\.?\d+(e-?\d+)?$/i.test(numeric)) {
    const n = Number(numeric);
    return { value: negative ? -n : n };
  }
  return { value: text };
}

/** What a cell holds, written the way a user would type it. */
export function cellInput(cell: Cell | null | undefined): string {
  if (!cell) return "";
  if (cell.formula !== undefined) return `=${cell.formula}`;
  if (cell.value === null || cell.value === undefined) return "";
  return String(cell.value);
}

export interface EditValidation {
  valid: CellEdit[];
  errors: string[];
}

export function validateEdits(workbook: Workbook, edits: CellEdit[]): EditValidation {
  const valid: CellEdit[] = [];
  const errors: string[] = [];
  for (const edit of edits) {
    const sheet = workbook.sheets.find((s) => s.name.toLowerCase() === edit.sheet.trim().toLowerCase());
    if (!sheet) {
      errors.push(`${edit.sheet}!${edit.cell}: no sheet named "${edit.sheet}"`);
      continue;
    }
    const pos = parseAddress(edit.cell);
    if (!pos) {
      errors.push(`${sheet.name}!${edit.cell}: not a cell address`);
      continue;
    }
    if (
      pos.row > Math.min(sheet.rowCount + MAX_NEW_ROWS, MAX_SHEET_ROWS) ||
      pos.col > Math.min(sheet.colCount + MAX_NEW_COLS, MAX_SHEET_COLS)
    ) {
      errors.push(`${sheet.name}!${edit.cell}: outside the sheet`);
      continue;
    }
    if (edit.input.length > MAX_INPUT_LENGTH) {
      errors.push(`${sheet.name}!${edit.cell}: input is longer than ${MAX_INPUT_LENGTH} characters`);
      continue;
    }
    const parsed = parseInput(edit.input);
    if (parsed && "formula" in parsed) {
      const problem = checkFormulaSyntax(parsed.formula);
      if (problem) {
        errors.push(`${sheet.name}!${edit.cell}: formula does not parse (${problem})`);
        continue;
      }
    }
    valid.push({ ...edit, sheet: sheet.name, cell: edit.cell.replace(/\$/g, "").toUpperCase() });
  }
  return { valid, errors };
}

function describeValue(cell: Cell): string {
  return typeof cell.value === "number"
    ? cell.value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : String(cell.value);
}

function nextCell(before: Cell | undefined, input: string, col: number): Cell | null {
  const parsed = parseInput(input);
  if (!parsed) return null;

  const cell: Cell = { ...parsed, format: before?.format, bold: before?.bold };
  if (col === 1 && "value" in parsed) {
    return { ...cell, role: "label", format: "text" };
  }
  if (!cell.format) {
    cell.format = "value" in parsed && typeof parsed.value === "string" ? "text" : "number";
  }
  if (before?.role === "assumption") {
    cell.role = "assumption";
  } else {
    cell.role = "formula" in parsed ? "formula" : "manual";
  }
  if (before?.source) {
    cell.note = `Overrides ${before.source.form} value ${describeValue(before)} (${before.source.concept}, filed ${before.source.filed}).`;
  }
  return cell;
}

/** Applies edits without mutating the input workbook. */
export function applyEdits(
  workbook: Workbook,
  edits: CellEdit[],
): { workbook: Workbook; applied: AppliedEdit[] } {
  const sheets = workbook.sheets.map((s) => ({ ...s, cells: { ...s.cells } }));
  const applied: AppliedEdit[] = [];
  for (const edit of edits) {
    const sheet = sheets.find((s) => s.name === edit.sheet);
    const pos = parseAddress(edit.cell);
    if (!sheet || !pos) continue;
    const before = sheet.cells[edit.cell];
    const after = nextCell(before, edit.input, pos.col);
    if (after) sheet.cells[edit.cell] = after;
    else delete sheet.cells[edit.cell];
    sheet.rowCount = Math.max(sheet.rowCount, pos.row);
    sheet.colCount = Math.max(sheet.colCount, pos.col);
    applied.push({ ...edit, before: before ?? null, after });
  }
  return { workbook: { ...workbook, sheets }, applied };
}

/** Restores the cells an earlier `applyEdits` changed. */
export function revertEdits(workbook: Workbook, applied: AppliedEdit[]): Workbook {
  const sheets = workbook.sheets.map((s) => ({ ...s, cells: { ...s.cells } }));
  for (const edit of [...applied].reverse()) {
    const sheet = sheets.find((s) => s.name === edit.sheet);
    if (!sheet) continue;
    if (edit.before) sheet.cells[edit.cell] = edit.before;
    else delete sheet.cells[edit.cell];
  }
  return { ...workbook, sheets };
}

function sameValue(a: Values[string] | undefined, b: Values[string] | undefined): boolean {
  if (isCellError(a) || isCellError(b)) {
    return isCellError(a) && isCellError(b) && a.error === b.error;
  }
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  return (a ?? null) === (b ?? null);
}

/** Cells whose evaluated value differs, excluding the ones edited directly. */
export function changedCells(before: Values, after: Values, edited: CellEdit[]): string[] {
  const direct = new Set(edited.map((e) => cellKey(e.sheet, e.cell)));
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => !direct.has(k) && !sameValue(before[k], after[k])).sort();
}
