// GET /api/templates/votes — displayed upvote counts per template + which ones the
// current owner has upvoted. Owner comes from the server session (never the client).
import type { APIRoute } from "astro";
import { getOwnerId } from "@/lib/session";
import { getVoteState } from "@/lib/db/votes";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const ownerId = await getOwnerId(ctx);
  const state = await getVoteState(ownerId);
  return new Response(JSON.stringify(state), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
