// GET    /api/templates/mine/:id  — fetch one saved template's LaTeX (to load into editor).
// DELETE /api/templates/mine/:id  — remove one saved template.
//
// Owner-scoped: the id is always matched with owner_id (WHERE id=? AND owner_id=?), so a
// user can only touch their own rows. owner_id comes from the server session.
import type { APIRoute } from "astro";
import { getOwnerId } from "@/lib/session";
import { getUserTemplate, deleteUserTemplate } from "@/lib/db/userTemplates";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const ownerId = await getOwnerId(ctx);
  if (!ownerId.startsWith("user:")) return json({ error: { code: "LOGIN_REQUIRED", message: "Sign in first." } }, 401);
  const id = ctx.params.id;
  if (!id) return json({ error: { code: "BAD_REQUEST", message: "missing id" } }, 400);
  const tpl = await getUserTemplate(ownerId, id);
  if (!tpl) return json({ error: { code: "NOT_FOUND", message: "Template not found." } }, 404);
  return json({ template: tpl }, 200);
};

export const DELETE: APIRoute = async (ctx) => {
  const ownerId = await getOwnerId(ctx);
  if (!ownerId.startsWith("user:")) return json({ error: { code: "LOGIN_REQUIRED", message: "Sign in first." } }, 401);
  const id = ctx.params.id;
  if (!id) return json({ error: { code: "BAD_REQUEST", message: "missing id" } }, 400);
  const removed = await deleteUserTemplate(ownerId, id);
  if (!removed) return json({ error: { code: "NOT_FOUND", message: "Template not found." } }, 404);
  return json({ ok: true }, 200);
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
