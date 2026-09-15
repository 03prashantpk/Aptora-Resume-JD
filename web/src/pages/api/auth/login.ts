// POST /api/auth/login { email, password }
import type { APIRoute } from "astro";
import { findUserByEmail, verifyPassword, setUserSession } from "@/lib/auth";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  let body: unknown;
  try { body = await ctx.request.json(); } catch { return json({ error: { code: "BAD_REQUEST", message: "invalid body" } }, 400); }
  const { email, password } = (body ?? {}) as { email?: string; password?: string };
  if (typeof email !== "string" || typeof password !== "string") {
    return json({ error: { code: "BAD_REQUEST", message: "Email and password are required." } }, 400);
  }

  const user = await findUserByEmail(email);
  // Same generic message whether the email or password is wrong (no account enumeration).
  if (!user || !verifyPassword(password, user.password_hash)) {
    return json({ error: { code: "BAD_CREDENTIALS", message: "Incorrect email or password." } }, 401);
  }
  if (!user.verified) {
    return json({ error: { code: "NOT_VERIFIED", message: "Please verify your email first.", email: user.email } }, 403);
  }

  setUserSession(ctx, user.id);
  return json({ ok: true, user: { email: user.email, name: user.name } }, 200);
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
