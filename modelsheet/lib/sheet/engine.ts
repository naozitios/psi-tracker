import FormulaParser from "fast-formula-parser";
import { cellKey, parseAddress, toAddress } from "./address";
import { isCellError, type CellValue, type Sheet } from "./types";

const { DepParser, FormulaError, FormulaHelpers, Types } = FormulaParser;

/** Evaluated value of every non-empty cell, keyed by `Sheet!A1`. */
export type Values = Record<string, CellValue>;

interface CellRef {
  sheet: string;
  row: number;
  col: number;
}

interface RangeRef {
  sheet: string;
  from: { row: number; col: number };
  to: { row: number; col: number };
}

function isRange(ref: CellRef | RangeRef): ref is RangeRef {
  return "from" in ref;
}

function numbersIn(params: unknown[]): number[] {
  const out: number[] = [];
  FormulaHelpers.flattenParams(params, Types.NUMBER, true, (item, info) => {
    if (info.isLiteral || typeof item === "number") out.push(item as number);
  });
  return out;
}

// fast-formula-parser is MIT licensed but lacks a few functions financial
// models lean on, so they are supplied here.
const extraFunctions = {
  MAX: (...params: unknown[]) => {
    const nums = numbersIn(params);
    return nums.length ? Math.max(...nums) : 0;
  },
  MIN: (...params: unknown[]) => {
    const nums = numbersIn(params);
    return nums.length ? Math.min(...nums) : 0;
  },
  NPV: (rate: unknown, ...values: unknown[]) => {
    const r = FormulaHelpers.accept(rate, Types.NUMBER) as number;
    return numbersIn(values).reduce(
      (total, v, i) => total + v / Math.pow(1 + r, i + 1),
      0,
    );
  },
};

interface EvalContext {
  values: Values;
  sheets: Map<string, Sheet>;
}

let context: EvalContext | null = null;

function resolveSheet(name: string): Sheet | undefined {
  return context?.sheets.get(name.toLowerCase());
}

function readCell(sheetName: string, row: number, col: number): unknown {
  const sheet = resolveSheet(sheetName);
  if (!sheet) return FormulaError.REF;
  const value = context!.values[cellKey(sheet.name, toAddress(row, col))];
  if (value === undefined) return null;
  if (isCellError(value)) return new FormulaError(value.error);
  return value;
}

const parser = new FormulaParser({
  functions: extraFunctions,
  onCell: (ref) => readCell(ref.sheet, ref.row, ref.col),
  onRange: (ref) => {
    const sheet = resolveSheet(ref.sheet);
    // Clamp whole-column and whole-row ranges to the sheet's used area.
    const lastRow = Math.min(ref.to.row, sheet?.rowCount ?? ref.to.row);
    const lastCol = Math.min(ref.to.col, sheet?.colCount ?? ref.to.col);
    const rows: unknown[][] = [];
    for (let r = ref.from.row; r <= lastRow; r++) {
      const row: unknown[] = [];
      for (let c = ref.from.col; c <= lastCol; c++) {
        row.push(readCell(ref.sheet, r, c));
      }
      rows.push(row);
    }
    return rows;
  },
});

const depParser = new DepParser();

/** Cells and ranges a formula reads. Throws if the formula does not parse. */
export function formulaRefs(
  formula: string,
  position: CellRef,
): Array<CellRef | RangeRef> {
  return depParser.parse(formula, position) as Array<CellRef | RangeRef>;
}

/** Returns an error message, or null when the formula parses. */
export function checkFormulaSyntax(formula: string): string | null {
  try {
    formulaRefs(formula, { sheet: "Sheet1", row: 1, col: 1 });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Formula could not be parsed";
  }
}

function toCellValue(result: unknown): CellValue {
  if (result instanceof FormulaError) return { error: result.error };
  if (Array.isArray(result)) {
    return { error: "#VALUE!", message: "Formula returns a range, not a value" };
  }
  if (typeof result === "number") {
    return Number.isFinite(result) ? result : { error: "#NUM!" };
  }
  if (typeof result === "string" || typeof result === "boolean") return result;
  return 0;
}

function toThrownError(err: unknown): CellValue {
  if (err instanceof FormulaError) {
    const details = (err as unknown as { details?: unknown }).details;
    if (details instanceof FormulaError && details.error === "#NAME?") {
      return { error: "#NAME?", message: details.message };
    }
    return { error: err.error, message: err.message };
  }
  return {
    error: "#ERROR!",
    message: err instanceof Error ? err.message : String(err),
  };
}

/**
 * Recalculates the whole workbook. Formulas are evaluated once each in
 * dependency order; cells caught in a circular reference get `#CIRC!`.
 */
export function evaluateWorkbook(workbook: { sheets: Sheet[] }): Values {
  const values: Values = {};
  const sheets = new Map(workbook.sheets.map((s) => [s.name.toLowerCase(), s]));

  interface FormulaNode extends CellRef {
    key: string;
    formula: string;
  }
  const nodes = new Map<string, FormulaNode>();
  const formulaCellsBySheet = new Map<string, FormulaNode[]>();

  for (const sheet of workbook.sheets) {
    const list: FormulaNode[] = [];
    for (const [address, cell] of Object.entries(sheet.cells)) {
      const key = cellKey(sheet.name, address);
      if (cell.formula !== undefined) {
        const pos = parseAddress(address);
        if (!pos) continue;
        const node = { key, sheet: sheet.name, ...pos, formula: cell.formula };
        nodes.set(key, node);
        list.push(node);
      } else if (cell.value !== undefined && cell.value !== null) {
        values[key] = cell.value;
      }
    }
    formulaCellsBySheet.set(sheet.name, list);
  }

  // Formulas that do not parse get their error now and take no part in
  // ordering; cells that read them see the error like any other value.
  const refsByKey = new Map<string, Array<CellRef | RangeRef>>();
  for (const node of nodes.values()) {
    try {
      refsByKey.set(node.key, formulaRefs(node.formula, node));
    } catch (err) {
      values[node.key] = toThrownError(err);
    }
  }
  const isPendingNode = (key: string) => refsByKey.has(key);

  // Build edges between formula cells: dependency -> dependents.
  const dependents = new Map<string, string[]>();
  const pending = new Map<string, number>();
  for (const [key, refs] of refsByKey) {
    const node = nodes.get(key)!;
    const deps = new Set<string>();
    for (const ref of refs) {
      const sheet = sheets.get(ref.sheet.toLowerCase());
      if (!sheet) continue;
      if (isRange(ref)) {
        for (const other of formulaCellsBySheet.get(sheet.name) ?? []) {
          if (
            isPendingNode(other.key) &&
            other.row >= ref.from.row &&
            other.row <= ref.to.row &&
            other.col >= ref.from.col &&
            other.col <= ref.to.col
          ) {
            deps.add(other.key);
          }
        }
      } else {
        const depKey = cellKey(sheet.name, toAddress(ref.row, ref.col));
        if (isPendingNode(depKey)) deps.add(depKey);
      }
    }
    pending.set(node.key, deps.size);
    for (const dep of deps) {
      const list = dependents.get(dep) ?? [];
      list.push(node.key);
      dependents.set(dep, list);
    }
  }

  const ready = [...pending.entries()].filter(([, n]) => n === 0).map(([k]) => k);
  context = { values, sheets };
  try {
    while (ready.length) {
      const key = ready.pop()!;
      const node = nodes.get(key)!;
      try {
        values[key] = toCellValue(
          parser.parse(node.formula, { sheet: node.sheet, row: node.row, col: node.col }),
        );
      } catch (err) {
        values[key] = toThrownError(err);
      }
      pending.delete(key);
      for (const next of dependents.get(key) ?? []) {
        const left = (pending.get(next) ?? 0) - 1;
        pending.set(next, left);
        if (left === 0) ready.push(next);
      }
    }
  } finally {
    context = null;
  }

  for (const key of pending.keys()) {
    values[key] = { error: "#CIRC!", message: "Circular reference" };
  }
  return values;
}
