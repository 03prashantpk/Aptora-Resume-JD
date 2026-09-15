// GET  /api/templates/mine        — list the logged-in user's saved templates.
// POST /api/templates/mine { name, latex } — save the current document as a template.
//
// Owner-scoped: only a logged-in user (owner_id === user:<id>) can list or save. Anonymous
// sessions get an empty list on GET and 401 on POST. owner_id comes from the server session.
// POST supports two kinds:
//   { latex }                              -> save the current editor doc (snapshot).
//   { kind:"custom", sourceLatex, name?, mappings? } -> save a reusable custom LaTeX
//                                              template with {{PLACEHOLDER}} tokens.
import type { APIRoute } from "astro";
import { getOwnerId } from "@/lib/session";
import { listUserTemplates, saveUserTemplate, saveCustomTemplate } from "@/lib/db/userTemplates";
import { validateTemplate } from "@/lib/latex/placeholders";

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
  const { kind, name, latex, sourceLatex, mappings } = (body ?? {}) as {
    kind?: string; name?: string; latex?: string; sourceLatex?: string; mappings?: Record<string, string>;
  };

  // --- Custom LaTeX template (with {{PLACEHOLDER}} tokens) ---
  if (kind === "custom") {
    const src = typeof sourceLatex === "string" ? sourceLatex : typeof latex === "string" ? latex : "";
    if (!src.trim()) return json({ error: { code: "BAD_REQUEST", message: "Template source is required." } }, 400);
    const v = validateTemplate(src);
    if (!v.ok) return json({ error: { code: "INVALID_TEMPLATE", message: v.errors[0], errors: v.errors } }, 400);
    const result = await saveCustomTemplate(
      ownerId,
      typeof name === "string" ? name : "",
      src,
      mappings && typeof mappings === "object" ? mappings : undefined,
    );
    if (!result.ok) {
      if (result.reason === "limit") return json({ error: { code: "LIMIT", message: "You've reached the saved-template limit (20)." } }, 409);
      return json({ error: { code: "BAD_REQUEST", message: "Nothing to save yet." } }, 400);
    }
    return json({ template: result.template, warnings: v.warnings }, 200);
  }

  // --- Snapshot of the current editor document ---
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
