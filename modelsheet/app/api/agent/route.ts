import Anthropic from "@anthropic-ai/sdk";
import { runAgent, type ChatTurn } from "@/lib/agent/agent";
import type { AgentResponse } from "@/lib/agent/proposal";
import { jsonError } from "@/lib/http";
import { runChecks } from "@/lib/model/checks";
import { applyEdits, changedCells, validateEdits } from "@/lib/sheet/edits";
import { evaluateWorkbook } from "@/lib/sheet/engine";
import type { Workbook } from "@/lib/sheet/types";

// POST { workbook, message, history } returns the agent's reply and, when it
// suggests changes, a proposal: the edits plus the recalculated result and
// checks, so the user can preview the diff before accepting.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    workbook?: Workbook;
    message?: string;
    history?: ChatTurn[];
  } | null;
  const message = body?.message?.trim();
  if (!body?.workbook?.sheets || !message) return jsonError("Missing workbook or message.", 400);
  if (message.length > 4000) return jsonError("Message is too long.", 400);

  const workbook = body.workbook;
  const history = (body.history ?? [])
    .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.text === "string")
    .map((t) => ({ role: t.role, text: t.text.slice(0, 4000) }));

  let result;
  try {
    result = await runAgent({ workbook, message, history });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return jsonError("The assistant is not configured: check ANTHROPIC_API_KEY.", 500);
    }
    if (err instanceof Anthropic.RateLimitError) {
      return jsonError("The assistant is busy. Try again in a moment.", 429);
    }
    if (err instanceof Anthropic.APIError) {
      console.error(err);
      return jsonError("The assistant could not answer. Try again.", 502);
    }
    throw err;
  }

  const { valid, errors } = validateEdits(workbook, result.edits);
  if (!valid.length) {
    return Response.json({ reply: result.reply, proposal: null, warnings: errors } satisfies AgentResponse);
  }

  const before = evaluateWorkbook(workbook);
  const { workbook: next, applied } = applyEdits(workbook, valid);
  const after = evaluateWorkbook(next);

  return Response.json({
    reply: result.reply,
    proposal: {
      summary: result.summary ?? result.reply,
      edits: applied,
      affected: changedCells(before, after, applied),
      checks: runChecks(next, after),
    },
    warnings: errors,
  } satisfies AgentResponse);
}
