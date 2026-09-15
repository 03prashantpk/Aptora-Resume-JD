// POST /api/auth/verify { email, code }
// Checks the OTP; on success marks the user verified, logs them in (session upgrade),
// sends the welcome email, and adds them to the Resend audience.
import type { APIRoute } from "astro";
import { checkOtp, markVerified, findUserByEmail, setUserSession } from "@/lib/auth";
import { sendWelcome, addToAudience } from "@/lib/email";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  let body: unknown;
  try { body = await ctx.request.json(); } catch { return json({ error: { code: "BAD_REQUEST", message: "invalid body" } }, 400); }
  const { email, code } = (body ?? {}) as { email?: string; code?: string };
  if (typeof email !== "string" || typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return json({ error: { code: "BAD_REQUEST", message: "Enter the 6-digit code." } }, 400);
  }

  const result = await checkOtp(email, code);
  if (result !== "ok") {
    const map: Record<string, string> = {
      invalid: "That code isn't right. Please check and try again.",
      expired: "That code has expired. Request a new one.",
      too_many: "Too many attempts. Request a new code.",
    };
    return json({ error: { code: result.toUpperCase(), message: map[result] ?? "Verification failed." } }, 400);
  }

  await markVerified(email);
  const user = await findUserByEmail(email);
  if (!user) return json({ error: { code: "NOT_FOUND", message: "Account not found." } }, 404);

  setUserSession(ctx, user.id);
  // fire-and-forget: welcome email + audience add shouldn't block the response
  void sendWelcome(user.email, user.name ?? undefined);
  void addToAudience(user.email, user.name ?? undefined);

  return json({ ok: true, user: { email: user.email, name: user.name } }, 200);
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
