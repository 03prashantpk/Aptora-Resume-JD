// Reusable chrome for the standalone secured pages (/usage, /activity, /files).
// It reuses the EXACT SAME components as the editor — the top MenuBar (in "dashboard"
// variant) and the icon rail — so the topbar and sidebar are identical everywhere.
// No second bar, no duplicated chrome.
import { ListTree, FileUp, SlidersHorizontal, Settings, Files, ChartBar } from "lucide-motion";
import { BrainIcon } from "../ui/brain";
import { SquareActivityIcon } from "../ui/SquareActivityIcon";
import MenuBar from "../workspace/MenuBar";

export type DashPage = "usage" | "activity" | "files";

const TITLES: Record<DashPage, string> = { usage: "Usage", activity: "Activity", files: "My files" };

export default function DashboardShell({ active, children }: { active: DashPage; children: React.ReactNode }) {
  const viewCls = (p: DashPage) => `rail-item${active === p ? " active" : ""}`;
  return (
    <div className="app">
      {/* Same top bar as the editor (logo · Editor link · page title · Upgrade · ⋯ account). */}
      <MenuBar variant="dashboard" pageTitle={TITLES[active]} />

      <div className="app-body">
        {/* Same icon rail as the editor — identical classes and icons. */}
        <nav className="rail" aria-label="Primary">
          <div className="rail-items">
            <a className="rail-item" href="/?tab=outline" aria-label="Document Outline" data-label="Outline"><ListTree size={19} /></a>
            <a className="rail-item" href="/?tab=import" aria-label="Import Context" data-label="Import"><FileUp size={19} /></a>
            <a className="rail-item" href="/?tab=intelligence" aria-label="Match Intelligence" data-label="AI Intel"><BrainIcon size={19} /></a>
            <a className="rail-item" href="/?tab=instruct" aria-label="Manual & Quick Fixes" data-label="Manual"><SlidersHorizontal size={19} /></a>

            <div className="rail-divider" />

            <a className={viewCls("files")} href="/files" aria-label="My files" data-label="My files" aria-current={active === "files" ? "page" : undefined}><Files size={19} /></a>
            <a className={viewCls("usage")} href="/usage" aria-label="Usage" data-label="Usage" aria-current={active === "usage" ? "page" : undefined}><ChartBar size={19} /></a>
            <a className={viewCls("activity")} href="/activity" aria-label="Activity" data-label="Activity" aria-current={active === "activity" ? "page" : undefined}><SquareActivityIcon size={19} /></a>
          </div>
          <div className="rail-foot">
            <button type="button" className="rail-item" aria-label="Settings" data-label="Settings" disabled><Settings size={19} /></button>
          </div>
        </nav>

        <div className="view-scroll">{children}</div>
      </div>
    </div>
  );
}
