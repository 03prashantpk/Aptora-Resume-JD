// Standalone /files page island: the reusable FilesView inside the dashboard shell.
import DashboardShell from "./DashboardShell";
import FilesView from "./FilesView";

export default function FilesPage() {
  return (
    <DashboardShell active="files">
      <FilesView />
    </DashboardShell>
  );
}
