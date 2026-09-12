import { useState, useRef, useEffect } from "react";
import { Download, Ellipsis, Check, X, ExternalLink, UserPlus, LogIn, Mail, Lock } from "lucide-motion";
import Button from "../ui/Button";
import IconButton from "../ui/IconButton";

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

function AuthModal({ mode: initialMode, onClose }: { mode: "login" | "signup"; onClose: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    alert(mode === "login" ? `Signing in as ${email}...` : `Creating account for ${name || email}...`);
    onClose();
  };

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

        <div className="auth-social-wrap">
          <button
            type="button"
            className="auth-google-btn"
            onClick={() => {
              alert("Google OAuth will be connected in authentication setup.");
              onClose();
            }}
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

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "signup" && (
            <div className="auth-field">
              <label>Full Name</label>
              <div className="auth-input-wrap">
                <input
                  type="text"
                  required
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
                onChange={(e) => setEmail(e.target.value)}
                autoFocus={mode === "login"}
              />
            </div>
          </div>

          <div className="auth-field">
            <div className="auth-label-row">
              <label>Password</label>
              {mode === "login" && (
                <button type="button" className="auth-link-btn" onClick={() => alert("Password reset link will be sent to your email.")}>
                  Forgot?
                </button>
              )}
            </div>
            <div className="auth-input-wrap">
              <Lock size={15} className="auth-field-icon" />
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <Button variant="primary" className="auth-submit-btn" type="submit">
            {mode === "login" ? "Sign In" : "Create Account"}
          </Button>
        </form>

        <div className="auth-footer-toggle">
          {mode === "login" ? (
            <span>
              Don't have an account?{" "}
              <button type="button" onClick={() => setMode("signup")}>
                Create one
              </button>
            </span>
          ) : (
            <span>
              Already have an account?{" "}
              <button type="button" onClick={() => setMode("login")}>
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

function statusText(s: SaveState): string {
  return s === "updating" ? "Saving…" : s === "saved" ? "Saved" : s === "error" ? "Couldn't update" : "";
}

export default function MenuBar({ docName, onRename, saveState, exportsLeft, onExport, canExport, aiChangedLines, onAcceptAi, onRejectAi }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(docName);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "version" | "developer">(null);
  const [authModal, setAuthModal] = useState<null | "login" | "signup">(null);
  const moreRef = useRef<HTMLDivElement>(null);

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
              <button role="menuitem" disabled>Save <span className="mb-hint">auto</span></button>
            </div>
          )}
        </div>
        <button type="button" className="mb-menu" disabled>Edit</button>
        <div className="mb-menu-wrap">
          <button type="button" className={`mb-menu${openMenu === "View" ? " open" : ""}`} onClick={() => setOpenMenu(openMenu === "View" ? null : "View")}>View</button>
          {openMenu === "View" && (
            <div className="mb-dropdown" role="menu">
              <button role="menuitem" disabled>About Aptora</button>
              <button role="menuitem" disabled>Use cases</button>
              <button role="menuitem" disabled>How it works</button>
              <button role="menuitem" disabled>Keyboard shortcuts</button>
            </div>
          )}
        </div>
        <div className="mb-menu-wrap">
          <button type="button" className={`mb-menu${openMenu === "Help" ? " open" : ""}`} onClick={() => setOpenMenu(openMenu === "Help" ? null : "Help")}>Help</button>
          {openMenu === "Help" && (
            <div className="mb-dropdown" role="menu">
              <a role="menuitem" href="/terms" target="_blank" rel="noreferrer">Terms &amp; Conditions</a>
              <a role="menuitem" href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>
              <div className="mb-sep" />
              <button role="menuitem" onClick={() => { setModal("version"); setOpenMenu(null); }}>What's new <span className="mb-hint">v{APP_VERSION}</span></button>
              <a role="menuitem" href="https://enally.in/contact" target="_blank" rel="noreferrer">Contact</a>
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
          <button type="button" className="mb-title" onClick={() => { setDraft(docName); setEditing(true); }}>{docName}</button>
        )}
        <span className={`mb-save ${saveState}`}>{statusText(saveState)}</span>
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
              <button
                className="popover-action-btn primary-action"
                role="menuitem"
                onClick={() => {
                  setOpenMenu(null);
                  setAuthModal("signup");
                }}
              >
                <div className="flex items-center gap-2.5">
                  <UserPlus size={15} className="text-blue-600" />
                  <strong>Create account</strong>
                </div>
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
                <div className="flex items-center gap-2.5">
                  <LogIn size={15} />
                  <span>Log in</span>
                </div>
              </button>
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
      {authModal && <AuthModal mode={authModal} onClose={() => setAuthModal(null)} />}
    </header>
  );
}
