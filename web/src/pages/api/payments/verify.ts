// GET /api/payments/verify?txnid=<one> — reconcile ONE purchase row against PayU's
// server-side verify_payment API. Purpose: a user whose browser never came back from
// the gateway (closed tab, network drop) is left with a row stuck at 'initiated' and
// no credits. This route asks PayU for the truth and grants idempotently if PayU
// actually completed the charge. Owner-gated: only the purchasing owner may call it.
// (Mirrors the proven enally.tech healer: backend/scripts/fix-payments.php.)
import type { APIRoute } from "astro";
import { getOwnerId } from "@/lib/session";
import { verifyPaymentStatus, PLANS } from "@/lib/payu";
import { query, ensureSchema } from "@/lib/db";
import { grantVerifiedSuccess } from "./webhook";

export const prerender = false;

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

export const GET: APIRoute = async (ctx) => {
  await ensureSchema();
  const txnid = ctx.url.searchParams.get("txnid") ?? "";
  if (!/^[A-Za-z0-9\-]{6,64}$/.test(txnid)) return json(400, { error: "Bad txnid." });

  const rows = await query<{
    id: string; owner_id: string; plan_code: string; amount: number; status: string; payu_mihpayid: string | null;
  }>("SELECT id, owner_id, plan_code, amount, status, payu_mihpayid FROM purchases WHERE id=$1", [txnid]);
  const row = rows[0];
  if (!row) return json(404, { error: "Transaction not found." });

  const ownerId = await getOwnerId(ctx);
  if (row.owner_id !== ownerId) return json(403, { error: "This transaction belongs to another session." });

  // Already settled — nothing to do, tell the truth.
  if (row.status === "success" || row.status === "refunded" || row.status === "disputed") {
    return json(200, { txnid, purchaseStatus: row.status, reconciled: false, payuStatus: row.status });
  }

  const details = await verifyPaymentStatus(txnid);
  if (!details) {
    return json(200, {
      txnid,
      purchaseStatus: row.status,
      reconciled: false,
      payuStatus: null,
      note: "PayU has no final status for this transaction yet. If you paid, wait a few minutes and check again — the webhook records it automatically.",
    });
  }

  const payuStatus = (details.status ?? "").toLowerCase();
  const plan = PLANS[row.plan_code as keyof typeof PLANS];
  const amountOk = !!plan && Math.abs(Number(details.amount ?? "0") - Number(row.amount)) <= 0.001;

  if (payuStatus === "success" && amountOk && row.status !== "success") {
    const granted = await grantVerifiedSuccess(txnid, row.plan_code, row.owner_id, {
      txnid,
      amount: details.amount,
      status: "success",
      mihpayid: details.mihpayid,
      mode: details.mode,
    });
    return json(200, { txnid, purchaseStatus: granted ? "success" : row.status, reconciled: granted, payuStatus });
  }

  // PayU says failure/cancelled/dropped → close it out (webhook already handles pending).
  if (["failure", "failed", "usercancelled", "cancelled", "dropped", "blocked", "auth"].includes(payuStatus)) {
    await query("UPDATE purchases SET status='failed', payu_mihpayid=$2, updated_at=now() WHERE id=$1 AND status='initiated'", [txnid, details.mihpayid ?? null])
      .catch(() => undefined);
    return json(200, { txnid, purchaseStatus: "failed", reconciled: true, payuStatus });
  }

  return json(200, { txnid, purchaseStatus: row.status, reconciled: false, payuStatus });
};
