import type { Queryable } from "../db";

export type EventName =
  | "model_built"
  | "model_opened"
  | "edit_saved"
  | "edit_undone"
  | "proposal_created"
  | "proposal_accepted"
  | "proposal_rejected"
  | "agent_limited"
  | "export_downloaded"
  | "export_blocked";

/** Records a product event. Never fails the request it belongs to. */
export async function track(
  db: Queryable,
  event: { name: EventName; userId: string; modelId?: string; props?: Record<string, unknown> },
): Promise<void> {
  try {
    await db.query(
      "INSERT INTO events (user_id, model_id, name, props) VALUES ($1, $2, $3, $4::jsonb)",
      [event.userId, event.modelId ?? null, event.name, JSON.stringify(event.props ?? {})],
    );
  } catch (err) {
    console.error("event tracking failed", err);
  }
}
