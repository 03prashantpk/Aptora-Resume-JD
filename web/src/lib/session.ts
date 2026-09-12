// Anonymous session (opaque HttpOnly cookie) + usage counting/gating.
// Server-only. Never trust a client-supplied id.
import type { APIContext } from "astro";
import { randomUUID } from "node:crypto";
import { query } from "./db";

const COOKIE = "aptora_sid";
const FREE_LIMIT = Number(process.env.FREE_USAGE_LIMIT ?? (import.meta.env as Record<string, string>).FREE_USAGE_LIMIT ?? 3);

/** Read (or create) the anonymous session id, setting the cookie if new. */
export async function getOwnerId(ctx: APIContext): Promise<string> {
  let sid = ctx.cookies.get(COOKIE)?.value;
  if (!sid) {
    sid = randomUUID();
    ctx.cookies.set(COOKIE, sid, {
      httpOnly: true, secure: false, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
    });
    await query("INSERT INTO anonymous_sessions (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [sid]);
  }
  return `anonymous:${sid}`;
}

export interface UsageState {
  aiCalls: number;
  exportsUsed: number;
  freeLimit: number;
  /** true when the owner still has free AI/export budget. */
  allowed: boolean;
}

async function readUsage(ownerId: string): Promise<{ ai_calls: number; exports_used: number }> {
  const rows = await query<{ ai_calls: number; exports_used: number }>(
    "SELECT COALESCE(SUM(ai_calls),0)::int AS ai_calls, COALESCE(SUM(exports_used),0)::int AS exports_used FROM usage WHERE owner_id=$1",
    [ownerId],
  );
  return rows[0] ?? { ai_calls: 0, exports_used: 0 };
}

export async function getUsage(ownerId: string): Promise<UsageState> {
  const u = await readUsage(ownerId);
  const used = Math.max(u.ai_calls, u.exports_used);
  return { aiCalls: u.ai_calls, exportsUsed: u.exports_used, freeLimit: FREE_LIMIT, allowed: used < FREE_LIMIT };
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

/** Gate for paid-ish actions (AI tailor/analyze, export). Returns whether allowed + state. */
export async function checkAndCountable(ownerId: string): Promise<UsageState> {
  return getUsage(ownerId);
}
