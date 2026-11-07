// Anonymous session (opaque HttpOnly cookie) + usage counting/gating.
// Server-only. Never trust a client-supplied id.
import type { APIContext } from "astro";
import { randomUUID } from "node:crypto";
import { query } from "./db";
import { PLANS } from "./payu";

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
  aiCalls: number;          // TODAY (the displayed "AI runs today")
  exportsUsed: number;      // TODAY (the displayed "exports today")
  totalAiCalls: number;     // all-time (history/aggregates)
  totalExports: number;     // all-time
  freeLimit: number;        // per-day free budget
  /** true when the owner still has free AI/export budget. */
  allowed: boolean;
}

async function readUsage(ownerId: string): Promise<{
  day: { ai_calls: number; exports_used: number };
  total: { ai_calls: number; exports_used: number };
}> {
  const rows = await query<{
    day_ai: number; day_exports: number;
    total_ai: number; total_exports: number;
  }>(
    "SELECT COALESCE(SUM(ai_calls) FILTER (WHERE day = current_date),0)::int AS day_ai," +
    " COALESCE(SUM(exports_used) FILTER (WHERE day = current_date),0)::int AS day_exports," +
    " COALESCE(SUM(ai_calls),0)::int AS total_ai," +
    " COALESCE(SUM(exports_used),0)::int AS total_exports" +
    " FROM usage WHERE owner_id=$1",
    [ownerId],
  );
  const r = rows[0];
  return {
    day: { ai_calls: r?.day_ai ?? 0, exports_used: r?.day_exports ?? 0 },
    total: { ai_calls: r?.total_ai ?? 0, exports_used: r?.total_exports ?? 0 },
  };
}

/** NOTE: legacy rows could hold bad counter values from older bugs, so every counter is
 *  clamped ≥ 0 here — a negative like "-44 AI runs" must never reach the UI again. */
export async function getUsage(ownerId: string): Promise<UsageState> {
  const u = await readUsage(ownerId);
  const aiCalls = Math.max(0, u.day.ai_calls);
  const exportsUsed = Math.max(0, u.day.exports_used);
  const totalAiCalls = Math.max(0, u.total.ai_calls);
  const totalExports = Math.max(0, u.total.exports_used);
  const used = Math.max(aiCalls, exportsUsed); // shared daily budget across kinds
  const freeLimit = limitFor(ownerId);
  return { aiCalls, exportsUsed, totalAiCalls, totalExports, freeLimit, allowed: used < freeLimit };
}

/** Atomically bump a usage counter for today. kind = 'ai_calls' | 'exports_used' | 'compiles'. */
export async function bumpUsage(ownerId: string, kind: "ai_calls" | "exports_used" | "compiles"): Promise<void> {
  // Whitelisted column name (never interpolate user input).
  const col = kind === "ai_calls" ? "ai_calls" : kind === "exports_used" ? "exports_used" : "compiles";
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
 * Combined budget check for gated actions (AI runs, exports, analysis).
 * Order of consumption at call time: active Pro → unlimited within limits.
 * Then purchased credits → consume one. Then the free tier budget → bump usage.
 * Returns the decision plus the source so the UI can show where budget went.
 */
export interface SpendResult extends UsageState {
  source: "free" | "credit" | "pro";
}

export async function spendFor(ownerId: string): Promise<SpendResult> {
  const credit = await getCreditState(ownerId);
  if (credit.isPro) {
    const u = await getUsage(ownerId);
    return { ...u, allowed: true, source: "pro" };
  }
  const u = await getUsage(ownerId);
  if (u.allowed) return { ...u, source: "free" };
  if (credit.credits > 0) {
    const ok = await consumeCredit(ownerId);
    if (ok) return { ...u, allowed: true, source: "credit" };
  }
  return { ...u, allowed: false, source: "free" };
}

/** Gate for paid-ish actions (AI tailor/analyze, export). Returns whether allowed + state. */
export async function checkAndCountable(ownerId: string): Promise<UsageState> {
  return getUsage(ownerId);
}
