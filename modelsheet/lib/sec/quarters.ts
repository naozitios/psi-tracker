import {
  daysBetween,
  findAnnualPeriods,
  PERIOD_ANCHORS,
  pickValue,
  shiftDate,
  type CompanyFacts,
  type ExtractedValue,
  type FactEntry,
} from "./extract";
import { LINE_DEF_BY_KEY } from "./template";

// Recent quarters. 10-Qs report the first three quarters of each fiscal
// year; the fourth is never filed on its own, so it is derived later as a
// formula (full year minus Q1-Q3). Cash flow statements in 10-Qs are
// year-to-date, so those are extracted as reported and differenced later.

export const QUARTER_LINES = [
  "revenue",
  "costOfRevenue",
  "researchAndDevelopment",
  "sellingGeneralAdmin",
  "operatingIncome",
  "pretaxIncome",
  "incomeTax",
  "netIncome",
  "dilutedShares",
  "dilutedEps",
] as const;

export const YTD_LINES = ["cashFromOperations", "capex"] as const;

export interface QuarterPeriod {
  label: string;
  quarter: 1 | 2 | 3 | 4;
  /** Fiscal year label, e.g. FY2024. */
  fiscalYear: string;
  fiscalYearStart: string;
  /** Annual period end when the fiscal year is complete (its 10-K is filed). */
  fiscalYearEnd: string | null;
  end: string;
}

export interface QuarterExtraction {
  periods: QuarterPeriod[];
  /** Three-month values for Q1-Q3; null for Q4 and where not reported. */
  lines: Record<string, Array<ExtractedValue | null>>;
  /** Year-to-date values for Q1-Q3; null for Q4 and where not reported. */
  ytd: Record<string, Array<ExtractedValue | null>>;
}

const TOLERANCE_DAYS = 7;

function isQuarterlyReport(form: string): boolean {
  return form === "10-Q" || form === "10-Q/A";
}

function isThreeMonths(entry: FactEntry): boolean {
  if (!entry.start) return false;
  const length = daysBetween(entry.start, entry.end);
  return length >= 80 && length <= 100;
}

function near(a: string, b: string): boolean {
  return Math.abs(daysBetween(a, b)) <= TOLERANCE_DAYS;
}

interface FiscalYear {
  label: string;
  start: string;
  end: string;
  complete: boolean;
}

/**
 * The last `completedYears` fiscal years with all four quarters, then
 * whatever quarters of the current fiscal year have been filed.
 */
export function extractQuarters(facts: CompanyFacts, completedYears = 2): QuarterExtraction {
  const annual = findAnnualPeriods(facts, 50);
  if (!annual.length) return { periods: [], lines: {}, ytd: {} };

  const last = annual[annual.length - 1];
  const years: FiscalYear[] = annual.map((p) => ({
    label: `FY${p.end.slice(0, 4)}`,
    start: p.start,
    end: p.end,
    complete: true,
  }));
  const currentEnd = shiftDate(last.end, 364);
  years.push({ label: `FY${currentEnd.slice(0, 4)}`, start: shiftDate(last.end, 1), end: currentEnd, complete: false });

  // Quarter ends seen in 10-Q three-month facts, keyed to fiscal year and quarter.
  const gaap = facts.facts["us-gaap"] ?? {};
  const found = new Map<string, QuarterPeriod>();
  for (const concept of PERIOD_ANCHORS) {
    for (const entry of gaap[concept]?.units.USD ?? []) {
      if (!isQuarterlyReport(entry.form) || !isThreeMonths(entry)) continue;
      const year = years.find((y) => entry.end > y.start && daysBetween(entry.end, y.end) >= -TOLERANCE_DAYS);
      if (!year) continue;
      const quarter = Math.round(daysBetween(year.start, entry.end) / 91.3);
      if (quarter < 1 || quarter > 3) continue;
      const key = `${year.label}Q${quarter}`;
      if (!found.has(key)) {
        found.set(key, {
          label: `Q${quarter} ${year.label}`,
          quarter: quarter as 1 | 2 | 3,
          fiscalYear: year.label,
          fiscalYearStart: year.start,
          fiscalYearEnd: year.complete ? year.end : null,
          end: entry.end,
        });
      }
    }
  }

  const completed = years.filter((y) => y.complete).slice(-completedYears);
  const current = years[years.length - 1];
  const periods: QuarterPeriod[] = [];
  for (const year of [...completed, current]) {
    for (const q of [1, 2, 3] as const) {
      const period = found.get(`${year.label}Q${q}`);
      if (period) periods.push(period);
      else if (year.complete) {
        // Keep the column so Q4 can show why it could not be derived.
        periods.push({
          label: `Q${q} ${year.label}`,
          quarter: q,
          fiscalYear: year.label,
          fiscalYearStart: year.start,
          fiscalYearEnd: year.end,
          end: shiftDate(year.start, Math.round(91.3 * q) - 1),
        });
      }
    }
    if (year.complete) {
      periods.push({
        label: `Q4 ${year.label}`,
        quarter: 4,
        fiscalYear: year.label,
        fiscalYearStart: year.start,
        fiscalYearEnd: year.end,
        end: year.end,
      });
    }
  }

  const lines: QuarterExtraction["lines"] = {};
  for (const key of QUARTER_LINES) {
    const def = LINE_DEF_BY_KEY[key];
    lines[key] = periods.map((p) =>
      p.quarter === 4
        ? null
        : pickValue(facts, def, (e) => isQuarterlyReport(e.form) && isThreeMonths(e) && near(e.end, p.end)),
    );
  }

  const ytd: QuarterExtraction["ytd"] = {};
  for (const key of YTD_LINES) {
    const def = LINE_DEF_BY_KEY[key];
    ytd[key] = periods.map((p) =>
      p.quarter === 4
        ? null
        : pickValue(
            facts,
            def,
            (e) => isQuarterlyReport(e.form) && !!e.start && near(e.start, p.fiscalYearStart) && near(e.end, p.end),
          ),
    );
  }

  return { periods, lines, ytd };
}
