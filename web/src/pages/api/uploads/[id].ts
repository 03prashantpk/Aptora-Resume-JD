// GET    /api/uploads/:id  -> single upload (owner-scoped)
// DELETE /api/uploads/:id  -> delete (owner-scoped)
import type { APIRoute } from "astro";
import { getOwnerId } from "@/lib/session";
import { getUpload, deleteUpload } from "@/lib/db/repo";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const ownerId = await getOwnerId(ctx);
  const id = ctx.params.id;
  if (!id) return json({ error: { code: "BAD_REQUEST", message: "id required" } }, 400);
  const row = await getUpload(ownerId, id);
  if (!row) return json({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
  return json(row);
};

export const DELETE: APIRoute = async (ctx) => {
  const ownerId = await getOwnerId(ctx);
  const id = ctx.params.id;
  if (!id) return json({ error: { code: "BAD_REQUEST", message: "id required" } }, 400);
  await deleteUpload(ownerId, id);
  return json({ ok: true });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
