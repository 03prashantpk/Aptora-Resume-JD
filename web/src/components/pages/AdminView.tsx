// Admin area — a clean, read-only tabbed view (Users · Contact · Tickets) driven by an
// extensible TABS config. Each tab lazily fetches its admin API (all guarded by
// requireAdmin server-side). Reuses dashboard tokens + the shared planBadge helper. No
// destructive actions; empty tables show a calm empty state (project rule 33).
import { useEffect, useState } from "react";
import { Users, Mail, Ticket, Eye } from "lucide-motion";
import { planBadge } from "@/lib/utils";
import WinBar from "../ui/WinBar";

const TABS = [
  { key: "users", label: "Users", Icon: Users },
  { key: "contact", label: "Contact", Icon: Mail },
  { key: "tickets", label: "Tickets", Icon: Ticket },
] as const;

type TabKey = (typeof TABS)[number]["key"];

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  verified: boolean;
  is_admin: boolean;
  has_key: boolean;
  credits: number;
  pro_until: string | null;
  isPro: boolean;
  total_ai: number;
  total_exports: number;
}
interface ContactRow { id: string; name: string | null; email: string; message: string; created_at: string }
interface TicketRow { id: string; owner_id: string; email: string | null; subject: string | null; body: string | null; status: string; created_at: string }

function fmtDate(s: string): string {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function truncate(s: string | null, n = 70): string {
  if (!s) return "—";
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** One labelled row inside the detail popup. */
function DetailRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="adm-detail-row">
      <span className="adm-detail-label">{label}</span>
      <div className={`adm-detail-value${mono ? " mono" : ""}`}>{value || "—"}</div>
    </div>
  );
}

/** Shared read-only detail popup (mac-style WinBar header). Scrim click + the red dot close. */
function DetailModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal adm-detail-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <WinBar onClose={onClose} title={title} light />
        <div className="adm-detail-body">{children}</div>
      </div>
    </div>
  );
}

export default function AdminView() {
  const [tab, setTab] = useState<TabKey>("users");
  return (
    <div className="view view-wide">
      <div className="view-head">
        <div>
          <p className="view-eyebrow">Admin</p>
          <h1>Operations</h1>
          <p>Accounts, inbound messages and support tickets — read-only.</p>
        </div>
        <a className="view-cta" href="/">Open editor</a>
      </div>

      <div className="adm-tabs" role="tablist" aria-label="Admin sections">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`adm-tab${tab === key ? " active" : ""}`}
            onClick={() => setTab(key)}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {tab === "users" && <UsersTab />}
      {tab === "contact" && <ContactTab />}
      {tab === "tickets" && <TicketsTab />}
    </div>
  );
}

// Generic lazy loader for a tab's API; returns { data, loading }.
function useTabData<T>(url: string, pick: (j: unknown) => T[]): { rows: T[]; loading: boolean } {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive) setRows(j ? pick(j) : []); })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return { rows, loading };
}

function UsersTab() {
  const { rows, loading } = useTabData<UserRow>("/api/admin/users", (j) => (j as { users?: UserRow[] }).users ?? []);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? rows.filter((r) => r.email.toLowerCase().includes(needle) || (r.name ?? "").toLowerCase().includes(needle))
    : rows;

  if (loading) return <div className="adm-skel" />;
  return (
    <>
      <div className="adm-toolbar">
        <input
          className="adm-search"
          type="search"
          placeholder="Filter by email or name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filter users"
        />
        <span className="adm-count">{filtered.length} of {rows.length}</span>
      </div>
      {filtered.length === 0 ? (
        <div className="adm-empty"><strong>No users</strong>{needle ? "No matches for your filter." : "No accounts yet."}</div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Email</th><th>Name</th><th>Verified</th><th>Role</th><th>Plan</th>
                <th className="adm-num">Credits</th><th className="adm-num">AI runs</th><th className="adm-num">Exports</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const badge = planBadge({ hasOwnKey: r.has_key, isPro: r.isPro, credits: r.credits });
                return (
                  <tr key={r.id}>
                    <td className="adm-email">{r.email}</td>
                    <td>{r.name ?? "—"}</td>
                    <td><span className={`adm-chip ${r.verified ? "yes" : "no"}`}>{r.verified ? "Yes" : "No"}</span></td>
                    <td>{r.is_admin ? <span className="adm-chip admin">Admin</span> : <span className="adm-chip no">User</span>}</td>
                    <td><span className={`u3-pill tone-${badge.tone}`}>{badge.label}</span></td>
                    <td className="adm-num">{r.credits}</td>
                    <td className="adm-num">{r.total_ai}</td>
                    <td className="adm-num">{r.total_exports}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ViewButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="adm-view-btn" onClick={onClick} aria-label="View details">
      <Eye size={14} /> View
    </button>
  );
}

function ContactTab() {
  const { rows, loading } = useTabData<ContactRow>("/api/admin/contact", (j) => (j as { messages?: ContactRow[] }).messages ?? []);
  const [open, setOpen] = useState<ContactRow | null>(null);
  if (loading) return <div className="adm-skel" />;
  if (rows.length === 0) return <div className="adm-empty"><strong>No messages</strong>No contact submissions yet.</div>;
  return (
    <>
      <div className="adm-toolbar"><span className="adm-count">{rows.length} message{rows.length === 1 ? "" : "s"}</span></div>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr><th>From</th><th>Email</th><th>Message</th><th>Received</th><th className="adm-actions-col" /></tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td className="adm-email">{m.name ?? "—"}</td>
                <td>{m.email}</td>
                <td className="adm-preview">{truncate(m.message)}</td>
                <td className="adm-card-time">{fmtDate(m.created_at)}</td>
                <td className="adm-actions-col"><ViewButton onClick={() => setOpen(m)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <DetailModal title="Contact message" onClose={() => setOpen(null)}>
          <DetailRow label="From" value={open.name ?? "—"} />
          <DetailRow label="Email" value={<a href={`mailto:${open.email}`}>{open.email}</a>} />
          <DetailRow label="Received" value={fmtDate(open.created_at)} />
          <DetailRow label="Message" value={<div className="adm-detail-long">{open.message}</div>} />
        </DetailModal>
      )}
    </>
  );
}

function TicketsTab() {
  const { rows, loading } = useTabData<TicketRow>("/api/admin/tickets", (j) => (j as { tickets?: TicketRow[] }).tickets ?? []);
  const [open, setOpen] = useState<TicketRow | null>(null);
  if (loading) return <div className="adm-skel" />;
  if (rows.length === 0) return <div className="adm-empty"><strong>No tickets yet.</strong>Support tickets will show up here.</div>;
  return (
    <>
      <div className="adm-toolbar"><span className="adm-count">{rows.length} ticket{rows.length === 1 ? "" : "s"}</span></div>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr><th>Subject</th><th>From</th><th>Status</th><th>Opened</th><th className="adm-actions-col" /></tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="adm-email">{truncate(t.subject, 50)}</td>
                <td>{t.email ?? t.owner_id}</td>
                <td><span className={`adm-chip ${t.status === "open" ? "yes" : "no"}`}>{t.status}</span></td>
                <td className="adm-card-time">{fmtDate(t.created_at)}</td>
                <td className="adm-actions-col"><ViewButton onClick={() => setOpen(t)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <DetailModal title="Support ticket" onClose={() => setOpen(null)}>
          <DetailRow label="Subject" value={open.subject ?? "—"} />
          <DetailRow label="From" value={open.email ?? "—"} />
          <DetailRow label="Owner" value={open.owner_id} mono />
          <DetailRow label="Status" value={<span className={`adm-chip ${open.status === "open" ? "yes" : "no"}`}>{open.status}</span>} />
          <DetailRow label="Opened" value={fmtDate(open.created_at)} />
          <DetailRow label="Details" value={<div className="adm-detail-long">{open.body ?? "—"}</div>} />
        </DetailModal>
      )}
    </>
  );
}
