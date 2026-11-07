// Budget gate modal - shown when a gated action is refused (402) because the daily
// budget AND paid credits are exhausted. Fully role-aware (guest / account) and offers
// the real ways forward: a free account, credits, or the owner's own free API key.
// Copy discipline: state what happened and what to do next - no scolding, no fluff.
import { useEffect, useState } from "react";
import { CreditCard, UserPlus, KeyRound, MoonStar } from "lucide-motion";
import ByokPanel from "./ByokPanel";

interface UsageSnap {
  role: "guest" | "user";
  credits: number;
  isPro: boolean;
  hasOwnKey: boolean;
  freeLimit: number;
}

export default function BudgetModal({
  onClose, onOpenAuth, onOpenPricing,
}: {
  onClose: () => void;
  onOpenAuth?: (mode: "login" | "signup") => void;
  onOpenPricing?: () => void;
}) {
  const [u, setU] = useState<UsageSnap | null>(null);
  const [tab, setTab] = useState<"options" | "key">("options");

  useEffect(() => {
    let alive = true;
    fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j) setU(j); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const guest = u?.role !== "user";

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal budget-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>✕</button>

        {tab === "key" ? (
          <>
            <p className="budget-eyebrow">Your API key</p>
            <h3>Run on your own key</h3>
            <p className="budget-sub">Connect it once - every AI run after that is billed to your NVIDIA account, not your Aptora plan.</p>
            <ByokPanel onChanged={(s) => { if (s.has) { onClose(); } }} compact isGuest={guest} onOpenAuth={(m) => { onClose(); onOpenAuth?.(m); }} />
            <button type="button" className="budget-back" onClick={() => setTab("options")}>← Back to options</button>
          </>
        ) : (
          <>
            <p className="budget-eyebrow">Daily budget</p>
            <h3>You've reached today's free limit</h3>
            <p className="budget-sub">
              {u === null
                ? "Your work is saved. The limit resets at midnight."
                : guest
                  ? "Your work is saved in this browser. The free budget resets at midnight - or unlock more right now, free."
                  : "Your work is saved to your account. The free budget resets at midnight - or keep working right now."}
            </p>
            <div className="budget-options">
              {guest ? (
                <button type="button" className="budget-option primary" onClick={() => { onClose(); onOpenAuth?.("signup"); }}>
                  <span className="budget-option-ic"><UserPlus size={17} /></span>
                  <span className="budget-option-copy">
                    <strong>Create a free account</strong>
                    <span>Higher daily budget and your work follows you on every device.</span>
                  </span>
                </button>
              ) : (
                <button type="button" className="budget-option primary" onClick={() => { onClose(); onOpenPricing?.(); }}>
                  <span className="budget-option-ic"><CreditCard size={17} /></span>
                  <span className="budget-option-copy">
                    <strong>Get more credits</strong>
                    <span>One-time top-up or Pro - pay once, no subscription, credits never expire.</span>
                  </span>
                </button>
              )}
              <button type="button" className="budget-option" onClick={() => setTab("key")}>
                <span className="budget-option-ic accent"><KeyRound size={17} /></span>
                <span className="budget-option-copy">
                  <strong>Use your own API key</strong>
                  <span>{guest
                    ? "Free - sign in, then connect an NVIDIA key and runs bill to you, not your plan."
                    : "Free - connect an NVIDIA key from build.nvidia.com and keep working immediately."}</span>
                </span>
              </button>
            </div>
            <p className="budget-foot"><MoonStar size={12} /> The daily budget resets automatically at midnight. Nothing you built is lost.</p>
          </>
        )}
      </div>
    </div>
  );
}
