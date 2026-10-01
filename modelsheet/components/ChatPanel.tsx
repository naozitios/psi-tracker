"use client";

import { useState } from "react";
import type { ChatMessage, LogEntry, Proposal } from "@/lib/models/types";
import { cellInput, type AppliedEdit } from "@/lib/sheet/edits";

interface Props {
  messages: ChatMessage[];
  pending: boolean;
  /** Another request is in flight; decisions wait for it. */
  busy: boolean;
  proposal: Proposal | null;
  log: LogEntry[];
  onSend: (text: string) => void;
  onAccept: () => void;
  onReject: () => void;
}

const EXAMPLES = [
  "Project revenue growth at 12% fading to 6% over five years",
  "Why did operating margin change in the last year?",
  "Add a row for free cash flow margin on the cash flow sheet",
];

function EditRow({ edit }: { edit: AppliedEdit }) {
  const before = cellInput(edit.before);
  const after = cellInput(edit.after);
  return (
    <li>
      <code>
        {edit.sheet}!{edit.cell}
      </code>{" "}
      <span className="before">{before || "empty"}</span> → <span className="after">{after || "empty"}</span>
      {edit.reason && <div className="muted small">{edit.reason}</div>}
      {edit.before?.source && (
        <div className="warn small">Replaces a value taken from a filing.</div>
      )}
    </li>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function ChatPanel({ messages, pending, busy, proposal, log, onSend, onAccept, onReject }: Props) {
  const [text, setText] = useState("");

  function submit(event?: React.FormEvent) {
    event?.preventDefault();
    const message = text.trim();
    if (!message || pending || busy) return;
    setText("");
    onSend(message);
  }

  const failing = proposal?.checks.filter((c) => c.status === "fail") ?? [];

  return (
    <section className="chat" aria-label="Assistant">
      <h2>Assistant</h2>
      <div className="messages" aria-live="polite">
        {messages.length === 0 && (
          <div className="muted small">
            Ask for a change in plain English. You will see it as a diff before anything changes.
            <ul className="examples">
              {EXAMPLES.map((e) => (
                <li key={e}>
                  <button className="link" onClick={() => setText(e)}>
                    {e}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {messages.map((m, i) => (
          <p key={i} className={`msg msg-${m.role}`}>
            {m.text}
          </p>
        ))}
        {pending && <p className="msg msg-note">Thinking…</p>}
      </div>

      {proposal && (
        <div className="proposal">
          <strong>{proposal.summary}</strong>
          <ul className="edits">
            {proposal.edits.map((e) => (
              <EditRow key={`${e.sheet}!${e.cell}`} edit={e} />
            ))}
          </ul>
          <p className="muted small">
            {proposal.edits.length} cell{proposal.edits.length === 1 ? "" : "s"} edited,{" "}
            {proposal.affected.length} recalculated.
          </p>
          {failing.length > 0 && (
            <p className="warn small">
              After this change these checks would fail: {failing.map((c) => c.label).join(", ")}.
            </p>
          )}
          <div className="actions">
            <button onClick={onAccept} disabled={busy}>
              Accept
            </button>
            <button className="secondary" onClick={onReject} disabled={busy}>
              Reject
            </button>
          </div>
        </div>
      )}

      <form className="composer" onSubmit={submit}>
        <textarea
          aria-label="Message the assistant"
          placeholder={proposal ? "Accept or reject the proposal first" : "Ask for a change…"}
          value={text}
          rows={2}
          disabled={!!proposal}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) submit(e);
          }}
        />
        <button type="submit" disabled={pending || busy || !!proposal || !text.trim()}>
          Send
        </button>
      </form>

      {log.length > 0 && (
        <details className="log">
          <summary>Change log ({log.length})</summary>
          <ol reversed>
            {[...log].reverse().map((entry) => (
              <li key={entry.id}>
                <span className="muted small">
                  {formatTime(entry.at)} · {entry.author}
                </span>{" "}
                {entry.summary}
                <ul className="edits">
                  {entry.applied.map((e) => (
                    <EditRow key={`${e.sheet}!${e.cell}`} edit={e} />
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
