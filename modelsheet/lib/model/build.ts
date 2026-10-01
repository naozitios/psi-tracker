import { colToLetters, toAddress } from "../sheet/address";
import type {
  Cell,
  CellFormat,
  Company,
  LineLocation,
  Period,
  Sheet,
  Workbook,
} from "../sheet/types";
import { LINE_DEF_BY_KEY } from "../sec/template";
import type { Extraction } from "../sec/extract";
import { buildDcfSheet } from "./dcf";
import { buildQuarterlySheet } from "./quarterly";

export const SHEET_INCOME = "Income";
export const SHEET_BALANCE = "BalanceSheet";
export const SHEET_CASHFLOW = "CashFlow";

/** Column of the first period; column A holds labels. */
export const FIRST_PERIOD_COL = 2;
const HEADER_ROW = 1;
const PERIOD_END_ROW = 2;
const FIRST_LINE_ROW = 4;

interface ColumnContext {
  /** Column letter of this period. */
  col: string;
  /** Column letter of the previous period, or null for the first. */
  prev: string | null;
  row: number;
  isFirstProjection: boolean;
  /** First and last historical columns used to seed assumptions. */
  seedFrom: string;
  seedTo: string;
  /** Reference to another line in the same column (or a given column). */
  ref: (key: string, col?: string) => string;
}

type FormulaFn = (c: ColumnContext) => string | null;

interface LineSpec {
  key?: string;
  label: string;
  /** Historical columns: `filing` reads the extraction, a function writes a formula. */
  actual?: "filing" | FormulaFn;
  /** Projected columns (Income sheet only). */
  projected?: FormulaFn;
  /** Projection cells are assumptions the user is expected to change. */
  projectedIsAssumption?: boolean;
  /** Used when a filing value is missing, e.g. total liabilities. */
  fallback?: { formula: (c: ColumnContext) => string; note: string };
  /**
   * Filing lines a historical formula needs. If one is missing that year the
   * cell is left blank with a note, instead of computing from a zero.
   */
  requires?: string[];
  format?: CellFormat;
  bold?: boolean;
}

type RowSpec = LineSpec | "blank" | { header: string };

// Assumptions start at the average of the last three actual years and hold
// flat, so every projected number is a formula the user can trace.
const seedAssumption: FormulaFn = (c) =>
  c.isFirstProjection
    ? `AVERAGE(${c.seedFrom}${c.row}:${c.seedTo}${c.row})`
    : `${c.prev}${c.row}`;

const INCOME_ROWS: RowSpec[] = [
  { key: "revenue", label: "Revenue", actual: "filing", bold: true,
    projected: (c) => `${c.ref("revenue", c.prev!)}*(1+${c.ref("revenueGrowth")})` },
  { key: "costOfRevenue", label: "Cost of revenue", actual: "filing",
    projected: (c) => `${c.ref("revenue")}*(1-${c.ref("grossMargin")})` },
  { key: "grossProfit", label: "Gross profit", bold: true, requires: ["revenue"],
    actual: (c) => `${c.ref("revenue")}-${c.ref("costOfRevenue")}`,
    projected: (c) => `${c.ref("revenue")}-${c.ref("costOfRevenue")}` },
  { key: "researchAndDevelopment", label: "Research and development", actual: "filing",
    projected: (c) => `${c.ref("revenue")}*${c.ref("rdPercent")}` },
  { key: "sellingGeneralAdmin", label: "Selling, general and administrative", actual: "filing",
    projected: (c) => `${c.ref("revenue")}*${c.ref("sgaPercent")}` },
  { key: "otherOperatingExpense", label: "Other operating expense, net", requires: ["revenue", "operatingIncome"],
    actual: (c) => `${c.ref("grossProfit")}-${c.ref("researchAndDevelopment")}-${c.ref("sellingGeneralAdmin")}-${c.ref("operatingIncome")}`,
    projected: (c) => `${c.ref("revenue")}*${c.ref("otherOpexPercent")}` },
  { key: "operatingIncome", label: "Operating income", actual: "filing", bold: true,
    projected: (c) => `${c.ref("grossProfit")}-${c.ref("researchAndDevelopment")}-${c.ref("sellingGeneralAdmin")}-${c.ref("otherOperatingExpense")}` },
  { key: "nonOperatingIncome", label: "Non-operating income (expense), net", requires: ["operatingIncome", "pretaxIncome"],
    actual: (c) => `${c.ref("pretaxIncome")}-${c.ref("operatingIncome")}`,
    projected: (c) => c.ref("nonOperatingIncome", c.prev!) },
  { key: "pretaxIncome", label: "Pre-tax income", actual: "filing", bold: true,
    projected: (c) => `${c.ref("operatingIncome")}+${c.ref("nonOperatingIncome")}` },
  { key: "incomeTax", label: "Income tax expense", actual: "filing",
    projected: (c) => `${c.ref("pretaxIncome")}*${c.ref("taxRate")}` },
  { key: "otherNetIncomeItems", label: "Other items (discontinued ops, minority interest)", requires: ["pretaxIncome", "netIncome"],
    actual: (c) => `${c.ref("netIncome")}-${c.ref("pretaxIncome")}+${c.ref("incomeTax")}` },
  { key: "netIncome", label: "Net income", actual: "filing", bold: true,
    projected: (c) => `${c.ref("pretaxIncome")}-${c.ref("incomeTax")}+${c.ref("otherNetIncomeItems")}` },
  "blank",
  { key: "dilutedShares", label: "Diluted shares (millions)", actual: "filing",
    projected: (c) => c.ref("dilutedShares", c.prev!) },
  { key: "dilutedEps", label: "Diluted EPS (USD)", actual: "filing", format: "perShare",
    projected: (c) => `${c.ref("netIncome")}/${c.ref("dilutedShares")}` },
  "blank",
  { header: "Drivers" },
  { key: "revenueGrowth", label: "Revenue growth", format: "percent", projectedIsAssumption: true, requires: ["revenue"],
    actual: (c) => (c.prev ? `${c.ref("revenue")}/${c.ref("revenue", c.prev)}-1` : null),
    projected: seedAssumption },
  { key: "grossMargin", label: "Gross margin", format: "percent", projectedIsAssumption: true, requires: ["revenue"],
    actual: (c) => `${c.ref("grossProfit")}/${c.ref("revenue")}`, projected: seedAssumption },
  { key: "rdPercent", label: "R&D % of revenue", format: "percent", projectedIsAssumption: true, requires: ["revenue"],
    actual: (c) => `${c.ref("researchAndDevelopment")}/${c.ref("revenue")}`, projected: seedAssumption },
  { key: "sgaPercent", label: "SG&A % of revenue", format: "percent", projectedIsAssumption: true, requires: ["revenue"],
    actual: (c) => `${c.ref("sellingGeneralAdmin")}/${c.ref("revenue")}`, projected: seedAssumption },
  { key: "otherOpexPercent", label: "Other opex % of revenue", format: "percent", projectedIsAssumption: true, requires: ["revenue", "operatingIncome"],
    actual: (c) => `${c.ref("otherOperatingExpense")}/${c.ref("revenue")}`, projected: seedAssumption },
  { key: "taxRate", label: "Effective tax rate", format: "percent", projectedIsAssumption: true, requires: ["pretaxIncome"],
    actual: (c) => `${c.ref("incomeTax")}/${c.ref("pretaxIncome")}`, projected: seedAssumption },
  { key: "operatingMargin", label: "Operating margin", format: "percent", requires: ["revenue", "operatingIncome"],
    actual: (c) => `${c.ref("operatingIncome")}/${c.ref("revenue")}`,
    projected: (c) => `${c.ref("operatingIncome")}/${c.ref("revenue")}` },
];

const BALANCE_ROWS: RowSpec[] = [
  { key: "cash", label: "Cash and cash equivalents", actual: "filing" },
  { key: "shortTermInvestments", label: "Short-term investments", actual: "filing" },
  { key: "receivables", label: "Accounts receivable, net", actual: "filing" },
  { key: "inventory", label: "Inventory", actual: "filing" },
  { key: "otherCurrentAssets", label: "Other current assets", requires: ["totalCurrentAssets"],
    actual: (c) => `${c.ref("totalCurrentAssets")}-${c.ref("cash")}-${c.ref("shortTermInvestments")}-${c.ref("receivables")}-${c.ref("inventory")}` },
  { key: "totalCurrentAssets", label: "Total current assets", actual: "filing", bold: true },
  { key: "ppe", label: "Property, plant and equipment, net", actual: "filing" },
  { key: "goodwill", label: "Goodwill", actual: "filing" },
  { key: "otherNonCurrentAssets", label: "Other non-current assets", requires: ["totalAssets", "totalCurrentAssets"],
    actual: (c) => `${c.ref("totalAssets")}-${c.ref("totalCurrentAssets")}-${c.ref("ppe")}-${c.ref("goodwill")}` },
  { key: "totalAssets", label: "Total assets", actual: "filing", bold: true },
  "blank",
  { key: "accountsPayable", label: "Accounts payable", actual: "filing" },
  { key: "shortTermDebt", label: "Short-term debt", actual: "filing" },
  { key: "otherCurrentLiabilities", label: "Other current liabilities", requires: ["totalCurrentLiabilities"],
    actual: (c) => `${c.ref("totalCurrentLiabilities")}-${c.ref("accountsPayable")}-${c.ref("shortTermDebt")}` },
  { key: "totalCurrentLiabilities", label: "Total current liabilities", actual: "filing", bold: true },
  { key: "longTermDebt", label: "Long-term debt", actual: "filing" },
  { key: "otherNonCurrentLiabilities", label: "Other non-current liabilities", requires: ["totalCurrentLiabilities"],
    actual: (c) => `${c.ref("totalLiabilities")}-${c.ref("totalCurrentLiabilities")}-${c.ref("longTermDebt")}` },
  { key: "totalLiabilities", label: "Total liabilities", actual: "filing", bold: true,
    fallback: {
      formula: (c) => `${c.ref("totalLiabilitiesAndEquity")}-${c.ref("temporaryEquity")}-${c.ref("totalEquity")}`,
      note: "Not reported as a total in the filing; derived as total liabilities and equity minus equity.",
    } },
  { key: "temporaryEquity", label: "Temporary equity", actual: "filing" },
  { key: "totalEquity", label: "Total equity", actual: "filing", bold: true },
  { key: "totalLiabilitiesAndEquity", label: "Total liabilities and equity", actual: "filing", bold: true },
  "blank",
  { key: "balanceDifference", label: "Assets minus liabilities and equity", requires: ["totalAssets", "totalLiabilitiesAndEquity"],
    actual: (c) => `${c.ref("totalAssets")}-${c.ref("totalLiabilitiesAndEquity")}` },
];

const CASHFLOW_ROWS: RowSpec[] = [
  { key: "cfNetIncome", label: "Net income (incl. minority interest)", actual: "filing" },
  { key: "depreciationAmortization", label: "Depreciation and amortization", actual: "filing" },
  { key: "stockCompensation", label: "Stock-based compensation", actual: "filing" },
  { key: "otherOperatingCashFlow", label: "Working capital and other", requires: ["cashFromOperations", "cfNetIncome"],
    actual: (c) => `${c.ref("cashFromOperations")}-${c.ref("cfNetIncome")}-${c.ref("depreciationAmortization")}-${c.ref("stockCompensation")}` },
  { key: "cashFromOperations", label: "Cash from operations", actual: "filing", bold: true },
  "blank",
  { key: "capex", label: "Capital expenditures", actual: "filing" },
  { key: "otherInvesting", label: "Other investing", requires: ["cashFromInvesting"],
    actual: (c) => `${c.ref("cashFromInvesting")}-${c.ref("capex")}` },
  { key: "cashFromInvesting", label: "Cash from investing", actual: "filing", bold: true },
  "blank",
  { key: "dividendsPaid", label: "Dividends paid", actual: "filing" },
  { key: "shareRepurchases", label: "Share repurchases", actual: "filing" },
  { key: "otherFinancing", label: "Other financing", requires: ["cashFromFinancing"],
    actual: (c) => `${c.ref("cashFromFinancing")}-${c.ref("dividendsPaid")}-${c.ref("shareRepurchases")}` },
  { key: "cashFromFinancing", label: "Cash from financing", actual: "filing", bold: true },
  "blank",
  { key: "fxAndOther", label: "FX and other", requires: ["netChangeInCash", "cashFromOperations", "cashFromInvesting", "cashFromFinancing"],
    actual: (c) => `${c.ref("netChangeInCash")}-${c.ref("cashFromOperations")}-${c.ref("cashFromInvesting")}-${c.ref("cashFromFinancing")}` },
  { key: "netChangeInCash", label: "Net change in cash", actual: "filing", bold: true },
  { key: "beginningCash", label: "Cash at beginning of period", actual: "filing" },
  { key: "endingCash", label: "Cash at end of period", bold: true, requires: ["beginningCash", "netChangeInCash"],
    actual: (c) => `${c.ref("beginningCash")}+${c.ref("netChangeInCash")}` },
  { key: "endingCashReported", label: "Cash at end of period (reported)", actual: "filing" },
  "blank",
  { key: "freeCashFlow", label: "Free cash flow", bold: true, requires: ["cashFromOperations"],
    actual: (c) => `${c.ref("cashFromOperations")}+${c.ref("capex")}` },
];

interface SheetPlan {
  name: string;
  title: string;
  rows: RowSpec[];
  withProjections: boolean;
}

const PLANS: SheetPlan[] = [
  { name: SHEET_INCOME, title: "Income statement", rows: INCOME_ROWS, withProjections: true },
  { name: SHEET_BALANCE, title: "Balance sheet", rows: BALANCE_ROWS, withProjections: false },
  { name: SHEET_CASHFLOW, title: "Cash flow statement", rows: CASHFLOW_ROWS, withProjections: false },
];

function projectedPeriods(actuals: Period[], years: number): Period[] {
  const last = actuals[actuals.length - 1];
  const out: Period[] = [];
  for (let i = 1; i <= years; i++) {
    const shift = (d: string) => `${Number(d.slice(0, 4)) + i}${d.slice(4)}`;
    const end = shift(last.end);
    out.push({ label: `FY${end.slice(0, 4)}E`, start: shift(last.start), end, kind: "projected" });
  }
  return out;
}

export interface BuildOptions {
  ticker: string;
  projectionYears?: number;
  now?: Date;
}

export function buildWorkbook(extraction: Extraction, options: BuildOptions): Workbook {
  const actuals = extraction.periods;
  if (actuals.length === 0) {
    throw new Error("No annual periods found in the company's 10-K data.");
  }
  const projections = projectedPeriods(actuals, options.projectionYears ?? 5);
  const allPeriods = [...actuals, ...projections];

  // Pass 1: assign rows so formulas can reference lines on any sheet.
  const lines: Record<string, LineLocation> = {};
  for (const plan of PLANS) {
    plan.rows.forEach((spec, i) => {
      if (typeof spec === "object" && "key" in spec && spec.key) {
        lines[spec.key] = { sheet: plan.name, row: FIRST_LINE_ROW + i };
      }
    });
  }

  const lastActualCol = FIRST_PERIOD_COL + actuals.length - 1;
  const seedFrom = colToLetters(Math.max(FIRST_PERIOD_COL, lastActualCol - 2));
  const seedTo = colToLetters(lastActualCol);

  const sheets: Sheet[] = PLANS.map((plan) => {
    const periods = plan.withProjections ? allPeriods : actuals;
    const cells: Record<string, Cell> = {};
    const set = (row: number, col: number, cell: Cell) => {
      cells[toAddress(row, col)] = cell;
    };

    set(HEADER_ROW, 1, { value: "USD millions", role: "header", bold: true, format: "text" });
    set(PERIOD_END_ROW, 1, { value: "Fiscal year end", role: "label", format: "text" });
    periods.forEach((p, i) => {
      set(HEADER_ROW, FIRST_PERIOD_COL + i, { value: p.label, role: "header", bold: true, format: "text" });
      if (p.kind === "actual") {
        set(PERIOD_END_ROW, FIRST_PERIOD_COL + i, { value: p.end, role: "label", format: "text" });
      }
    });

    plan.rows.forEach((spec, i) => {
      const row = FIRST_LINE_ROW + i;
      if (spec === "blank") return;
      if ("header" in spec) {
        set(row, 1, { value: spec.header, role: "header", bold: true, format: "text" });
        return;
      }
      set(row, 1, { value: spec.label, role: "label", bold: spec.bold, format: "text" });

      periods.forEach((period, p) => {
        const col = FIRST_PERIOD_COL + p;
        const context: ColumnContext = {
          col: colToLetters(col),
          prev: p > 0 ? colToLetters(col - 1) : null,
          row,
          isFirstProjection: p === actuals.length,
          seedFrom,
          seedTo,
          ref: (key, colLetter = colToLetters(col)) => {
            const loc = lines[key];
            if (!loc) throw new Error(`Unknown line ${key}`);
            const prefix = loc.sheet === plan.name ? "" : `${loc.sheet}!`;
            return `${prefix}${colLetter}${loc.row}`;
          },
        };
        const base = { format: spec.format ?? "number", bold: spec.bold };

        if (period.kind === "projected") {
          if (!spec.projected) return;
          const formula = spec.projected(context);
          if (formula) {
            set(row, col, {
              ...base,
              formula,
              role: spec.projectedIsAssumption ? "assumption" : "formula",
            });
          }
          return;
        }

        if (spec.actual === "filing") {
          const found = extraction.lines[spec.key!]?.[p] ?? null;
          if (found) {
            set(row, col, { ...base, value: found.value, source: found.source, role: "filing" });
            return;
          }
          if (spec.fallback) {
            set(row, col, {
              ...base,
              formula: spec.fallback.formula(context),
              role: "formula",
              note: spec.fallback.note,
            });
            return;
          }
          const def = LINE_DEF_BY_KEY[spec.key!];
          set(row, col, {
            ...base,
            role: "filing",
            note: def?.required
              ? "Missing: the 10-K data has no value for this required line. It is left blank rather than estimated."
              : "Not reported separately in this filing; treated as zero.",
          });
          return;
        }

        const formula = spec.actual?.(context);
        if (!formula) return;
        const missing = (spec.requires ?? []).filter((key) => !extraction.lines[key]?.[p]);
        if (missing.length) {
          const labels = missing.map((key) => LINE_DEF_BY_KEY[key]?.label ?? key).join(" and ");
          set(row, col, {
            ...base,
            role: "formula",
            note: `Left blank: ${labels} is missing for ${period.label}. Once it is filled in, this cell's formula is =${formula}`,
          });
          return;
        }
        set(row, col, { ...base, formula, role: "formula" });
      });
    });

    return {
      name: plan.name,
      title: plan.title,
      rowCount: FIRST_LINE_ROW + plan.rows.length - 1,
      colCount: FIRST_PERIOD_COL + periods.length - 1,
      cells,
      frozenRows: PERIOD_END_ROW,
    };
  });

  const dcf = buildDcfSheet({ periods: allPeriods, lines });
  sheets.push(dcf.sheet);
  Object.assign(lines, dcf.lines);

  // Recent quarters reference the annual sheets, so they are built last.
  const quarterly = extraction.quarters
    ? buildQuarterlySheet(extraction.quarters, { periods: actuals, lines, values: extraction.lines })
    : null;
  if (quarterly) {
    sheets.push(quarterly.sheet);
    Object.assign(lines, quarterly.lines);
  }

  const company: Company = {
    cik: extraction.cik,
    ticker: options.ticker.toUpperCase(),
    name: extraction.entityName,
  };

  return {
    company,
    createdAt: (options.now ?? new Date()).toISOString(),
    units: "USD millions, except per-share amounts",
    periods: allPeriods,
    sheets,
    lines,
  };
}
