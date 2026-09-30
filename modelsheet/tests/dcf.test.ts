import { describe, expect, it } from "vitest";
import { buildWorkbook } from "@/lib/model/build";
import { runChecks } from "@/lib/model/checks";
import { SHEET_DCF } from "@/lib/model/dcf";
import { extractFinancials } from "@/lib/sec/extract";
import { cellKey, colToLetters } from "@/lib/sheet/address";
import { applyEdits } from "@/lib/sheet/edits";
import { evaluateWorkbook } from "@/lib/sheet/engine";
import type { Workbook } from "@/lib/sheet/types";
import { buildCompanyFacts, figures } from "./fixtures/companyfacts";

const wb = buildWorkbook(extractFinancials(buildCompanyFacts()), { ticker: "EXMP" });
const values = evaluateWorkbook(wb);

function series(book: Workbook, v: typeof values, line: string, index: number): number {
  const loc = book.lines[line];
  return v[cellKey(loc.sheet, `${colToLetters(2 + index)}${loc.row}`)] as number;
}
const scalar = (book: Workbook, v: typeof values, line: string) => series(book, v, line, 0);

describe("DCF sheet", () => {
  it("builds unlevered free cash flow from the forecast and the cash flow statement", () => {
    const f = figures(2024);
    const tax = f.incomeTax / f.pretaxIncome;
    expect(series(wb, values, "dcf.fcf", 4)).toBeCloseTo(
      f.operatingIncome * (1 - tax) + f.da - f.capex + 0.01 * f.revenue,
      6,
    );
    // Forecast years use driver ratios seeded from the last three actual
    // years; the fixture's capex is 3% of (restated) revenue in each.
    expect(series(wb, values, "dcf.capexPercent", 4)).toBeCloseTo(-0.03, 12);
    expect(series(wb, values, "dcf.capexPercent", 5)).toBeCloseTo(-0.03, 12);
    expect(series(wb, values, "dcf.capex", 5)).toBeCloseTo(-0.03 * series(wb, values, "dcf.revenue", 5), 6);
  });

  it("computes WACC from the marked inputs", () => {
    const tax = series(wb, values, "dcf.taxRate", 5);
    expect(scalar(wb, values, "dcf.wacc")).toBeCloseTo(0.9 * (0.04 + 1 * 0.05) + 0.1 * 0.05 * (1 - tax), 12);
    const riskFree = wb.sheets.find((s) => s.name === SHEET_DCF)!.cells[`B${wb.lines["dcf.riskFree"].row}`];
    expect(riskFree).toMatchObject({ role: "assumption", value: 0.04 });
    expect(riskFree.note).toMatch(/Placeholder/);
  });

  it("values the equity by discounting the forecast and a terminal value", () => {
    const w = scalar(wb, values, "dcf.wacc");
    const g = scalar(wb, values, "dcf.terminalGrowth");
    const fcf = [5, 6, 7, 8, 9].map((i) => series(wb, values, "dcf.fcf", i));
    const pv = fcf.reduce((sum, cf, t) => sum + cf / (1 + w) ** (t + 1), 0);
    const tv = (fcf[4] * (1 + g)) / (w - g);
    const ev = pv + tv / (1 + w) ** 5;
    const f = figures(2024);
    const equity = ev - (f.shortTermDebt + f.longTermDebt) + f.cash + f.sti;
    expect(scalar(wb, values, "dcf.enterpriseValue")).toBeCloseTo(ev, 4);
    expect(scalar(wb, values, "dcf.equityValue")).toBeCloseTo(equity, 4);
    expect(scalar(wb, values, "dcf.valuePerShare")).toBeCloseTo(equity / f.shares, 8);
  });

  it("has a live sensitivity grid whose centre is the base case", () => {
    const sheet = wb.sheets.find((s) => s.name === SHEET_DCF)!;
    const gridTop = wb.lines["dcf.valuePerShare"].row + 3;
    const centre = values[cellKey(SHEET_DCF, `E${gridTop + 3}`)] as number;
    expect(centre).toBeCloseTo(scalar(wb, values, "dcf.valuePerShare"), 8);
    // Higher WACC (lower rows) means lower value; higher growth (right) means higher value.
    const at = (r: number, c: string) => values[cellKey(SHEET_DCF, `${c}${gridTop + r}`)] as number;
    expect(at(1, "E")).toBeGreaterThan(at(5, "E"));
    expect(at(3, "G")).toBeGreaterThan(at(3, "C"));
    expect(sheet.cells[`C${gridTop + 1}`].formula).toMatch(/^\(NPV\(\$B\d+,/);
  });

  it("recalculates when the user changes an input, and checks WACC against growth", () => {
    const growthCell = `B${wb.lines["dcf.terminalGrowth"].row}`;
    const { workbook: raised } = applyEdits(wb, [{ sheet: SHEET_DCF, cell: growthCell, input: "3%" }]);
    const v = evaluateWorkbook(raised);
    expect(scalar(raised, v, "dcf.valuePerShare")).toBeGreaterThan(scalar(wb, values, "dcf.valuePerShare"));

    const { workbook: broken } = applyEdits(wb, [{ sheet: SHEET_DCF, cell: growthCell, input: "0.2" }]);
    const check = runChecks(broken, evaluateWorkbook(broken)).find((c) => c.id === "valuation")!;
    expect(check.status).toBe("fail");
    expect(check.details[0]).toMatch(/must be above terminal growth/);
  });
});
