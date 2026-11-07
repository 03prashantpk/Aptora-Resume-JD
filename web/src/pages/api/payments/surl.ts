// POST /api/payments/surl — PayU's SUCCESS URL (mandatory `_payment` parameter).
// PayU posts the transaction result here as form-urlencoded data. The shared handler
// verifies the reverse hash, grants credits/Pro exactly once, and the user is bounced
// to the branded status page (/payment/success or /payment/failed).
import type { APIRoute } from "astro";
import { siteOrigin, type PayuCallback } from "@/lib/payu";
import { handlePayuRedirect } from "@/lib/payu-redirect";

export const prerender = false;

// Status pages live on this site; the grant already happened server-side before the
// redirect — these pages are pure user-facing status, never trusted state.
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

// Defensive: PayU (or a user fiddling with URL history) may hit surl with GET.
// Never grant anything without the form POST — send them to the neutral status page.
export const GET: APIRoute = async (ctx) =>
  new Response(null, { status: 303, headers: { Location: `${siteOrigin(ctx.url.origin)}/payment/failed` } });
