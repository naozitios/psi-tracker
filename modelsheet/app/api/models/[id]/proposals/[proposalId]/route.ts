import { z } from "zod";
import { decideProposal, isUuid, ModelNotFound } from "@/lib/models/store";
import { track } from "@/lib/server/events";
import { readJson, withUser } from "@/lib/server/route";

type Context = { params: Promise<{ id: string; proposalId: string }> };

const Body = z.object({ decision: z.enum(["accept", "reject"]) });

export async function POST(request: Request, { params }: Context) {
  const { id, proposalId } = await params;
  return withUser(request, { create: false }, async ({ db, userId }) => {
    if (!isUuid(id) || !isUuid(proposalId)) throw new ModelNotFound("Model not found.");
    const { decision } = await readJson(request, Body);
    const state = await decideProposal(db, userId, id, proposalId, decision);
    await track(db, {
      name: decision === "accept" ? "proposal_accepted" : "proposal_rejected",
      userId,
      modelId: id,
    });
    return Response.json(state);
  });
}
