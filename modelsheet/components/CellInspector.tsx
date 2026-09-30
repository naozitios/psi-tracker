"use client";

import { cellKey, parseAddress, toAddress } from "@/lib/sheet/address";
import { formulaRefs, type Values } from "@/lib/sheet/engine";
import type { Sheet, Workbook } from "@/lib/sheet/types";
import { formatCellValue, formatReported } from "@/lib/format";

interface Props {
  workbook: Workbook;
  sheet: Sheet;
  address: string | null;
  values: Values;
  onNavigate: (sheet: string, address: string) => void;
}

interface Precedent {
  sheet: string;
  address: string;
  label: string;
}

function labelFor(workbook: Workbook, sheetName: string, address: string): string {
  const sheet = workbook.sheets.find((s) => s.name.toLowerCase() === sheetName.toLowerCase());
  const pos = parseAddress(address);
  if (!sheet || !pos) return "";
  const row = sheet.cells[toAddress(pos.row, 1)]?.value;
  const period = sheet.cells[toAddress(1, pos.col)]?.value;
  return [row, period].filter(Boolean).join(", ");
}

function precedentsOf(workbook: Workbook, sheet: Sheet, address: string, formula: string): Precedent[] {
  const pos = parseAddress(address);
  if (!pos) return [];
  try {
    return formulaRefs(formula, { sheet: sheet.name, ...pos }).map((ref) => {
      const target = workbook.sheets.find((s) => s.name.toLowerCase() === ref.sheet.toLowerCase());
      const sheetName = target?.name ?? ref.sheet;
      const addr =
        "from" in ref
          ? `${toAddress(ref.from.row, ref.from.col)}:${toAddress(ref.to.row, ref.to.col)}`
          : toAddress(ref.row, ref.col);
      const first = "from" in ref ? toAddress(ref.from.row, ref.from.col) : addr;
      return { sheet: sheetName, address: addr, label: labelFor(workbook, sheetName, first) };
    });
  } catch {
    return [];
  }
}

export function CellInspector({ workbook, sheet, address, values, onNavigate }: Props) {
  if (!address) {
    return <p className="muted">Select a cell to see where its number comes from.</p>;
  }
  const cell = sheet.cells[address];
  const value = values[cellKey(sheet.name, address)];
  const label = labelFor(workbook, sheet.name, address);

  return (
    <div className="inspector">
      <div className="inspector-head">
        <code>
          {sheet.name}!{address}
        </code>
        {label && <span className="muted"> {label}</span>}
      </div>
      {cell?.formula !== undefined || cell?.value !== undefined ? (
        <p className="big">{formatCellValue(value, cell?.format) || "—"}</p>
      ) : null}

      {cell?.source && (
        <dl className="source">
          <dt>Source</dt>
          <dd>
            {cell.source.form} filed {cell.source.filed} ·{" "}
            <a href={cell.source.url} target="_blank" rel="noreferrer">
              open filing
            </a>
          </dd>
          <dt>Statement line</dt>
          <dd>
            {cell.source.conceptLabel} <code>{cell.source.concept}</code>
          </dd>
          <dt>Period</dt>
          <dd>
            {cell.source.periodStart ? `${cell.source.periodStart} to ` : ""}
            {cell.source.periodEnd}
          </dd>
          <dt>As reported</dt>
          <dd>{formatReported(cell.source.reportedValue, cell.source.unit)}</dd>
          <dt>Accession</dt>
          <dd>
            <code>{cell.source.accessionNumber}</code>
          </dd>
        </dl>
      )}

      {cell?.formula !== undefined && (
        <>
          <p>
            <code className="formula">={cell.formula}</code>
          </p>
          <ul className="precedents">
            {precedentsOf(workbook, sheet, address, cell.formula).map((p, i) => (
              <li key={i}>
                <button className="link" onClick={() => onNavigate(p.sheet, p.address.split(":")[0])}>
                  {p.sheet === sheet.name ? p.address : `${p.sheet}!${p.address}`}
                </button>{" "}
                <span className="muted">{p.label}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {cell?.role === "assumption" && (
        <p className="hint">Forecast assumption. Type a new value above or ask the assistant.</p>
      )}
      {cell?.role === "manual" && !cell.note && <p className="hint">Typed in by hand.</p>}
      {cell?.note && <p className="hint">{cell.note}</p>}
      {!cell && <p className="muted">Empty cell.</p>}
    </div>
  );
}
