import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, PanelLeftClose, Check, Circle, ListTree, Briefcase, Clock } from "lucide-motion";
import Button from "../ui/Button";
import IconButton from "../ui/IconButton";
import Gauge from "../ui/Gauge";
import { BrainIcon } from "../ui/brain";
import type { DrawerTab } from "./LeftRail";
import type { Analysis } from "@/lib/ai/analyze";

export type Intensity = "light" | "balanced" | "aggressive";
export type TailorPhase = "idle" | "connecting" | "thinking" | "writing" | "compiling" | "done" | "error";

// Ordered phases with human labels (no implementation details).
const PHASES: { key: TailorPhase; label: string }[] = [
  { key: "connecting", label: "Reading your resume and the role" },
  { key: "thinking", label: "Finding your strongest, relevant experience" },
  { key: "writing", label: "Rewriting content to fit the role" },
  { key: "compiling", label: "Updating your document" },
  { key: "done", label: "Done" },
];
const PHASE_ORDER: TailorPhase[] = ["connecting", "thinking", "writing", "compiling", "done"];

// Push drawer (a real layout column, not an overlay). Tabs: Outline / Import / Intelligence.
interface Props {
  tab: DrawerTab;
  onTab: (t: DrawerTab) => void;
  onClose: () => void;
  latex: string;
  onJumpToLine: (line: number) => void;
  jd: string;
  onJdChange: (v: string) => void;
  onTailor: () => void;
  tailoring: boolean;
  resumeName: string | null;
  onUploadName: (n: string | null) => void;
  // Intelligence
  analysis: Analysis | null;
  analyzing: boolean;
  onAnalyze: () => void;
  intensity: Intensity;
  onIntensity: (i: Intensity) => void;
  tailorPhase: TailorPhase;
}

function TailorProgress({ phase }: { phase: TailorPhase }) {
  const activeIdx = PHASE_ORDER.indexOf(phase);
  const pct = phase === "done" ? 100 : Math.max(6, Math.round(((activeIdx + 0.5) / PHASE_ORDER.length) * 100));
  return (
    <div className="tailor-progress">
      <div className="tp-head">
        <span className="tp-spinner" aria-hidden="true" />
        <span>Aptora is tailoring your resume</span>
      </div>
      <div className="tp-bar"><span className="tp-bar-fill" style={{ width: `${pct}%` }} /></div>
      <ul className="tp-steps">
        {PHASES.filter((p) => p.key !== "done").map((p) => {
          const i = PHASE_ORDER.indexOf(p.key);
          const state = phase === "error" ? "idle" : i < activeIdx ? "done" : i === activeIdx ? "active" : "idle";
          return (
            <li key={p.key} className={`tp-step ${state}`}>
              <span className="tp-mark">{state === "done" ? "✓" : state === "active" ? <span className="tp-dot" /> : "○"}</span>
              <span>{p.label}{state === "active" ? "…" : ""}</span>
            </li>
          );
        })}
      </ul>
      <p className="dr-note">Streaming the rewrite into the editor as it's written — you can watch it change live.</p>
      {phase === "error" && <p className="dr-note danger">We couldn't tailor right now. Your previous version is kept.</p>}
    </div>
  );
}

// Parse \section / \section* headings -> {title, line} for the outline.
function parseOutline(latex: string): { title: string; line: number }[] {
  const out: { title: string; line: number }[] = [];
  latex.split("\n").forEach((l, i) => {
    const m = l.match(/\\section\*?\{([^}]*)\}/);
    if (m) out.push({ title: m[1].replace(/\\[a-zA-Z]+/g, "").trim() || "Section", line: i + 1 });
  });
  return out;
}

const TAB_LABEL: Record<DrawerTab, string> = { outline: "Outline", import: "Import", intelligence: "Intelligence" };

export default function Drawer({
  tab, onTab, onClose, latex, onJumpToLine, jd, onJdChange, onTailor, tailoring, resumeName, onUploadName,
  analysis, analyzing, onAnalyze, intensity, onIntensity, tailorPhase,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(resumeName);
  const outline = useMemo(() => parseOutline(latex), [latex]);
  const pick = () => fileRef.current?.click();

  // Reusable uploads (resume PDFs + JD text, ~60 min). Owner-scoped server-side.
  const [savedResumes, setSavedResumes] = useState<{ id: string; name: string | null }[]>([]);
  const [savedJds, setSavedJds] = useState<{ id: string; name: string | null; content: string | null }[]>([]);
  const loadSaved = async () => {
    try {
      const [r, j] = await Promise.all([fetch("/api/uploads?kind=resume_pdf"), fetch("/api/uploads?kind=jd")]);
      if (r.ok) setSavedResumes(((await r.json()) as { uploads: { id: string; name: string | null }[] }).uploads);
      if (j.ok) setSavedJds(((await j.json()) as { uploads: { id: string; name: string | null; content: string | null }[] }).uploads);
    } catch { /* db may be down */ }
  };
  useEffect(() => { if (tab === "import") loadSaved(); }, [tab]);

  const onFilePicked = async (file: File | null) => {
    if (!file) return;
    setName(file.name); onUploadName(file.name);
    // Save to reusable uploads (base64 -> tmpfiles, 60 min) so the user can reuse it.
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = ""; for (const b of buf) bin += String.fromCharCode(b);
      const fileBase64 = btoa(bin);
      await fetch("/api/uploads", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "resume_pdf", name: file.name, fileBase64 }) });
      loadSaved();
    } catch { /* non-fatal */ }
  };

  const saveJd = async () => {
    if (!jd.trim()) return;
    try {
      await fetch("/api/uploads", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "jd", name: jd.slice(0, 40), content: jd }) });
      loadSaved();
    } catch { /* non-fatal */ }
  };

  return (
    <aside className="drawer" aria-label={TAB_LABEL[tab]}>
      <div className="drawer-head">
        <div className="drawer-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "outline"} className={`drawer-tab${tab === "outline" ? " active" : ""}`} onClick={() => onTab("outline")}>
            <ListTree size={14} /> <span>Outline</span>
          </button>
          <button role="tab" aria-selected={tab === "import"} className={`drawer-tab${tab === "import" ? " active" : ""}`} onClick={() => onTab("import")}>
            <Briefcase size={14} /> <span>Import</span>
          </button>
          <button role="tab" aria-selected={tab === "intelligence"} className={`drawer-tab${tab === "intelligence" ? " active" : ""}`} onClick={() => onTab("intelligence")}>
            <BrainIcon size={14} /> <span>AI</span>
          </button>
        </div>
        <IconButton label="Collapse" onClick={onClose}><PanelLeftClose size={16} /></IconButton>
      </div>

      <div className="drawer-body">
        {tab === "outline" && (
          <div className="outline">
            {outline.length === 0 ? (
              <p className="dr-note">Section headings will appear here as you write.</p>
            ) : outline.map((s) => (
              <button key={`${s.line}-${s.title}`} type="button" className="outline-item" onClick={() => onJumpToLine(s.line)}>
                {s.title}
              </button>
            ))}
          </div>
        )}

        {tab === "import" && (
          <>
            <section className="dr-block">
              <h4>Your Resume</h4>
              <button type="button" className="dropzone" onClick={pick}>
                <Upload size={18} className="dz-icon" />
                {name ? <span className="file-name">{name}</span> : <span>Upload PDF Resume</span>}
                <em>{name ? "Imported" : "PDF · up to 10 MB"}</em>
              </button>
              <input ref={fileRef} type="file" accept="application/pdf" hidden
                onChange={(e) => onFilePicked(e.target.files?.[0] ?? null)} />
              {name && <p className="dr-note">Saved for 60 minutes so you can reuse it. Automatic import is coming soon.</p>}
              {savedResumes.length > 0 && (
                <div className="saved-list">
                  <span className="saved-label">Recent</span>
                  {savedResumes.map((r) => (
                    <button key={r.id} type="button" className="saved-item" onClick={() => { setName(r.name); onUploadName(r.name); }}>
                      <Clock size={12} /> {r.name ?? "resume.pdf"}
                    </button>
                  ))}
                </div>
              )}
            </section>
            <section className="dr-block">
              <h4>Job description</h4>
              <textarea className="jd-input" rows={9} value={jd} placeholder="Paste the job description you're targeting…" onChange={(e) => onJdChange(e.target.value)} />
              <div className="jd-actions">
                <button type="button" className="jd-save" onClick={saveJd} disabled={!jd.trim()}>Save JD</button>
              </div>
              {savedJds.length > 0 && (
                <div className="saved-list">
                  <span className="saved-label">Recent</span>
                  {savedJds.map((j) => (
                    <button key={j.id} type="button" className="saved-item" onClick={() => j.content && onJdChange(j.content)}>
                      <Clock size={12} /> {j.name ?? "Job description"}
                    </button>
                  ))}
                </div>
              )}
            </section>
            <section className="dr-block">
              <h4>Tailoring intensity</h4>
              <div className="seg">
                {(["light", "balanced", "aggressive"] as Intensity[]).map((i) => (
                  <button key={i} type="button" className={`seg-btn${intensity === i ? " active" : ""}`} onClick={() => onIntensity(i)}>{i}</button>
                ))}
              </div>
              <p className="dr-note">Light keeps almost everything; aggressive rewrites more. It never invents facts.</p>
            </section>

            <Button variant="ai" className="dr-cta" onClick={onTailor} disabled={!jd.trim() || tailoring}>
              <BrainIcon size={16} /> <span>{tailoring ? "Tailoring…" : "Tailor with Aptora"}</span>
            </Button>
            {!jd.trim() && <p className="dr-note">Add a job description to tailor your Resume.</p>}
          </>
        )}

        {tab === "intelligence" && (
          <div className="intel">
            {tailoring || tailorPhase === "compiling" ? (
              <TailorProgress phase={tailorPhase} />
            ) : !jd.trim() ? (
              <p className="dr-note">Add a job description (Import tab) to analyze your Resume against the role.</p>
            ) : analyzing ? (
              <div className="intel-steps">
                <p>Understanding your experience…</p>
                <p className="muted">Comparing against the role</p>
                <p className="muted">Scoring alignment</p>
              </div>
            ) : analysis ? (
              <>
                <div className="intel-gauges">
                  <Gauge value={analysis.alignment} label="Role fit" />
                  <Gauge value={analysis.identityMatch} label="You" size={84} />
                </div>

                <section className="dr-block">
                  <h4>Strong matches</h4>
                  <ul className="kw-list">
                    {analysis.matched.length ? analysis.matched.map((k) => (
                      <li key={k} className="kw ok"><Check size={13} /> {k}</li>
                    )) : <li className="dr-note">No strong matches detected.</li>}
                  </ul>
                </section>

                <section className="dr-block">
                  <h4>Missing / weak</h4>
                  <ul className="kw-list">
                    {analysis.missing.length ? analysis.missing.map((k) => (
                      <li key={k} className="kw miss"><Circle size={11} /> {k}</li>
                    )) : <li className="dr-note">Nothing critical missing.</li>}
                  </ul>
                </section>

                {analysis.opportunities.length > 0 && (
                  <section className="dr-block">
                    <h4>Opportunities</h4>
                    <ul className="opp-list">
                      {analysis.opportunities.map((o, i) => <li key={i}>{o}</li>)}
                    </ul>
                  </section>
                )}

                <Button variant="secondary" className="dr-cta" onClick={onAnalyze}>Re-analyze</Button>
                <Button variant="ai" className="dr-cta" onClick={onTailor} disabled={tailoring}>
                  <BrainIcon size={15} /> <span>{tailoring ? "Tailoring…" : "Tailor with Aptora"}</span>
                </Button>
              </>
            ) : (
              <>
                <p>Analyze how well your Resume fits this role — match score, matched skills, and gaps.</p>
                <Button variant="ai" className="dr-cta" onClick={onAnalyze}><BrainIcon size={15} /> <span>Analyze with Aptora</span></Button>
                <p className="dr-note">Aptora never invents skills — it only reports what your Resume already shows.</p>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
