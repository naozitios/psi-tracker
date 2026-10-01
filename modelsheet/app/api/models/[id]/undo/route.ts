import { z } from "zod";
import { isUuid, ModelNotFound, undoLast } from "@/lib/models/store";
import { track } from "@/lib/server/events";
import { readJson, withUser } from "@/lib/server/route";

type Context = { params: Promise<{ id: string }> };

const Body = z.object({ baseVersion: z.number().int().nonnegative() });

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  return withUser(request, { create: false }, async ({ db, userId }) => {
    if (!isUuid(id)) throw new ModelNotFound("Model not found.");
    const body = await readJson(request, Body);
    const state = await undoLast(db, userId, id, body.baseVersion);
    await track(db, { name: "edit_undone", userId, modelId: id });
    return Response.json(state);
  });
}
