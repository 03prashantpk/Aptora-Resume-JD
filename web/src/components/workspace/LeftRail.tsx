import { ListTree, FileUp, Settings, Files, ChartBar, SlidersHorizontal } from "lucide-motion";
import { BrainIcon } from "../ui/brain";

// Thin icon rail (~48px). Top 4 = drawer tabs (Outline/Import/AI/Manual Adjust). Divider.
// Then in-shell views (Files, Usage) that swap the CENTER content.
export type DrawerTab = "outline" | "import" | "intelligence" | "instruct";
export type View = "editor" | "files" | "usage";

interface Props {
  drawerOpen: boolean;
  activeTab: DrawerTab | null;
  onToggle: (tab: DrawerTab) => void;
  view: View;
  onView: (v: View) => void;
}

export default function LeftRail({ drawerOpen, activeTab, onToggle, view, onView }: Props) {
  const tabCls = (t: DrawerTab) => `rail-item${drawerOpen && activeTab === t && view === "editor" ? " active" : ""}`;
  const viewCls = (v: View) => `rail-item${view === v ? " active" : ""}`;
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

        <button type="button" className={viewCls("files")} onClick={() => onView(view === "files" ? "editor" : "files")} aria-label="My files" data-label="My files">
          <Files size={19} />
        </button>
        <button type="button" className={viewCls("usage")} onClick={() => onView(view === "usage" ? "editor" : "usage")} aria-label="Usage" data-label="Usage">
          <ChartBar size={19} />
        </button>
      </div>

      <div className="rail-foot">
        <button type="button" className="rail-item" aria-label="Settings" data-label="Settings" disabled>
          <Settings size={19} />
        </button>
      </div>
    </nav>
  );
}
