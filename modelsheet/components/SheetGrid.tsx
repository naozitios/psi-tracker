"use client";

import { memo } from "react";
import { cellKey, colToLetters, toAddress } from "@/lib/sheet/address";
import type { Values } from "@/lib/sheet/engine";
import { isCellError, type Sheet } from "@/lib/sheet/types";
import { formatCellValue } from "@/lib/format";

export interface Highlights {
  edited: Set<string>;
  affected: Set<string>;
  flagged: Set<string>;
}

interface Props {
  sheet: Sheet;
  values: Values;
  selected: string | null;
  highlights: Highlights;
  onSelect: (address: string) => void;
  onEdit: () => void;
}

function SheetGridImpl({ sheet, values, selected, highlights, onSelect, onEdit }: Props) {
  const rows = Array.from({ length: sheet.rowCount }, (_, i) => i + 1);
  const cols = Array.from({ length: sheet.colCount }, (_, i) => i + 1);

  return (
    <div className="grid-scroll">
      <table className="grid" role="grid" aria-label={sheet.title}>
        <thead>
          <tr>
            <th className="corner" />
            {cols.map((c) => (
              <th key={c} scope="col" className="colhead">
                {colToLetters(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r} className={r <= sheet.frozenRows ? "frozen" : undefined}>
              <th scope="row" className="rowhead">
                {r}
              </th>
              {cols.map((c) => {
                const address = toAddress(r, c);
                const key = cellKey(sheet.name, address);
                const cell = sheet.cells[address];
                const value = values[key];
                const classes = ["cell"];
                if (c === 1) classes.push("label");
                if (cell?.role) classes.push(`role-${cell.role}`);
                if (cell?.bold) classes.push("bold");
                if (cell?.note?.startsWith("Missing")) classes.push("missing");
                if (isCellError(value)) classes.push("has-error");
                if (highlights.edited.has(key)) classes.push("hl-edited");
                else if (highlights.affected.has(key)) classes.push("hl-affected");
                if (highlights.flagged.has(key)) classes.push("hl-flagged");
                if (selected === address) classes.push("selected");
                return (
                  <td
                    key={c}
                    className={classes.join(" ")}
                    onClick={() => onSelect(address)}
                    onDoubleClick={() => {
                      onSelect(address);
                      onEdit();
                    }}
                    aria-selected={selected === address}
                    title={cell?.source ? `${cell.source.form} filed ${cell.source.filed}` : cell?.note}
                  >
                    {formatCellValue(value, cell?.format)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const SheetGrid = memo(SheetGridImpl);
