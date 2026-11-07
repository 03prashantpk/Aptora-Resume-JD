// Standalone /activity page island: the reusable ActivityView inside the dashboard shell.
import DashboardShell from "./DashboardShell";
import ActivityView from "./ActivityView";

export default function ActivityPage() {
  return (
    <DashboardShell active="activity">
      <ActivityView />
    </DashboardShell>
  );
}
