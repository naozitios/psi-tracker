"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { exportBlockers, runChecks } from "@/lib/model/checks";
import type { ChatMessage, ModelState } from "@/lib/models/types";
import { cellKey, parseAddress, toAddress } from "@/lib/sheet/address";
import { applyEdits, cellInput } from "@/lib/sheet/edits";
import { evaluateWorkbook } from "@/lib/sheet/engine";
import { CellInspector } from "./CellInspector";
import { ChatPanel } from "./ChatPanel";
import { ChecksPanel } from "./ChecksPanel";
import { SheetGrid, type Highlights } from "./SheetGrid";

export function Workbench({ initial }: { initial: ModelState }) {
  const [state, setState] = useState(initial);
  const [activeSheet, setActiveSheet] = useState(initial.workbook.sheets[0].name);
  const [selected, setSelected] = useState<string | null>("B4");
  const [draft, setDraft] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"cell" | "checks">("cell");
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [notes, setNotes] = useState<ChatMessage[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const formulaInput = useRef<HTMLInputElement>(null);

  const { workbook, proposal } = state;
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

  const startEdit = useCallback((initialText?: string) => {
    if (initialText !== undefined) setDraft(initialText);
    formulaInput.current?.focus();
    if (initialText === undefined) formulaInput.current?.select();
  }, []);

  function addNote(text: string) {
    setNotes((n) => [...n, { role: "note", text }]);
  }

  /** Runs a server mutation; a version conflict reloads the latest model. */
  async function mutate(run: () => Promise<ModelState>, onError?: (message: string) => void): Promise<boolean> {
    setBusy(true);
    try {
      setState(await run());
      setNotes([]);
      return true;
    } catch (err) {
      const message = (err as Error).message;
      if (err instanceof ApiError && err.status === 409 && !message.startsWith("Accept or reject")) {
        setState(await api.loadModel(state.id));
      }
      (onError ?? addNote)(message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function commitDraft() {
    if (!selected || proposal || busy || thinking) return;
    const current = workbook.sheets.find((s) => s.name === activeSheet)?.cells[selected];
    if (draft === cellInput(current)) return;
    await mutate(() => api.saveEdit(state.id, state.version, activeSheet, selected, draft), setEditError);
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
      Tab: [0, 1],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      moveSelection(...move);
      return;
    }
    if (proposal || busy) return;
    if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      startEdit();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Typing on a selected cell starts replacing its contents, as in Excel.
      event.preventDefault();
      startEdit(event.key);
    }
  }

  async function send(text: string) {
    setThinking(true);
    setNotes([{ role: "user", text }]);
    try {
      const next = await api.ask(state.id, text);
      setState(next);
      setNotes([]);
      const first = next.proposal?.edits[0];
      if (first) navigate(first.sheet, first.cell);
    } catch (err) {
      addNote((err as Error).message);
    } finally {
      setThinking(false);
    }
  }

  async function exportXlsx() {
    setExportError(null);
    setExporting(true);
    try {
      const res = await fetch(api.exportUrl(state.id));
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Export failed (${res.status})`);
      }
      const url = URL.createObjectURL(await res.blob());
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
  const locked = !!proposal || busy || thinking;

  return (
    <div className="workbench">
      <div className="main">
        <div className="toolbar">
          <div className="model-title">
            <strong>{workbook.company.name}</strong> <span className="muted">({workbook.company.ticker})</span>
          </div>
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
            <button
              className="secondary"
              onClick={() => mutate(() => api.undo(state.id, state.version))}
              disabled={!state.log.length || locked}
            >
              Undo
            </button>
            <button
              onClick={exportXlsx}
              disabled={exporting || blockers.length > 0 || locked}
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
            disabled={!selected || locked}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
                moveSelection(1, 0);
              } else if (e.key === "Escape") {
                setDraft(selected ? cellInput(sheet.cells[selected]) : "");
                setEditError(null);
                requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
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
          <span className="swatch role-manual">123</span> typed by you · saved automatically
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
          messages={[...state.messages, ...notes]}
          pending={thinking}
          busy={busy}
          proposal={proposal}
          log={state.log}
          onSend={send}
          onAccept={() => proposal && mutate(() => api.decide(state.id, proposal.id, "accept"))}
          onReject={() => proposal && mutate(() => api.decide(state.id, proposal.id, "reject"))}
        />
      </aside>
    </div>
  );
}
