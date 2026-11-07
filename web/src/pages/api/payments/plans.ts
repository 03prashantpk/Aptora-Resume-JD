// GET /api/payments/plans — public plan metadata for client UIs (PricingModal, home
// cards). Prices/credits come from the env-driven PLANS table (PRICING_* in web/.env),
// so UIs and the checkout can never disagree about what a plan costs.
import type { APIRoute } from "astro";
import { PLANS, payuConfigured } from "@/lib/payu";

export const prerender = false;

export const GET: APIRoute = () =>
  new Response(JSON.stringify({
    // `configured` tells the UI whether checkout is wired (env creds present);
    // when false the UI shows the free BYOK path instead of a dead buy button.
    configured: payuConfigured(),
    TOPUP: { inr: PLANS.TOPUP.amountRupees, credits: PLANS.TOPUP.credits },
    PRO: { inr: PLANS.PRO.amountRupees, credits: PLANS.PRO.credits },
  }), { status: 200, headers: { "content-type": "application/json" } });
