import { z } from "zod";
import { MAX_INPUT_LENGTH } from "@/lib/sheet/edits";
import { isUuid, ModelNotFound, saveEdits } from "@/lib/models/store";
import { track } from "@/lib/server/events";
import { hit, LIMITS } from "@/lib/server/ratelimit";
import { readJson, tooMany, withUser } from "@/lib/server/route";

type Context = { params: Promise<{ id: string }> };

const Body = z.object({
  baseVersion: z.number().int().nonnegative(),
  edits: z
    .array(
      z.object({
        sheet: z.string().min(1).max(40),
        cell: z.string().min(2).max(12),
        input: z.string().max(MAX_INPUT_LENGTH),
      }),
    )
    .min(1)
    .max(200),
});

// Saves cell edits typed by the user. The server validates and versions
// them; a stale baseVersion gets a 409 so the browser reloads.
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  return withUser(request, { create: false }, async ({ db, userId }) => {
    if (!isUuid(id)) throw new ModelNotFound("Model not found.");
    const body = await readJson(request, Body);
    const limit = await hit(db, `edit:${userId}`, LIMITS.editsPerUserMinute, 60);
    if (!limit.ok) throw tooMany("Too many edits at once. Slow down a little.", limit.retryAfter);

    const summary =
      body.edits.length === 1
        ? `Edited ${body.edits[0].sheet}!${body.edits[0].cell.toUpperCase()}`
        : `Edited ${body.edits.length} cells`;
    const state = await saveEdits(db, userId, id, { baseVersion: body.baseVersion, edits: body.edits, summary });
    await track(db, { name: "edit_saved", userId, modelId: id, props: { author: "you", cells: body.edits.length } });
    return Response.json(state);
  });
}
