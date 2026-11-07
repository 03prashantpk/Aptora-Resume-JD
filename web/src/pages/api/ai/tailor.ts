// POST /api/ai/tailor — AI rewrites the Resume LaTeX to fit the JD.
// The NVIDIA key stays server-side (this route never runs in the browser).
import type { APIRoute } from "astro";
import { tailorLatex } from "@/lib/ai/tailor";
import { getOwnerId, peekBudget, settleSpend } from "@/lib/session";

export const prerender = false;

const MAX_LATEX = 400_000;
const MAX_JD = 20_000;

export const POST: APIRoute = async (ctx) => {
  const { request } = ctx;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: { code: "BAD_REQUEST", message: "invalid JSON body" } }, 400);
  }
  const { latex, jd } = (body ?? {}) as { latex?: string; jd?: string };
  if (typeof latex !== "string" || !latex.trim()) {
    return json({ error: { code: "EMPTY_SOURCE", message: "LaTeX source is required" } }, 400);
  }
  if (typeof jd !== "string" || !jd.trim()) {
    return json({ error: { code: "EMPTY_JD", message: "Job description is required" } }, 400);
  }
  if (latex.length > MAX_LATEX || jd.length > MAX_JD) {
    return json({ error: { code: "INPUT_TOO_LARGE", message: "Input is too large" } }, 400);
  }

  // Budget gate — same single source of truth as every other AI route, so this
  // endpoint can never be used to get free, unmetered AI runs.
  const ownerId = await getOwnerId(ctx);
  const budget = await peekBudget(ownerId);
  if (!budget.allowed) {
    return json({ error: { code: "BUDGET_EXHAUSTED", message: "Daily limit reached. Add credits, use your own free API key, or continue tomorrow." } }, 402);
  }

  try {
    const tailored = await tailorLatex(latex, jd);
    if (!tailored) return json({ error: { code: "AI_EMPTY", message: "No result produced" } }, 502);
    await settleSpend(ownerId, budget.source, "ai_calls");
    return json({ latex: tailored }, 200);
  } catch {
    // Never leak provider errors / keys.
    return json({ error: { code: "AI_UNAVAILABLE", message: "Tailoring is unavailable right now." } }, 502);
  }
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
