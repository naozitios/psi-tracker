import { describe, expect, it } from "vitest";
import { buildWorkbook } from "@/lib/model/build";
import { runChecks } from "@/lib/model/checks";
import { SHEET_QUARTERLY } from "@/lib/model/quarterly";
import { extractFinancials } from "@/lib/sec/extract";
import { extractQuarters } from "@/lib/sec/quarters";
import { evaluateWorkbook } from "@/lib/sheet/engine";
import { buildCompanyFacts, figures, QUARTER_SHARES } from "./fixtures/companyfacts";

const facts = buildCompanyFacts();

describe("extractQuarters", () => {
  const q = extractQuarters(facts);

  it("covers the last two fiscal years and the current year's filed quarters", () => {
    expect(q.periods.map((p) => p.label)).toEqual([
      "Q1 FY2023", "Q2 FY2023", "Q3 FY2023", "Q4 FY2023",
      "Q1 FY2024", "Q2 FY2024", "Q3 FY2024", "Q4 FY2024",
      "Q1 FY2025",
    ]);
    expect(q.periods[7]).toMatchObject({ quarter: 4, end: "2024-09-28", fiscalYearEnd: "2024-09-28" });
    expect(q.periods[8]).toMatchObject({ quarter: 1, fiscalYearEnd: null });
  });

  it("reads three-month income statement values from 10-Qs only", () => {
    const q1 = q.lines.revenue[4]!;
    expect(q1.value).toBeCloseTo(391_000 * QUARTER_SHARES[0], 6);
    // Also reported as the comparative in the next year's Q1 10-Q, which is newer and wins.
    expect(q1.source).toMatchObject({ form: "10-Q", accessionNumber: "0001234567-25-000210" });
    expect(q.lines.revenue[7]).toBeNull();
  });

  it("reads year-to-date cash flow as reported", () => {
    const ytd = q.ytd.cashFromOperations[6]!;
    expect(ytd.value).toBeCloseTo(figures(2024).cfo * (0.24 + 0.23 + 0.25), 6);
    expect(ytd.source.periodStart).toBe("2023-10-01");
    expect(q.ytd.capex[4]!.value).toBeCloseTo(-figures(2024).capex * 0.24, 6);
  });
});

describe("Quarterly sheet", () => {
  const wb = buildWorkbook(extractFinancials(facts), { ticker: "EXMP" });
  const values = evaluateWorkbook(wb);
  const sheet = wb.sheets.find((s) => s.name === SHEET_QUARTERLY)!;
  const at = (line: string, col: string) => values[`${SHEET_QUARTERLY}!${col}${wb.lines[line].row}`];

  it("derives Q4 from the full year minus Q1-Q3, as a formula", () => {
    const revenueRow = wb.lines["q.revenue"].row;
    expect(sheet.cells[`I${revenueRow}`].formula).toBe(`Income!F${wb.lines.revenue.row}-SUM(F${revenueRow}:H${revenueRow})`);
    expect(at("q.revenue", "I")).toBeCloseTo(391_000 * QUARTER_SHARES[3], 6);
    expect(at("q.netIncome", "E")).toBeCloseTo(figures(2023).netIncome * QUARTER_SHARES[3], 6);
    expect(sheet.cells[`I${wb.lines["q.dilutedEps"].row}`].note).toMatch(/do not report/);
  });

  it("turns year-to-date cash flow into quarters", () => {
    const cfo = figures(2024).cfo;
    expect(at("q.cashFromOperations", "F")).toBeCloseTo(cfo * 0.24, 6);
    expect(at("q.cashFromOperations", "G")).toBeCloseTo(cfo * 0.23, 6);
    expect(at("q.cashFromOperations", "I")).toBeCloseTo(cfo * 0.28, 6);
    expect(at("q.freeCashFlow", "I")).toBeCloseTo((cfo - figures(2024).capex) * 0.28, 6);
  });

  it("compares each quarter with the same quarter a year earlier", () => {
    expect(at("q.revenueGrowth", "J")).toBeCloseTo(405_000 / 391_000 - 1, 9);
    expect(sheet.cells[`B${wb.lines["q.revenueGrowth"].row}`]).toBeUndefined();
  });

  it("keeps the model's checks passing", () => {
    expect(runChecks(wb, values).filter((c) => c.status !== "pass")).toEqual([]);
  });

  it("leaves Q4 blank when a quarter is missing, instead of deriving a wrong number", () => {
    const partial = buildCompanyFacts();
    const units = partial.facts["us-gaap"].RevenueFromContractWithCustomerExcludingAssessedTax.units.USD;
    const q2End = extractQuarters(partial).periods.find((p) => p.label === "Q2 FY2024")!.end;
    const kept = units.filter((e) => !(e.form === "10-Q" && e.end === q2End));
    units.splice(0, units.length, ...kept);
    const book = buildWorkbook(extractFinancials(partial), { ticker: "EXMP" });
    const q = book.sheets.find((s) => s.name === SHEET_QUARTERLY)!;
    const row = book.lines["q.revenue"].row;
    expect(q.cells[`G${row}`].value).toBeUndefined();
    expect(q.cells[`I${row}`].formula).toBeUndefined();
    expect(q.cells[`I${row}`].note).toMatch(/not all reported/);
  });
});
