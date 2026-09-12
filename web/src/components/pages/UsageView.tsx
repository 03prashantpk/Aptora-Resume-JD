import { useEffect, useState } from "react";
import Gauge from "../ui/Gauge";

interface Usage { aiCalls: number; exportsUsed: number; freeLimit: number; allowed: boolean; }

export default function UsageView() {
  const [u, setU] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/usage");
        if (r.ok) setU((await r.json()) as Usage);
      } catch { /* db may be down */ }
      finally { setLoading(false); }
    })();
  }, []);

  const used = u ? Math.max(u.aiCalls, u.exportsUsed) : 0;
  const pct = u ? Math.min(100, Math.round((used / Math.max(1, u.freeLimit)) * 100)) : 0;
  const left = u ? Math.max(0, u.freeLimit - used) : 0;

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <p className="view-eyebrow">Account</p>
          <h1>Usage</h1>
          <p>You're on the free plan. Aptora is usable without an account for a few runs — create an account to continue.</p>
        </div>
        <a className="view-cta" href="/">Open editor</a>
      </div>

      {loading ? <p className="view-muted">Loading…</p> : (
        <div className="usage-grid">
          <div className="usage-card">
            <Gauge value={pct} label="Free used" />
            <div className="usage-nums">
              <p className="usage-big">{left}</p>
              <p className="muted">free run{left === 1 ? "" : "s"} remaining</p>
            </div>
          </div>
          <div className="usage-stats">
            <div className="stat"><span className="muted">AI runs (tailor + analyze)</span><strong>{u?.aiCalls ?? 0}</strong></div>
            <div className="stat"><span className="muted">Exports</span><strong>{u?.exportsUsed ?? 0}</strong></div>
            <div className="stat"><span className="muted">Free limit</span><strong>{u?.freeLimit ?? 0}</strong></div>
          </div>
          {left <= 0 && (
            <a className="ui-btn primary usage-cta" href="/signup">Create a free account for more</a>
          )}
        </div>
      )}
    </div>
  );
}
