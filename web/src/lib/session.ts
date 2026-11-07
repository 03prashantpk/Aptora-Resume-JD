// Anonymous session (opaque HttpOnly cookie) + usage counting/gating.
// Server-only. Never trust a client-supplied id.
import type { APIContext } from "astro";
import { randomUUID } from "node:crypto";
import { query } from "./db";
import { PLANS } from "./payu";
import { getStatus } from "./keys";

const COOKIE = "aptora_sid";
const env = (k: string): string | undefined => process.env[k] ?? (import.meta.env as Record<string, string>)[k];
// Export budgets: anonymous visitors get 1; a verified account gets 3 total.
const ANON_LIMIT = Number(env("FREE_EXPORT_LIMIT_ANON") ?? 1);
const USER_LIMIT = Number(env("FREE_EXPORT_LIMIT_USER") ?? 3);

/** Owner identity from the session cookie. Logged-in => "user:<id>"; otherwise a
 *  stable "anonymous:<sid>" (cookie created on first visit). */
export async function getOwnerId(ctx: APIContext): Promise<string> {
  const existing = ctx.cookies.get(COOKIE)?.value;
  if (existing?.startsWith("user:")) return existing; // logged in
  let sid = existing;
  if (!sid) {
    sid = randomUUID();
    ctx.cookies.set(COOKIE, sid, {
      httpOnly: true, secure: false, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
    });
    await query("INSERT INTO anonymous_sessions (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [sid]);
  }
  return `anonymous:${sid}`;
}

/** The export/usage budget for this owner: 1 for anonymous, 3 for a logged-in user. */
export function limitFor(ownerId: string): number {
  return ownerId.startsWith("user:") ? USER_LIMIT : ANON_LIMIT;
}

export interface UsageState {
  aiCalls: number;          // TODAY (the displayed "AI runs today"), free/pro budget only
  exportsUsed: number;      // TODAY (the displayed "exports today")
  byokAiCalls: number;      // TODAY — AI runs on the owner's OWN key (budget-exempt)
  totalAiCalls: number;     // all-time (history/aggregates)
  totalExports: number;     // all-time
  freeLimit: number;        // per-day free budget
  /** Signed "used today" that drives the gate: max(ai_calls, exports_used) from the DB
   *  WITHOUT a floor, so an operator's negative grant stays authoritative. May be < 0. */
  usedSigned: number;
  /** true when the owner still has free AI/export budget. */
  allowed: boolean;
}

async function readUsage(ownerId: string): Promise<{
  day: { ai_calls: number; exports_used: number; byok_ai_calls: number };
  total: { ai_calls: number; exports_used: number };
}> {
  // Lifetime totals = live daily rows + the pruned-rows rollup (usage_totals), so
  // all-time counts survive old-row cleanup. Day counters come only from today's row.
  const rows = await query<{
    day_ai: number; day_exports: number; day_byok: number;
    total_ai: number; total_exports: number;
  }>(
    "SELECT COALESCE(SUM(u.ai_calls) FILTER (WHERE u.day = current_date),0)::int AS day_ai," +
    " COALESCE(SUM(u.exports_used) FILTER (WHERE u.day = current_date),0)::int AS day_exports," +
    " COALESCE(SUM(u.byok_ai_calls) FILTER (WHERE u.day = current_date),0)::int AS day_byok," +
    " (COALESCE(SUM(u.ai_calls),0) + COALESCE(MAX(t.ai_calls),0))::int AS total_ai," +
    " (COALESCE(SUM(u.exports_used),0) + COALESCE(MAX(t.exports_used),0))::int AS total_exports" +
    " FROM usage u LEFT JOIN usage_totals t ON t.owner_id = u.owner_id" +
    " WHERE u.owner_id=$1",
    [ownerId],
  );
  const r = rows[0];
  return {
    day: { ai_calls: r?.day_ai ?? 0, exports_used: r?.day_exports ?? 0, byok_ai_calls: r?.day_byok ?? 0 },
    total: { ai_calls: r?.total_ai ?? 0, exports_used: r?.total_exports ?? 0 },
  };
}

/** Counter semantics (single source of truth — the DB row wins):
 *  - The gate uses the RAW signed counters, so a manual override works as intended:
 *    setting usage.ai_calls = -50 grants ~50 extra runs today (the row is the truth;
 *    the app never silently discards what an operator wrote to it).
 *  - The DISPLAYED counters are floored at 0 only so the UI never shows "-50 AI runs";
 *    the real signed value still drives the budget math (`used`, `allowed`).
 *  `aiCalls` counts PLAN-budget runs only (own-key runs are counted separately in
 *  byokAiCalls) so the daily gate can never be poisoned by a user's own-key usage. */
export async function getUsage(ownerId: string): Promise<UsageState> {
  const u = await readUsage(ownerId);
  // RAW signed daily counters drive the gate (an operator's negative override = bonus budget).
  const rawAi = u.day.ai_calls;
  const rawExports = u.day.exports_used;
  // DISPLAY counters never go below 0 (a negative grant reads as "0 used today").
  const aiCalls = Math.max(0, rawAi);
  const exportsUsed = Math.max(0, rawExports);
  const byokAiCalls = Math.max(0, u.day.byok_ai_calls);
  const totalAiCalls = Math.max(0, u.total.ai_calls);
  const totalExports = Math.max(0, u.total.exports_used);
  const freeLimit = limitFor(ownerId);
  // Gate on the signed value: used can be negative (a grant), so allowed stays true
  // until genuine usage climbs back over the free limit.
  const usedSigned = Math.max(rawAi, rawExports);
  return { aiCalls, exportsUsed, byokAiCalls, totalAiCalls, totalExports, freeLimit, usedSigned, allowed: usedSigned < freeLimit };
}

/** Atomically bump a usage counter for today. kind = 'ai_calls' | 'exports_used' | 'compiles'.
 *  byok=true records the run under byok_ai_calls instead — runs on the owner's OWN key
 *  don't consume the plan budget but ARE part of the honest usage record. */
export async function bumpUsage(
  ownerId: string,
  kind: "ai_calls" | "exports_used" | "compiles",
  { byok = false }: { byok?: boolean } = {},
): Promise<void> {
  // Whitelisted column name (never interpolate user input).
  const col = byok && kind === "ai_calls" ? "byok_ai_calls" : kind === "ai_calls" ? "ai_calls" : kind === "exports_used" ? "exports_used" : "compiles";
  await query(
    `INSERT INTO usage (owner_id, day, ${col}) VALUES ($1, current_date, 1)
     ON CONFLICT (owner_id, day) DO UPDATE SET ${col} = usage.${col} + 1`,
    [ownerId],
  );
}

// ── Paid credits & Pro (PayU purchases) ────────────────────────────────────────
// Paid credits sit in credit_balance and are consumed BEFORE the free budget.
// Pro = an active pro_until window set by the ₹100 plan.

export interface CreditState {
  credits: number;           // remaining purchased credits
  isPro: boolean;            // active pro window (100-credit plan, 1 year)
  proUntil: string | null;   // ISO date, for the UI
}

export async function getCreditState(ownerId: string): Promise<CreditState> {
  try {
    const rows = await query<{ credits: number; pro_until: string | null }>(
      "SELECT credits, pro_until FROM credit_balance WHERE owner_id=$1",
      [ownerId],
    );
    const r = rows[0];
    const proUntil = r?.pro_until ?? null;
    const isPro = !!proUntil && new Date(proUntil).getTime() > Date.now();
    return { credits: r?.credits ?? 0, isPro, proUntil };
  } catch {
    return { credits: 0, isPro: false, proUntil: null }; // DB down → degrade to free
  }
}

/** Atomically deduct 1 paid credit. Returns false when the balance was empty. */
export async function consumeCredit(ownerId: string): Promise<boolean> {
  try {
    const rows = await query<{ owner_id: string }>(
      "UPDATE credit_balance SET credits = credits - 1, updated_at = now() WHERE owner_id=$1 AND credits > 0 RETURNING owner_id",
      [ownerId],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** Grant a plan after a verified payment. TOPUP adds credits; PRO extends the window.
 *  Credit amounts come from the SAME env-driven pricing table as checkout
 *  (PRICING_*_CREDITS in web/.env) so a price change can never desync the grant. */
export async function grantPlan(ownerId: string, plan: "TOPUP" | "PRO"): Promise<void> {
  const credits = PLANS[plan].credits;
  if (plan === "TOPUP") {
    await query(
      `INSERT INTO credit_balance (owner_id, credits) VALUES ($1, $2)
       ON CONFLICT (owner_id) DO UPDATE SET credits = credit_balance.credits + $2, updated_at = now()`,
      [ownerId, credits],
    );
  } else {
    await query(
      `INSERT INTO credit_balance (owner_id, credits, pro_until) VALUES ($1, $2, now() + interval '1 year')
       ON CONFLICT (owner_id) DO UPDATE SET
         credits = credit_balance.credits + $2,
         pro_until = GREATEST(COALESCE(credit_balance.pro_until, to_timestamp(0)), now() + interval '1 year'),
         updated_at = now()`,
      [ownerId, credits],
    );
  }
}

/**
 * BUDGET PEEK — the single source of truth for every gated action (AI tailor/analyze/
 * instruct/repair/ingest and PDF export). Decides WITHOUT consuming anything:
 *   own-key → runs bill the owner's own NVIDIA key (no plan consumption)
 *   pro → active Pro window (generous, effectively unlimited daily budget)
 *   free → daily free budget still available
 *   credit → consume one purchased credit AT SETTLE TIME (after the action succeeds)
 *   blocked → nothing left; the route answers 402 and the UI offers options.
 * The two-step peek/settle means a FAILED AI call never eats a paid credit.
 */
export type BudgetSource = "own-key" | "pro" | "free" | "credit" | "blocked";

export interface Budget {
  usage: UsageState;
  credits: CreditState;
  ownKey: boolean;          // BYOK active for this owner
  source: BudgetSource;
  allowed: boolean;
}

export async function peekBudget(ownerId: string): Promise<Budget> {
  const [usage, credits, keyStatus] = await Promise.all([
    getUsage(ownerId),
    getCreditState(ownerId),
    getStatus(ownerId),
  ]);
  if (keyStatus.has) return { usage, credits, ownKey: true, source: "own-key", allowed: true };
  if (credits.isPro) return { usage, credits, ownKey: false, source: "pro", allowed: true };
  if (usage.allowed) return { usage, credits, ownKey: false, source: "free", allowed: true };
  if (credits.credits > 0) return { usage, credits, ownKey: false, source: "credit", allowed: true };
  return { usage, credits, ownKey: false, source: "blocked", allowed: false };
}

/** Record a completed action. kind='ai_calls' for AI runs, 'exports_used' for exports.
 *  Counter semantics: paid credits are consumed AFTER success (see peekBudget). */
export async function settleSpend(
  ownerId: string,
  source: BudgetSource,
  kind: "ai_calls" | "exports_used",
): Promise<void> {
  await bumpUsage(ownerId, kind, { byok: source === "own-key" && kind === "ai_calls" });
  if (source === "credit") {
    const ok = await consumeCredit(ownerId);
    if (!ok) {
      // Raced empty mid-action — still done, never fail the user's finished work.
      console.warn("[budget] credit empty at settle; consumed 0 (race)");
    }
  }
}

