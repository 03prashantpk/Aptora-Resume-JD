// Server-only auth: password hashing (scrypt), email-domain allowlist, OTP codes,
// and the anonymous->user session upgrade. Never trust client-supplied identity.
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import type { APIContext } from "astro";
import { query } from "./db";

const COOKIE = "aptora_sid";

// Reputable consumer + work domains we accept. Anything else is prompted with the list.
export const ALLOWED_DOMAINS = [
  "gmail.com", "googlemail.com",
  "icloud.com", "me.com", "mac.com", // Apple
  "outlook.com", "hotmail.com", "live.com", "msn.com", // Microsoft
  "yahoo.com", "yahoo.co.in", "ymail.com",
  "proton.me", "protonmail.com",
];

export function emailDomainAllowed(email: string): boolean {
  const d = email.trim().toLowerCase().split("@")[1] ?? "";
  return ALLOWED_DOMAINS.includes(d);
}

// A short, human-friendly allowlist summary for the prompt/toast.
export const ALLOWED_SUMMARY = "Gmail, iCloud, Outlook/Hotmail, Yahoo or Proton";

// ---- Password hashing (scrypt; format "salt:hash", both hex) ----
export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(pw, salt, 64);
  const known = Buffer.from(hash, "hex");
  return test.length === known.length && timingSafeEqual(test, known);
}

// ---- OTP codes (6 digits; stored hashed) ----
export function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

// ---- Users ----
export interface UserRow { id: string; email: string; name: string | null; password_hash: string; verified: boolean }

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const rows = await query<UserRow>(
    "SELECT id, email, name, password_hash, verified FROM users WHERE email=$1",
    [email.trim().toLowerCase()],
  );
  return rows[0] ?? null;
}

export async function createUser(email: string, name: string, passwordHash: string): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO users (id, email, name, password_hash, verified) VALUES ($1,$2,$3,$4,false)
     ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash`,
    [id, email.trim().toLowerCase(), name, passwordHash],
  );
  const u = await findUserByEmail(email);
  return u?.id ?? id;
}

export async function markVerified(email: string): Promise<void> {
  await query("UPDATE users SET verified=true WHERE email=$1", [email.trim().toLowerCase()]);
}

// ---- OTP storage ----
export async function storeOtp(email: string, code: string, purpose = "signup"): Promise<void> {
  await query(
    `INSERT INTO email_verifications (email, code_hash, purpose, attempts, expires_at)
     VALUES ($1,$2,$3,0, now() + interval '15 minutes')
     ON CONFLICT (email) DO UPDATE SET code_hash=EXCLUDED.code_hash, purpose=EXCLUDED.purpose,
       attempts=0, created_at=now(), expires_at=now() + interval '15 minutes'`,
    [email.trim().toLowerCase(), hashCode(code), purpose],
  );
}

export type OtpResult = "ok" | "invalid" | "expired" | "too_many";

export async function checkOtp(email: string, code: string): Promise<OtpResult> {
  const e = email.trim().toLowerCase();
  const rows = await query<{ code_hash: string; attempts: number; expired: boolean }>(
    "SELECT code_hash, attempts, (expires_at <= now()) AS expired FROM email_verifications WHERE email=$1",
    [e],
  );
  const row = rows[0];
  if (!row) return "invalid";
  if (row.expired) return "expired";
  if (row.attempts >= 5) return "too_many";
  if (row.code_hash !== hashCode(code)) {
    await query("UPDATE email_verifications SET attempts = attempts + 1 WHERE email=$1", [e]);
    return "invalid";
  }
  await query("DELETE FROM email_verifications WHERE email=$1", [e]); // one-time use
  return "ok";
}

// ---- Session ----
/** Upgrade the current session cookie to a logged-in user identity. */
export function setUserSession(ctx: APIContext, userId: string): void {
  ctx.cookies.set(COOKIE, `user:${userId}`, {
    httpOnly: true, secure: false, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
}

/** Current logged-in user id, or null if the session is anonymous. */
export function currentUserId(ctx: APIContext): string | null {
  const sid = ctx.cookies.get(COOKIE)?.value ?? "";
  return sid.startsWith("user:") ? sid.slice(5) : null;
}

/** Drop back to a fresh anonymous session on logout. */
export function clearUserSession(ctx: APIContext): void {
  ctx.cookies.set(COOKIE, randomUUID(), {
    httpOnly: true, secure: false, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
}
