// POST /api/ai/analyze — Resume vs JD -> structured analysis JSON. Key stays server-side.
import type { APIRoute } from "astro";
import { analyzeResume } from "@/lib/ai/analyze";
import { getOwnerId, peekBudget, settleSpend } from "@/lib/session";
import { getRawKey } from "@/lib/keys";
import { withOwnerKey } from "@/lib/ai/provider";
import { logRoute } from "@/lib/ai/log";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const { request } = ctx;
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: { code: "BAD_REQUEST", message: "invalid JSON" } }, 400); }
  const { latex, jd, isFollowUp } = (body ?? {}) as { latex?: string; jd?: string; isFollowUp?: boolean };
  if (typeof latex !== "string" || !latex.trim()) return json({ error: { code: "EMPTY_SOURCE", message: "Resume required" } }, 400);
  if (typeof jd !== "string" || !jd.trim()) return json({ error: { code: "EMPTY_JD", message: "job description required" } }, 400);
  if (latex.length > 400_000 || jd.length > 20_000) return json({ error: { code: "INPUT_TOO_LARGE", message: "input too large" } }, 400);

  const rlog = logRoute("ai/analyze", { resume: `${latex.length}c`, jd: `${jd.length}c`, followUp: !!isFollowUp });
  const ownerId = await getOwnerId(ctx);
  const budget = await peekBudget(ownerId);
  // If not a follow-up, enforce the budget
  if (!isFollowUp && !budget.allowed) {
    rlog.done("402 budget");
    return json({ error: { code: "BUDGET_EXHAUSTED", message: "Daily limit reached. Add credits, use your own free API key, or continue tomorrow." } }, 402);
  }
  const ownerKey = budget.ownKey ? await getRawKey(ownerId) : null;

  return withOwnerKey(ownerKey, async () => {
  try {
    const analysis = await analyzeResume(latex, jd);
    if (!analysis) { rlog.done("502 empty"); return json({ error: { code: "AI_EMPTY", message: "No analysis produced" } }, 502); }
    // Only record a run if it's a primary analysis (not an automatic follow-up post-tailoring)
    if (!isFollowUp) {
      await settleSpend(ownerId, budget.source, "ai_calls");
    }
    rlog.done("200 ok");
    return json(analysis, 200);
  } catch {
    rlog.done("502 unavailable");
    return json({ error: { code: "AI_UNAVAILABLE", message: "Analysis is unavailable right now." } }, 502);
  }
  });
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
