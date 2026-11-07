// PayU payment integration (India). Server-only.
// Flow: /api/payments/init builds the form params + SHA-512 request hash → the browser
// POSTs them to PayU's gateway → PayU POSTs the result to our SURL (verify + grant
// credits, then bounce the user to a thank-you URL) and calls the webhook (server-to-
// server, same reverse-hash verification) as a durable backstop.
//
// Env: PAYU_MERCHANT_KEY | PAYU_MERCHANT_SALT | PAYU_MODE ("test"|"live", default test).
// Test-mode credentials flip to live with zero code change.
import { createHash, randomUUID } from "node:crypto";

// Env (matches web/.env layout):
//   PAYU_MODE            "test" | "live" (default test)
//   PAYU_TEST_KEY / PAYU_TEST_SALT   for test.payu.in sandbox (or PAYU_MERCHANT_KEY/SALT)
//   PAYU_LIVE_KEY / PAYU_LIVE_SALT   for secure.payu.in production
// The gateway base URL and the key/salt pair BOTH follow the mode — no code change to flip.
const envVal = (...names: string[]): string => {
  for (const n of names) {
    const v = process.env[n] ?? (import.meta.env as Record<string, string | undefined>)[n];
    if (v) return v;
  }
  return "";
};

export const PAYU_MODE = (): "test" | "live" => (envVal("PAYU_MODE").toLowerCase() === "live" ? "live" : "test");

export const PAYU_BASE = (): string =>
  (PAYU_MODE() === "live" ? "https://secure.payu.in" : "https://test.payu.in") + "/_payment";

function creds(): { key: string; salt: string } {
  const live = PAYU_MODE() === "live";
  const key = envVal(live ? "PAYU_LIVE_KEY" : "PAYU_TEST_KEY", "PAYU_MERCHANT_KEY", "PAYU_KEY");
  const salt = envVal(live ? "PAYU_LIVE_SALT" : "PAYU_TEST_SALT", "PAYU_MERCHANT_SALT", "PAYU_SALT");
  return { key, salt };
}

export function payuConfigured(): boolean {
  const { key, salt } = creds();
  return !!key && !!salt;
}

export interface PayuPlan {
  code: "TOPUP" | "PRO";
  name: string;
  amountRupees: number;
  credits: number;
}

function envNumber(names: string[], fallback: number): number {
  const raw = envVal(...names);
  const n = Number(raw);
  return raw !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
}

/** PRICING (env-driven so the merchant can change it any time without a deploy of code):
 *   PRICING_TOPUP_INR / PRICING_TOPUP_CREDITS  — top-up plan price + credits granted
 *   PRICING_PRO_INR    / PRICING_PRO_CREDITS   — Pro plan price + credits granted
 * Defaults are the current promo pricing (₹1 / 12 credits, ₹3 / 100 credits). */
export const PLANS: Record<PayuPlan["code"], PayuPlan> = {
  TOPUP: {
    code: "TOPUP",
    name: "Credit top-up",
    amountRupees: envNumber(["PRICING_TOPUP_INR"], 1),
    credits: Math.round(envNumber(["PRICING_TOPUP_CREDITS"], 12)),
  },
  PRO: {
    code: "PRO",
    name: "Pro (1 year)",
    amountRupees: envNumber(["PRICING_PRO_INR"], 3),
    credits: Math.round(envNumber(["PRICING_PRO_CREDITS"], 100)),
  },
};

function sha512(s: string): string {
  return createHash("sha512").update(s).digest("hex");
}

export function newTxnId(): string {
  return `APT${Date.now()}${randomUUID().replace(/\D/g, "").slice(0, 6)}`;
}

/** Public origin used to build absolute surl/furl. Resolution order:
 *  1. PAYU_SITE_URL env (recommended on Vercel — the deployment's public URL)
 *  2. PUBLIC_HOST + PUBLIC_PROTO env (behind a proxy)
 *  3. the request's own origin (works when the site is public at that origin). */
export function siteOrigin(reqOrigin: string): string {
  const site = envVal("PAYU_SITE_URL");
  if (site) return site.replace(/\/+$/, "");
  const host = envVal("PUBLIC_HOST");
  if (host) {
    const proto = envVal("PUBLIC_PROTO") || "https";
    return `${proto}://${host}`;
  }
  return reqOrigin.replace(/\/+$/, "");
}

/** Absolute surl/furl for the transaction POST. Both must be PUBLIC and reachable —
 *  PayU POSTs the transaction response there from the customer's redirect flow.
 *  Override at the env level with PAYU_SURL / PAYU_FURL if ever needed. */
export function callbackUrls(origin: string): { surl: string; furl: string } {
  return {
    surl: envVal("PAYU_SURL") || `${origin}/api/payments/surl`,
    furl: envVal("PAYU_FURL") || `${origin}/api/payments/furl`,
  };
}

/** Build the gateway form. MANDATORY request parameters per PayU docs
 *  (https://docs.payu.in/reference/_payment_merchant_hosted — key, txnid, amount,
 *  productinfo, firstname, email, phone, surl, furl, hash):
 *
 *  Request-hash sequence (phone/surl/furl are NOT part of it):
 *    sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt)
 *
 *  udf1 = plan code, udf2 = owner id (echoed back on the callback for reconciliation). */
export function buildPayuParams(o: {
  plan: PayuPlan; ownerId: string; txnid: string;
  firstname: string; email: string; phone: string;
  surl: string; furl: string;
}): Record<string, string> {
  const { key, salt } = creds();
  // Amount is formatted to ONE decimal ("1.0", "299.0") — the same proven format
  // the live enally.tech integration uses; the SAME string goes into the hash and
  // the posted form (PayU validates the hash against the posted amount verbatim).
  const amount = o.plan.amountRupees.toFixed(1);
  const productinfo = `Aptora ${o.plan.name}`;
  const firstname = o.firstname || "Aptora User";
  const email = o.email || "billing@example.com";
  const phone = o.phone || "9999999999";
  const udf1 = o.plan.code;      // plan code
  const udf2 = o.ownerId;        // opaque owner id (granted on return/webhook)
  const udf3 = "udf3"; const udf4 = "udf4"; const udf5 = "udf5";
  const hash = sha512([
    key, o.txnid, amount, productinfo, firstname, email,
    udf1, udf2, udf3, udf4, udf5,
    "", "", "", "", "", "",           // udf6..udf10 empty + 2 reserved slots
  ].join("|") + salt);
  return {
    key, txnid: o.txnid, amount, productinfo,
    firstname, email,
    phone,                            // mandatory, pre-payu error "phone is required"
    surl: o.surl,                     // mandatory — PayU POSTs the SUCCESS response here
    furl: o.furl,                     // mandatory — PayU POSTs the FAILURE response here
    udf1, udf2, udf3, udf4, udf5,
    hash,
  };
}

export interface PayuCallback {  status?: string;        // "success" | "failure" | ("cancelled" in webhooks)
  txnid?: string;
  amount?: string;
  mihpayid?: string;
  error_description_MES?: string;
  mode?: string;          // gateway mode e.g. "CC"|"UPI"|"NB"
  bankcode?: string;
  email?: string;
  firstname?: string;
  productinfo?: string;
  udf1?: string; udf2?: string; udf3?: string; udf4?: string; udf5?: string; udf6?: string;
  udf7?: string; udf8?: string; udf9?: string; udf10?: string;
  hash?: string;
}

/** Reverse-hash verification of PayU's response (SURL / FURL / webhook share semantics):
 *  SHA-512(salt|status|udf10...udf6(empty)|udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key) */
export function verifyPayuCallback(cb: PayuCallback): boolean {
  const { key, salt } = creds();
  if (!key || !salt || !cb?.hash || !cb?.txnid) return false;
  const hashStr = [
    salt,
    cb.status ?? "",
    cb.udf10 ?? "", cb.udf9 ?? "", cb.udf8 ?? "", cb.udf7 ?? "", cb.udf6 ?? "",
    cb.udf5 ?? "", cb.udf4 ?? "", cb.udf3 ?? "", cb.udf2 ?? "", cb.udf1 ?? "",
    cb.email ?? "", cb.firstname ?? "", cb.productinfo ?? "",
    cb.amount ?? "", cb.txnid ?? "",
    key,
  ].join("|");
  const got = cb.hash.toLowerCase().trim();
  const want = sha512(hashStr);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

// ── Verify API (postservice.php?form=2) ──────────────────────────────────────
// Server-side status check for transactions whose browser redirect was dropped
// (user closed the tab, network died, webhook missed) leaving the row stuck at
// 'initiated'. Hash: sha512(key|command|var1|salt), command = verify_payment.
// Mirrors the proven live PHP integration (enally.tech backend/payment/PayU.php).

const PAYU_VERIFY_BASE = (): string =>
  (PAYU_MODE() === "live"
    ? "https://info.payu.in/merchant/postservice.php?form=2"
    : "https://test.payu.in/merchant/postservice.php?form=2")

export interface PayuVerifyDetails {
  txnid?: string;
  status?: string;      // "success" | "failure" | "pending" | "Not Found"
  amount?: string;      // string rupees, e.g. "1.00"
  mihpayid?: string;
  mode?: string;
  bank_ref_num?: string;
  error_MES?: string;
}

/** Ask PayU for the real status of OUR txnid. Returns null if unreachable/unknown. */
export async function verifyPaymentStatus(txnid: string): Promise<PayuVerifyDetails | null> {
  const { key, salt } = creds();
  if (!key || !salt || !txnid || !/^[A-Za-z0-9\-]{6,64}$/.test(txnid)) return null;
  const hash = sha512([key, "verify_payment", txnid, salt].join("|"));
  const body = new URLSearchParams({ key, command: "verify_payment", var1: txnid, hash });
  let res: Response;
  try {
    res = await fetch(PAYU_VERIFY_BASE(), {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let data: { status?: number; transaction_details?: Record<string, PayuVerifyDetails> };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return null;
  }
  if (!data || Number(data.status) !== 1) return null;
  const details = data.transaction_details?.[txnid];
  if (!details || !details.status || details.status === "Not Found") return null;
  return details;
}
