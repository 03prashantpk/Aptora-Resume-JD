// POST /api/payments/webhook — PayU server-to-server notifications.
// Handles ALL THREE event shapes the live PayU contract sends (mirrors the proven
// enally.tech integration):
//   1. Payment result (form-urlencoded, hash-verified) — success AND failure recording.
//   2. Refund events  (application/json, action:"refund") → status 'refunded'.
//   3. Dispute events (application/json, type:"payments"+event:"dispute") → 'disputed'.
// Every event answers 200 so PayU stops retrying. Grant logic is identical to the
// SURL path and idempotent (a status can only move to 'success' once).
import type { APIRoute } from "astro";
import { verifyPayuCallback, PLANS, type PayuCallback } from "@/lib/payu";
import { grantPlan } from "@/lib/session";
import { query, ensureSchema } from "@/lib/db";

export const prerender = false;

interface RefundEvent {
  action?: string;
  merchantTxnId?: string;
  amt?: string;
  status?: string;
  request_id?: string;
  bank_ref_num?: string;
  bank_arn?: string;
  remark?: string;
}
interface DisputeEvent {
  type?: string;
  event?: string;
  txn_id?: string;        // NOTE: PayU sends its OWN mihpayid here, not our txnid
  cb_id?: string;
  cb_amount?: string;
  cb_status?: string;
  due_date?: string;
  reason_code?: string;
}

const ok = (msg = "ok") => new Response(msg, { status: 200 });

/** Shared grant step (kept in one place so webhook and verify-API agree exactly). */
export async function grantVerifiedSuccess(
  txnid: string,
  planCode: string,
  ownerId: string,
  cb: PayuCallback,
): Promise<boolean> {
  const plan = PLANS[planCode as keyof typeof PLANS];
  if (!plan) return false;
  const rows = await query<{ status: string; owner_id: string }>(
    "SELECT status, owner_id FROM purchases WHERE id=$1", [txnid],
  );
  const row = rows[0] ?? (await query<{ status: string; owner_id: string }>(
    "INSERT INTO purchases (id, owner_id, plan_code, amount, status) VALUES ($1,$2,$3,$4,'initiated') ON CONFLICT (id) DO UPDATE SET updated_at = now() RETURNING status, owner_id",
    [txnid, ownerId, plan.code, plan.amountRupees],
  ))[0];
  if (!row || row.owner_id !== ownerId) return false;
  if (row.status === "success") return true; // already granted — idempotent
  await query(
    "UPDATE purchases SET status='success', payu_mihpayid=$2, payu_mode=$3, email=$4, updated_at=now() WHERE id=$1 AND status<>'success'",
    [txnid, cb.mihpayid ?? null, cb.mode ?? cb.bankcode ?? null, cb.email ?? null],
  );
  await grantPlan(ownerId, plan.code);
  return true;
}

export const POST: APIRoute = async (ctx) => {
  await ensureSchema();
  const isJson = (ctx.request.headers.get("content-type") ?? "").includes("application/json");

  // ── JSON events (refund / dispute) ───────────────────────────────────────
  if (isJson) {
    let payload: (RefundEvent & DisputeEvent) | null = null;
    try { payload = (await ctx.request.json()) as typeof payload; } catch { payload = null; }

    if (payload && (payload as RefundEvent).action === "refund") {
      const merchantTxnId = String((payload as RefundEvent).merchantTxnId ?? "");
      const succeeded = String((payload as RefundEvent).status ?? "").toLowerCase() === "success";
      const amt = Number((payload as RefundEvent).amt ?? "0");
      console.log(`[payu-webhook] refund txn=${merchantTxnId} status=${succeeded ? "success" : "failed"}`);
      if (merchantTxnId) {
        // Refunds don't revoke already-granted credits automatically — the row is
        // statused so Activity honesty shows it; admin decides any revoke manually.
        await query(
          `UPDATE purchases SET status = ${succeeded ? "'refunded'" : "status"}, refund_amt = $2, updated_at = now() WHERE id = $1 AND status <> 'refunded'`,
          [merchantTxnId, succeeded && Number.isFinite(amt) && amt > 0 ? amt : null],
        ).catch(() => undefined);
      }
      return ok();
    }

    if (payload && (payload as DisputeEvent).type === "payments" && (payload as DisputeEvent).event === "dispute") {
      const mihpayid = String((payload as DisputeEvent).txn_id ?? "");
      console.log(`[payu-webhook] dispute ref=${mihpayid} amount=${(payload as DisputeEvent).cb_amount} due=${(payload as DisputeEvent).due_date}`);
      if (mihpayid) {
        // Disputes reference PayU's mihpayid — find our row by that column.
        await query(
          "UPDATE purchases SET status='disputed', updated_at=now() WHERE payu_mihpayid=$1 AND status <> 'disputed'",
          [mihpayid],
        ).catch(() => undefined);
      }
      return ok();
    }
    return ok(); // unknown JSON shape — always 200 so PayU stops retrying
  }

  // ── Payment result (form-urlencoded, hash-verified) ──────────────────────
  let cb: PayuCallback;
  try {
    const form = await ctx.request.formData();
    cb = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])) as PayuCallback;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  if (!verifyPayuCallback(cb)) { console.log("[payu-webhook] payment event rejected: hash mismatch"); return new Response("invalid signature", { status: 401 }); }

  const txnid = cb.txnid ?? "";
  const planCode = cb.udf1 ?? "";
  const ownerId = cb.udf2 ?? "";
  if (!txnid || !planCode || !ownerId) return ok("bad payload");

  const status = (cb.status ?? "").toLowerCase();
  if (status !== "success") {
    // Record verified failures too (mirrors handlePayment in the reference) so a
    // browser-closed failure doesn't linger as 'initiated'.
    if (status !== "pending") {
      await query("UPDATE purchases SET status='failed', updated_at=now() WHERE id=$1 AND status='initiated'", [txnid])
        .catch(() => undefined);
    }
    console.log(`[payu-webhook] payment txn=${txnid} status=${status}`);
    return ok();
  }

  const granted = await grantVerifiedSuccess(txnid, planCode, ownerId, cb);
  console.log(`[payu-webhook] payment txn=${txnid} granted=${granted}`);
  return ok(granted ? "ok" : "not granted");
};
