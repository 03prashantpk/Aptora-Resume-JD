// GET /api/usage — full budget state for the CURRENT owner.
// Includes the tier (guest vs account), free budget, paid credits from PayU
// purchases, and Pro entitlement. Drives the Usage page, the guest gate, and the
// upgrade prompts. Roles:
//   guest (anonymous:<sid>) — tiny free budget, cookie-bound (clearing cookies resets it)
//   user  (user:<id>)       — larger free budget + purchased credits survive forever
import type { APIRoute } from "astro";
import { getOwnerId, getUsage, getCreditState } from "@/lib/session";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const ownerId = await getOwnerId(ctx);
  const [u, c] = await Promise.all([getUsage(ownerId), getCreditState(ownerId)]);
  const role = ownerId.startsWith("user:") ? "user" : "guest";
  return new Response(JSON.stringify({
    role,                       // "guest" | "user"
    tier: c.isPro ? "pro" : "free",
    aiCalls: u.aiCalls,         // today
    exportsUsed: u.exportsUsed, // today
    totalAiCalls: u.totalAiCalls,
    totalExports: u.totalExports,
    freeLimit: u.freeLimit,
    allowed: u.allowed,
    credits: c.credits,         // purchased credits (unused free—independent budget)
    isPro: c.isPro,
    proUntil: c.proUntil,
  }), { status: 200, headers: { "content-type": "application/json" } });
};
