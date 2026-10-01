import { colToLetters, toAddress } from "../sheet/address";
import type { Cell, CellFormat, LineLocation, Period, Sheet } from "../sheet/types";
import type { ExtractedValue } from "../sec/extract";
import type { QuarterExtraction } from "../sec/quarters";
import { LINE_DEF_BY_KEY } from "../sec/template";

export const SHEET_QUARTERLY = "Quarterly";

const FIRST_COL = 2;
const FIRST_ROW = 4;

type Row =
  | { key: string; label: string; flow?: boolean; format?: CellFormat; bold?: boolean }
  | "blank"
  | { header: string };

// Keys are prefixed so they never collide with the annual lines.
const ROWS: Row[] = [
  { key: "q.revenue", label: "Revenue", flow: true, bold: true },
  { key: "q.costOfRevenue", label: "Cost of revenue", flow: true },
  { key: "q.grossProfit", label: "Gross profit", bold: true },
  { key: "q.researchAndDevelopment", label: "Research and development", flow: true },
  { key: "q.sellingGeneralAdmin", label: "Selling, general and administrative", flow: true },
  { key: "q.operatingIncome", label: "Operating income", flow: true, bold: true },
  { key: "q.pretaxIncome", label: "Pre-tax income", flow: true },
  { key: "q.incomeTax", label: "Income tax expense", flow: true },
  { key: "q.netIncome", label: "Net income", flow: true, bold: true },
  "blank",
  { key: "q.dilutedShares", label: "Diluted shares (millions)" },
  { key: "q.dilutedEps", label: "Diluted EPS (USD)", format: "perShare" },
  "blank",
  { header: "Cash flow" },
  { key: "q.cashFromOperationsYtd", label: "Cash from operations, year to date (as reported)" },
  { key: "q.capexYtd", label: "Capital expenditures, year to date (as reported)" },
  { key: "q.cashFromOperations", label: "Cash from operations", bold: true },
  { key: "q.capex", label: "Capital expenditures" },
  { key: "q.freeCashFlow", label: "Free cash flow", bold: true },
  "blank",
  { header: "Growth" },
  { key: "q.revenueGrowth", label: "Revenue growth vs. same quarter last year", format: "percent" },
];

const YTD_SOURCE: Record<string, { ytdKey: string; annualKey: string }> = {
  "q.cashFromOperationsYtd": { ytdKey: "cashFromOperations", annualKey: "cashFromOperations" },
  "q.capexYtd": { ytdKey: "capex", annualKey: "capex" },
};

/**
 * Builds the Quarterly sheet. Q1-Q3 come from 10-Qs; Q4 and quarterly cash
 * flow are formulas against the annual sheets, so every number stays
 * traceable to a filing.
 */
export function buildQuarterlySheet(
  quarters: QuarterExtraction,
  annual: {
    periods: Period[];
    lines: Record<string, LineLocation>;
    values: Record<string, Array<ExtractedValue | null>>;
  },
): { sheet: Sheet; lines: Record<string, LineLocation> } | null {
  const periods = quarters.periods;
  if (!periods.length) return null;

  const lines: Record<string, LineLocation> = {};
  ROWS.forEach((row, i) => {
    if (typeof row === "object" && "key" in row) lines[row.key] = { sheet: SHEET_QUARTERLY, row: FIRST_ROW + i };
  });
  const rowOf = (key: string) => lines[key].row;
  const colOf = (i: number) => colToLetters(FIRST_COL + i);
  // Reference to a full-year filing value, or null when that year or value is missing.
  const annualRef = (key: string, fiscalYearEnd: string | null): string | null => {
    const index = annual.periods.findIndex((p) => p.kind === "actual" && p.end === fiscalYearEnd);
    const loc = annual.lines[key];
    if (index < 0 || !loc || !annual.values[key]?.[index]) return null;
    return `${loc.sheet}!${colToLetters(FIRST_COL + index)}${loc.row}`;
  };
  // Columns of Q1-Q3 of the same fiscal year, in order.
  const earlierQuarters = (i: number) =>
    periods
      .map((p, j) => ({ p, j }))
      .filter(({ p }) => p.fiscalYear === periods[i].fiscalYear && p.quarter < periods[i].quarter);

  const cells: Record<string, Cell> = {};
  const set = (row: number, col: number, cell: Cell) => (cells[toAddress(row, col)] = cell);

  set(1, 1, { value: "USD millions", role: "header", bold: true, format: "text" });
  set(2, 1, { value: "Quarter end", role: "label", format: "text" });
  periods.forEach((p, i) => {
    set(1, FIRST_COL + i, { value: p.label, role: "header", bold: true, format: "text" });
    set(2, FIRST_COL + i, { value: p.end, role: "label", format: "text" });
  });

  ROWS.forEach((row, r) => {
    const rowNum = FIRST_ROW + r;
    if (row === "blank") return;
    if ("header" in row) {
      set(rowNum, 1, { value: row.header, role: "header", bold: true, format: "text" });
      return;
    }
    set(rowNum, 1, { value: row.label, role: "label", bold: row.bold, format: "text" });
    const base = { format: row.format ?? "number", bold: row.bold } as const;
    const baseKey = row.key.slice(2);

    periods.forEach((p, i) => {
      const col = FIRST_COL + i;
      const c = colOf(i);
      const formula = (f: string) => set(rowNum, col, { ...base, formula: f, role: "formula" });
      const blank = (note: string, role: Cell["role"] = "formula") => set(rowNum, col, { ...base, role, note });

      if (row.key in YTD_SOURCE) {
        const { ytdKey, annualKey } = YTD_SOURCE[row.key];
        if (p.quarter === 4) {
          const ref = annualRef(annualKey, p.fiscalYearEnd);
          if (ref) formula(ref);
          else blank("The full-year figure for this fiscal year is not in the filings data.");
          return;
        }
        const found = quarters.ytd[ytdKey]?.[i];
        if (found) set(rowNum, col, { ...base, value: found.value, source: found.source, role: "filing" });
        else blank("Not reported in this 10-Q.", "filing");
        return;
      }

      if (row.key === "q.cashFromOperations" || row.key === "q.capex") {
        const ytdRow = rowOf(`${row.key}Ytd`);
        if (p.quarter === 1) return formula(`${c}${ytdRow}`);
        const prev = earlierQuarters(i).at(-1);
        if (prev && prev.p.quarter === p.quarter - 1) return formula(`${c}${ytdRow}-${colOf(prev.j)}${ytdRow}`);
        return blank("Needs the previous quarter's year-to-date figure, which is missing.");
      }

      if (row.key === "q.freeCashFlow") {
        return formula(`${c}${rowOf("q.cashFromOperations")}+${c}${rowOf("q.capex")}`);
      }
      if (row.key === "q.grossProfit") {
        return formula(`${c}${rowOf("q.revenue")}-${c}${rowOf("q.costOfRevenue")}`);
      }
      if (row.key === "q.revenueGrowth") {
        const prior = periods.findIndex(
          (o) => o.quarter === p.quarter && Number(o.fiscalYear.slice(2)) === Number(p.fiscalYear.slice(2)) - 1,
        );
        if (prior < 0) return;
        const rev = rowOf("q.revenue");
        return formula(`${c}${rev}/${colOf(prior)}${rev}-1`);
      }

      if (p.quarter !== 4) {
        const found = quarters.lines[baseKey]?.[i];
        if (found) set(rowNum, col, { ...base, value: found.value, source: found.source, role: "filing" });
        else blank("Not reported in this 10-Q.", "filing");
        return;
      }

      // Q4 is never filed on its own.
      if (!row.flow) return blank("10-K filings do not report this for the fourth quarter on its own.");
      const annualValue = annualRef(baseKey, p.fiscalYearEnd);
      const earlier = earlierQuarters(i);
      const haveQuarters =
        earlier.length === 3 && earlier.every(({ j }) => quarters.lines[baseKey]?.[j]);
      if (!annualValue) {
        const anyQuarter = earlier.some(({ j }) => quarters.lines[baseKey]?.[j]);
        return anyQuarter ? blank("The full-year figure for this fiscal year is not in the filings data.") : undefined;
      }
      if (!haveQuarters) {
        const anyQuarter = earlier.some(({ j }) => quarters.lines[baseKey]?.[j]);
        return anyQuarter
          ? blank("Left blank: Q1-Q3 are not all reported, so Q4 cannot be derived from the full year.")
          : undefined;
      }
      formula(`${annualValue}-SUM(${colOf(earlier[0].j)}${rowNum}:${colOf(earlier[2].j)}${rowNum})`);
      cells[toAddress(rowNum, col)].note = `Fourth quarter = full year (${LINE_DEF_BY_KEY[baseKey]?.label ?? baseKey}, 10-K) minus Q1-Q3 (10-Qs).`;
    });
  });

  return {
    sheet: {
      name: SHEET_QUARTERLY,
      title: "Recent quarters",
      rowCount: FIRST_ROW + ROWS.length - 1,
      colCount: FIRST_COL + periods.length - 1,
      cells,
      frozenRows: 2,
    },
    lines,
  };
}
