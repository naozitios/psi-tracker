"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentResponse, Proposal } from "@/lib/agent/proposal";
import { exportBlockers, runChecks } from "@/lib/model/checks";
import { cellKey, parseAddress, toAddress } from "@/lib/sheet/address";
import {
  applyEdits,
  cellInput,
  revertEdits,
  validateEdits,
  type CellEdit,
} from "@/lib/sheet/edits";
import { evaluateWorkbook } from "@/lib/sheet/engine";
import type { Workbook } from "@/lib/sheet/types";
import { CellInspector } from "./CellInspector";
import { ChatPanel, type ChatMessage, type LogEntry } from "./ChatPanel";
import { ChecksPanel } from "./ChecksPanel";
import { SheetGrid, type Highlights } from "./SheetGrid";

function timeNow(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function Workbench({ initial }: { initial: Workbook }) {
  const [workbook, setWorkbook] = useState(initial);
  const [activeSheet, setActiveSheet] = useState(initial.sheets[0].name);
  const [selected, setSelected] = useState<string | null>("B4");
  const [draft, setDraft] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"cell" | "checks">("cell");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const formulaInput = useRef<HTMLInputElement>(null);
  const nextLogId = useRef(1);

  const values = useMemo(() => evaluateWorkbook(workbook), [workbook]);
  const checks = useMemo(() => runChecks(workbook, values), [workbook, values]);

  // While a proposal is open the grid shows the workbook as it would be.
  const preview = useMemo(
    () => (proposal ? applyEdits(workbook, proposal.edits).workbook : null),
    [workbook, proposal],
  );
  const previewValues = useMemo(() => (preview ? evaluateWorkbook(preview) : null), [preview]);
  const shown = preview ?? workbook;
  const shownValues = previewValues ?? values;
  const shownChecks = useMemo(
    () => (preview && previewValues ? runChecks(preview, previewValues) : checks),
    [preview, previewValues, checks],
  );

  const sheet = shown.sheets.find((s) => s.name === activeSheet) ?? shown.sheets[0];
  const blockers = exportBlockers(checks);

  const highlights: Highlights = useMemo(
    () => ({
      edited: new Set(proposal?.edits.map((e) => cellKey(e.sheet, e.cell)) ?? []),
      affected: new Set(proposal?.affected ?? []),
      flagged: new Set(shownChecks.filter((c) => c.status === "fail").flatMap((c) => c.cells)),
    }),
    [proposal, shownChecks],
  );

  // Keep the formula bar in step with the selected cell.
  useEffect(() => {
    setDraft(selected ? cellInput(sheet.cells[selected]) : "");
    setEditError(null);
  }, [selected, sheet]);

  const navigate = useCallback((sheetName: string, address: string) => {
    setActiveSheet(sheetName);
    setSelected(address);
    setPanel("cell");
  }, []);

  const startEdit = useCallback(() => {
    formulaInput.current?.focus();
    formulaInput.current?.select();
  }, []);

  function record(author: LogEntry["author"], summary: string, applied: LogEntry["applied"]) {
    setLog((entries) => [...entries, { id: nextLogId.current++, author, summary, applied, at: timeNow() }]);
  }

  function commitDraft() {
    if (!selected || proposal || pending) return;
    if (draft === cellInput(workbook.sheets.find((s) => s.name === activeSheet)?.cells[selected])) return;
    const edit: CellEdit = { sheet: activeSheet, cell: selected, input: draft };
    const { valid, errors } = validateEdits(workbook, [edit]);
    if (!valid.length) {
      setEditError(errors[0] ?? "That edit could not be applied.");
      return;
    }
    const { workbook: next, applied } = applyEdits(workbook, valid);
    setWorkbook(next);
    record("you", `Edited ${activeSheet}!${selected}`, applied);
  }

  function moveSelection(dRow: number, dCol: number) {
    const pos = selected ? parseAddress(selected) : { row: 1, col: 1 };
    if (!pos) return;
    const row = Math.min(Math.max(1, pos.row + dRow), sheet.rowCount);
    const col = Math.min(Math.max(1, pos.col + dCol), sheet.colCount);
    setSelected(toAddress(row, col));
  }

  function onGridKey(event: React.KeyboardEvent) {
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      moveSelection(...move);
    } else if (event.key === "Enter" && !proposal) {
      event.preventDefault();
      startEdit();
    }
  }

  async function send(text: string) {
    const history = messages
      .filter((m) => m.role !== "note")
      .map((m) => ({ role: m.role as "user" | "assistant", text: m.text }));
    setMessages((m) => [...m, { role: "user", text }]);
    setPending(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workbook, message: text, history }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<AgentResponse> & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      const notes: ChatMessage[] = (data.warnings ?? []).map((w) => ({ role: "note", text: `Skipped: ${w}` }));
      setMessages((m) => [...m, { role: "assistant", text: data.reply ?? "" }, ...notes]);
      if (data.proposal) {
        setProposal(data.proposal);
        const first = data.proposal.edits[0];
        if (first) {
          setActiveSheet(first.sheet);
          setSelected(first.cell);
        }
      }
    } catch (err) {
      setMessages((m) => [...m, { role: "note", text: (err as Error).message }]);
    } finally {
      setPending(false);
    }
  }

  function accept() {
    if (!proposal) return;
    const { workbook: next, applied } = applyEdits(workbook, proposal.edits);
    setWorkbook(next);
    record("assistant", proposal.summary, applied);
    setProposal(null);
    setMessages((m) => [...m, { role: "note", text: "Change accepted." }]);
  }

  function reject() {
    setProposal(null);
    setMessages((m) => [...m, { role: "note", text: "Change rejected. Nothing was modified." }]);
  }

  function undo() {
    const last = log[log.length - 1];
    if (!last || proposal) return;
    setWorkbook(revertEdits(workbook, last.applied));
    setLog(log.slice(0, -1));
    setMessages((m) => [...m, { role: "note", text: `Undid: ${last.summary}` }]);
  }

  async function exportXlsx() {
    setExportError(null);
    setExporting(true);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workbook }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${workbook.company.ticker || "model"}-model.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError((err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const failingCount = shownChecks.filter((c) => c.status === "fail").length;
  const warnCount = shownChecks.filter((c) => c.status === "warn").length;

  return (
    <div className="workbench">
      <div className="main">
        <div className="toolbar">
          <nav className="sheet-tabs" aria-label="Sheets">
            {shown.sheets.map((s) => (
              <button
                key={s.name}
                className={s.name === sheet.name ? "tab active" : "tab"}
                onClick={() => setActiveSheet(s.name)}
              >
                {s.title}
              </button>
            ))}
          </nav>
          <div className="toolbar-actions">
            <button className="secondary" onClick={undo} disabled={!log.length || !!proposal}>
              Undo
            </button>
            <button
              onClick={exportXlsx}
              disabled={exporting || blockers.length > 0 || !!proposal}
              title={blockers.length ? `Blocked by failing checks: ${blockers.map((b) => b.label).join(", ")}` : undefined}
            >
              {exporting ? "Exporting…" : "Export .xlsx"}
            </button>
          </div>
        </div>
        {exportError && <p className="error">{exportError}</p>}

        <div className="formula-bar">
          <code className="address">{selected ? `${sheet.name}!${selected}` : ""}</code>
          <input
            ref={formulaInput}
            aria-label="Cell contents"
            value={draft}
            disabled={!selected || !!proposal || pending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitDraft();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                setDraft(selected ? cellInput(sheet.cells[selected]) : "");
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        </div>
        {editError && <p className="error small">{editError}</p>}

        {proposal && (
          <div className="preview-banner" role="status">
            Previewing the assistant&apos;s change: edited cells are outlined, recalculated cells are
            shaded. Accept or reject it in the assistant panel.
          </div>
        )}

        <div className="grid-wrap" tabIndex={0} onKeyDown={onGridKey}>
          <SheetGrid
            sheet={sheet}
            values={shownValues}
            selected={selected}
            highlights={highlights}
            onSelect={setSelected}
            onEdit={startEdit}
          />
        </div>
        <p className="legend small">
          <span className="swatch role-filing">123</span> from a filing ·{" "}
          <span className="swatch role-formula">123</span> formula ·{" "}
          <span className="swatch role-assumption">12%</span> forecast assumption ·{" "}
          <span className="swatch role-manual">123</span> typed by you
        </p>
      </div>

      <aside className="side">
        <div className="side-tabs" role="tablist">
          <button role="tab" aria-selected={panel === "cell"} className={panel === "cell" ? "tab active" : "tab"} onClick={() => setPanel("cell")}>
            Cell
          </button>
          <button role="tab" aria-selected={panel === "checks"} className={panel === "checks" ? "tab active" : "tab"} onClick={() => setPanel("checks")}>
            Checks{" "}
            {failingCount > 0 ? (
              <span className="badge badge-fail">{failingCount}</span>
            ) : warnCount > 0 ? (
              <span className="badge badge-warn">{warnCount}</span>
            ) : (
              <span className="badge badge-pass">✓</span>
            )}
          </button>
        </div>
        <div className="side-body">
          {panel === "cell" ? (
            <CellInspector workbook={shown} sheet={sheet} address={selected} values={shownValues} onNavigate={navigate} />
          ) : (
            <ChecksPanel checks={shownChecks} onNavigate={navigate} previewing={!!proposal} />
          )}
        </div>
        <ChatPanel
          messages={messages}
          pending={pending}
          proposal={proposal}
          log={log}
          onSend={send}
          onAccept={accept}
          onReject={reject}
        />
      </aside>
    </div>
  );
}
