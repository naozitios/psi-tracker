import { deleteModel, loadModel } from "@/lib/models/store";
import { track } from "@/lib/server/events";
import { jsonError, withUser } from "@/lib/server/route";

type Context = { params: Promise<{ id: string }> };

// Someone else's model and no model at all look the same to the caller.
const whenAnonymous = () => jsonError("Model not found.", 404);

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  return withUser(request, { create: false, whenAnonymous }, async ({ db, userId }) => {
    const state = await loadModel(db, userId, id);
    await track(db, { name: "model_opened", userId, modelId: id });
    return Response.json(state);
  });
}

export async function DELETE(request: Request, { params }: Context) {
  const { id } = await params;
  return withUser(request, { create: false }, async ({ db, userId }) => {
    await deleteModel(db, userId, id);
    return new Response(null, { status: 204 });
  });
}
