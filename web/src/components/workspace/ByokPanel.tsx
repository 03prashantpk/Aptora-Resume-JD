// BYOK panel — connect or remove the owner's personal NVIDIA API key.
// The key NEVER returns to the browser after saving (only a last-4 hint).
import { useEffect, useState } from "react";
import { ExternalLink, KeyRound, CircleCheck, Trash2 } from "lucide-motion";

interface KeyStatus {
  has: boolean;
  provider: "nvidia";
  hint: string;
  createdAt: string | null;
  lastUsedAt: string | null;
}

export default function ByokPanel({ onChanged, compact, isGuest, onOpenAuth }: {
  onChanged?: (s: KeyStatus) => void;
  compact?: boolean;
  /** When true, BYOK is gated behind sign-in (a key belongs to an account, not a cookie). */
  isGuest?: boolean;
  onOpenAuth?: (mode: "login" | "signup") => void;
}) {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/keys")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) setStatus(j); })
      .catch(() => undefined);
  }, []);

  const save = async () => {
    if (!key.trim() || busy) return;
    setBusy(true); setErr(null); setSaved(false);
    try {
      const r = await fetch("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: key.trim() }),
      });
      const j = (await r.json()) as KeyStatus | { error?: { message: string } };
      if (r.ok && j && (j as KeyStatus).has) {
        setStatus(j as KeyStatus);
        setKey("");
        setSaved(true);
        onChanged?.(j as KeyStatus);
      } else {
        const msg = (j as { error?: { message: string } })?.error?.message ?? "Couldn't verify the key — try again.";
        setErr(msg);
      }
    } catch {
      setErr("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/keys", { method: "DELETE" });
      const j = (await r.json()) as KeyStatus;
      setStatus(j);
      onChanged?.(j);
    } catch {
      setErr("Couldn't remove the key — try again.");
    } finally {
      setBusy(false);
    }
  };

  if (status === null) {
    return <div className="byok-skel" aria-label="Loading API key state…" />;
  }

  const active = status.has;

  return (
    <div className={`byok-panel${compact ? " compact" : ""}`}>
      <div className="byok-head">
        <KeyRound size={15} className="byok-ic" />
        <div className="byok-copy">
          <strong>{active ? "Your API key is active" : "Use your own free API key"}</strong>
          <p>
            {active
              ? "AI runs on your key — they never count against your plan. NVIDIA bills you directly."
              : "Runs will be billed to your own build.nvidia.com key instead of your plan."}
          </p>
        </div>
        {active && (
          <button type="button" className="byok-remove" onClick={remove} disabled={busy} title="Remove key">
            <Trash2 size={13} /> Remove
          </button>
        )}
      </div>

      {active ? (
        <>
          <div className="byok-active-row">
            <CircleCheck size={14} className="byok-check" />
            <span className="byok-hint">NVIDIA NIM · {status.hint}</span>
            {saved && <span className="byok-saved">Saved</span>}
          </div>
        </>
      ) : isGuest ? (
        // BYOK belongs to an account — a guest signs in first (their work migrates too).
        <div className="byok-guest">
          <p>Your own key stays with your account, so it's always there and never tied to one browser. Sign in to connect it.</p>
          <button type="button" className="ui-btn primary" onClick={() => onOpenAuth?.("signup")}>Sign in to connect a key</button>
        </div>
      ) : (
        <>
          <ol className="byok-steps">
            <li>
              <a href="https://build.nvidia.com/settings/api-keys" target="_blank" rel="noreferrer">
                Open build.nvidia.com <ExternalLink size={11} />
              </a> and sign in (free).
            </li>
            <li>Generate a key and copy it (starts with <code>nvapi-</code>).</li>
            <li>Paste it below — it's verified before saving.</li>
          </ol>
          <div className="byok-input-row">
            <input
              type="password"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="nvapi-…"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            />
            <button type="button" className="ui-btn primary" disabled={busy || key.trim().length === 0} onClick={save}>
              {busy ? "Verifying…" : "Connect key"}
            </button>
          </div>
        </>
      )}

      {err && <p className="byok-error" role="alert">{err}</p>}
      {!active && saved && <p className="byok-saved-note">Key connected — your next runs run on it.</p>}
    </div>
  );
}
