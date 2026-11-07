// POST /api/payments/webhook — PayU server-to-server backstop.
// Fires independently of the browser redirect; same reverse-hash verification
// and the same idempotent grant, so SURL + webhook can both hit without
// double-crediting. Responds 200 so PayU stops retrying.
import type { APIRoute } from "astro";
import { verifyPayuCallback, PLANS, type PayuCallback } from "@/lib/payu";
import { grantPlan } from "@/lib/session";
import { query, ensureSchema } from "@/lib/db";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  await ensureSchema();
  let cb: PayuCallback;
  try {
    const form = await ctx.request.formData();
    cb = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])) as PayuCallback;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  if (!verifyPayuCallback(cb)) return new Response("invalid signature", { status: 401 });

  const txnid = cb.txnid ?? "";
  const plan = PLANS[(cb.udf1 ?? "") as keyof typeof PLANS];
  const ownerId = cb.udf2 ?? "";
  if (!txnid || !plan || !ownerId) return new Response("bad payload", { status: 400 });
  if ((cb.status ?? "").toLowerCase() !== "success") return new Response("ignored", { status: 200 });
  const paid = Number(cb.amount ?? "0");
  if (Math.abs(paid - plan.amountRupees) > 0.001) return new Response("amount mismatch", { status: 400 });

  const rows = await query<{ status: string; owner_id: string }>(
    "SELECT status, owner_id FROM purchases WHERE id=$1",
    [txnid],
  );
  const row = rows[0] ?? (await query<{ status: string; owner_id: string }>(
    "INSERT INTO purchases (id, owner_id, plan_code, amount, status) VALUES ($1,$2,$3,$4,'initiated') ON CONFLICT (id) DO UPDATE SET updated_at = now() RETURNING status, owner_id",
    [txnid, ownerId, plan.code, plan.amountRupees],
  ))[0];

  if (!row) return new Response("not found", { status: 404 });
  if (row.owner_id !== ownerId) return new Response("owner mismatch", { status: 400 });
  if (row.status === "success") return new Response("already granted", { status: 200 });

  await query(
    "UPDATE purchases SET status='success', payu_mihpayid=$2, payu_mode=$3, email=$4, updated_at=now() WHERE id=$1",
    [txnid, cb.mihpayid ?? null, cb.mode ?? cb.bankcode ?? null, cb.email ?? null],
  );
  await grantPlan(ownerId, plan.code);

  return new Response("ok", { status: 200 });
};
