import { filingIndexUrl, padCik } from "./client";
import { LINE_DEFS, scaleFor, type LineDef } from "./template";
import type { FilingSource, Period } from "../sheet/types";
import { extractQuarters, type QuarterExtraction } from "./quarters";

// Shapes of https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json
export interface FactEntry {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy: number | null;
  fp: string | null;
  form: string;
  filed: string;
  frame?: string;
}

export interface ConceptFacts {
  label: string | null;
  description?: string | null;
  units: Record<string, FactEntry[]>;
}

export interface CompanyFacts {
  cik: number;
  entityName: string;
  facts: Record<string, Record<string, ConceptFacts>>;
}

export interface ExtractedValue {
  value: number;
  source: FilingSource;
}

export interface Extraction {
  cik: string;
  entityName: string;
  periods: Period[];
  /** One entry per period, null where the filings have no value. */
  lines: Record<string, Array<ExtractedValue | null>>;
  quarters?: QuarterExtraction;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_TOLERANCE_DAYS = 7;

export function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / DAY_MS;
}

export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);
}

function isAnnualReport(form: string): boolean {
  return form === "10-K" || form === "10-K/A";
}

function isFullYear(entry: FactEntry): boolean {
  if (!entry.start) return false;
  const length = daysBetween(entry.start, entry.end);
  return length >= 350 && length <= 380;
}

// Concepts nearly every filer reports for each fiscal year; used to find
// the fiscal periods before any line item is read.
export const PERIOD_ANCHORS = [
  "NetIncomeLoss",
  "ProfitLoss",
  "Revenues",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "OperatingIncomeLoss",
  "NetCashProvidedByUsedInOperatingActivities",
];

export function findAnnualPeriods(facts: CompanyFacts, maxYears = 5): Period[] {
  const gaap = facts.facts["us-gaap"] ?? {};
  const byEnd = new Map<string, string>();
  for (const concept of PERIOD_ANCHORS) {
    for (const entry of gaap[concept]?.units.USD ?? []) {
      if (isAnnualReport(entry.form) && isFullYear(entry)) {
        byEnd.set(entry.end, entry.start!);
      }
    }
  }

  const ends = [...byEnd.keys()].sort().reverse();
  const picked: string[] = [];
  for (const end of ends) {
    // 52/53-week years end on slightly different dates; treat near-equal
    // ends as the same fiscal year.
    if (picked.some((p) => Math.abs(daysBetween(p, end)) <= DATE_TOLERANCE_DAYS)) continue;
    picked.push(end);
    if (picked.length === maxYears) break;
  }

  return picked.reverse().map((end) => ({
    label: `FY${end.slice(0, 4)}A`,
    start: byEnd.get(end)!,
    end,
    kind: "actual" as const,
  }));
}

function matchesPeriod(entry: FactEntry, def: LineDef, period: Period): boolean {
  if (!isAnnualReport(entry.form)) return false;
  if (def.periodType === "duration") {
    return (
      isFullYear(entry) &&
      Math.abs(daysBetween(entry.end, period.end)) <= DATE_TOLERANCE_DAYS
    );
  }
  if (entry.start) return false;
  const target = def.atPeriodStart ? shiftDate(period.start, -1) : period.end;
  return Math.abs(daysBetween(entry.end, target)) <= DATE_TOLERANCE_DAYS;
}

/**
 * The value for one line item, from the first concept with a fact that
 * `matches`. Among matching facts the most recently filed wins, so
 * restated figures replace originals.
 */
export function pickValue(
  facts: CompanyFacts,
  def: LineDef,
  matches: (entry: FactEntry) => boolean,
): ExtractedValue | null {
  const gaap = facts.facts["us-gaap"] ?? {};
  for (const concept of def.concepts) {
    const conceptFacts = gaap[concept];
    const entries = conceptFacts?.units[def.unit] ?? [];
    let best: FactEntry | null = null;
    for (const entry of entries) {
      if (!matches(entry)) continue;
      if (
        !best ||
        entry.filed > best.filed ||
        (entry.filed === best.filed && entry.accn > best.accn)
      ) {
        best = entry;
      }
    }
    if (!best) continue;

    const scale = scaleFor(def.unit) * (def.sign ?? 1);
    return {
      value: best.val * scale,
      source: {
        concept: `us-gaap:${concept}`,
        conceptLabel: conceptFacts?.label ?? concept,
        statement: def.statement,
        lineItem: def.label,
        form: best.form,
        accessionNumber: best.accn,
        filed: best.filed,
        periodStart: best.start,
        periodEnd: best.end,
        reportedValue: best.val,
        unit: def.unit,
        scale,
        url: filingIndexUrl(facts.cik, best.accn),
      },
    };
  }
  return null;
}

export function extractFinancials(facts: CompanyFacts, maxYears = 5): Extraction {
  const periods = findAnnualPeriods(facts, maxYears);
  const lines: Extraction["lines"] = {};
  for (const def of LINE_DEFS) {
    lines[def.key] = periods.map((p) => pickValue(facts, def, (e) => matchesPeriod(e, def, p)));
  }
  return {
    cik: padCik(facts.cik),
    entityName: facts.entityName,
    periods,
    lines,
    quarters: extractQuarters(facts),
  };
}
