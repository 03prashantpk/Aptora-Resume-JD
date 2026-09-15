// Transactional email via Resend (REST, no SDK dependency). Server-only: the API key
// is read from env and NEVER shipped to the client. Sends use the published Resend
// TEMPLATES (managed in the dashboard) with {{{VARIABLE}}} substitution, so the email
// design lives in Resend, not in code. Every send is best-effort — if the key is
// missing or Resend errors, we resolve false and never throw.
const env = (k: string): string | undefined =>
  process.env[k] ?? (import.meta.env as Record<string, string>)[k];

const RESEND_API_KEY = env("RESEND_API_KEY");
const RESEND_FROM = env("RESEND_FROM") ?? "Aptora <no-reply@aptora.enally.in>";
const RESEND_AUDIENCE_ID = env("RESEND_AUDIENCE_ID");
const TPL_OTP = env("RESEND_TPL_OTP");
const TPL_WELCOME = env("RESEND_TPL_WELCOME");
const TPL_CONTACT_ACK = env("RESEND_TPL_CONTACT_ACK");

const API = "https://api.resend.com";

async function post(path: string, body: unknown): Promise<boolean> {
  if (!RESEND_API_KEY) return false; // no provider configured -> graceful no-op
  try {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Send using a published Resend template + variables. */
async function sendTemplate(templateId: string | undefined, to: string, variables: Record<string, string>): Promise<boolean> {
  if (!templateId) return false;
  return post("/emails", { from: RESEND_FROM, to: [to], template: { id: templateId, variables } });
}

/** Send a raw-HTML email (used for the internal contact notification, no template). */
export async function sendHtml(to: string, subject: string, html: string, replyTo?: string): Promise<boolean> {
  return post("/emails", { from: RESEND_FROM, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) });
}

// ---- Specific transactional emails --------------------------------------
export function sendOtp(to: string, code: string, name?: string): Promise<boolean> {
  return sendTemplate(TPL_OTP, to, { CODE: code, NAME: name || "there" });
}

export function sendWelcome(to: string, name?: string): Promise<boolean> {
  return sendTemplate(TPL_WELCOME, to, { NAME: name || "there" });
}

export function sendContactAck(to: string, name: string, message: string): Promise<boolean> {
  return sendTemplate(TPL_CONTACT_ACK, to, { NAME: name || "there", MESSAGE: message });
}

/** Add a contact to the Resend audience (best-effort). */
export async function addToAudience(email: string, firstName?: string): Promise<void> {
  if (!RESEND_API_KEY || !RESEND_AUDIENCE_ID) return;
  await post(`/audiences/${RESEND_AUDIENCE_ID}/contacts`, { email, first_name: firstName ?? "", unsubscribed: false });
}
