// POST /api/ai/tailor — surgically tailors LaTeX to a job description.
//
// HOW IT WORKS (surgical approach):
//   Old: Regenerate the entire 1000+ line LaTeX document (hit token limit mid-doc → broken LaTeX)
//   New: Extract editable text regions → AI rewrites only those snippets as JSON →
//        stitch back into the untouched original template
//
// Returns JSON: { latex: string, changedCount: number }
import type { APIRoute } from "astro";
import { surgicalTailor } from "@/lib/ai/surgical";
import { getOwnerId, getUsage, bumpUsage } from "@/lib/session";

export const prerender = false;

const MAX_LATEX = 400_000;
const MAX_JD = 20_000;

export const POST: APIRoute = async (ctx) => {
  const { request } = ctx;
  let body: unknown;
  try { body = await request.json(); } catch { return bad("invalid JSON body"); }
  const { latex, jd, intensity } = (body ?? {}) as { latex?: string; jd?: string; intensity?: "light" | "balanced" | "aggressive" };
  if (typeof latex !== "string" || !latex.trim()) return bad("LaTeX source is required");
  if (typeof jd !== "string" || !jd.trim()) return bad("Job description is required");
  if (latex.length > MAX_LATEX || jd.length > MAX_JD) return bad("Input is too large");
  const level = intensity === "light" || intensity === "aggressive" ? intensity : "balanced";

  const ownerId = await getOwnerId(ctx);
  const usage = await getUsage(ownerId);
  if (!usage.allowed) {
    return new Response(JSON.stringify({ error: { code: "FREE_LIMIT", message: "You've used your free runs. Create an account for more." } }), {
      status: 402, headers: { "content-type": "application/json" },
    });
  }

  try {
    const result = await surgicalTailor(latex, jd, level);
    // Only bump usage AFTER a successful AI call (fix: old code bumped before the call)
    await bumpUsage(ownerId, "ai_calls");
    return new Response(
      JSON.stringify({ latex: result.latex, changedCount: result.changed.length }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  } catch {
    // Never leak provider errors or keys.
    return new Response(
      JSON.stringify({ error: { code: "AI_UNAVAILABLE", message: "Tailoring is unavailable right now." } }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }
};

function bad(message: string): Response {
  return new Response(JSON.stringify({ error: { code: "BAD_REQUEST", message } }), {
    status: 400, headers: { "content-type": "application/json" },
  });
}
