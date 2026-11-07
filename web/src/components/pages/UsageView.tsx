// Usage page: daily budget gauge + tier + paid credits + Pro entitlement, with
// one-click purchase CTAs priced LIVE from /api/payments/plans (env-driven server
// pricing — the page can never show a stale price).
import { useEffect, useState } from "react";
import Gauge from "../ui/Gauge";
import { CreditCard, Sparkles, User, Zap } from "lucide-motion";
import { startCheckout, type PlanCode } from "@/lib/payments-client";

interface Usage {
  role: "guest" | "user";
  tier: "free" | "pro";
  aiCalls: number;          // today (server clamps ≥ 0)
  exportsUsed: number;      // today
  freeLimit: number;
  allowed: boolean;
  credits: number;
  isPro: boolean;
  proUntil: string | null;
}

interface PlanPrices {
  TOPUP: { inr: number; credits: number };
  PRO: { inr: number; credits: number };
}

function fmt(n: number): string {
  return `₹${Number.isInteger(n) ? String(n) : String(n).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export default function UsageView({ onOpenAuth }: { onOpenAuth?: (mode: "login" | "signup") => void }) {
  const [u, setU] = useState<Usage | null>(null);
  const [prices, setPrices] = useState<PlanPrices | null>(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<PlanCode | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/usage");
        if (r.ok) setU((await r.json()) as Usage);
      } catch { /* db may be down */ }
      finally { setLoading(false); }
    })();
    fetch("/api/payments/plans")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && j.TOPUP && j.PRO) setPrices(j); })
      .catch(() => undefined);
  }, []);

  const used = u ? Math.max(u.aiCalls, u.exportsUsed) : 0;
  const pct = u ? Math.min(100, Math.round((used / Math.max(1, u.freeLimit)) * 100)) : 0;
  const left = u ? Math.max(0, u.freeLimit - used) : 0; // never negative in UI
  const isPro = !!u?.isPro;
  const credits = u?.credits ?? 0;
  const proDate = u?.proUntil ? new Date(u.proUntil).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;

  const buy = async (plan: PlanCode) => {
    if (u?.role === "guest") { onOpenAuth?.("signup"); return; }
    setBuying(plan);
    try { await startCheckout(plan); }
    catch { /* toast surfaced by the client layer */ }
    finally { setBuying(null); }
  };

  const topup = prices?.TOPUP ?? { inr: 1, credits: 12 };
  const pro = prices?.PRO ?? { inr: 3, credits: 100 };

  return (
    <div className="view view-wide">
      <div className="view-head">
        <div>
          <p className="view-eyebrow">Account</p>
          <h1>Usage</h1>
          <p>
            {u?.role === "guest"
              ? "You're a guest — the free budget is tied to this browser and resets when cookies are cleared."
              : isPro
                ? "You're on Pro — an active paid plan with the biggest budget."
                : "Signed in — your budget follows your account and purchased credits never expire."}
          </p>
        </div>
        <a className="view-cta" href="/">Open editor</a>
      </div>

      {loading ? <p className="view-muted">Loading…</p> : (
        <div className="usage-grid-wide">
          {/* Daily budget — the headline metric */}
          <div className="usage-hero-card">
            <Gauge value={pct} label={isPro ? "Pro · no limit" : "Free used"} tone="accent" />
            <div className="usage-hero-nums">
              <p className="usage-big">{isPro ? "Unlimited" : left}</p>
              <p className="muted">{isPro ? "runs while Pro is active" : `run${left === 1 ? "" : "s"} remaining today`}</p>
            </div>
            <div className="usage-hero-side">
              {isPro ? (
                <span className="usage-pill is-pro">Pro active{proDate ? ` until ${proDate}` : ""}</span>
              ) : (
                <>
                  <span className="usage-pill">{u?.role === "user" ? "Account · Free tier" : "Guest · Free tier"}</span>
                  <span className="usage-pill dim">{credits} paid credit{credits === 1 ? "" : "s"} on hand</span>
                </>
              )}
            </div>
          </div>

          {/* Metrics */}
          <div className="usage-metrics-grid">
            <div className="stat-card"><span className="muted">AI runs today</span><strong>{u?.aiCalls ?? 0}</strong><span className="stat-foot muted">all models · tailor, edits, analysis</span></div>
            <div className="stat-card"><span className="muted">Exports today</span><strong>{u?.exportsUsed ?? 0}</strong><span className="stat-foot muted">compiled PDFs downloaded</span></div>
            <div className="stat-card"><span className="muted">Free limit / day</span><strong>{u?.freeLimit ?? 0}</strong><span className="stat-foot muted">resets at midnight</span></div>
            <div className="stat-card highlight"><span className="muted">Paid credits</span><strong>{credits}</strong><span className="stat-foot muted">never expire — used after the free budget</span></div>
          </div>

          {/* Purchase actions — env-priced live */}
          {!isPro && (
            <div className="usage-buy-row">
              <button type="button" className="ui-btn ai" disabled={buying !== null} onClick={() => buy("TOPUP")}>
                <Zap size={14} /> {buying === "TOPUP" ? "Opening PayU…" : `Top up ${topup.credits} credits — ${fmt(topup.inr)}`}
              </button>
              {u?.role === "user" || u === null ? null : (
                <span className="muted usage-buy-note">Sign in first so the credits attach to your account.</span>
              )}
              <button type="button" className="ui-btn primary" disabled={buying !== null} onClick={() => buy("PRO")}>
                <Sparkles size={14} /> {buying === "PRO" ? "Opening PayU…" : `Go Pro — ${pro.credits} credits / year, ${fmt(pro.inr)}`}
              </button>
            </div>
          )}

          {left <= 0 && credits <= 0 && !isPro && u?.role === "guest" && (
            <button type="button" className="ui-btn secondary usage-cta" onClick={() => onOpenAuth?.("signup")}>
              <User size={14} /> Create a free account for a bigger daily budget
            </button>
          )}
          <p className="usage-hint muted"><CreditCard size={12} /> Secure payments via PayU (UPI, cards, netbanking) · one-time charges only · payment history lives in Activity.</p>
        </div>
      )}
    </div>
  );
}
