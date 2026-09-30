import type { CheckResult } from "../model/checks";
import type { AppliedEdit } from "../sheet/edits";

/** A change the agent suggests, previewed before the user accepts it. */
export interface Proposal {
  summary: string;
  edits: AppliedEdit[];
  /** Cells whose values change as a result, besides the edited ones. */
  affected: string[];
  /** Integrity checks as they would be after the change. */
  checks: CheckResult[];
}

export interface AgentResponse {
  reply: string;
  proposal: Proposal | null;
  /** Edits the agent suggested that could not be applied, and why. */
  warnings: string[];
}
