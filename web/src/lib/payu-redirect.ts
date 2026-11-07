// Shared handling of PayU's browser-redirect callbacks (surl + furl).
// Per PayU docs PayU POSTs the transaction result (form-urlencoded) to surl on
// success and to furl on failure/cancellation. Both endpoints MUST:
//   1. verify the reverse hash (only PayU's response is trusted),
//   2. keep `purchases` reconciled (idempotent grant exactly once),
//   3. bounce the user to a branded, server-rendered status page.
// The GRANT never happens on the status pages — those are pure UI.
import type { PayuCallback } from "./payu";
import { PLANS, verifyPayuCallback } from "./payu";
import { grantPlan } from "./session";
import { query, ensureSchema } from "./db";

export type RedirectPage = "success" | "failed";

/** Outcome routing: returns the branded page to 303 the user to.
 *  - "success": PayU-declared success + amount agreement + grant completed
 *               (or already granted — SURL, FURL and the webhook are idempotent).
 *  - "failed" : failure/cancel/pending/invalid — nothing was charged or granted.
 */
export async function handlePayuRedirect(cb: PayuCallback): Promise<RedirectPage> {
  // 0) Forged/tampered callback — no DB write at all. Only PayU's response (which only
  //    PayU can hash) is allowed to move a purchase row.
  if (!verifyPayuCallback(cb)) return "failed";

  const txnid = cb.txnid ?? "";
  const plan = PLANS[(cb.udf1 ?? "") as keyof typeof PLANS];
  const ownerId = cb.udf2 ?? "";
  if (!txnid || !plan || !ownerId) return "failed";

  await ensureSchema();

  // Reconcile against the intent row created at init time (owner must match — the udf2
  // echo from PayU is checked against the DB so a valid-hash replay for a foreign
  // owner can never grant to someone else's balance).
  const rows = await query<{ status: string; owner_id: string }>(
    "SELECT status, owner_id FROM purchases WHERE id=$1",
    [txnid],
  );
  const row = rows[0] ?? (await query<{ status: string; owner_id: string }>(
    "INSERT INTO purchases (id, owner_id, plan_code, amount, status) VALUES ($1,$2,$3,$4,'initiated') ON CONFLICT (id) DO UPDATE SET updated_at = now() RETURNING status, owner_id",
    [txnid, ownerId, plan.code, plan.amountRupees],
  ))[0];
  if (!row || row.owner_id !== ownerId) return "failed";

  const status = (cb.status ?? "").toLowerCase();
  const paid = Number(cb.amount ?? "0");
  const amountOk = Math.abs(paid - plan.amountRupees) <= 0.001;

  if (status === "success") {
    // Amount mismatch on a "success" is unreachable through PayU's own hash, but stay
    // strict — refuse anything that doesn't agree with the plan on record.
    if (!amountOk) return "failed";
    if (row.status === "success") return "success"; // already granted (idempotent)
    await query(
      "UPDATE purchases SET status='success', payu_mihpayid=$2, payu_mode=$3, email=$4, updated_at=now() WHERE id=$1 AND status<>'success'",
      [txnid, cb.mihpayid ?? null, cb.mode ?? cb.bankcode ?? null, cb.email ?? null],
    );
    await grantPlan(ownerId, plan.code);
    return "success";
  }

  // failure / cancellation / pending → record the terminal-or-waiting state and keep
  // the user out of "success" (the webhook is the durable backstop that can still
  // flip a late pending → success).
  if (!FAIL_REASONS.has(status)) return "failed"; // unknown status from PayU → console-free reject
  const reason = (cb.error_description_MES ?? "").slice(0, 200) || status || "failed";
  await query(
    "UPDATE purchases SET status='failed', payu_mihpayid=$2, payu_mode=$3, email=$4, updated_at=now() WHERE id=$1 AND status NOT IN ('success','failed')",
    [txnid, cb.mihpayid ?? null, cb.mode ?? cb.bankcode ?? null, cb.email ?? null],
  ).catch(() => undefined);
  return "failed";
}

const FAIL_REASONS = new Set([
  "", "failure", "failed", "usercancelled", "cancelled", "blocked", "auth",
  "dropped", "pending",
]);
