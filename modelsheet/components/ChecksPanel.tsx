"use client";

import type { CheckResult } from "@/lib/model/checks";
import { splitCellKey } from "@/lib/sheet/address";

const ICON: Record<CheckResult["status"], string> = { pass: "✓", warn: "!", fail: "✕" };

export function ChecksPanel({
  checks,
  onNavigate,
  previewing,
}: {
  checks: CheckResult[];
  onNavigate: (sheet: string, address: string) => void;
  previewing: boolean;
}) {
  return (
    <div className="checks">
      {previewing && <p className="hint">Showing checks as they would be after the proposed change.</p>}
      <ul>
        {checks.map((check) => (
          <li key={check.id} className={`check check-${check.status}`}>
            <span className="check-icon" aria-label={check.status}>
              {ICON[check.status]}
            </span>
            <div>
              <div className="check-label">{check.label}</div>
              {check.status !== "pass" && (
                <ul className="check-details">
                  {check.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
              {check.status !== "pass" && check.cells[0] && (
                <button
                  className="link small"
                  onClick={() => {
                    const { sheet, address } = splitCellKey(check.cells[0]);
                    onNavigate(sheet, address);
                  }}
                >
                  Go to cell
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
