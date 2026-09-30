import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { workbookToXlsx } from "@/lib/export/xlsx";
import { buildWorkbook } from "@/lib/model/build";
import { runChecks } from "@/lib/model/checks";
import { extractFinancials } from "@/lib/sec/extract";
import { evaluateWorkbook } from "@/lib/sheet/engine";
import { DISCLAIMER } from "@/lib/disclaimer";
import { buildCompanyFacts, tenKAccession } from "./fixtures/companyfacts";

describe("workbookToXlsx (PRD F7)", async () => {
  const wb = buildWorkbook(extractFinancials(buildCompanyFacts()), { ticker: "EXMP" });
  const values = evaluateWorkbook(wb);
  const buffer = await workbookToXlsx(wb, values, runChecks(wb, values));
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as unknown as ArrayBuffer);

  it("includes the model sheets plus About, Sources and Checks", () => {
    expect(book.worksheets.map((w) => w.name)).toEqual([
      "About", "Income", "BalanceSheet", "CashFlow", "Quarterly", "Sources", "Checks",
    ]);
  });

  it("carries the not-investment-advice notice", () => {
    const about = book.getWorksheet("About")!;
    const texts = about.getColumn(1).values.filter(Boolean);
    expect(texts).toContain(DISCLAIMER);
  });

  it("keeps live formulas with cached results", () => {
    const income = book.getWorksheet("Income")!;
    const revenueRow = wb.lines.revenue.row;
    const cell = income.getCell(`G${revenueRow}`).value as ExcelJS.CellFormulaValue;
    expect(cell.formula).toBe(`F${revenueRow}*(1+G${wb.lines.revenueGrowth.row})`);
    expect(cell.result).toBeCloseTo(values[`Income!G${revenueRow}`] as number, 6);

    const cf = book.getWorksheet("CashFlow")!;
    const fcf = cf.getCell(`F${wb.lines.freeCashFlow.row}`).value as ExcelJS.CellFormulaValue;
    expect(fcf.formula).toBe(`F${wb.lines.cashFromOperations.row}+F${wb.lines.capex.row}`);
  });

  it("notes the filing behind each hardcoded input", () => {
    const income = book.getWorksheet("Income")!;
    const cell = income.getCell(`F${wb.lines.revenue.row}`);
    expect(cell.value).toBeCloseTo(391_000, 6);
    const note = typeof cell.note === "string" ? cell.note : JSON.stringify(cell.note);
    expect(note).toContain(tenKAccession(2024));
    expect(note).toContain("RevenueFromContractWithCustomerExcludingAssessedTax");
  });

  it("lists every sourced cell on the Sources sheet with a link to the filing", () => {
    const sources = book.getWorksheet("Sources")!;
    const sourcedCells = wb.sheets.flatMap((s) => Object.values(s.cells).filter((c) => c.source));
    expect(sources.rowCount - 1).toBe(sourcedCells.length);
    const link = sources.getRow(2).getCell(10).value as ExcelJS.CellHyperlinkValue;
    expect(link.hyperlink).toMatch(/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1234567\//);
  });
});
