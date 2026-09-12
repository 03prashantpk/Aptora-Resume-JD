// POST /api/ai/analyze — Resume vs JD -> structured analysis JSON. Key stays server-side.
import type { APIRoute } from "astro";
import { analyzeResume } from "@/lib/ai/analyze";
import { getOwnerId, getUsage, bumpUsage } from "@/lib/session";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const { request } = ctx;
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: { code: "BAD_REQUEST", message: "invalid JSON" } }, 400); }
  const { latex, jd } = (body ?? {}) as { latex?: string; jd?: string };
  if (typeof latex !== "string" || !latex.trim()) return json({ error: { code: "EMPTY_SOURCE", message: "Resume required" } }, 400);
  if (typeof jd !== "string" || !jd.trim()) return json({ error: { code: "EMPTY_JD", message: "job description required" } }, 400);
  if (latex.length > 400_000 || jd.length > 20_000) return json({ error: { code: "INPUT_TOO_LARGE", message: "input too large" } }, 400);

  const ownerId = await getOwnerId(ctx);
  const usage = await getUsage(ownerId);
  if (!usage.allowed) return json({ error: { code: "FREE_LIMIT", message: "You've used your free runs. Create an account for more." } }, 402);

  try {
    const analysis = await analyzeResume(latex, jd);
    if (!analysis) return json({ error: { code: "AI_EMPTY", message: "No analysis produced" } }, 502);
    await bumpUsage(ownerId, "ai_calls");
    return json(analysis, 200);
  } catch {
    return json({ error: { code: "AI_UNAVAILABLE", message: "Analysis is unavailable right now." } }, 502);
  }
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
