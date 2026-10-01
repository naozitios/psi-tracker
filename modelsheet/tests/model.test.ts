import { describe, expect, it } from "vitest";
import { buildWorkbook, SHEET_BALANCE, SHEET_CASHFLOW, SHEET_INCOME } from "@/lib/model/build";
import { exportBlockers, runChecks } from "@/lib/model/checks";
import { extractFinancials } from "@/lib/sec/extract";
import { cellKey, toAddress } from "@/lib/sheet/address";
import { applyEdits, changedCells, revertEdits, validateEdits } from "@/lib/sheet/edits";
import { evaluateWorkbook } from "@/lib/sheet/engine";
import type { Workbook } from "@/lib/sheet/types";
import { buildCompanyFacts, figures, RESTATED_FY2022_REVENUE } from "./fixtures/companyfacts";

function build(): Workbook {
  return buildWorkbook(extractFinancials(buildCompanyFacts()), {
    ticker: "exmp",
    now: new Date("2026-09-30T00:00:00Z"),
  });
}

function addressOf(wb: Workbook, line: string, periodIndex: number) {
  const loc = wb.lines[line];
  return { sheet: loc.sheet, address: toAddress(loc.row, 2 + periodIndex) };
}

function valueOf(wb: Workbook, values: ReturnType<typeof evaluateWorkbook>, line: string, periodIndex: number) {
  const { sheet, address } = addressOf(wb, line, periodIndex);
  return values[cellKey(sheet, address)];
}

describe("buildWorkbook", () => {
  const wb = build();
  const values = evaluateWorkbook(wb);

  it("lays out five actual and five projected years", () => {
    expect(wb.company).toEqual({ cik: "0001234567", ticker: "EXMP", name: "Example Corp" });
    expect(wb.periods.map((p) => p.label)).toEqual([
      "FY2020A", "FY2021A", "FY2022A", "FY2023A", "FY2024A",
      "FY2025E", "FY2026E", "FY2027E", "FY2028E", "FY2029E",
    ]);
    expect(wb.sheets.map((s) => s.name)).toEqual([SHEET_INCOME, SHEET_BALANCE, SHEET_CASHFLOW, "DCF", "Quarterly"]);
    const income = wb.sheets[0];
    expect(income.cells.B1.value).toBe("FY2020A");
    expect(income.cells.K1.value).toBe("FY2029E");
  });

  it("links every historical input to a filing (PRD F6)", () => {
    for (const sheet of wb.sheets) {
      for (const [address, cell] of Object.entries(sheet.cells)) {
        if (cell.role === "filing" && cell.value !== undefined) {
          expect(cell.source, `${sheet.name}!${address}`).toBeDefined();
        }
      }
    }
  });

  it("drives every projection with a formula, never a pasted value (PRD F3)", () => {
    const income = wb.sheets[0];
    for (const [address, cell] of Object.entries(income.cells)) {
      const col = address.match(/^[A-Z]+/)![0];
      if (col >= "G" && col <= "K" && Number(address.slice(col.length)) > 2) {
        expect(cell.formula, `Income!${address}`).toBeDefined();
      }
    }
  });

  it("reconciles historical subtotals to reported totals (PRD F2)", () => {
    const f = figures(2024);
    expect(valueOf(wb, values, "grossProfit", 4)).toBeCloseTo(f.revenue - f.costOfRevenue, 6);
    expect(valueOf(wb, values, "operatingIncome", 4)).toBeCloseTo(f.operatingIncome, 6);
    expect(valueOf(wb, values, "otherCurrentAssets", 4)).toBeCloseTo(0.05 * f.revenue, 6);
    expect(valueOf(wb, values, "endingCash", 4)).toBeCloseTo(f.cash, 6);
    expect(valueOf(wb, values, "freeCashFlow", 4)).toBeCloseTo(f.cfo - f.capex, 6);
  });

  it("derives a missing total instead of leaving a hole", () => {
    const { sheet, address } = addressOf(wb, "totalLiabilities", 4);
    const cell = wb.sheets.find((s) => s.name === sheet)!.cells[address];
    expect(cell.formula).toBeDefined();
    expect(cell.note).toMatch(/derived/i);
    expect(valueOf(wb, values, "totalLiabilities", 4)).toBeCloseTo(figures(2024).totalLiabilities, 6);
  });

  it("seeds forecasts from the three-year average and grows revenue from the last actual", () => {
    const g22 = RESTATED_FY2022_REVENUE / 365_000 - 1;
    const g23 = 383_000 / RESTATED_FY2022_REVENUE - 1;
    const g24 = 391_000 / 383_000 - 1;
    const growth = (g22 + g23 + g24) / 3;
    expect(valueOf(wb, values, "revenueGrowth", 5)).toBeCloseTo(growth, 12);
    expect(valueOf(wb, values, "revenue", 5)).toBeCloseTo(391_000 * (1 + growth), 6);
    expect(valueOf(wb, values, "revenue", 9)).toBeCloseTo(391_000 * (1 + growth) ** 5, 4);
    expect(valueOf(wb, values, "dilutedEps", 5)).toBeCloseTo(
      (valueOf(wb, values, "netIncome", 5) as number) / 15_300,
      9,
    );
  });
});

describe("runChecks", () => {
  it("passes every check on a clean model", () => {
    const wb = build();
    const checks = runChecks(wb, evaluateWorkbook(wb));
    expect(checks.map((c) => [c.id, c.status])).toEqual([
      ["balance", "pass"],
      ["liabilitiesEquity", "pass"],
      ["cash", "pass"],
      ["signs", "pass"],
      ["errors", "pass"],
      ["forecastInputs", "pass"],
      ["valuation", "pass"],
      ["gaps", "pass"],
    ]);
    expect(exportBlockers(checks)).toEqual([]);
  });

  it("fails the balance check when a historical input is overwritten badly", () => {
    const wb = build();
    const { sheet, address } = addressOf(wb, "totalAssets", 2);
    const { workbook } = applyEdits(wb, [{ sheet, cell: address, input: "1" }]);
    const checks = runChecks(workbook, evaluateWorkbook(workbook));
    const balance = checks.find((c) => c.id === "balance")!;
    expect(balance.status).toBe("fail");
    expect(balance.details[0]).toMatch(/^FY2022A/);
    expect(balance.cells).toContain(cellKey(sheet, address));
    expect(exportBlockers(checks).map((c) => c.id)).toContain("balance");
  });

  it("flags formula errors, bad signs and missing data", () => {
    const wb = build();
    const capex = addressOf(wb, "capex", 1);
    const equity = addressOf(wb, "totalEquity", 0);
    const { workbook } = applyEdits(wb, [
      { sheet: SHEET_INCOME, cell: "G20", input: "=1/0" },
      { sheet: capex.sheet, cell: capex.address, input: "500" },
      { sheet: equity.sheet, cell: equity.address, input: "" },
    ]);
    const checks = Object.fromEntries(
      runChecks(workbook, evaluateWorkbook(workbook)).map((c) => [c.id, c]),
    );
    expect(checks.errors.status).toBe("fail");
    expect(checks.errors.cells).toContain("Income!G20");
    expect(checks.signs.status).toBe("fail");
    expect(checks.signs.details.join()).toMatch(/capital expenditures/);
    expect(checks.gaps.status).toBe("warn");
    expect(checks.gaps.details).toEqual(["Total equity, FY2020A"]);
  });
});

describe("edits", () => {
  it("previews a driver change as a diff and can be undone (PRD F5)", () => {
    const wb = build();
    const growthRow = wb.lines.revenueGrowth.row;
    const edits = ["G", "H", "I", "J", "K"].map((col, i) => ({
      sheet: SHEET_INCOME,
      cell: `${col}${growthRow}`,
      input: String(0.12 - i * 0.015),
    }));
    const { valid, errors } = validateEdits(wb, edits);
    expect(errors).toEqual([]);

    const before = evaluateWorkbook(wb);
    const { workbook: next, applied } = applyEdits(wb, valid);
    const after = evaluateWorkbook(next);

    expect(valueOf(next, after, "revenue", 5)).toBeCloseTo(391_000 * 1.12, 6);
    expect(valueOf(next, after, "revenue", 9)).toBeCloseTo(391_000 * 1.12 * 1.105 * 1.09 * 1.075 * 1.06, 4);
    expect(next.sheets[0].cells[`G${growthRow}`].role).toBe("assumption");

    const affected = changedCells(before, after, applied);
    expect(affected).toContain(`Income!G${wb.lines.revenue.row}`);
    expect(affected).toContain(`Income!K${wb.lines.netIncome.row}`);
    expect(affected).not.toContain(`Income!G${growthRow}`);
    expect(affected.some((k) => k.startsWith("BalanceSheet!"))).toBe(false);

    const restored = revertEdits(next, applied);
    expect(restored.sheets[0].cells).toEqual(wb.sheets[0].cells);
    expect(wb.sheets[0].cells[`G${growthRow}`].formula).toMatch(/^AVERAGE/);
  });

  it("notes when a filing value is overridden", () => {
    const wb = build();
    const { sheet, address } = addressOf(wb, "revenue", 4);
    const { workbook } = applyEdits(wb, [{ sheet, cell: address, input: "391,500" }]);
    const cell = workbook.sheets[0].cells[address];
    expect(cell.value).toBe(391_500);
    expect(cell.source).toBeUndefined();
    expect(cell.role).toBe("manual");
    expect(cell.note).toMatch(/Overrides 10-K value 391,000/);
  });

  it("rejects edits to unknown sheets, bad addresses and broken formulas", () => {
    const wb = build();
    const { valid, errors } = validateEdits(wb, [
      { sheet: "Nope", cell: "A1", input: "1" },
      { sheet: "income", cell: "ZZ9999", input: "1" },
      { sheet: "income", cell: "B4", input: "=SUM(" },
      { sheet: "income", cell: "$b$40", input: "Label" },
    ]);
    expect(errors).toHaveLength(3);
    expect(valid).toEqual([{ sheet: "Income", cell: "B40", input: "Label" }]);
  });

  it("appends rows beyond the current sheet", () => {
    const wb = build();
    const income = wb.sheets[0];
    const row = income.rowCount + 2;
    const { workbook } = applyEdits(wb, [
      { sheet: SHEET_INCOME, cell: `A${row}`, input: "Net margin" },
      { sheet: SHEET_INCOME, cell: `F${row}`, input: `=F${wb.lines.netIncome.row}/F${wb.lines.revenue.row}` },
    ]);
    expect(workbook.sheets[0].rowCount).toBe(row);
    expect(workbook.sheets[0].cells[`A${row}`].role).toBe("label");
    const v = evaluateWorkbook(workbook)[`Income!F${row}`] as number;
    expect(v).toBeCloseTo(figures(2024).netIncome / 391_000, 9);
  });
});

describe("missing filing data", () => {
  function buildWithout(concept: string, years?: string[]) {
    const facts = buildCompanyFacts();
    const gaap = facts.facts["us-gaap"];
    if (years) {
      for (const unit of Object.values(gaap[concept].units)) {
        const kept = unit.filter((e) => !years.some((y) => e.end.startsWith(y)));
        unit.splice(0, unit.length, ...kept);
      }
    } else {
      delete gaap[concept];
    }
    const wb = buildWorkbook(extractFinancials(facts), { ticker: "X" });
    return { wb, values: evaluateWorkbook(wb) };
  }

  it("blocks export instead of forecasting from a missing operating income", () => {
    const { wb, values } = buildWithout("OperatingIncomeLoss");
    const checks = Object.fromEntries(runChecks(wb, values).map((c) => [c.id, c]));
    expect(checks.forecastInputs.status).toBe("fail");
    expect(checks.forecastInputs.details[0]).toMatch(/^Operating income, FY2022A/);
    expect(exportBlockers(Object.values(checks)).map((c) => c.id)).toContain("forecastInputs");

    // The plug that would have absorbed the whole gap is left blank, with the formula to restore.
    const { sheet, address } = addressOf(wb, "otherOperatingExpense", 4);
    const cell = wb.sheets.find((s) => s.name === sheet)!.cells[address];
    expect(cell.formula).toBeUndefined();
    expect(cell.note).toMatch(/^Left blank: Operating income is missing for FY2024A\. .*=F6-F7-F8-F10$/);
  });

  it("only warns about a missing balance sheet total, and leaves its plug blank", () => {
    const { wb, values } = buildWithout("AssetsCurrent", ["2021"]);
    const checks = Object.fromEntries(runChecks(wb, values).map((c) => [c.id, c]));
    expect(checks.gaps.status).toBe("warn");
    expect(checks.gaps.details).toEqual(["Total current assets, FY2021A"]);
    expect(checks.forecastInputs.status).toBe("pass");
    expect(exportBlockers(Object.values(checks))).toEqual([]);
    expect(valueOf(wb, values, "otherCurrentAssets", 1)).toBeUndefined();
    expect(valueOf(wb, values, "otherCurrentAssets", 2)).toBeCloseTo(0.05 * RESTATED_FY2022_REVENUE, 6);
  });

  it("never reads a partial concept as a total", () => {
    const facts = buildCompanyFacts();
    const gaap = facts.facts["us-gaap"];
    gaap.IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic =
      gaap.IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest;
    delete gaap.IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest;
    const extraction = extractFinancials(facts);
    expect(extraction.lines.pretaxIncome.every((v) => v === null)).toBe(true);
  });
});
