import { cellKey, toAddress } from "../sheet/address";
import type { Values } from "../sheet/engine";
import { isCellError, type Workbook } from "../sheet/types";
import { LINE_DEFS } from "../sec/template";
import { FIRST_PERIOD_COL } from "./build";

export type CheckStatus = "pass" | "warn" | "fail";

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  /** Why the check passed or failed, one line per finding. */
  details: string[];
  /** `Sheet!A1` keys of the cells behind a failure, for highlighting. */
  cells: string[];
}

const MAX_DETAILS = 8;

// Reported totals tie exactly; allow for float noise and rounding of
// values the user typed in by hand.
function tolerance(reference: number): number {
  return Math.max(0.01, Math.abs(reference) * 0.0005);
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

class LineReader {
  constructor(
    private readonly workbook: Workbook,
    private readonly values: Values,
  ) {}

  key(line: string, periodIndex: number): string | null {
    const loc = this.workbook.lines[line];
    if (!loc) return null;
    return cellKey(loc.sheet, toAddress(loc.row, FIRST_PERIOD_COL + periodIndex));
  }

  /** Numeric value, 0 for blank, null for errors, text or unknown lines. */
  number(line: string, periodIndex: number): number | null {
    const key = this.key(line, periodIndex);
    if (!key) return null;
    const v = this.values[key];
    if (v === undefined || v === null) return 0;
    return typeof v === "number" ? v : null;
  }

  hasContent(line: string, periodIndex: number): boolean {
    const loc = this.workbook.lines[line];
    if (!loc) return false;
    const sheet = this.workbook.sheets.find((s) => s.name === loc.sheet);
    const cell = sheet?.cells[toAddress(loc.row, FIRST_PERIOD_COL + periodIndex)];
    return !!cell && (cell.formula !== undefined || (cell.value !== undefined && cell.value !== null));
  }
}

function summarize(
  id: string,
  label: string,
  failStatus: CheckStatus,
  findings: Array<{ detail: string; cells: string[] }>,
  passDetail: string,
): CheckResult {
  if (!findings.length) {
    return { id, label, status: "pass", details: [passDetail], cells: [] };
  }
  const details = findings.slice(0, MAX_DETAILS).map((f) => f.detail);
  if (findings.length > MAX_DETAILS) details.push(`…and ${findings.length - MAX_DETAILS} more`);
  return { id, label, status: failStatus, details, cells: findings.flatMap((f) => f.cells) };
}

function tieCheck(
  reader: LineReader,
  workbook: Workbook,
  id: string,
  label: string,
  left: { lines: string[]; name: string },
  right: { line: string; name: string },
  /** Inputs that must be present; missing ones are reported by the gaps check. */
  requires: string[],
): CheckResult {
  const findings: Array<{ detail: string; cells: string[] }> = [];
  workbook.periods.forEach((period, i) => {
    if (period.kind !== "actual") return;
    if (requires.some((line) => !reader.hasContent(line, i))) return;
    const parts = left.lines.map((l) => reader.number(l, i));
    const target = reader.number(right.line, i);
    if (parts.some((p) => p === null) || target === null) return; // reported by the errors check
    const total = (parts as number[]).reduce((a, b) => a + b, 0);
    const diff = total - target;
    if (Math.abs(diff) > tolerance(target)) {
      findings.push({
        detail: `${period.label}: ${left.name} ${fmt(total)} vs ${right.name} ${fmt(target)} (off by ${fmt(diff)})`,
        cells: [...left.lines, right.line]
          .map((l) => reader.key(l, i))
          .filter((k): k is string => !!k),
      });
    }
  });
  return summarize(id, label, "fail", findings, `Ties out in every actual year.`);
}

interface SignRule {
  line: string;
  expect: "positive" | "nonNegative" | "nonPositive";
  includeProjections?: boolean;
  why: string;
}

const SIGN_RULES: SignRule[] = [
  { line: "revenue", expect: "nonNegative", includeProjections: true, why: "revenue should not be negative" },
  { line: "totalAssets", expect: "positive", why: "total assets should be positive" },
  { line: "cash", expect: "nonNegative", why: "cash should not be negative" },
  { line: "dilutedShares", expect: "positive", includeProjections: true, why: "share count should be positive" },
  { line: "capex", expect: "nonPositive", why: "capital expenditures are a cash outflow" },
  { line: "dividendsPaid", expect: "nonPositive", why: "dividends are a cash outflow" },
  { line: "shareRepurchases", expect: "nonPositive", why: "buybacks are a cash outflow" },
];

function signCheck(reader: LineReader, workbook: Workbook): CheckResult {
  const findings: Array<{ detail: string; cells: string[] }> = [];
  for (const rule of SIGN_RULES) {
    workbook.periods.forEach((period, i) => {
      if (period.kind === "projected" && !rule.includeProjections) return;
      if (!reader.hasContent(rule.line, i)) return;
      const v = reader.number(rule.line, i);
      if (v === null) return;
      const ok =
        rule.expect === "positive" ? v > 0 : rule.expect === "nonNegative" ? v >= 0 : v <= 0;
      if (!ok) {
        findings.push({
          detail: `${period.label}: ${rule.why} (${fmt(v)})`,
          cells: [reader.key(rule.line, i)!],
        });
      }
    });
  }
  return summarize("signs", "Signs make sense", "fail", findings, "No values with an unexpected sign.");
}

function errorCheck(workbook: Workbook, values: Values): CheckResult {
  const findings: Array<{ detail: string; cells: string[] }> = [];
  for (const sheet of workbook.sheets) {
    for (const address of Object.keys(sheet.cells)) {
      const key = cellKey(sheet.name, address);
      const v = values[key];
      if (isCellError(v)) {
        findings.push({ detail: `${key}: ${v.error}${v.message ? ` (${v.message})` : ""}`, cells: [key] });
      }
    }
  }
  return summarize("errors", "No formula errors", "fail", findings, "Every formula evaluates.");
}

function gapCheck(reader: LineReader, workbook: Workbook): CheckResult {
  const findings: Array<{ detail: string; cells: string[] }> = [];
  for (const def of LINE_DEFS) {
    if (!def.required || !workbook.lines[def.key]) continue;
    workbook.periods.forEach((period, i) => {
      if (period.kind !== "actual" || reader.hasContent(def.key, i)) return;
      findings.push({ detail: `${def.label}, ${period.label}`, cells: [reader.key(def.key, i)!] });
    });
  }
  return summarize(
    "gaps",
    "Required data present",
    "warn",
    findings,
    "Every required line has a value from the filings.",
  );
}

/** Integrity checks that run after every edit (PRD F4). */
export function runChecks(workbook: Workbook, values: Values): CheckResult[] {
  const reader = new LineReader(workbook, values);
  return [
    tieCheck(reader, workbook, "balance", "Balance sheet balances",
      { lines: ["totalAssets"], name: "total assets" },
      { line: "totalLiabilitiesAndEquity", name: "liabilities and equity" },
      ["totalAssets", "totalLiabilitiesAndEquity"]),
    tieCheck(reader, workbook, "liabilitiesEquity", "Liabilities and equity add up",
      { lines: ["totalLiabilities", "temporaryEquity", "totalEquity"], name: "liabilities + equity" },
      { line: "totalLiabilitiesAndEquity", name: "reported total" },
      ["totalEquity", "totalLiabilitiesAndEquity"]),
    tieCheck(reader, workbook, "cash", "Cash ties out",
      { lines: ["endingCash"], name: "beginning cash + net change" },
      { line: "endingCashReported", name: "reported ending cash" },
      ["beginningCash", "netChangeInCash", "endingCashReported"]),
    signCheck(reader, workbook),
    errorCheck(workbook, values),
    gapCheck(reader, workbook),
  ];
}

export function exportBlockers(checks: CheckResult[]): CheckResult[] {
  return checks.filter((c) => c.status === "fail");
}
