import type { CheckResult } from "../model/checks";
import type { AppliedEdit } from "../sheet/edits";
import type { Workbook } from "../sheet/types";

// Shapes shared by the API and the browser.

export interface ModelSummary {
  id: string;
  ticker: string;
  companyName: string;
  version: number;
  updatedAt: string;
}

export interface LogEntry {
  id: number;
  author: "you" | "assistant";
  summary: string;
  applied: AppliedEdit[];
  at: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "note";
  text: string;
}

/** A change the assistant suggested, previewed until the user decides. */
export interface Proposal {
  id: string;
  summary: string;
  edits: AppliedEdit[];
  /** Cells whose values change as a result, besides the edited ones. */
  affected: string[];
  /** Integrity checks as they would be after the change. */
  checks: CheckResult[];
}

/** Everything the workbench needs; every mutation returns a fresh copy. */
export interface ModelState {
  id: string;
  version: number;
  workbook: Workbook;
  log: LogEntry[];
  messages: ChatMessage[];
  proposal: Proposal | null;
}
