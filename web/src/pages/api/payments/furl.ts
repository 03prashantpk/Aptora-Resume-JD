// POST /api/payments/furl — PayU's FAILURE URL (mandatory `_payment` parameter).
// PayU posts here when the transaction failed, was cancelled, or dropped. The shared
// handler verifies the reverse hash and reconciles `purchases` (marked failed), and
// the user lands on the branded /payment/failed page. On some gateway edge cases PayU
// can still report status=success on this URL — the handler grants in that case too.
import type { APIRoute } from "astro";
import { siteOrigin, type PayuCallback } from "@/lib/payu";
import { handlePayuRedirect } from "@/lib/payu-redirect";

export const prerender = false;

function back(origin: string, page: "success" | "failed"): Response {
  const target = page === "success" ? "/payment/success" : "/payment/failed";
  return new Response(null, { status: 303, headers: { Location: `${origin}${target}` } });
}

export const POST: APIRoute = async (ctx) => {
  const origin = siteOrigin(ctx.url.origin);
  let cb: PayuCallback | null = null;
  try {
    const form = await ctx.request.formData();
    cb = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])) as PayuCallback;
  } catch {
    return back(origin, "failed");
  }
  return back(origin, await handlePayuRedirect(cb));
};

export const GET: APIRoute = async (ctx) =>
  new Response(null, { status: 303, headers: { Location: `${siteOrigin(ctx.url.origin)}/payment/failed` } });
