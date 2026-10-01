import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { runAgent, WorkbookTooLarge } from "@/lib/agent/agent";
import { chatHistory, isUuid, loadModel, ModelNotFound, recordAgentTurn } from "@/lib/models/store";
import { track } from "@/lib/server/events";
import { hit, LIMITS } from "@/lib/server/ratelimit";
import { HttpError, readJson, tooMany, withUser } from "@/lib/server/route";

type Context = { params: Promise<{ id: string }> };

const Body = z.object({ message: z.string().trim().min(1).max(2000) });

// Sends the user's request and the saved workbook to Claude. Suggested
// edits come back as a pending proposal with a preview; nothing changes in
// the workbook until the user accepts.
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  return withUser(request, { create: false }, async ({ db, userId }) => {
    if (!isUuid(id)) throw new ModelNotFound("Model not found.");
    const { message } = await readJson(request, Body);
    const model = await loadModel(db, userId, id);
    if (model.proposal) throw new HttpError(409, "Accept or reject the current suggestion first.");

    // These limits bound what one person, and the whole app, can spend on
    // API credits in a day.
    const budgets = [
      { scope: "user-hour", key: `agent:${userId}:h`, max: LIMITS.agentPerUserHour, seconds: 3600, text: "You've reached the assistant's hourly limit." },
      { scope: "user-day", key: `agent:${userId}:d`, max: LIMITS.agentPerUserDay, seconds: 86400, text: "You've reached the assistant's daily limit." },
      { scope: "global-day", key: "agent:all:d", max: LIMITS.agentGlobalDay, seconds: 86400, text: "The assistant has reached today's usage limit." },
    ];
    for (const budget of budgets) {
      const limit = await hit(db, budget.key, budget.max, budget.seconds);
      if (!limit.ok) {
        await track(db, { name: "agent_limited", userId, modelId: id, props: { scope: budget.scope } });
        throw tooMany(`${budget.text} Try again later.`, limit.retryAfter);
      }
    }

    let result;
    try {
      result = await runAgent({ workbook: model.workbook, message, history: await chatHistory(db, id) });
    } catch (err) {
      if (err instanceof WorkbookTooLarge) throw new HttpError(413, err.message);
      if (err instanceof Anthropic.AuthenticationError) {
        console.error(err);
        throw new HttpError(503, "The assistant is not configured on this server.");
      }
      if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, "The assistant is busy. Try again in a moment.");
      if (err instanceof Anthropic.APIError) {
        console.error(err);
        throw new HttpError(502, "The assistant could not answer. Try again.");
      }
      throw err;
    }

    const { state, proposalId } = await recordAgentTurn(db, userId, id, model.version, {
      message,
      reply: result.reply,
      summary: result.summary,
      edits: result.edits,
      warnings: [],
    });
    if (proposalId) {
      await track(db, { name: "proposal_created", userId, modelId: id, props: { cells: result.edits.length } });
    }
    return Response.json(state);
  });
}
