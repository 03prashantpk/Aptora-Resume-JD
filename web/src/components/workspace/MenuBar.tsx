import { useState } from "react";
import { Download, Ellipsis, Check, X, ExternalLink } from "lucide-motion";
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

export type SaveState = "idle" | "updating" | "saved" | "error";

// Application MENU BAR (top strip) — Overleaf-style: light menus on the left, centered
// editable document title, actions on the right. Distinct from the per-pane toolbars.
// NOTE: the single brand mark lives in the left rail; the menu bar shows the doc title.

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
  const commit = () => { setEditing(false); const v = draft.trim(); if (v && v !== docName) onRename(v); else setDraft(docName); };

  return (
    <header className="menubar" onMouseLeave={() => setOpenMenu(null)}>
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
          <Download size={16} /> <span>Export PDF</span>
        </Button>
        <IconButton label="More"><Ellipsis size={18} /></IconButton>
      </div>

      {modal === "version" && <VersionModal onClose={() => setModal(null)} />}
      {modal === "developer" && <DeveloperModal onClose={() => setModal(null)} />}
    </header>
  );
}
