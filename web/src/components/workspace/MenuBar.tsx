import { useState, useRef, useEffect } from "react";
import { Download, Ellipsis, Check, X, ExternalLink, UserPlus, LogIn, Mail, Lock, LogOut, ShieldAlert, Pencil } from "lucide-motion";
import Button from "../ui/Button";
import IconButton from "../ui/IconButton";
import { toast } from "../ui/toast";

interface AuthUser { email: string; name: string | null }

/** DiceBear 'notionists' avatar, seeded by name/email — matches the landing page. */
function avatarUrl(seedRaw: string): string {
  const seed = encodeURIComponent(seedRaw.replace(/[\s.]/g, "").toLowerCase() || "aptora");
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${seed}&backgroundColor=e7ecff,e6f4ea,faf0e6,f1eafd,f3f3f0&radius=50&scale=110`;
}

const APP_VERSION = "0.1.0";

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="about-scrim" onClick={onClose}>
      <div className="about-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button type="button" className="about-close" aria-label="Close" onClick={onClose}><X size={16} /></button>
        {children}
      </div>
    </div>
  );
}

function VersionModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      <div className="about-badge"><img src="/aptora_sq.webp" alt="Aptora" /></div>
      <h2 className="about-title">Aptora</h2>
      <p className="about-tag">Make your experience count.</p>
      <div className="about-version">Version {APP_VERSION} <span className="about-chip">Beta</span></div>
      <p className="about-copy">An AI-assisted document workspace that tailors your resume to the role and renders a real, professional PDF.</p>
      <p className="about-legal">© 2026 Aptora, by Enally. All rights reserved.</p>
    </Modal>
  );
}

function CalendlyModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="about-scrim" onClick={onClose}>
      <div className="cal-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Schedule a call">
        <div className="cal-head">
          <div>
            <h3 className="cal-title">Schedule a free call</h3>
            <p className="cal-sub">30 min · No commitment · Let's talk about your resume or project.</p>
          </div>
          <button type="button" className="about-close cal-close" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="cal-frame-wrap">
          <iframe
            title="Schedule a call with Aptora"
            src="https://calendly.com/03prashantpk/30min?hide_gdpr_banner=1&background_color=ffffff&text_color=111111&primary_color=2563eb"
            className="cal-frame"
            loading="lazy"
          />
        </div>
      </div>
    </div>
  );
}

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["Compile / preview", "Auto (on pause) · use Recompile in the preview"],
    ["Find in editor", "Ctrl / Cmd + F"],
    ["Undo · Redo", "Ctrl / Cmd + Z · Shift + Z"],
    ["Select all", "Ctrl / Cmd + A"],
    ["Rename document", "Click the title in the top bar"],
    ["Export PDF", "File → Export PDF"],
  ];
  return (
    <Modal onClose={onClose}>
      <h2 className="about-title" style={{ fontSize: 20 }}>Keyboard shortcuts</h2>
      <div className="sc-list">
        {rows.map(([k, v]) => (
          <div className="sc-row" key={k}><span className="sc-k">{k}</span><span className="sc-v">{v}</span></div>
        ))}
      </div>
      <p className="about-legal" style={{ marginTop: 16 }}>The editor supports standard code-editor shortcuts.</p>
    </Modal>
  );
}

function DeveloperModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      <img className="dev-avatar" src="https://enally.in/storage/avatars/6a360d67d16b2.png" alt="Prashant Kumar" />
      <h2 className="about-title">Prashant Kumar</h2>
      <p className="about-tag">Full-Stack Developer &amp; Product Engineer</p>
      <p className="about-copy">Builder of Aptora and the Enally ecosystem: products, communities, and opportunities.</p>
      <a className="dev-link" href="https://www.linkedin.com/in/03prashantpk/" target="_blank" rel="noreferrer">
        View LinkedIn <ExternalLink size={14} />
      </a>
      <p className="about-legal">Built with care · by Enally</p>
    </Modal>
  );
}

async function readJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return {}; }
}

function AuthModal({ mode: initialMode, onClose, onAuthed }: { mode: "login" | "signup"; onClose: () => void; onAuthed: (u: AuthUser) => void }) {
  // step: "form" = login/signup form; "verify" = enter the 6-digit OTP after signup.
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [step, setStep] = useState<"form" | "verify">("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // On-brand prompt shown when the email domain isn't on the allowlist.
  const [domainPrompt, setDomainPrompt] = useState<{ message: string; allowed: string[] } | null>(null);

  const switchMode = (m: "login" | "signup") => { setMode(m); setStep("form"); setErr(null); setDomainPrompt(null); };

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    setDomainPrompt(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password, name }),
        });
        const data = await readJson(res);
        if (res.status === 422 && data?.error?.code === "DOMAIN_NOT_ALLOWED") {
          setDomainPrompt({ message: data.error.message, allowed: data.error.allowed ?? [] });
          toast("That email domain isn't accepted yet.", "error");
          return;
        }
        if (!res.ok) {
          const msg = data?.error?.message ?? "Couldn't create your account. Please try again.";
          setErr(msg);
          toast(msg, "error");
          return;
        }
        // Move to OTP verification.
        setStep("verify");
        toast("We sent a 6-digit code to your email.", "success");
      } else {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await readJson(res);
        if (res.status === 403 && data?.error?.code === "NOT_VERIFIED") {
          // Account exists but was never verified — send a fresh code and jump to verify.
          setErr("Your email isn't verified yet. Enter the code we email you.");
          await fetch("/api/auth/signup", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email, password, name: "" }),
          }).catch(() => {});
          setMode("signup");
          setStep("verify");
          toast("Verify your email — we sent a new code.", "info");
          return;
        }
        if (!res.ok) {
          const msg = data?.error?.message ?? "Sign in failed. Please try again.";
          setErr(msg);
          toast(msg, "error");
          return;
        }
        toast(`Welcome back${data?.user?.name ? ", " + data.user.name : ""}.`, "success");
        onAuthed(data.user as AuthUser);
        onClose();
      }
    } catch {
      const msg = "Network error. Please check your connection and try again.";
      setErr(msg);
      toast(msg, "error");
    } finally {
      setBusy(false);
    }
  }

  async function submitVerify(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        const msg = data?.error?.message ?? "Verification failed. Please try again.";
        setErr(msg);
        toast(msg, "error");
        return;
      }
      toast("Email verified — you're all set.", "success");
      onAuthed(data.user as AuthUser);
      onClose();
    } catch {
      const msg = "Network error. Please try again.";
      setErr(msg);
      toast(msg, "error");
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      toast("A new code is on its way.", "success");
    } catch {
      toast("Couldn't resend the code. Try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  // ── OTP verification step ──────────────────────────────────────────────
  if (step === "verify") {
    return (
      <div className="about-scrim" onClick={onClose}>
        <div className="auth-modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <button type="button" className="about-close" aria-label="Close" onClick={onClose}><X size={16} /></button>
          <div className="auth-head">
            <div className="auth-brand-badge"><img src="/aptora_rec.webp" alt="Aptora" className="auth-rec-logo" /></div>
            <h2 className="auth-title">Verify your email</h2>
            <p className="auth-sub">Enter the 6-digit code we sent to <strong>{email}</strong>.</p>
          </div>
          {err && <div className="auth-error" role="alert">{err}</div>}
          <form className="auth-form" onSubmit={submitVerify}>
            <div className="auth-field">
              <label>Verification code</label>
              <div className="auth-input-wrap">
                <input
                  className="no-icon otp-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  autoFocus
                />
              </div>
            </div>
            <Button variant="primary" className="auth-submit-btn" type="submit" disabled={busy || code.length !== 6}>
              {busy ? "Verifying…" : "Verify & continue"}
            </Button>
          </form>
          <div className="auth-footer-toggle">
            <span>
              Didn't get it?{" "}
              <button type="button" onClick={resendCode} disabled={busy}>Resend code</button>
            </span>
          </div>
          <div className="auth-footer-toggle">
            <span><button type="button" onClick={() => { setStep("form"); setErr(null); }}>← Back</button></span>
          </div>
        </div>
      </div>
    );
  }

  // ── Login / signup form ────────────────────────────────────────────────
  return (
    <div className="about-scrim" onClick={onClose}>
      <div className="auth-modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button type="button" className="about-close" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
        <div className="auth-head">
          <div className="auth-brand-badge">
            <img src="/aptora_rec.webp" alt="Aptora" className="auth-rec-logo" />
          </div>
          <h2 className="auth-title">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h2>
          <p className="auth-sub">
            {mode === "login"
              ? "Sign in to access your saved resumes & tailored applications."
              : "Start tailoring high-converting resumes with AI precision."}
          </p>
        </div>

        {/* Continue with Google — hidden until OAuth is wired (kept for later). */}
        {/*
        <div className="auth-social-wrap">
          <button
            type="button"
            className="auth-google-btn"
            onClick={() => { toast("Google sign-in is coming soon.", "info"); }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" className="google-icon">
              <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/>
              <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.78-2.11-6.73-4.96H1.23v3.13C3.26 21.36 7.35 24 12 24z"/>
              <path fill="#FBBC05" d="M5.27 14.24A7.18 7.18 0 0 1 4.9 12c0-.78.14-1.54.37-2.24V6.63H1.23A11.97 11.97 0 0 0 0 12c0 1.92.45 3.74 1.23 5.37l4.04-3.13z"/>
              <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.26 2.64 1.23 6.63l4.04 3.13c.95-2.85 3.61-4.96 6.73-4.96z"/>
            </svg>
            <span>Continue with Google</span>
          </button>
        </div>

        <div className="auth-or-divider">
          <span>or continue with email</span>
        </div>
        */}

        {domainPrompt && (
          <div className="auth-domain-prompt" role="alert">
            <ShieldAlert size={16} className="auth-domain-icon" />
            <div>
              <p className="auth-domain-msg">{domainPrompt.message}</p>
              {domainPrompt.allowed.length > 0 && (
                <p className="auth-domain-list">
                  Accepted: {domainPrompt.allowed.slice(0, 8).map((d) => d.replace(/\*$/, "…")).join(", ")}
                </p>
              )}
            </div>
          </div>
        )}

        {err && !domainPrompt && <div className="auth-error" role="alert">{err}</div>}

        <form className="auth-form" onSubmit={submitForm}>
          {mode === "signup" && (
            <div className="auth-field">
              <label>Full Name</label>
              <div className="auth-input-wrap">
                <input
                  className="no-icon"
                  type="text"
                  placeholder="Alex Morgan"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
          )}

          <div className="auth-field">
            <label>Email address</label>
            <div className="auth-input-wrap">
              <Mail size={15} className="auth-field-icon" />
              <input
                type="email"
                required
                placeholder="alex@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (domainPrompt) setDomainPrompt(null); }}
                autoFocus={mode === "login"}
              />
            </div>
          </div>

          <div className="auth-field">
            <div className="auth-label-row">
              <label>Password</label>
              {mode === "login" && (
                <button type="button" className="auth-link-btn" onClick={() => toast("Password reset is coming soon.", "info")}>
                  Forgot?
                </button>
              )}
            </div>
            <div className="auth-input-wrap">
              <Lock size={15} className="auth-field-icon" />
              <input
                type="password"
                required
                minLength={8}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {mode === "signup" && <p className="auth-hint">At least 8 characters.</p>}
          </div>

          <Button variant="primary" className="auth-submit-btn" type="submit" disabled={busy}>
            {busy ? (mode === "login" ? "Signing in…" : "Creating…") : mode === "login" ? "Sign In" : "Create Account"}
          </Button>
        </form>

        <div className="auth-footer-toggle">
          {mode === "login" ? (
            <span>
              Don't have an account?{" "}
              <button type="button" onClick={() => switchMode("signup")}>
                Create one
              </button>
            </span>
          ) : (
            <span>
              Already have an account?{" "}
              <button type="button" onClick={() => switchMode("login")}>
                Sign in
              </button>
            </span>
          )}
        </div>

        <p className="auth-trust-note">
          Protected by 256-bit encryption. By continuing, you agree to our{" "}
          <a href="/terms" target="_blank" rel="noreferrer">Terms</a> &amp;{" "}
          <a href="/privacy" target="_blank" rel="noreferrer">Privacy</a>.
        </p>
      </div>
    </div>
  );
}

export type SaveState = "idle" | "updating" | "saved" | "error";

interface Props {
  docName: string;
  onRename: (name: string) => void;
  saveState: SaveState;
  exportsLeft: number;
  onExport: () => void;
  canExport: boolean;
  aiChangedLines: number;
  onAcceptAi: () => void;
  onRejectAi: () => void;
}

function statusText(s: SaveState, loggedIn: boolean): string {
  // Logged-in docs are persisted to the account; anonymous docs to the session. Reflect
  // that in the auto-save label so the "Saved" state reads correctly for the context.
  const savedLabel = loggedIn ? "Saved to account" : "Saved";
  return s === "updating" ? "Saving…" : s === "saved" ? savedLabel : s === "error" ? "Couldn't update" : "";
}

export default function MenuBar({ docName, onRename, saveState, exportsLeft, onExport, canExport, aiChangedLines, onAcceptAi, onRejectAi }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(docName);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "version" | "developer" | "calendly" | "shortcuts">(null);
  const [authModal, setAuthModal] = useState<null | "login" | "signup">(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  // Load current auth state so the menu reflects logged-in vs anonymous.
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => { if (alive && d?.authenticated) setUser(d.user as AuthUser); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const logout = async () => {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* ignore */ }
    setUser(null);
    setOpenMenu(null);
    toast("Signed out.", "info");
  };

  const commit = () => { setEditing(false); const v = draft.trim(); if (v && v !== docName) onRename(v); else setDraft(docName); };

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (openMenu === "more" && moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openMenu]);

  return (
    <header className="menubar" onMouseLeave={() => { if (openMenu !== "more") setOpenMenu(null); }}>
      <div className="mb-left">
        <img src="/aptora_sq.webp" alt="Aptora" className="mb-logo" />
        <div className="mb-menu-wrap">
          <button type="button" className={`mb-menu${openMenu === "File" ? " open" : ""}`} onClick={() => setOpenMenu(openMenu === "File" ? null : "File")}>File</button>
          {openMenu === "File" && (
            <div className="mb-dropdown" role="menu">
              <button role="menuitem" onClick={() => { onExport(); setOpenMenu(null); }} disabled={!canExport}>Export PDF</button>
              <a role="menuitem" href="/" onClick={() => setOpenMenu(null)}>New resume</a>
              <div className="mb-sep" />
              <button role="menuitem" disabled>Save <span className="mb-hint">auto</span></button>
            </div>
          )}
        </div>
        <div className="mb-menu-wrap">
          <button type="button" className={`mb-menu${openMenu === "Edit" ? " open" : ""}`} onClick={() => setOpenMenu(openMenu === "Edit" ? null : "Edit")}>Edit</button>
          {openMenu === "Edit" && (
            <div className="mb-dropdown" role="menu">
              <button role="menuitem" onClick={() => { setEditing(true); setDraft(docName); setOpenMenu(null); }}>Rename</button>
              <button role="menuitem" onClick={() => { setModal("shortcuts"); setOpenMenu(null); }}>Shortcuts <span className="mb-hint">Ctrl F</span></button>
            </div>
          )}
        </div>
        <div className="mb-menu-wrap">
          <button type="button" className={`mb-menu${openMenu === "View" ? " open" : ""}`} onClick={() => setOpenMenu(openMenu === "View" ? null : "View")}>View</button>
          {openMenu === "View" && (
            <div className="mb-dropdown" role="menu">
              <a role="menuitem" href="/about" target="_blank" rel="noreferrer">About Aptora</a>
              <a role="menuitem" href="/home#workflow" target="_blank" rel="noreferrer">How it works</a>
              <a role="menuitem" href="/home#templates" target="_blank" rel="noreferrer">Templates</a>
              <button role="menuitem" onClick={() => { setModal("shortcuts"); setOpenMenu(null); }}>Shortcuts</button>
            </div>
          )}
        </div>
        <div className="mb-menu-wrap">
          <button type="button" className={`mb-menu${openMenu === "Help" ? " open" : ""}`} onClick={() => setOpenMenu(openMenu === "Help" ? null : "Help")}>Help</button>
          {openMenu === "Help" && (
            <div className="mb-dropdown" role="menu">
              <button role="menuitem" onClick={() => { setModal("calendly"); setOpenMenu(null); }}>Book a call <span className="mb-hint">30m</span></button>
              <a role="menuitem" href="/contact" target="_blank" rel="noreferrer">Contact</a>
              <div className="mb-sep" />
              <a role="menuitem" href="/terms" target="_blank" rel="noreferrer">Terms &amp; Conditions</a>
              <a role="menuitem" href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>
              <div className="mb-sep" />
              <button role="menuitem" onClick={() => { setModal("version"); setOpenMenu(null); }}>What's new <span className="mb-hint">v{APP_VERSION}</span></button>
              <button role="menuitem" onClick={() => { setModal("developer"); setOpenMenu(null); }}>Developer</button>
            </div>
          )}
        </div>
      </div>

      <div className="mb-center">
        {editing ? (
          <input className="mb-title-input" value={draft} autoFocus
            onChange={(e) => setDraft(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(docName); setEditing(false); } }} />
        ) : (
          <button type="button" className="mb-title" title="Click to rename" onClick={() => { setDraft(docName); setEditing(true); }}>
            <span className="mb-title-text">{docName}</span>
            <Pencil size={12} className="mb-title-pencil" />
          </button>
        )}
        <span className={`mb-save ${saveState}`}>{statusText(saveState, !!user)}</span>
      </div>

      <div className="mb-right">
        {aiChangedLines > 0 && (
          <div className="ai-review-bar">
            <span className="ai-review-label">Aptora changed {aiChangedLines} line{aiChangedLines > 1 ? "s" : ""}</span>
            <button type="button" className="ai-accept" onClick={onAcceptAi}><Check size={13} /> Keep</button>
            <button type="button" className="ai-reject" onClick={onRejectAi}><X size={13} /> Undo</button>
          </div>
        )}
        <Button variant="primary" onClick={onExport} disabled={exportsLeft <= 0 || !canExport}
          title={exportsLeft <= 0 ? "No exports left" : !canExport ? "Compile first" : undefined}>
          <Download size={16} /> <span>Export</span>
        </Button>
        <div className="mb-menu-wrap" ref={moreRef}>
          <IconButton
            label="More"
            onClick={() => setOpenMenu(openMenu === "more" ? null : "more")}
          >
            <Ellipsis size={18} />
          </IconButton>
          {openMenu === "more" && (
            <div className="mb-dropdown mb-dropdown-right premium-popover" role="menu">
              <div className="popover-badge-row">
                <span className="popover-plan-tag">Free Plan</span>
                <span className="popover-credits-tag">{exportsLeft} exports left</span>
              </div>
              <div className="mb-sep" />
              {user ? (
                <>
                  <div className="popover-user">
                    <img className="popover-user-avatar" src={avatarUrl(user.name || user.email)} alt="" width={34} height={34} />
                    <div className="popover-user-meta">
                      <strong className="popover-user-name">{user.name || user.email.split("@")[0]}</strong>
                      <span className="popover-user-email">{user.email}</span>
                    </div>
                  </div>
                  <button className="popover-action-btn" role="menuitem" onClick={logout}>
                    <span className="pab-label">
                      <LogOut size={16} className="pab-icon" />
                      <span>Sign out</span>
                    </span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="popover-action-btn primary-action"
                    role="menuitem"
                    onClick={() => {
                      setOpenMenu(null);
                      setAuthModal("signup");
                    }}
                  >
                    <span className="pab-label">
                      <UserPlus size={16} className="pab-icon" />
                      <strong>Create account</strong>
                    </span>
                    <span className="popover-hint-badge">New</span>
                  </button>
                  <button
                    className="popover-action-btn"
                    role="menuitem"
                    onClick={() => {
                      setOpenMenu(null);
                      setAuthModal("login");
                    }}
                  >
                    <span className="pab-label">
                      <LogIn size={16} className="pab-icon" />
                      <span>Log in</span>
                    </span>
                  </button>
                </>
              )}
              <div className="mb-sep" />
              <div className="popover-extra-links">
                <a href="/usage" className="popover-sub-link">Check limits</a>
                <a href="/about" className="popover-sub-link">About</a>
                <a href="/contact" className="popover-sub-link">Contact</a>
              </div>
            </div>
          )}
        </div>
      </div>

      {modal === "version" && <VersionModal onClose={() => setModal(null)} />}
      {modal === "developer" && <DeveloperModal onClose={() => setModal(null)} />}
      {modal === "calendly" && <CalendlyModal onClose={() => setModal(null)} />}
      {modal === "shortcuts" && <ShortcutsModal onClose={() => setModal(null)} />}
      {authModal && <AuthModal mode={authModal} onClose={() => setAuthModal(null)} onAuthed={(u) => setUser(u)} />}
    </header>
  );
}
