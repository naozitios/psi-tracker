import { randomUUID } from "node:crypto";
import type { Db, Queryable } from "../db";
import { runChecks } from "../model/checks";
import {
  applyEdits,
  changedCells,
  revertEdits,
  validateEdits,
  type AppliedEdit,
  type CellEdit,
} from "../sheet/edits";
import { evaluateWorkbook } from "../sheet/engine";
import type { Workbook } from "../sheet/types";
import type { ChatMessage, LogEntry, ModelState, ModelSummary, Proposal } from "./types";

// The server owns every workbook. Browsers send edits, never whole
// workbooks, and each change is validated, versioned and logged here.

export class ModelNotFound extends Error {}

/** The model changed since the caller last saw it. */
export class VersionConflict extends Error {
  constructor(readonly current: number) {
    super("This model changed in another tab or window. It has been reloaded.");
  }
}

export class EditRejected extends Error {
  constructor(readonly reasons: string[]) {
    super(reasons.join("; "));
  }
}

const MAX_MESSAGES = 60;

interface ModelRow {
  id: string;
  workbook: Workbook;
  version: number;
}

async function lockModel(tx: Queryable, userId: string, modelId: string): Promise<ModelRow> {
  const [row] = await tx.query<ModelRow>(
    "SELECT id, workbook, version FROM models WHERE id = $1 AND user_id = $2 FOR UPDATE",
    [modelId, userId],
  );
  if (!row) throw new ModelNotFound("Model not found.");
  return row;
}

async function saveWorkbook(tx: Queryable, modelId: string, workbook: Workbook): Promise<number> {
  const [row] = await tx.query<{ version: number }>(
    `UPDATE models SET workbook = $2::jsonb, version = version + 1, updated_at = now()
     WHERE id = $1 RETURNING version`,
    [modelId, JSON.stringify(workbook)],
  );
  // Any accepted change makes an open suggestion stale.
  await tx.query(
    "UPDATE proposals SET status = 'superseded', decided_at = now() WHERE model_id = $1 AND status = 'pending'",
    [modelId],
  );
  return row.version;
}

async function note(tx: Queryable, modelId: string, role: ChatMessage["role"], text: string) {
  await tx.query("INSERT INTO chat_messages (model_id, role, text) VALUES ($1, $2, $3)", [modelId, role, text]);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

export async function createModel(db: Queryable, userId: string, workbook: Workbook): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO models (id, user_id, cik, ticker, company_name, workbook)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [id, userId, workbook.company.cik, workbook.company.ticker, workbook.company.name, JSON.stringify(workbook)],
  );
  return id;
}

export async function listModels(db: Queryable, userId: string): Promise<ModelSummary[]> {
  const rows = await db.query<{ id: string; ticker: string; company_name: string; version: number; updated_at: Date }>(
    `SELECT id, ticker, company_name, version, updated_at FROM models
     WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    ticker: r.ticker,
    companyName: r.company_name,
    version: r.version,
    updatedAt: new Date(r.updated_at).toISOString(),
  }));
}

export async function deleteModel(db: Queryable, userId: string, modelId: string): Promise<void> {
  const rows = await db.query("DELETE FROM models WHERE id = $1 AND user_id = $2 RETURNING id", [modelId, userId]);
  if (!rows.length) throw new ModelNotFound("Model not found.");
}

export async function loadModel(db: Queryable, userId: string, modelId: string): Promise<ModelState> {
  if (!isUuid(modelId)) throw new ModelNotFound("Model not found.");
  const [model] = await db.query<ModelRow>(
    "SELECT id, workbook, version FROM models WHERE id = $1 AND user_id = $2",
    [modelId, userId],
  );
  if (!model) throw new ModelNotFound("Model not found.");

  const edits = await db.query<{ id: string; author: LogEntry["author"]; summary: string; edits: AppliedEdit[]; created_at: Date }>(
    `SELECT id::text, author, summary, edits, created_at FROM model_edits
     WHERE model_id = $1 AND reverted_at IS NULL ORDER BY id`,
    [modelId],
  );
  const messages = await db.query<ChatMessage>(
    `SELECT role, text FROM (
       SELECT id, role, text FROM chat_messages WHERE model_id = $1 ORDER BY id DESC LIMIT ${MAX_MESSAGES}
     ) recent ORDER BY id`,
    [modelId],
  );
  const [pending] = await db.query<{ id: string; summary: string; edits: AppliedEdit[]; preview: Pick<Proposal, "affected" | "checks"> }>(
    `SELECT id, summary, edits, preview FROM proposals
     WHERE model_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
    [modelId],
  );

  return {
    id: model.id,
    version: model.version,
    workbook: model.workbook,
    log: edits.map((e) => ({
      id: Number(e.id),
      author: e.author,
      summary: e.summary,
      applied: e.edits,
      at: new Date(e.created_at).toISOString(),
    })),
    messages: messages.map((m) => ({ role: m.role, text: m.text })),
    proposal: pending
      ? { id: pending.id, summary: pending.summary, edits: pending.edits, ...pending.preview }
      : null,
  };
}

/** Applies edits typed by the user, all or nothing. */
export async function saveEdits(
  db: Db,
  userId: string,
  modelId: string,
  input: { baseVersion: number; edits: CellEdit[]; summary: string },
): Promise<ModelState> {
  await db.transaction(async (tx) => {
    const model = await lockModel(tx, userId, modelId);
    if (model.version !== input.baseVersion) throw new VersionConflict(model.version);
    const { valid, errors } = validateEdits(model.workbook, input.edits);
    if (errors.length || !valid.length) throw new EditRejected(errors.length ? errors : ["No edits"]);
    const { workbook, applied } = applyEdits(model.workbook, valid);
    const version = await saveWorkbook(tx, modelId, workbook);
    await tx.query(
      "INSERT INTO model_edits (model_id, version, author, summary, edits) VALUES ($1, $2, 'you', $3, $4::jsonb)",
      [modelId, version, input.summary, JSON.stringify(applied)],
    );
  });
  return loadModel(db, userId, modelId);
}

/** Reverts the most recent change that has not been undone yet. */
export async function undoLast(
  db: Db,
  userId: string,
  modelId: string,
  baseVersion: number,
): Promise<ModelState> {
  await db.transaction(async (tx) => {
    const model = await lockModel(tx, userId, modelId);
    if (model.version !== baseVersion) throw new VersionConflict(model.version);
    const [last] = await tx.query<{ id: string; summary: string; edits: AppliedEdit[] }>(
      `SELECT id::text, summary, edits FROM model_edits
       WHERE model_id = $1 AND reverted_at IS NULL ORDER BY id DESC LIMIT 1`,
      [modelId],
    );
    if (!last) throw new EditRejected(["Nothing to undo"]);
    await saveWorkbook(tx, modelId, revertEdits(model.workbook, last.edits));
    await tx.query("UPDATE model_edits SET reverted_at = now() WHERE id = $1", [last.id]);
    await note(tx, modelId, "note", `Undid: ${last.summary}`);
  });
  return loadModel(db, userId, modelId);
}

export interface AgentTurn {
  message: string;
  reply: string;
  summary: string | null;
  edits: CellEdit[];
  warnings: string[];
}

/**
 * Records an assistant turn. Valid edits become a pending proposal with a
 * preview of their effect; nothing in the workbook changes yet.
 */
export async function recordAgentTurn(
  db: Db,
  userId: string,
  modelId: string,
  baseVersion: number,
  turn: AgentTurn,
): Promise<{ state: ModelState; proposalId: string | null }> {
  let proposalId: string | null = null;
  await db.transaction(async (tx) => {
    const model = await lockModel(tx, userId, modelId);
    await note(tx, modelId, "user", turn.message);
    await note(tx, modelId, "assistant", turn.reply);

    const { valid, errors } = validateEdits(model.workbook, turn.edits);
    for (const warning of [...turn.warnings, ...errors]) await note(tx, modelId, "note", `Skipped: ${warning}`);
    if (!valid.length) return;
    if (model.version !== baseVersion) {
      await note(tx, modelId, "note", "The model changed while the assistant was working. Ask again to get a fresh suggestion.");
      return;
    }

    const before = evaluateWorkbook(model.workbook);
    const { workbook: next, applied } = applyEdits(model.workbook, valid);
    const after = evaluateWorkbook(next);
    const preview = { affected: changedCells(before, after, applied), checks: runChecks(next, after) };

    await tx.query(
      "UPDATE proposals SET status = 'superseded', decided_at = now() WHERE model_id = $1 AND status = 'pending'",
      [modelId],
    );
    proposalId = randomUUID();
    await tx.query(
      `INSERT INTO proposals (id, model_id, base_version, summary, edits, preview)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [proposalId, modelId, model.version, turn.summary ?? turn.reply, JSON.stringify(applied), JSON.stringify(preview)],
    );
  });
  return { state: await loadModel(db, userId, modelId), proposalId };
}

export async function decideProposal(
  db: Db,
  userId: string,
  modelId: string,
  proposalId: string,
  decision: "accept" | "reject",
): Promise<ModelState> {
  await db.transaction(async (tx) => {
    const model = await lockModel(tx, userId, modelId);
    const [proposal] = await tx.query<{ base_version: number; summary: string; edits: AppliedEdit[] }>(
      "SELECT base_version, summary, edits FROM proposals WHERE id = $1 AND model_id = $2 AND status = 'pending'",
      [proposalId, modelId],
    );
    if (!proposal) throw new EditRejected(["That suggestion is no longer open."]);

    if (decision === "reject") {
      await tx.query("UPDATE proposals SET status = 'rejected', decided_at = now() WHERE id = $1", [proposalId]);
      await note(tx, modelId, "note", "Change rejected. Nothing was modified.");
      return;
    }
    if (proposal.base_version !== model.version) {
      throw new EditRejected(["The model changed after this suggestion was made. Ask again."]);
    }
    const { valid, errors } = validateEdits(model.workbook, proposal.edits);
    if (errors.length) throw new EditRejected(errors);
    const { workbook, applied } = applyEdits(model.workbook, valid);
    const version = await saveWorkbook(tx, modelId, workbook);
    await tx.query("UPDATE proposals SET status = 'accepted', decided_at = now() WHERE id = $1", [proposalId]);
    await tx.query(
      "INSERT INTO model_edits (model_id, version, author, summary, edits) VALUES ($1, $2, 'assistant', $3, $4::jsonb)",
      [modelId, version, proposal.summary, JSON.stringify(applied)],
    );
    await note(tx, modelId, "note", "Change accepted.");
  });
  return loadModel(db, userId, modelId);
}

/** Recent user and assistant turns, oldest first, for the agent's context. */
export async function chatHistory(db: Queryable, modelId: string, limit = 10) {
  const rows = await db.query<{ role: "user" | "assistant"; text: string }>(
    `SELECT role, text FROM (
       SELECT id, role, text FROM chat_messages
       WHERE model_id = $1 AND role IN ('user', 'assistant') ORDER BY id DESC LIMIT $2
     ) recent ORDER BY id`,
    [modelId, limit],
  );
  return rows;
}
