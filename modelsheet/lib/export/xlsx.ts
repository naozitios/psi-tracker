import ExcelJS from "exceljs";
import { cellKey, parseAddress } from "../sheet/address";
import type { Values } from "../sheet/engine";
import { isCellError, type Cell, type CellFormat, type Workbook } from "../sheet/types";
import type { CheckResult } from "../model/checks";
import { DISCLAIMER } from "../disclaimer";

const NUMBER_FORMATS: Record<CellFormat, string | undefined> = {
  number: '#,##0.0;(#,##0.0);"–"',
  percent: "0.0%;(0.0%)",
  perShare: "0.00;(0.00)",
  text: undefined,
};

// Common modeling convention: blue for hardcoded inputs, black for formulas.
const INPUT_BLUE = "FF1F4FD8";
const ASSUMPTION_FILL = "FFFFF6D5";

function sourceNote(cell: Cell): string | undefined {
  const s = cell.source;
  if (!s) return cell.note;
  const reported = s.reportedValue.toLocaleString("en-US");
  return [
    `${s.form}, accession ${s.accessionNumber}, filed ${s.filed}`,
    `${s.concept} (${s.conceptLabel})`,
    `Period ${s.periodStart ? `${s.periodStart} to ` : ""}${s.periodEnd}`,
    `Reported: ${reported} ${s.unit}`,
  ].join("\n");
}

function writeCell(target: ExcelJS.Cell, cell: Cell, value: Values[string] | undefined) {
  if (cell.formula !== undefined) {
    const result = isCellError(value)
      ? ({ error: value.error } as ExcelJS.CellErrorValue)
      : (value as number | string | boolean | null | undefined) ?? undefined;
    target.value = { formula: cell.formula, result } as ExcelJS.CellFormulaValue;
  } else if (cell.value !== undefined && cell.value !== null) {
    target.value = cell.value;
  }

  const numFmt = NUMBER_FORMATS[cell.format ?? "number"];
  if (numFmt) target.numFmt = numFmt;

  const isInput = cell.role === "filing" || cell.role === "manual" || cell.role === "assumption";
  target.font = {
    bold: cell.bold || cell.role === "header",
    color: isInput && cell.formula === undefined ? { argb: INPUT_BLUE } : undefined,
  };
  if (cell.role === "assumption") {
    target.font = { ...target.font, color: { argb: INPUT_BLUE } };
    target.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ASSUMPTION_FILL } };
  }

  const note = sourceNote(cell);
  if (note) target.note = note;
}

function addAboutSheet(book: ExcelJS.Workbook, workbook: Workbook) {
  const sheet = book.addWorksheet("About");
  sheet.getColumn(1).width = 110;
  const rows = [
    `${workbook.company.name} (${workbook.company.ticker}) financial model`,
    `CIK ${workbook.company.cik} · generated ${workbook.createdAt.slice(0, 10)} from SEC 10-K XBRL data`,
    `Units: ${workbook.units}`,
    "",
    DISCLAIMER,
    "",
    "Blue numbers are hardcoded inputs: values from filings (hover for the source) or typed by the user.",
    "Black numbers are formulas. Shaded cells are forecast assumptions you can change.",
    "The Sources sheet lists the filing behind every historical input.",
  ];
  rows.forEach((text, i) => {
    const cell = sheet.getCell(i + 1, 1);
    cell.value = text;
    cell.alignment = { wrapText: true };
    if (i === 0) cell.font = { bold: true, size: 14 };
    if (text === DISCLAIMER) cell.font = { bold: true };
  });
}

function addSourcesSheet(book: ExcelJS.Workbook, workbook: Workbook) {
  const sheet = book.addWorksheet("Sources", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Cell", key: "cell", width: 18 },
    { header: "Line item", key: "line", width: 34 },
    { header: "Period end", key: "end", width: 12 },
    { header: "XBRL concept", key: "concept", width: 48 },
    { header: "Form", key: "form", width: 8 },
    { header: "Filed", key: "filed", width: 12 },
    { header: "Accession number", key: "accn", width: 22 },
    { header: "Reported value", key: "reported", width: 20 },
    { header: "Unit", key: "unit", width: 12 },
    { header: "Filing", key: "url", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const s of workbook.sheets) {
    for (const [address, cell] of Object.entries(s.cells)) {
      const src = cell.source;
      if (!src) continue;
      const row = sheet.addRow({
        cell: cellKey(s.name, address),
        line: src.lineItem,
        end: src.periodEnd,
        concept: src.concept,
        form: src.form,
        filed: src.filed,
        accn: src.accessionNumber,
        reported: src.reportedValue,
        unit: src.unit,
      });
      row.getCell("reported").numFmt = "#,##0.####";
      row.getCell("url").value = { text: "Open filing", hyperlink: src.url };
    }
  }
}

function addChecksSheet(book: ExcelJS.Workbook, checks: CheckResult[]) {
  const sheet = book.addWorksheet("Checks");
  sheet.columns = [
    { header: "Check", key: "label", width: 34 },
    { header: "Status", key: "status", width: 10 },
    { header: "Details", key: "details", width: 100 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const check of checks) {
    const row = sheet.addRow({
      label: check.label,
      status: check.status.toUpperCase(),
      details: check.details.join("\n"),
    });
    row.getCell("details").alignment = { wrapText: true, vertical: "top" };
  }
}

/** Builds an .xlsx with live formulas; each historical input notes its filing. */
export async function workbookToXlsx(
  workbook: Workbook,
  values: Values,
  checks: CheckResult[],
): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "ModelSheet";
  book.created = new Date(workbook.createdAt);

  addAboutSheet(book, workbook);
  for (const s of workbook.sheets) {
    const sheet = book.addWorksheet(s.name, {
      views: [{ state: "frozen", xSplit: 1, ySplit: s.frozenRows }],
    });
    sheet.getColumn(1).width = 44;
    for (let c = 2; c <= s.colCount; c++) sheet.getColumn(c).width = 13;
    for (const [address, cell] of Object.entries(s.cells)) {
      if (!parseAddress(address)) continue;
      writeCell(sheet.getCell(address), cell, values[cellKey(s.name, address)]);
    }
  }
  addSourcesSheet(book, workbook);
  addChecksSheet(book, checks);

  const buffer = await book.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
