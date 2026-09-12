// GET /api/usage — current owner's free-usage state (drives the "create account" prompt).
import type { APIRoute } from "astro";
import { getOwnerId, getUsage } from "@/lib/session";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const ownerId = await getOwnerId(ctx);
  const u = await getUsage(ownerId);
  return new Response(JSON.stringify(u), { status: 200, headers: { "content-type": "application/json" } });
};
