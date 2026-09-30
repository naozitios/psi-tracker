import { colToLetters, toAddress } from "../sheet/address";
import type { Cell, CellFormat, LineLocation, Period, Sheet } from "../sheet/types";

export const SHEET_DCF = "DCF";

const FIRST_COL = 2;
const FIRST_ROW = 4;

// Placeholder market inputs. They are assumptions for the user to set, not
// data: the app has no live market data (a PRD non-goal), so each carries a
// note saying what to replace it with.
const PLACEHOLDERS = {
  riskFree: { value: 0.04, note: "Placeholder. Set to the current 10-year US Treasury yield." },
  equityRiskPremium: { value: 0.05, note: "Placeholder. A common range is 4% to 6%." },
  beta: { value: 1.0, note: "Placeholder. Use the stock's beta from a data provider; 1.0 is the market average." },
  costOfDebt: { value: 0.05, note: "Placeholder. Use the company's borrowing rate or bond yields." },
  debtWeight: { value: 0.1, note: "Placeholder. Target share of debt in the capital structure, at market values." },
  terminalGrowth: { value: 0.025, note: "Long-run growth after the forecast. Usually at or below long-run GDP growth." },
};

interface Ctx {
  col: string;
  prev: string | null;
  isActual: boolean;
  isFirstProjection: boolean;
  /** Same-sheet reference to a DCF line in this column. */
  row: (key: string) => string;
  /** Reference to an annual line on another sheet in this column. */
  ext: (key: string) => string;
}

interface SeriesRow {
  key: string;
  label: string;
  actual: (c: Ctx) => string | null;
  projected: (c: Ctx) => string | null;
  assumption?: boolean;
  format?: CellFormat;
  bold?: boolean;
}

interface ScalarRow {
  key: string;
  label: string;
  /** A placeholder input, or a formula built from scalar references. */
  input?: keyof typeof PLACEHOLDERS;
  formula?: (s: (key: string) => string) => string;
  format?: CellFormat;
  bold?: boolean;
}

type Row =
  | { series: SeriesRow }
  | { scalar: ScalarRow }
  | { header: string; valueHeader?: boolean }
  | "blank"
  | "sensitivity";

export function buildDcfSheet(annual: {
  periods: Period[];
  lines: Record<string, LineLocation>;
}): { sheet: Sheet; lines: Record<string, LineLocation> } {
  const actualCount = annual.periods.filter((p) => p.kind === "actual").length;
  const projectedCount = annual.periods.length - actualCount;
  const lastActual = colToLetters(FIRST_COL + actualCount - 1);
  const firstProjected = colToLetters(FIRST_COL + actualCount);
  const lastProjected = colToLetters(FIRST_COL + annual.periods.length - 1);
  const seedFrom = colToLetters(Math.max(FIRST_COL, FIRST_COL + actualCount - 3));

  // Driver assumptions start at the last three years' average and hold flat.
  const seeded = (key: string) => (c: Ctx) =>
    c.isFirstProjection
      ? `AVERAGE(${seedFrom}${rowOf(key)}:${lastActual}${rowOf(key)})`
      : `${c.prev}${rowOf(key)}`;

  const rows: Row[] = [
    { series: { key: "dcf.revenue", label: "Revenue", actual: (c) => c.ext("revenue"), projected: (c) => c.ext("revenue") } },
    { series: { key: "dcf.ebit", label: "Operating income (EBIT)", actual: (c) => c.ext("operatingIncome"), projected: (c) => c.ext("operatingIncome") } },
    { series: { key: "dcf.taxRate", label: "Tax rate", format: "percent", actual: (c) => c.ext("taxRate"), projected: (c) => c.ext("taxRate") } },
    { series: { key: "dcf.nopat", label: "EBIT after tax (NOPAT)", actual: (c) => `${c.row("dcf.ebit")}*(1-${c.row("dcf.taxRate")})`, projected: (c) => `${c.row("dcf.ebit")}*(1-${c.row("dcf.taxRate")})` } },
    { series: { key: "dcf.da", label: "Depreciation and amortization", actual: (c) => c.ext("depreciationAmortization"), projected: (c) => `${c.row("dcf.revenue")}*${c.row("dcf.daPercent")}` } },
    { series: { key: "dcf.capex", label: "Capital expenditures", actual: (c) => c.ext("capex"), projected: (c) => `${c.row("dcf.revenue")}*${c.row("dcf.capexPercent")}` } },
    { series: { key: "dcf.workingCapital", label: "Working capital and other", actual: (c) => c.ext("otherOperatingCashFlow"), projected: (c) => `${c.row("dcf.revenue")}*${c.row("dcf.workingCapitalPercent")}` } },
    { series: { key: "dcf.fcf", label: "Unlevered free cash flow", bold: true, actual: (c) => `${c.row("dcf.nopat")}+${c.row("dcf.da")}+${c.row("dcf.capex")}+${c.row("dcf.workingCapital")}`, projected: (c) => `${c.row("dcf.nopat")}+${c.row("dcf.da")}+${c.row("dcf.capex")}+${c.row("dcf.workingCapital")}` } },
    "blank",
    { header: "Drivers" },
    { series: { key: "dcf.daPercent", label: "D&A % of revenue", format: "percent", assumption: true, actual: (c) => `${c.row("dcf.da")}/${c.row("dcf.revenue")}`, projected: seeded("dcf.daPercent") } },
    { series: { key: "dcf.capexPercent", label: "Capex % of revenue", format: "percent", assumption: true, actual: (c) => `${c.row("dcf.capex")}/${c.row("dcf.revenue")}`, projected: seeded("dcf.capexPercent") } },
    { series: { key: "dcf.workingCapitalPercent", label: "Working capital and other % of revenue", format: "percent", assumption: true, actual: (c) => `${c.row("dcf.workingCapital")}/${c.row("dcf.revenue")}`, projected: seeded("dcf.workingCapitalPercent") } },
    "blank",
    { header: "Discount rate (WACC)", valueHeader: true },
    { scalar: { key: "dcf.riskFree", label: "Risk-free rate", input: "riskFree", format: "percent" } },
    { scalar: { key: "dcf.equityRiskPremium", label: "Equity risk premium", input: "equityRiskPremium", format: "percent" } },
    { scalar: { key: "dcf.beta", label: "Beta", input: "beta", format: "perShare" } },
    { scalar: { key: "dcf.costOfEquity", label: "Cost of equity", format: "percent", formula: (s) => `${s("dcf.riskFree")}+${s("dcf.beta")}*${s("dcf.equityRiskPremium")}` } },
    { scalar: { key: "dcf.costOfDebt", label: "Pre-tax cost of debt", input: "costOfDebt", format: "percent" } },
    { scalar: { key: "dcf.debtWeight", label: "Debt share of capital", input: "debtWeight", format: "percent" } },
    { scalar: { key: "dcf.wacc", label: "WACC", format: "percent", bold: true, formula: (s) => `(1-${s("dcf.debtWeight")})*${s("dcf.costOfEquity")}+${s("dcf.debtWeight")}*${s("dcf.costOfDebt")}*(1-${firstProjected}${rowOf("dcf.taxRate")})` } },
    "blank",
    { header: "Valuation", valueHeader: true },
    { scalar: { key: "dcf.terminalGrowth", label: "Terminal growth rate", input: "terminalGrowth", format: "percent" } },
    { scalar: { key: "dcf.pvForecast", label: "Present value of forecast cash flows", formula: (s) => `NPV(${s("dcf.wacc")},${firstProjected}${rowOf("dcf.fcf")}:${lastProjected}${rowOf("dcf.fcf")})` } },
    { scalar: { key: "dcf.terminalValue", label: `Terminal value (end of ${annual.periods.at(-1)!.label})`, formula: (s) => `${lastProjected}${rowOf("dcf.fcf")}*(1+${s("dcf.terminalGrowth")})/(${s("dcf.wacc")}-${s("dcf.terminalGrowth")})` } },
    { scalar: { key: "dcf.pvTerminal", label: "Present value of terminal value", formula: (s) => `${s("dcf.terminalValue")}/(1+${s("dcf.wacc")})^${projectedCount}` } },
    { scalar: { key: "dcf.enterpriseValue", label: "Enterprise value", bold: true, formula: (s) => `${s("dcf.pvForecast")}+${s("dcf.pvTerminal")}` } },
    { scalar: { key: "dcf.debt", label: `Less: debt (${annual.periods[actualCount - 1].label} balance sheet)`, formula: () => `-(${ext("shortTermDebt", lastActual)}+${ext("longTermDebt", lastActual)})` } },
    { scalar: { key: "dcf.cash", label: "Plus: cash and short-term investments", formula: () => `${ext("cash", lastActual)}+${ext("shortTermInvestments", lastActual)}` } },
    { scalar: { key: "dcf.equityValue", label: "Equity value", bold: true, formula: (s) => `${s("dcf.enterpriseValue")}+${s("dcf.debt")}+${s("dcf.cash")}` } },
    { scalar: { key: "dcf.shares", label: `Diluted shares (millions, ${annual.periods[actualCount - 1].label})`, formula: () => ext("dilutedShares", lastActual) } },
    { scalar: { key: "dcf.valuePerShare", label: "Implied value per share (USD)", bold: true, format: "perShare", formula: (s) => `${s("dcf.equityValue")}/${s("dcf.shares")}` } },
    "blank",
    { header: "Sensitivity: value per share (USD)" },
    "sensitivity",
  ];

  const lines: Record<string, LineLocation> = {};
  let sensitivityRow = 0;
  rows.forEach((row, i) => {
    const r = FIRST_ROW + i;
    if (row === "sensitivity") sensitivityRow = r;
    else if (typeof row === "object" && "series" in row) lines[row.series.key] = { sheet: SHEET_DCF, row: r };
    else if (typeof row === "object" && "scalar" in row) lines[row.scalar.key] = { sheet: SHEET_DCF, row: r };
  });
  function rowOf(key: string): number {
    return lines[key].row;
  }
  function ext(key: string, col: string): string {
    const loc = annual.lines[key];
    return `${loc.sheet}!${col}${loc.row}`;
  }
  const scalarRef = (key: string) => `$B$${rowOf(key)}`;

  const cells: Record<string, Cell> = {};
  const set = (row: number, col: number, cell: Cell) => (cells[toAddress(row, col)] = cell);

  set(1, 1, { value: "USD millions", role: "header", bold: true, format: "text" });
  set(2, 1, { value: "Fiscal year end", role: "label", format: "text" });
  annual.periods.forEach((p, i) => {
    set(1, FIRST_COL + i, { value: p.label, role: "header", bold: true, format: "text" });
    if (p.kind === "actual") set(2, FIRST_COL + i, { value: p.end, role: "label", format: "text" });
  });

  rows.forEach((row, i) => {
    const r = FIRST_ROW + i;
    if (row === "blank") return;
    if (row === "sensitivity") return;
    if ("header" in row) {
      set(r, 1, { value: row.header, role: "header", bold: true, format: "text" });
      if (row.valueHeader) set(r, FIRST_COL, { value: "Value", role: "header", bold: true, format: "text" });
      return;
    }
    if ("scalar" in row) {
      const s = row.scalar;
      set(r, 1, { value: s.label, role: "label", bold: s.bold, format: "text" });
      const base = { format: s.format ?? "number", bold: s.bold } as const;
      if (s.input) {
        const p = PLACEHOLDERS[s.input];
        set(r, FIRST_COL, { ...base, value: p.value, role: "assumption", note: p.note });
      } else if (s.formula) {
        set(r, FIRST_COL, { ...base, formula: s.formula(scalarRef), role: "formula" });
      }
      return;
    }
    const s = row.series;
    set(r, 1, { value: s.label, role: "label", bold: s.bold, format: "text" });
    annual.periods.forEach((p, j) => {
      const col = FIRST_COL + j;
      const c: Ctx = {
        col: colToLetters(col),
        prev: j > 0 ? colToLetters(col - 1) : null,
        isActual: p.kind === "actual",
        isFirstProjection: j === actualCount,
        row: (key) => `${colToLetters(col)}${rowOf(key)}`,
        ext: (key) => ext(key, colToLetters(col)),
      };
      const formula = p.kind === "actual" ? s.actual(c) : s.projected(c);
      if (!formula) return;
      set(r, col, {
        format: s.format ?? "number",
        bold: s.bold,
        formula,
        role: s.assumption && p.kind === "projected" ? "assumption" : "formula",
      });
    });
  });

  // Value per share across WACC (rows) and terminal growth (columns), each
  // cell a full DCF so the grid stays live when any input changes.
  const steps = [-0.01, -0.005, 0, 0.005, 0.01];
  const gRow = sensitivityRow;
  set(gRow, 1, { value: "WACC (down) by terminal growth (across)", role: "label", format: "text" });
  steps.forEach((step, k) => {
    const col = FIRST_COL + 1 + k;
    set(gRow, col, { formula: `${scalarRef("dcf.terminalGrowth")}${step ? `${step > 0 ? "+" : ""}${step}` : ""}`, role: "formula", format: "percent", bold: true });
  });
  const fcf = rowOf("dcf.fcf");
  steps.forEach((step, k) => {
    const r = gRow + 1 + k;
    set(r, FIRST_COL, { formula: `${scalarRef("dcf.wacc")}${step ? `${step > 0 ? "+" : ""}${step}` : ""}`, role: "formula", format: "percent", bold: true });
    steps.forEach((_, m) => {
      const g = `${colToLetters(FIRST_COL + 1 + m)}$${gRow}`;
      const w = `$B${r}`;
      set(r, FIRST_COL + 1 + m, {
        formula:
          `(NPV(${w},$${firstProjected}$${fcf}:$${lastProjected}$${fcf})` +
          `+$${lastProjected}$${fcf}*(1+${g})/(${w}-${g})/(1+${w})^${projectedCount}` +
          `+${scalarRef("dcf.debt")}+${scalarRef("dcf.cash")})/${scalarRef("dcf.shares")}`,
        role: "formula",
        format: "perShare",
      });
    });
  });

  return {
    sheet: {
      name: SHEET_DCF,
      title: "DCF",
      rowCount: gRow + steps.length,
      colCount: Math.max(FIRST_COL + annual.periods.length - 1, FIRST_COL + steps.length),
      cells,
      frozenRows: 2,
    },
    lines,
  };
}
