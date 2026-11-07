// GET /api/usage — full budget state for the CURRENT owner.
// Drives the Usage page, the menubar popover, the gate modal and the upgrade prompts.
// Budget order: own API key (BYOK, no plan consumption) → Pro → free daily budget →
// purchased credits → nothing. Every number here must agree with peekBudget.
import type { APIRoute } from "astro";
import { getOwnerId, peekBudget } from "@/lib/session";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const ownerId = await getOwnerId(ctx);
  const b = await peekBudget(ownerId);
  const { usage: u, credits: c, source, allowed } = b;
  const role = ownerId.startsWith("user:") ? "user" : "guest";

  // "Left to do today". We mirror getUsage's gate math EXACTLY (signed used) so the
  // popover, the usage page and the server routes never disagree. A negative operator
  // grant surfaces here as MORE runs left (freeLimit minus a negative used), which is
  // the intended behavior for a "-50" style override.
  const runsLeft: number | null = source === "own-key" ? null : source === "pro" ? null : Math.max(0, u.freeLimit - u.usedSigned);
  const exportsLeft: number | null = runsLeft;

  return new Response(JSON.stringify({
    role,                       // "guest" | "user"
    tier: c.isPro ? "pro" : "free",
    aiCalls: u.aiCalls,         // today (plan-budget runs)
    byokAiCalls: u.byokAiCalls, // today (runs on the owner's own key)
    exportsUsed: u.exportsUsed, // today
    totalAiCalls: u.totalAiCalls,
    totalExports: u.totalExports,
    freeLimit: u.freeLimit,
    allowed,                    // can the next gated action start right now?
    source,                     // "own-key" | "pro" | "free" | "credit" | "blocked"
    runsLeft,                   // null = unlimited (own key or Pro)
    exportsLeft,                // exports share the same daily budget
    credits: c.credits,         // purchased credits
    isPro: c.isPro,
    proUntil: c.proUntil,
    hasOwnKey: b.ownKey,        // BYOK active
  }), { status: 200, headers: { "content-type": "application/json" } });
};
