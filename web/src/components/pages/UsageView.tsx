// Usage page — clean, light, low-shadow. A compact status strip, a 4-metric row,
// three plan cards (Free · Credit top-up · Pro) matching the pricing modal, the BYOK
// panel, and a short footer. All numbers are live from the DB; prices from the env.
import { useEffect, useState } from "react";
import ByokPanel from "../workspace/ByokPanel";
import { Check, Sparkles, KeyRound } from "lucide-motion";
import { startCheckout, type PlanCode } from "@/lib/payments-client";
import { planBadge } from "@/lib/utils";

interface Usage {
  role: "guest" | "user";
  tier: "free" | "pro";
  aiCalls: number;
  byokAiCalls: number;
  exportsUsed: number;
  freeLimit: number;
  allowed: boolean;
  source: string;
  runsLeft: number | null;
  exportsLeft: number | null;
  credits: number;
  isPro: boolean;
  proUntil: string | null;
  hasOwnKey: boolean;
}

interface PlanPrices {
  configured?: boolean;
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

  const reload = () => fetch("/api/usage").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) setU(j as Usage); }).catch(() => undefined);
  useEffect(() => {
    (async () => { await reload(); setLoading(false); })();
    fetch("/api/payments/plans").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.TOPUP && j.PRO) setPrices(j); }).catch(() => undefined);
  }, []);

  const used = u ? Math.max(u.aiCalls, u.exportsUsed) : 0;
  const unlimited = !!u && (u.hasOwnKey || u.isPro);
  const left = u?.runsLeft ?? (u ? Math.max(0, u.freeLimit - used) : 0);
  const pct = unlimited ? 100 : u ? Math.max(0, Math.min(100, Math.round((left / Math.max(1, u.freeLimit)) * 100))) : 0;
  const isPro = !!u?.isPro;
  const ownKey = !!u?.hasOwnKey;
  const credits = u?.credits ?? 0;
  const totalAiToday = (u?.aiCalls ?? 0) + (u?.byokAiCalls ?? 0);
  const proDate = u?.proUntil ? new Date(u.proUntil).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;

  const topup = prices?.TOPUP ?? { inr: 1, credits: 12 };
  const pro = prices?.PRO ?? { inr: 3, credits: 100 };
  const configured = prices ? prices.configured !== false : true;

  const buy = async (plan: PlanCode) => {
    setBuying(plan);
    try { await startCheckout(plan); } catch { /* client toast */ } finally { setBuying(null); }
  };

  const badge = planBadge(u);

  return (
    <div className="view view-wide usage3">
      <div className="view-head">
        <div>
          <p className="view-eyebrow">Account</p>
          <h1>Usage &amp; plan</h1>
          <p>Your live budget and plan — straight from your account.</p>
        </div>
        <a className="view-cta" href="/">Open editor</a>
      </div>

      {loading ? (
        <div className="u3-skel"><span /><span /></div>
      ) : (
        <>
          {/* Status strip — one calm line, a thin progress bar, a pill. */}
          <section className="u3-status">
            <div className="u3-status-top">
              <div>
                <span className="u3-left">{unlimited ? "Unlimited" : left}</span>
                <span className="u3-left-sub">{ownKey ? "runs on your key" : isPro ? "runs while Pro is active" : `run${left === 1 ? "" : "s"} left today`}</span>
              </div>
              <span className={`u3-pill tone-${badge.tone}`}>
                {badge.tone === "pro" ? <><Sparkles size={12} /> Pro{proDate ? ` · until ${proDate}` : ""}</> : badge.tone === "byok" ? <><KeyRound size={12} /> BYOK</> : badge.label}
              </span>
            </div>
            {!unlimited && (
              <div className="u3-track"><span className="u3-track-fill" style={{ width: `${100 - pct}%` }} /></div>
            )}
          </section>

          {/* Metrics */}
          <section className="u3-metrics">
            <div className="u3-metric"><span>AI runs today</span><strong>{totalAiToday}</strong></div>
            <div className="u3-metric"><span>Exports today</span><strong>{u?.exportsUsed ?? 0}</strong></div>
            <div className="u3-metric"><span>Free / day</span><strong>{unlimited ? "∞" : u?.freeLimit ?? 0}</strong></div>
            <div className="u3-metric accent"><span>Paid credits</span><strong>{credits}</strong></div>
          </section>

          {/* Three plan cards — only when not already on an unlimited source. */}
          {!ownKey && !isPro && (
            <section className="u3-plans" aria-label="Plans">
              {/* Free */}
              <article className="u3-card is-current">
                <p className="u3-k">Free</p>
                <p className="u3-price">₹0<span>forever</span></p>
                <ul className="u3-feats">
                  <li><Check size={13} /> {u?.freeLimit ?? 3} runs / day</li>
                  <li><Check size={13} /> Every template</li>
                  <li><Check size={13} /> Real PDF export</li>
                </ul>
                <button type="button" className="u3-cta current" disabled><Check size={14} /> Current</button>
              </article>

              {/* Credit top-up */}
              <article className="u3-card">
                <p className="u3-k">Top-up</p>
                <p className="u3-price">{fmt(topup.inr)}<span>{topup.credits} credits</span></p>
                <ul className="u3-feats">
                  <li><Check size={13} /> {topup.credits} runs &amp; exports</li>
                  <li><Check size={13} /> Never expire</li>
                  <li><Check size={13} /> Used after free</li>
                </ul>
                <button type="button" className="u3-cta" disabled={!configured || buying !== null} onClick={() => buy("TOPUP")}>
                  {buying === "TOPUP" ? "Starting…" : configured ? `Get ${topup.credits} · ${fmt(topup.inr)}` : "Soon"}
                </button>
              </article>

              {/* Pro */}
              <article className="u3-card featured">
                <span className="u3-ribbon">BEST VALUE</span>
                <p className="u3-k pro"><Sparkles size={11} /> Pro</p>
                <p className="u3-price">{fmt(pro.inr)}<span>/ year</span></p>
                <ul className="u3-feats">
                  <li><Check size={13} /> {pro.credits} credits / year</li>
                  <li><Check size={13} /> No daily limit</li>
                  <li><Check size={13} /> All premium exports</li>
                </ul>
                <button type="button" className="u3-cta buy" disabled={!configured || buying !== null} onClick={() => buy("PRO")}>
                  {buying === "PRO" ? "Starting…" : configured ? `Go Pro · ${fmt(pro.inr)}` : "Soon"}
                </button>
              </article>
            </section>
          )}

          {/* BYOK */}
          <section className="u3-byok" id="api-key">
            <ByokPanel onChanged={() => void reload()} isGuest={u?.role === "guest"} onOpenAuth={onOpenAuth} />
          </section>

          {u?.role === "guest" && !isPro && (
            <p className="u3-guest">Paying as a guest attaches to this browser and follows you in. <button type="button" className="u3-link" onClick={() => onOpenAuth?.("signup")}>Create a free account</button> for more.</p>
          )}

          <p className="u3-foot">One-time payments · credits never expire · secure UPI, cards &amp; net-banking · history in <a href="/activity">Activity</a>.</p>
        </>
      )}
    </div>
  );
}
