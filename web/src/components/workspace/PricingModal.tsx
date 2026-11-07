// Pricing modal: the two one-time plans, no recurring billing.
// Prices + credits are loaded LIVE from /api/payments/plans (which reads the env-driven
// pricing table server-side) — the UI can never drift from what checkout actually charges.
import { useEffect, useState } from "react";
import { Sparkles, Zap, ShieldCheck } from "lucide-motion";
import { startCheckout, type PlanCode } from "@/lib/payments-client";

interface PlanMeta {
  code: PlanCode; name: string; price: string; tag: string;
  perks: string[]; icon: typeof Zap; primary?: boolean;
}

function fmt(n: number): string {
  // ₹1 → "₹1", ₹10.5 → "₹10.5", ₹100 → "₹100"
  return `₹${Number.isInteger(n) ? String(n) : String(n).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function buildPlans(meta: Partial<Record<PlanCode, { inr: number; credits: number }>> | null): PlanMeta[] {
  const topup = meta?.TOPUP ?? { inr: 1, credits: 12 };
  const pro = meta?.PRO ?? { inr: 3, credits: 100 };
  return [
    {
      code: "TOPUP",
      name: "Credit top-up",
      price: fmt(topup.inr),
      tag: `${topup.credits} credits`,
      icon: Zap,
      perks: [`${topup.credits} AI runs / exports`, "One-time — never expires", "All current templates"],
    },
    {
      code: "PRO",
      name: "Aptora Pro",
      price: fmt(pro.inr),
      tag: "1 year",
      icon: Sparkles,
      primary: true,
      perks: [`${pro.credits} credits for a full year`, "All templates + premium exports", "Save unlimited job descriptions"],
    },
  ];
}

export default function PricingModal({ onClose }: { onClose: () => void }) {
  const [plans, setPlans] = useState<PlanMeta[]>(() => buildPlans(null));
  const [busy, setBusy] = useState<PlanCode | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live prices first, perks render from the response.
  useEffect(() => {
    let alive = true;
    fetch("/api/payments/plans")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j) setPlans(buildPlans(j)); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const buy = async (plan: PlanCode) => {
    setError(null);
    setBusy(plan);
    try {
      // PayU POSTs back to the site root; the session cookie survives the round-trip.
      await startCheckout(plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed. Please try again.");
      setBusy(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal pricing-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        <div className="pricing-head">
          <h2>Upgrade your workspace</h2>
          <p className="muted">One-time payments. No subscriptions — credits stay yours.</p>
        </div>
        <div className="pricing-grid">
          {plans.map((p) => (
            <div key={p.code} className={`pricing-card${p.primary ? " featured" : ""}`}>
              <p.icon size={20} />
              <h3>{p.name}</h3>
              <div className="pricing-price"><span className="price">{p.price}</span><span className="tag">{p.tag}</span></div>
              <ul className="pricing-perks">
                {p.perks.map((perk) => <li key={perk}>{perk}</li>)}
              </ul>
              <button type="button" className={`ui-btn ${p.primary ? "primary" : ""}`} disabled={busy !== null}
                onClick={() => buy(p.code)}>
                {busy === p.code ? "Opening PayU…" : busy ? "Wait…" : "Pay with PayU"}
              </button>
            </div>
          ))}
        </div>
        {error && <p className="pricing-error" role="alert">{error}</p>}
        <p className="pricing-footer muted"><ShieldCheck size={13} /> Secure payment via PayU. Card details are never stored, never auto-billed.</p>
      </div>
    </div>
  );
}
