// POST /api/ai/fix-tex — the user-facing "Fix" button.
// Sends ONLY the failing document + the compiler's error to the repair model and
// returns the corrected, compile-verified LaTeX. No re-editing, no re-instruction.
import type { APIRoute } from "astro";
import { repairLatexDocument } from "@/lib/ai/instruct";
import { AIProviderError } from "@/lib/ai/provider";
import { getOwnerId, peekBudget, settleSpend } from "@/lib/session";
import { getRawKey } from "@/lib/keys";
import { withOwnerKey } from "@/lib/ai/provider";
import { logRoute } from "@/lib/ai/log";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const { request } = ctx;
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: { code: "BAD_REQUEST", message: "invalid JSON" } }, 400); }
  const { latex, error } = (body ?? {}) as { latex?: string; error?: string };

  if (typeof latex !== "string" || !latex.trim()) return json({ error: { code: "EMPTY_SOURCE", message: "Resume required" } }, 400);
  if (typeof error !== "string" || !error.trim()) return json({ error: { code: "NO_ERROR", message: "Compiler error required" } }, 400);
  if (latex.length > 400_000) return json({ error: { code: "INPUT_TOO_LARGE", message: "input too large" } }, 400);

  const rlog = logRoute("ai/fix-tex", { resume: `${latex.length}c`, err: JSON.stringify(error.slice(0, 60)) });
  const ownerId = await getOwnerId(ctx);
  const budget = await peekBudget(ownerId);
  if (!budget.allowed) {
    rlog.done("402 budget");
    return json({ error: { code: "BUDGET_EXHAUSTED", message: "Daily limit reached. Add credits, use your own free API key, or continue tomorrow." } }, 402);
  }
  const ownerKey = budget.ownKey ? await getRawKey(ownerId) : null;

  return withOwnerKey(ownerKey, async () => {
  try {
    const out = await repairLatexDocument(latex, error);
    await settleSpend(ownerId, budget.source, "ai_calls");
    if (out.ok && out.latex) {
      rlog.done("200 fixed");
      return json({ latex: out.latex, fixed: true }, 200);
    }
    // Repair produced a document but it STILL doesn't compile — give the user the real
    // compiler error so they can hand-edit if they want.
    rlog.done("422 unrepairable");
    return json({ error: { code: "REPAIR_FAILED", message: out.error || "could not fix" } }, 422);
  } catch (e) {
    console.error("[AI] ai/fix-tex FAILED:", e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    if (e instanceof AIProviderError && e.status === 401) {
      rlog.done("401 key-rejected");
      return json({ error: { code: "KEY_REJECTED", message: e.message } }, 401);
    }
    rlog.done("502 unavailable");
    return json({ error: { code: "AI_UNAVAILABLE", message: "Fix is unavailable right now." } }, 502);
  }
  });
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
