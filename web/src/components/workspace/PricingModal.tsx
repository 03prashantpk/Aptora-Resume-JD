// Pricing modal - one-time purchases (credits / Pro), priced LIVE from
// /api/payments/plans so the UI can never drift from checkout. Design rules:
// black/white + single blue accent, no decorative icons, no payment-gateway
// branding inside the product (buttons say what you GET, not who processes it).
// Guests may pay right away; purchases attach to the browser session and migrate
// to their account automatically on sign-in (transferOwnership).
import { useEffect, useState } from "react";
import { CircleCheck, LogIn, KeyRound, Sparkles } from "lucide-motion";
import { startCheckout, type PlanCode } from "@/lib/payments-client";

interface PlansPayload {
  configured: boolean;
  TOPUP?: { inr: number; credits: number };
  PRO?: { inr: number; credits: number };
}
interface UsageSnap {
  role: "guest" | "user";
  isPro: boolean;
  credits: number;
}

function fmt(n: number): string {
  // ₹1 → "₹1", ₹10.5 → "₹10.5", ₹100 → "₹100"
  return `₹${Number.isInteger(n) ? String(n) : String(n).replace(/0+$/, "").replace(/\.$/, "")}`;
}

interface PlanCard { code: PlanCode; name: string; price: string; tag: string; perks: string[]; primary?: boolean }

function buildPlans(meta: Partial<PlansPayload> | null): PlanCard[] {
  const topup = meta?.TOPUP ?? { inr: 1, credits: 12 };
  const pro = meta?.PRO ?? { inr: 3, credits: 100 };
  return [
    {
      code: "TOPUP",
      name: "Credit top-up",
      price: fmt(topup.inr),
      tag: `${topup.credits} credits`,
      perks: [
        `${topup.credits} runs & exports`,
        "Never expire",
        "Every template",
      ],
    },
    {
      code: "PRO",
      name: "Aptora Pro",
      price: fmt(pro.inr),
      tag: "/ year",
      primary: true,
      perks: [
        `${pro.credits} credits / year`,
        "No daily limit",
        "All premium exports",
      ],
    },
  ];
}

export default function PricingModal({ onClose, onOpenAuth }: { onClose: () => void; onOpenAuth?: (mode: "login" | "signup") => void }) {
  const [plans, setPlans] = useState<PlanCard[]>(() => buildPlans(null));
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<UsageSnap | null>(null);
  const [busy, setBusy] = useState<PlanCode | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live prices + live account state on every open (the modal remounts when opened).
  useEffect(() => {
    let alive = true;
    fetch("/api/payments/plans")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j) {
          setPlans(buildPlans(j));
          setConfigured(j.configured !== false);
        }
      })
      .catch(() => undefined);
    fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j) setUsage({ role: j.role, isPro: !!j.isPro, credits: Math.max(0, j.credits ?? 0) });
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const isGuest = usage?.role === "guest";
  const isPro = !!usage?.isPro;

  const buy = async (plan: PlanCode) => {
    setError(null);
    setBusy(plan);
    try {
      // PayU POSTs back to the same origin; the session cookie survives the
      // round-trip, so guest purchases land on the same browser identity
      // and are inherited by the account on sign-in.
      await startCheckout(plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed. Please try again.");
      setBusy(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal pricing-modal pricing2" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>✕</button>

        <div className="pricing-head">
          <p className="pricing-eyebrow">Pricing</p>
          <h2>{isPro ? "You're on Pro" : "Keep your workspace going"}</h2>
          <p className="muted">One-time payments. No subscriptions, no auto-billing - credits stay yours.</p>
          {usage && (
            <div className="pricing-status-row">
              <span className={`pricing-planpill${isPro ? " pro" : ""}`}>{isPro ? "Pro active" : usage.role === "user" ? "Free plan" : "Guest"}</span>
              {usage.credits > 0 && !isPro && <span className="pricing-statusdim">{usage.credits} paid credit{usage.credits === 1 ? "" : "s"} on hand</span>}
            </div>
          )}
        </div>

        {isPro ? (
          <div className="pricing-pro-note">
            <div>
              <strong>Your Pro plan is active.</strong>
              <p>Unlimited daily runs - nothing further to buy. Payment history lives in Activity.</p>
            </div>
          </div>
        ) : configured === false ? (
          // Checkout isn't wired on this deployment - show the free path instead
          // of a dead button that 503s on click.
          <div className="pricing-unconfigured">
            <p><strong>Checkout is being set up.</strong> Online payments will be live shortly - in the meantime your work isn't blocked.</p>
            <p className="pricing-unconfigured-alt">
              <KeyRound size={14} /> Connect a free API key from{" "}
              <a href="https://build.nvidia.com/settings/api-keys" target="_blank" rel="noreferrer">build.nvidia.com</a>{" "}
              and keep tailoring on your own key today (Usage → Your API key).
            </p>
          </div>
        ) : (
          <div className="u2-plans pricing2-plans">
            {plans.map((p) => (
              <article key={p.code} className={`u2-plan${p.primary ? " featured" : ""}`}>
                {p.primary && <span className="u2-plan-ribbon">BEST VALUE</span>}
                <span className={`u2-plan-tex ${p.primary ? "blue" : "green"}`} aria-hidden="true" />
                <header className="u2-plan-head">
                  <span className={`u2-plan-kicker${p.primary ? " pro" : ""}`}>{p.primary && <Sparkles size={12} />}{p.name}</span>
                  <div className="u2-plan-price"><span className="u2-price">{p.price}</span><span className="u2-price-sub">{p.tag}</span></div>
                </header>
                <ul className="u2-feats">
                  {p.perks.map((perk) => <li key={perk}><CircleCheck size={14} />{perk}</li>)}
                </ul>
                <button type="button" className={`u2-plan-cta ${p.primary ? "buy" : "buy"}`} disabled={busy !== null} onClick={() => buy(p.code)}>
                  {busy === p.code ? "Starting checkout…" : busy ? "One moment…" : p.code === "TOPUP" ? `Get ${p.tag.toLowerCase()} · ${p.price}` : `Go Pro · ${p.price}`}
                </button>
                {isGuest && <p className="pricing-guest-hint">Pays as guest - follows you into your account.</p>}
              </article>
            ))}
          </div>
        )}

        {isGuest && !isPro && configured !== false && (
          <div className="pricing-guest-banner" role="note">
            <LogIn size={15} className="pricing-guest-icon" />
            <div className="pricing-guest-copy">
              <strong>Browsing as a guest?</strong>
              <p>Purchases attach to this browser and follow you into a free account automatically - along with credits, history and unsaved work.</p>
            </div>
            <button type="button" className="ui-btn ghost pricing-guest-cta" onClick={() => { onClose(); onOpenAuth?.("signup"); }}>
              Sign in first
            </button>
          </div>
        )}

        {error && <p className="pricing-error" role="alert">{error}</p>}
        <p className="pricing-footer muted">Secure checkout - UPI, cards &amp; netbanking. Card details are never stored; nothing is ever auto-billed.</p>
      </div>
    </div>
  );
}
