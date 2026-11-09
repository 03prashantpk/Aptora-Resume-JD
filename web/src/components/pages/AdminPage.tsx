// Standalone /admin page island: the AdminView inside the shared dashboard shell.
import DashboardShell from "./DashboardShell";
import AdminView from "./AdminView";

export default function AdminPage() {
  return (
    <DashboardShell active="admin">
      <AdminView />
    </DashboardShell>
  );
}
