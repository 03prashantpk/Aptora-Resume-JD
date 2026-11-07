// Standalone /usage page island: the reusable UsageView inside the shared dashboard
// shell. onOpenAuth routes to the editor's in-app auth (the auth modal lives there).
import DashboardShell from "./DashboardShell";
import UsageView from "./UsageView";

export default function UsagePage() {
  return (
    <DashboardShell active="usage">
      <UsageView onOpenAuth={(mode) => { window.location.href = `/?auth=${mode}`; }} />
    </DashboardShell>
  );
}
