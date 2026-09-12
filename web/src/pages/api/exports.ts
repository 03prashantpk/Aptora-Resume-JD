// GET /api/exports -> owner's export/download records (with expiry). Cleans expired first.
import type { APIRoute } from "astro";
import { getOwnerId } from "@/lib/session";
import { listExports, cleanupExpired } from "@/lib/db/repo";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  await cleanupExpired();
  const ownerId = await getOwnerId(ctx);
  const rows = await listExports(ownerId);
  return new Response(JSON.stringify({ exports: rows }), { status: 200, headers: { "content-type": "application/json" } });
};
