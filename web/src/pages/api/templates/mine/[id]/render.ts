// POST /api/templates/mine/:id/render  { values: { NAME, HEADLINE, ... }, raw?, onMissing? }
// Render an owner-scoped CUSTOM template by injecting placeholder values into its
// preserved source_latex. LITERAL + SURGICAL: only {{KEY}} tokens are replaced; the
// user's LaTeX (\Huge, spacing, packages) is untouched. The stored source is never
// modified — this returns a filled copy for the editor/compile.
import type { APIRoute } from "astro";
import { getOwnerId } from "@/lib/session";
import { getUserTemplate } from "@/lib/db/userTemplates";
import { renderTemplate, type RenderOptions } from "@/lib/latex/placeholders";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const ownerId = await getOwnerId(ctx);
  if (!ownerId.startsWith("user:")) return json({ error: { code: "LOGIN_REQUIRED", message: "Sign in first." } }, 401);

  const id = ctx.params.id;
  if (!id) return json({ error: { code: "BAD_REQUEST", message: "missing id" } }, 400);

  let body: unknown;
  try { body = await ctx.request.json(); } catch { return json({ error: { code: "BAD_REQUEST", message: "invalid JSON body" } }, 400); }
  const { values, raw, onMissing } = (body ?? {}) as {
    values?: Record<string, string>; raw?: boolean; onMissing?: RenderOptions["onMissing"];
  };

  const tpl = await getUserTemplate(ownerId, id);
  if (!tpl) return json({ error: { code: "NOT_FOUND", message: "Template not found." } }, 404);

  // Use the preserved original for custom templates; fall back to latex for snapshots.
  const source = tpl.source_latex ?? tpl.latex;
  const result = renderTemplate(source, values ?? {}, { raw: !!raw, onMissing: onMissing ?? "empty" });

  return json({
    latex: result.latex,
    found: result.found,
    unknown: result.unknown,
    missing: result.missing,
    unused: result.unused,
  }, 200);
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
