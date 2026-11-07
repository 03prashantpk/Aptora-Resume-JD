// POST /api/payments/init — build a PayU checkout session.
// Body: { plan: "TOPUP" | "PRO" }. Returns the gateway URL + pre-hashed form params;
// the browser posts them to PayU (standard redirect/hidden-form flow). PayU then
// posts the result to /api/payments/surl and (optionally) /api/payments/webhook.
import type { APIRoute } from "astro";
import { getOwnerId, getCreditState } from "@/lib/session";
import { payuConfigured, PLANS, buildPayuParams, newTxnId, PAYU_BASE, siteOrigin, callbackUrls } from "@/lib/payu";
import { query, ensureSchema } from "@/lib/db";
import { currentUserId } from "@/lib/auth";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  if (!payuConfigured()) {
    return new Response(JSON.stringify({ error: "Checkout isn't set up for this site yet. You can keep working with a free API key connected under Usage → Your API key." }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  await ensureSchema();

  const userId = currentUserId(ctx);
  const ownerId = await getOwnerId(ctx);
  let body: { plan?: string; name?: string; email?: string; phone?: string };
  try {
    body = (await ctx.request.json()) as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body." }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  }

  const plan = PLANS[(body.plan ?? "") as keyof typeof PLANS];
  if (!plan) {
    return new Response(JSON.stringify({ error: "Unknown plan." }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  }

  // Pro is not purchasable twice while active.
  const credit = await getCreditState(ownerId);
  if (plan.code === "PRO" && credit.isPro) {
    return new Response(JSON.stringify({ error: "You're already Pro. Enjoy it!" }), {
      status: 409, headers: { "content-type": "application/json" },
    });
  }

  // Absolute public URLs for PayU's redirect flow (mandatory surl/furl). PayU cannot
  // reach localhost — public site URL env wins when set.
  const origin = siteOrigin(ctx.url.origin);
  const { surl, furl } = callbackUrls(origin);

  const txnid = newTxnId();
  const params = buildPayuParams({
    plan, ownerId,
    txnid,
    // Logged-in users get real billing fields; anonymous sessions get placeholders
    // (PayU requires non-empty firstname/email/phone for the hash sequence).
    firstname: userId ? (body.name?.trim() || "Aptora User") : "Aptora User",
    email: userId ? (body.email?.trim() || "billing@example.com") : "billing@example.com",
    phone: userId ? (body.phone?.trim() || "9999999999") : "9999999999",
    surl, furl,
  });

  // Record the intent BEFORE redirecting — SURL/webhook reconcile against this row.
  try {
    await query(
      "INSERT INTO purchases (id, owner_id, plan_code, amount, status) VALUES ($1,$2,$3,$4,'initiated')",
      [txnid, ownerId, plan.code, plan.amountRupees],
    );
  } catch {
    // DB down: the transaction can still complete (webhook/surl verify on their own),
    // but without the row we cannot reconcile later — surface the failure.
    return new Response(JSON.stringify({ error: "Could not start checkout. Please try again." }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ gatewayUrl: PAYU_BASE(), txnid, params }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
