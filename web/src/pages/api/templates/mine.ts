// GET  /api/templates/mine        — list the logged-in user's saved templates.
// POST /api/templates/mine { name, latex } — save the current document as a template.
//
// Owner-scoped: only a logged-in user (owner_id === user:<id>) can list or save. Anonymous
// sessions get an empty list on GET and 401 on POST. owner_id comes from the server session.
import type { APIRoute } from "astro";
import { getOwnerId } from "@/lib/session";
import { listUserTemplates, saveUserTemplate } from "@/lib/db/userTemplates";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const ownerId = await getOwnerId(ctx);
  if (!ownerId.startsWith("user:")) return json({ templates: [] }, 200);
  const templates = await listUserTemplates(ownerId);
  return json({ templates }, 200);
};

export const POST: APIRoute = async (ctx) => {
  const ownerId = await getOwnerId(ctx);
  if (!ownerId.startsWith("user:")) {
    return json({ error: { code: "LOGIN_REQUIRED", message: "Sign in to save your own templates." } }, 401);
  }

  let body: unknown;
  try { body = await ctx.request.json(); } catch { return json({ error: { code: "BAD_REQUEST", message: "invalid JSON body" } }, 400); }
  const { name, latex } = (body ?? {}) as { name?: string; latex?: string };
  if (typeof latex !== "string" || !latex.trim()) {
    return json({ error: { code: "BAD_REQUEST", message: "Nothing to save yet." } }, 400);
  }

  const result = await saveUserTemplate(ownerId, typeof name === "string" ? name : "", latex);
  if (!result.ok) {
    if (result.reason === "limit") return json({ error: { code: "LIMIT", message: "You've reached the saved-template limit (20)." } }, 409);
    return json({ error: { code: "BAD_REQUEST", message: "Nothing to save yet." } }, 400);
  }
  return json({ template: result.template }, 200);
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
