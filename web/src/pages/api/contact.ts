// POST /api/contact { name, email, message }
// Stores the message and fires (best-effort) a confirmation email to the sender + an
// internal notification. Email failures never fail the request.
import type { APIRoute } from "astro";
import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { sendContactAck, sendHtml } from "@/lib/email";

export const prerender = false;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOTIFY_TO = process.env.CONTACT_NOTIFY_TO ?? (import.meta.env as Record<string, string>).CONTACT_NOTIFY_TO ?? "support@enally.in";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: { code: "BAD_REQUEST", message: "invalid body" } }, 400); }
  const { name, email, message } = (body ?? {}) as { name?: string; email?: string; message?: string };

  if (typeof email !== "string" || !EMAIL_RE.test(email)) return json({ error: { code: "BAD_EMAIL", message: "Please enter a valid email." } }, 400);
  if (typeof message !== "string" || message.trim().length < 10) return json({ error: { code: "SHORT_MESSAGE", message: "Please write a little more (10+ characters)." } }, 400);

  const cleanName = (typeof name === "string" ? name : "").trim().slice(0, 120);
  const cleanEmail = email.trim().toLowerCase();
  const cleanMsg = message.trim().slice(0, 5000);

  await query(
    "INSERT INTO contact_messages (id, name, email, message) VALUES ($1,$2,$3,$4)",
    [randomUUID(), cleanName || null, cleanEmail, cleanMsg],
  );

  // Fire-and-forget: acknowledge to the sender + notify the internal inbox.
  void sendContactAck(cleanEmail, cleanName || "there", esc(cleanMsg).replace(/\n/g, "<br>"));
  void sendHtml(
    NOTIFY_TO,
    `New contact message from ${cleanName || cleanEmail}`,
    `<p><strong>From:</strong> ${esc(cleanName)} &lt;${esc(cleanEmail)}&gt;</p><p>${esc(cleanMsg).replace(/\n/g, "<br>")}</p>`,
    cleanEmail,
  );

  return json({ ok: true }, 200);
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
