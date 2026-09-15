// POST /api/templates/vote  { templateId }  — record ONE upvote for a template.
//
// One vote per owner is enforced server-side by the (template_id, owner_id) primary key
// (see votes.ts). owner_id is the server session identity, so the client can't forge it
// or vote twice.
//
// Login gating: the product intent is "only a logged-in user can upvote." Real auth is
// still a stub, so today we scope by the anonymous session (one vote per browser
// session). Because owner_id already becomes user:<id> once auth lands, flipping this to
// a true login requirement is a one-line guard here — no schema/data change. Until then
// we enforce one-vote-per-session, which preserves the "1 user, 1 vote" behavior.
import type { APIRoute } from "astro";
import { getOwnerId } from "@/lib/session";
import { addVote } from "@/lib/db/votes";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  let body: unknown;
  try {
    body = await ctx.request.json();
  } catch {
    return json({ error: { code: "BAD_REQUEST", message: "invalid JSON body" } }, 400);
  }
  const { templateId } = (body ?? {}) as { templateId?: string };
  if (typeof templateId !== "string" || !templateId.trim()) {
    return json({ error: { code: "BAD_REQUEST", message: "templateId is required" } }, 400);
  }

  // Login gate: only a real, logged-in user (owner_id === user:<id>) can upvote. This,
  // combined with the (template_id, owner_id) primary key, guarantees one vote per user.
  const ownerId = await getOwnerId(ctx);
  if (!ownerId.startsWith("user:")) {
    return json({ error: { code: "LOGIN_REQUIRED", message: "Sign in to upvote a template." } }, 401);
  }

  const result = await addVote(ownerId, templateId);
  if (!result.ok) {
    return json({ error: { code: "UNKNOWN_TEMPLATE", message: "unknown template" } }, 400);
  }
  return json({ count: result.count, alreadyVoted: result.alreadyVoted, voted: true }, 200);
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
