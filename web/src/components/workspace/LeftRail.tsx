import { useEffect, useState, type ComponentType } from "react";
import { ListTree, FileUp, Settings, Files, ChartBar, SlidersHorizontal, Lock, ShieldCheck } from "lucide-motion";
import { BrainIcon } from "../ui/brain";
import { SquareActivityIcon } from "../ui/SquareActivityIcon";

// Thin icon rail (~48px). Top 4 = drawer tabs (Outline/Import/AI/Manual Adjust). Divider.
// Then the account pages (Files, Usage, Activity). These are ACCOUNT-ONLY: a guest sees
// a lock and is prompted to sign in (the pages themselves also guard server-side), while
// a logged-in user navigates normally. The editor itself stays guest-usable.
export type DrawerTab = "outline" | "import" | "intelligence" | "instruct";
export type View = "editor" | "files" | "usage" | "activity";

interface Props {
  drawerOpen: boolean;
  activeTab: DrawerTab | null;
  onToggle: (tab: DrawerTab) => void;
  view: View;
  onOpenAuth?: (mode: "login" | "signup") => void;
}

export default function LeftRail({ drawerOpen, activeTab, onToggle, view, onOpenAuth }: Props) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d) { setAuthed(!!d.authenticated); setIsAdmin(!!d.user?.isAdmin); } }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const tabCls = (t: DrawerTab) => `rail-item${drawerOpen && activeTab === t && view === "editor" ? " active" : ""}`;
  const viewCls = (v: View) => `rail-item${view === v ? " active" : ""}${authed === false ? " locked" : ""}`;

  // Account pages: real links when logged in; a sign-in prompt for guests (never a
  // navigate-then-bounce). authed === null (still loading) → treat as link; the page
  // guard is the real enforcement, this is just UX.
  const accountItem = (v: Exclude<View, "editor">, label: string, Icon: ComponentType<{ size?: number }>) => {
    const guest = authed === false;
    const common = { className: viewCls(v), "aria-label": label, "data-label": guest ? `${label} · sign in` : label } as const;
    return guest
      ? <button type="button" {...common} onClick={() => onOpenAuth?.("login")}><Icon size={19} />{guest && <span className="rail-lock"><Lock size={9} /></span>}</button>
      : <a {...common} href={`/${v}`}><Icon size={19} /></a>;
  };

  return (
    <nav className="rail" aria-label="Primary">
      <div className="rail-items">
        <button type="button" className={tabCls("outline")} onClick={() => onToggle("outline")} aria-label="Document Outline" data-label="Outline">
          <ListTree size={19} />
        </button>
        <button type="button" className={tabCls("import")} onClick={() => onToggle("import")} aria-label="Import Context" data-label="Import">
          <FileUp size={19} />
        </button>
        <button type="button" className={tabCls("intelligence")} onClick={() => onToggle("intelligence")} aria-label="Match Intelligence" data-label="AI Intel">
          <BrainIcon size={19} />
        </button>
        <button type="button" className={tabCls("instruct")} onClick={() => onToggle("instruct")} aria-label="Manual & Quick Fixes" data-label="Manual">
          <SlidersHorizontal size={19} />
        </button>

        <div className="rail-divider" />

        {accountItem("files", "My files", Files)}
        {accountItem("usage", "Usage", ChartBar)}
        {accountItem("activity", "Activity", SquareActivityIcon)}
      </div>

      <div className="rail-foot">
        {isAdmin && (
          <a className="rail-item" href="/admin" aria-label="Admin" data-label="Admin">
            <ShieldCheck size={19} />
          </a>
        )}
        <button type="button" className="rail-item" aria-label="Settings" data-label="Settings" disabled>
          <Settings size={19} />
        </button>
      </div>
    </nav>
  );
}
