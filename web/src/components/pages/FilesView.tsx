import { useEffect, useState } from "react";
import { Download, Trash, ExternalLink } from "lucide-motion";

interface ExportRow { id: string; title: string | null; temp_url: string | null; page_count: number | null; created_at: string; expires_at: string; }
interface UploadRow { id: string; kind: "resume_pdf" | "jd"; name: string | null; content: string | null; temp_url: string | null; created_at: string; expires_at: string; }

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function expiresIn(iso: string): { text: string; soon: boolean } {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { text: "expired", soon: true };
  const m = Math.round(ms / 60000);
  if (m < 60) return { text: `${m} min`, soon: m <= 10 };
  return { text: `${Math.round(m / 60)} h`, soon: false };
}

export default function FilesView() {
  const [exports, setExports] = useState<ExportRow[]>([]);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [e, u] = await Promise.all([fetch("/api/exports"), fetch("/api/uploads")]);
      if (e.ok) setExports(((await e.json()) as { exports: ExportRow[] }).exports);
      if (u.ok) setUploads(((await u.json()) as { uploads: UploadRow[] }).uploads);
    } catch { /* db may be down */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const delUpload = async (id: string) => { await fetch(`/api/uploads/${id}`, { method: "DELETE" }); load(); };

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <p className="view-eyebrow">Workspace</p>
          <h1>My files</h1>
          <p>Reusable inputs and generated PDFs. Job descriptions are kept for 30 days; uploaded resume files and export PDFs are temporary (about an hour to a few hours). You can regenerate anytime.</p>
        </div>
        <a className="view-cta" href="/">Open editor</a>
      </div>

      {loading ? <p className="view-muted">Loading…</p> : (
        <>
          <div className="stat-cards">
            <div className="stat-card">
              <span className="sc-label">Exports</span>
              <span className="sc-value">{exports.length}</span>
              <span className="sc-sub">generated PDFs</span>
            </div>
            <div className="stat-card">
              <span className="sc-label">Saved inputs</span>
              <span className="sc-value">{uploads.length}</span>
              <span className="sc-sub">resumes &amp; job descriptions</span>
            </div>
            <div className="stat-card">
              <span className="sc-label">Retention</span>
              <span className="sc-value">30 days</span>
              <span className="sc-sub">JDs · files &amp; exports shorter</span>
            </div>
          </div>

          <section className="tbl-section">
            <div className="tbl-head-row"><h2>Exports</h2><span className="tbl-count">{exports.length}</span></div>
            {exports.length === 0 ? (
              <div className="tbl-empty">No exports yet. Export a resume from the editor and it appears here.</div>
            ) : (
              <table className="tbl">
                <thead><tr><th>Document</th><th>Pages</th><th>Created</th><th>Expires in</th><th className="ta-r">Actions</th></tr></thead>
                <tbody>
                  {exports.map((x) => {
                    const ex = expiresIn(x.expires_at);
                    return (
                      <tr key={x.id}>
                        <td className="td-title">{x.title ?? "Resume"}</td>
                        <td>{x.page_count ?? "—"}</td>
                        <td className="td-muted">{fmtDate(x.created_at)}</td>
                        <td><span className={`pill${ex.soon ? " warn" : ""}`}>{ex.text}</span></td>
                        <td className="ta-r">
                          {x.temp_url
                            ? <a className="row-act" href={x.temp_url} target="_blank" rel="noreferrer"><Download size={14} /> Download</a>
                            : <span className="td-muted">unavailable</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section className="tbl-section">
            <div className="tbl-head-row"><h2>Saved inputs</h2><span className="tbl-count">{uploads.length}</span></div>
            {uploads.length === 0 ? (
              <div className="tbl-empty">No saved resumes or job descriptions. Uploads are kept for 60 minutes so you don't have to re-upload.</div>
            ) : (
              <table className="tbl">
                <thead><tr><th>Type</th><th>Name</th><th>Created</th><th>Expires in</th><th className="ta-r">Actions</th></tr></thead>
                <tbody>
                  {uploads.map((u) => {
                    const ex = expiresIn(u.expires_at);
                    return (
                      <tr key={u.id}>
                        <td><span className="tag">{u.kind === "jd" ? "Job description" : "Resume PDF"}</span></td>
                        <td className="td-title">{u.name ?? "untitled"}</td>
                        <td className="td-muted">{fmtDate(u.created_at)}</td>
                        <td><span className={`pill${ex.soon ? " warn" : ""}`}>{ex.text}</span></td>
                        <td className="ta-r">
                          {u.temp_url && <a className="row-act" href={u.temp_url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open</a>}
                          <button type="button" className="row-act danger" onClick={() => delUpload(u.id)}><Trash size={13} /> Delete</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
