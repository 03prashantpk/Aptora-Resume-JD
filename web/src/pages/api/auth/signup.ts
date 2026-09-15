// POST /api/auth/signup { email, password, name }
// Validates the email domain against the allowlist, creates an UNVERIFIED user, and
// emails a 6-digit OTP. The account isn't logged in until /api/auth/verify succeeds.
import type { APIRoute } from "astro";
import { emailDomainAllowed, ALLOWED_SUMMARY, ALLOWED_DOMAINS, hashPassword, createUser, generateOtp, storeOtp, findUserByEmail } from "@/lib/auth";
import { sendOtp } from "@/lib/email";

export const prerender = false;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: { code: "BAD_REQUEST", message: "invalid body" } }, 400); }
  const { email, password, name } = (body ?? {}) as { email?: string; password?: string; name?: string };

  if (typeof email !== "string" || !EMAIL_RE.test(email)) return json({ error: { code: "BAD_EMAIL", message: "Enter a valid email address." } }, 400);
  if (typeof password !== "string" || password.length < 8) return json({ error: { code: "WEAK_PASSWORD", message: "Password must be at least 8 characters." } }, 400);

  if (!emailDomainAllowed(email)) {
    return json({
      error: {
        code: "DOMAIN_NOT_ALLOWED",
        message: `To keep accounts trustworthy and cut spam, we currently accept ${ALLOWED_SUMMARY} addresses. Please sign up with one of those.`,
        allowed: ALLOWED_DOMAINS,
      },
    }, 422);
  }

  const existing = await findUserByEmail(email);
  if (existing?.verified) return json({ error: { code: "EMAIL_TAKEN", message: "An account with this email already exists. Try signing in." } }, 409);

  await createUser(email, (name ?? "").trim() || email.split("@")[0], hashPassword(password));
  const code = generateOtp();
  await storeOtp(email, code, "signup");
  await sendOtp(email, code, name);

  return json({ ok: true, step: "verify", email: email.trim().toLowerCase() }, 200);
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
