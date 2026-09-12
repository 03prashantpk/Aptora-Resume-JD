import { useEffect, useMemo, useRef, useState } from "react";
import {
  Upload, ChevronLeft, Check, Circle, ListTree, FileUp, Clock,
  User, Code, Layers, GraduationCap, Award, Sparkles, Target,
  SlidersHorizontal, Minimize2, Type, Zap, Scissors, FileText, Briefcase,
  Info,
} from "lucide-motion";
import Button from "../ui/Button";
import IconButton from "../ui/IconButton";
import Gauge from "../ui/Gauge";
import { BrainIcon } from "../ui/brain";
import type { DrawerTab } from "./LeftRail";
import type { Analysis } from "@/lib/ai/analyze";

export type Intensity = "light" | "balanced" | "aggressive";
export type TailorPhase = "idle" | "connecting" | "thinking" | "writing" | "compiling" | "done" | "error";

const PHASES: { key: TailorPhase; label: string }[] = [
  { key: "connecting", label: "Reading resume and role context" },
  { key: "thinking", label: "Aligning target role & skill gaps" },
  { key: "writing", label: "Rewriting title, summary & bullets" },
  { key: "compiling", label: "Compiling LaTeX & verifying layout" },
  { key: "done", label: "Complete! Updating fit score..." },
];
const PHASE_ORDER: TailorPhase[] = ["connecting", "thinking", "writing", "compiling", "done"];

const TAB_META: Record<DrawerTab, { title: string; tooltip: string }> = {
  outline: {
    title: "Outline",
    tooltip: "Jump directly to sections in your LaTeX source.",
  },
  import: {
    title: "Import",
    tooltip: "Upload resume PDF and paste target job description.",
  },
  intelligence: {
    title: "AI Analysis",
    tooltip: "Fit score, detected role, and actionable gap analysis.",
  },
  instruct: {
    title: "Manual Edit",
    tooltip: "Natural language prompt to adjust layout, margins, or content.",
  },
};

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
  analysis: Analysis | null;
  analyzing: boolean;
  onAnalyze: () => void;
  intensity: Intensity;
  onIntensity: (i: Intensity) => void;
  tailorPhase: TailorPhase;
  onInstruct?: (instruction: string) => Promise<boolean>;
  instructing?: boolean;
}

function TailorProgress({ phase }: { phase: TailorPhase }) {
  const activeIdx = PHASE_ORDER.indexOf(phase);
  const pct = phase === "done" ? 100 : Math.max(8, Math.round(((activeIdx + 0.5) / PHASE_ORDER.length) * 100));
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
      <p className="dr-note">Pinpoint updates to role title, summary, skills & bullets.</p>
      {phase === "error" && <p className="dr-note danger">Could not tailor right now. Kept previous version.</p>}
    </div>
  );
}

export interface OutlineSection {
  title: string;
  line: number;
  itemCount: number;
  iconType: "user" | "briefcase" | "code" | "layers" | "graduation" | "award" | "sparkles";
}

function parseOutline(latex: string): OutlineSection[] {
  const lines = latex.split("\n");
  const rawSections: { title: string; line: number; startIndex: number }[] = [];

  lines.forEach((l, i) => {
    const m = l.match(/\\section\*?\{([^}]*)\}/);
    if (m) {
      let decoded = m[1]
        .replace(/\\&/g, "&")
        .replace(/\\[a-zA-Z]+/g, "")
        .replace(/[{}]/g, "")
        .trim();
      if (!decoded) decoded = "Section";
      rawSections.push({ title: decoded, line: i + 1, startIndex: i });
    }
  });

  return rawSections.map((sec, idx) => {
    const nextLine = idx < rawSections.length - 1 ? rawSections[idx + 1].startIndex : lines.length;
    const secLines = lines.slice(sec.startIndex, nextLine).join("\n");
    const itemMatches = secLines.match(/\\(?:item|resumeItem)\b/g);
    const itemCount = itemMatches ? itemMatches.length : 0;

    const lower = sec.title.toLowerCase();
    let iconType: OutlineSection["iconType"] = "sparkles";
    if (lower.includes("summary") || lower.includes("profile") || lower.includes("about")) iconType = "user";
    else if (lower.includes("experience") || lower.includes("employment") || lower.includes("work")) iconType = "briefcase";
    else if (lower.includes("project")) iconType = "code";
    else if (lower.includes("skill")) iconType = "layers";
    else if (lower.includes("education")) iconType = "graduation";
    else if (lower.includes("cert") || lower.includes("award")) iconType = "award";

    return {
      title: sec.title,
      line: sec.line,
      itemCount,
      iconType,
    };
  });
}

export default function Drawer({
  tab, onTab, onClose, latex, onJumpToLine, jd, onJdChange, onTailor, tailoring, resumeName, onUploadName,
  analysis, analyzing, onAnalyze, intensity, onIntensity, tailorPhase, onInstruct, instructing,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(resumeName);
  const outline = useMemo(() => parseOutline(latex), [latex]);
  const pick = () => fileRef.current?.click();
  const [savedResumes, setSavedResumes] = useState<{ id: string; name: string | null }[]>([]);
  const [savedJds, setSavedJds] = useState<{ id: string; name: string | null; content: string | null }[]>([]);

  // Manual Update state
  const [instructInput, setInstructInput] = useState("");
  const [instructStatus, setInstructStatus] = useState<string | null>(null);
  const [saveJdStatus, setSaveJdStatus] = useState<string | null>(null);

  const handleApplyInstruct = async (cmd?: string) => {
    const text = cmd ?? instructInput;
    if (!text.trim() || !onInstruct) return;
    setInstructStatus("Applying update…");
    const ok = await onInstruct(text);
    if (ok) {
      setInstructStatus(`✓ Updated: "${text.slice(0, 45)}${text.length > 45 ? "..." : ""}"`);
      if (!cmd) setInstructInput("");
    } else {
      setInstructStatus("Could not apply update. Check input and try again.");
    }
  };

  const loadSaved = async () => {
    try {
      const [r, j] = await Promise.all([fetch("/api/uploads?kind=resume_pdf"), fetch("/api/uploads?kind=jd")]);
      if (r.ok) setSavedResumes(((await r.json()) as { uploads: { id: string; name: string | null }[] }).uploads);
      if (j.ok) {
        const jds = ((await j.json()) as { uploads: { id: string; name: string | null; content: string | null }[] }).uploads;
        setSavedJds(jds);
        // Automatically populate JD textarea if empty and saved JD exists
        if (!jd.trim() && jds.length > 0 && jds[0].content) {
          onJdChange(jds[0].content);
        }
      }
    } catch { /* db may be down */ }
  };

  useEffect(() => { if (tab === "import") loadSaved(); }, [tab]);

  const onFilePicked = async (file: File | null) => {
    if (!file) return;
    setName(file.name); onUploadName(file.name);
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
    setSaveJdStatus("Saving…");
    try {
      const title = jd.trim().slice(0, 36).replace(/[\r\n]+/g, " ");
      const res = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "jd", name: title, content: jd }),
      });
      if (res.ok) {
        setSaveJdStatus("✓ Saved");
        setTimeout(() => setSaveJdStatus(null), 3000);
        loadSaved();
      } else {
        setSaveJdStatus("Failed");
      }
    } catch {
      setSaveJdStatus("Saved");
    }
  };

  const currentMeta = TAB_META[tab] || TAB_META.intelligence;

  return (
    <aside className="drawer" aria-label={currentMeta.title}>
      <header className="drawer-header-bar">
        <div className="dh-left">
          <h2 className="dh-title">{currentMeta.title}</h2>
          <div className="dh-tooltip-wrap" data-tooltip={currentMeta.tooltip}>
            <Info size={11.5} className="dh-info-icon" />
          </div>
        </div>
        <button
          type="button"
          className="dh-close-btn"
          onClick={onClose}
          aria-label="Collapse drawer"
          title="Collapse panel (Esc)"
        >
          <ChevronLeft size={16} />
        </button>
      </header>

      <div className="drawer-body">
        {tab === "outline" && (
          <div className="outline">
            {outline.length === 0 ? (
              <p className="dr-note">Section headings will appear here as you write.</p>
            ) : (
              outline.map((s) => (
                <button
                  key={`${s.line}-${s.title}`}
                  type="button"
                  className="outline-item"
                  onClick={() => onJumpToLine(s.line)}
                >
                  <div className="outline-left">
                    {s.iconType === "user" && <User size={13} className="outline-icon" />}
                    {s.iconType === "briefcase" && <Briefcase size={13} className="outline-icon" />}
                    {s.iconType === "code" && <Code size={13} className="outline-icon" />}
                    {s.iconType === "layers" && <Layers size={13} className="outline-icon" />}
                    {s.iconType === "graduation" && <GraduationCap size={13} className="outline-icon" />}
                    {s.iconType === "award" && <Award size={13} className="outline-icon" />}
                    {s.iconType === "sparkles" && <Sparkles size={13} className="outline-icon" />}
                    <span className="outline-title">{s.title}</span>
                  </div>
                  <div className="outline-meta">
                    {s.itemCount > 0 && <span className="outline-pill">{s.itemCount} items</span>}
                    <span className="outline-line">L{s.line}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {tab === "import" && (
          <>
            <section className="dr-block">
              <div className="section-head-wrap">
                <h4>Your Resume</h4>
                <span className="section-tag">PDF</span>
              </div>
              <button type="button" className="dropzone" onClick={pick}>
                <FileUp size={20} className="dz-icon" />
                {name ? <span className="file-name">{name}</span> : <span>Upload PDF</span>}
                <em>{name ? "Uploaded & ready" : "Click or drop file (Max 10 MB)"}</em>
              </button>
              <input ref={fileRef} type="file" accept="application/pdf" hidden
                onChange={(e) => onFilePicked(e.target.files?.[0] ?? null)} />
              {savedResumes.length > 0 && (
                <div className="saved-list">
                  <span className="saved-label">Recent Resumes</span>
                  {savedResumes.map((r) => (
                    <button key={r.id} type="button" className="saved-item" onClick={() => { setName(r.name); onUploadName(r.name); }}>
                      <Clock size={12} /> <span>{r.name ?? "resume.pdf"}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="dr-block">
              <div className="section-head-wrap">
                <h4>Job Description</h4>
                <span className="section-tag">{jd.trim() ? `${jd.trim().split(/\s+/).length} words` : "Required"}</span>
              </div>
              <textarea className="jd-input" rows={6} value={jd} placeholder="Paste job description or role requirements here…" onChange={(e) => onJdChange(e.target.value)} />
              <div className="jd-actions">
                {saveJdStatus && <span className="save-feedback">{saveJdStatus}</span>}
                <button type="button" className="jd-save" onClick={saveJd} disabled={!jd.trim()}>Save JD</button>
              </div>
              {savedJds.length > 0 && (
                <div className="saved-list">
                  <span className="saved-label">Saved Library ({savedJds.length})</span>
                  {savedJds.map((j) => (
                    <button
                      key={j.id}
                      type="button"
                      className="saved-item"
                      onClick={() => j.content && onJdChange(j.content)}
                      title="Click to load this JD into the editor"
                    >
                      <Clock size={12} /> <span>{j.name ?? "Job description"}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="dr-block">
              <div className="section-head-wrap">
                <h4>Tailoring Mode</h4>
                <span className="section-tag capitalize">{intensity}</span>
              </div>
              <div className="seg">
                {(["light", "balanced", "aggressive"] as Intensity[]).map((i) => (
                  <button key={i} type="button" className={`seg-btn${intensity === i ? " active" : ""}`} onClick={() => onIntensity(i)}>{i}</button>
                ))}
              </div>
            </section>

            <Button variant="ai" className="dr-cta" onClick={onTailor} disabled={!jd.trim() || tailoring}>
              <BrainIcon size={16} /> <span>{tailoring ? "Tailoring…" : "Tailor"}</span>
            </Button>
            {!jd.trim() && <p className="dr-note">Paste a target job description above to enable AI-powered tailoring.</p>}
          </>
        )}

        {tab === "intelligence" && (
          <div className="intel">
            {tailoring || tailorPhase === "compiling" || tailorPhase === "error" ? (
              <TailorProgress phase={tailorPhase} />
            ) : !jd.trim() ? (
              <div className="empty-intel-card">
                <Target size={28} className="empty-intel-icon" />
                <h4>No Target Role Set</h4>
                <p>Paste a job description in the <strong>Import</strong> tab to inspect fit scores and skills gaps.</p>
                <button type="button" className="dr-link-btn" onClick={() => onTab("import")}>
                  Import JD →
                </button>
              </div>
            ) : analyzing ? (
              <div className="intel-steps">
                <p>Analyzing role alignment…</p>
                <p className="muted">Evaluating experience against requirements</p>
                <p className="muted">Predicting gap bridge timelines</p>
              </div>
            ) : analysis ? (
              <>
                {/* Target Role Banner */}
                {analysis.targetRole && (
                  <div className="target-role-card">
                    <div className="target-role-head">
                      <Target size={13} />
                      <span>Target Role Detected</span>
                    </div>
                    <div className="target-role-name">{analysis.targetRole}</div>
                  </div>
                )}

                {/* Gauges */}
                <div className="intel-gauges">
                  <Gauge value={analysis.alignment} label="Role Fit" />
                  <Gauge value={analysis.identityMatch} label="Profile" size={84} />
                </div>

                {/* Preparation Time Prediction */}
                <div className="prep-time-box">
                  <div className="prep-time-head">
                    <div className="prep-label-wrap">
                      <Clock size={13} />
                      <span>Est. Prep Time</span>
                    </div>
                    <span className="prep-badge">{analysis.prepTimeEstimate || "2 - 3 Weeks"}</span>
                  </div>
                  <p className="prep-desc">{analysis.prepSummary}</p>
                </div>

                {/* Structured Gaps */}
                {analysis.gaps && analysis.gaps.length > 0 ? (
                  <section className="dr-block">
                    <div className="section-head-wrap">
                      <h4>Skill Gaps & Actions</h4>
                      <span className="section-tag">{analysis.gaps.length} detected</span>
                    </div>
                    <div className="gap-list">
                      {analysis.gaps.map((g, i) => (
                        <div key={i} className={`gap-card ${g.severity}`}>
                          <div className="gap-card-head">
                            <span className="gap-skill">{g.skill}</span>
                            <div className="gap-tags">
                              <span className={`gap-sev ${g.severity}`}>{g.severity}</span>
                              <span className="gap-time"><Clock size={10} /> {g.timeToBridge}</span>
                            </div>
                          </div>
                          <p className="gap-action">{g.action}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : analysis.missing && analysis.missing.length > 0 ? (
                  <section className="dr-block">
                    <h4>Missing / Weak</h4>
                    <ul className="kw-list">
                      {analysis.missing.map((k) => (
                        <li key={k} className="kw miss"><Circle size={11} /> {k}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {/* Strong Matches */}
                <section className="dr-block">
                  <div className="section-head-wrap">
                    <h4>Strong Matches</h4>
                    <span className="section-tag">{analysis.matched.length} verified</span>
                  </div>
                  <ul className="kw-list">
                    {analysis.matched.length ? analysis.matched.map((k) => (
                      <li key={k} className="kw ok"><Check size={12} /> {k}</li>
                    )) : <li className="dr-note">No strong matches detected yet.</li>}
                  </ul>
                </section>

                {/* Suggested Alternative Career Roles */}
                {analysis.suggestedRoles && analysis.suggestedRoles.length > 0 && (
                  <section className="dr-block">
                    <div className="section-head-wrap">
                      <h4>Suggested Career Roles</h4>
                      <span className="section-tag">{analysis.suggestedRoles.length} matches</span>
                    </div>
                    <div className="suggested-roles-list">
                      {analysis.suggestedRoles.map((r, i) => (
                        <div key={i} className="role-card">
                          <div className="role-card-top">
                            <span className="role-card-title">{r.title}</span>
                            <span className={`role-fit-pill ${r.matchScore >= 80 ? "high" : r.matchScore >= 60 ? "med" : "grow"}`}>
                              {r.matchScore}%
                            </span>
                          </div>
                          <div className="role-card-prep">
                            <Clock size={11} /> <span>Prep Time: <strong>{r.prepTime}</strong></span>
                          </div>
                          <p className="role-card-why">{r.whyFit}</p>
                          <button
                            type="button"
                            className="role-target-btn"
                            onClick={() => {
                              onJdChange(`Role: ${r.title}\nKey Domain Focus: ${r.whyFit}`);
                              onTab("import");
                            }}
                          >
                            Target Role →
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Opportunities */}
                {analysis.opportunities.length > 0 && (
                  <section className="dr-block">
                    <h4>Framing Recommendations</h4>
                    <ul className="opp-list">
                      {analysis.opportunities.map((o, i) => <li key={i}>{o}</li>)}
                    </ul>
                  </section>
                )}

                {/* Action Bar */}
                <div className="intel-actions-bar">
                  <Button variant="ai" className="dr-cta" onClick={onTailor} disabled={tailoring}>
                    <BrainIcon size={15} /> <span>{tailoring ? "Tailoring…" : "Tailor"}</span>
                  </Button>
                  <div className="intel-sub-actions">
                    <button type="button" className="intel-sub-btn" onClick={() => onTab("instruct")}>
                      <SlidersHorizontal size={13} /> <span>Manual Adjust</span>
                    </button>
                    <button type="button" className="intel-sub-btn" onClick={onAnalyze} disabled={analyzing}>
                      <span>{analyzing ? "Scoring…" : "Re-score"}</span>
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-intel-card">
                <Target size={28} className="empty-intel-icon" />
                <h4>Fit Analysis Ready</h4>
                <p>Analyze your resume match percentage, gap closure predictions, and career role fits.</p>
                <Button variant="ai" className="dr-cta" onClick={onAnalyze}>
                  <BrainIcon size={15} /> <span>Run Fit</span>
                </Button>
              </div>
            )}
          </div>
        )}

        {tab === "instruct" && (
          <div className="instruct-view">
            <section className="dr-block">
              <div className="section-head-wrap">
                <h4>Custom Prompt Edit</h4>
                <span className="section-tag">AI Powered</span>
              </div>
              <textarea
                className="jd-input"
                rows={3}
                value={instructInput}
                placeholder="e.g. Fit to 1 page, reduce margins to 0.35in, shorten summary, or add Docker to projects..."
                onChange={(e) => setInstructInput(e.target.value)}
              />
              <Button
                variant="ai"
                className="dr-cta"
                onClick={() => handleApplyInstruct()}
                disabled={!instructInput.trim() || instructing}
              >
                <Sparkles size={14} /> <span>{instructing ? "Applying…" : "Apply Edit"}</span>
              </Button>
              {instructStatus && (
                <p className="instruct-feedback">{instructStatus}</p>
              )}
            </section>

            <section className="dr-block">
              <div className="section-head-wrap">
                <h4>1-Click Page & Layout Fixes</h4>
                <span className="section-tag">Instant</span>
              </div>
              <div className="quick-chips-grid">
                <button
                  type="button"
                  className="quick-chip"
                  onClick={() => handleApplyInstruct("Fit to 1 page with compact margins and 10pt font")}
                  disabled={instructing}
                >
                  <div className="qc-icon-wrap"><Minimize2 size={14} /></div>
                  <div className="qc-text">
                    <strong>Fit 1 Page</strong>
                    <small>Compact margins & 10pt</small>
                  </div>
                </button>
                <button
                  type="button"
                  className="quick-chip"
                  onClick={() => handleApplyInstruct("Reduce margins to 0.45in")}
                  disabled={instructing}
                >
                  <div className="qc-icon-wrap"><SlidersHorizontal size={14} /></div>
                  <div className="qc-text">
                    <strong>0.45in Margins</strong>
                    <small>Maximize space</small>
                  </div>
                </button>
                <button
                  type="button"
                  className="quick-chip"
                  onClick={() => handleApplyInstruct("Set document base font size to 10pt")}
                  disabled={instructing}
                >
                  <div className="qc-icon-wrap"><Type size={14} /></div>
                  <div className="qc-text">
                    <strong>10pt Font</strong>
                    <small>Compact density</small>
                  </div>
                </button>
                <button
                  type="button"
                  className="quick-chip"
                  onClick={() => handleApplyInstruct("Set document base font size to 11pt")}
                  disabled={instructing}
                >
                  <div className="qc-icon-wrap"><Type size={14} /></div>
                  <div className="qc-text">
                    <strong>11pt Font</strong>
                    <small>Balanced body</small>
                  </div>
                </button>
              </div>
            </section>

            <section className="dr-block">
              <div className="section-head-wrap">
                <h4>Content Refinements</h4>
                <span className="section-tag">Surgical</span>
              </div>
              <div className="quick-chips-list">
                <button
                  type="button"
                  className="quick-chip-row"
                  onClick={() => handleApplyInstruct("Make the professional summary 30% shorter and punchier")}
                  disabled={instructing}
                >
                  <Scissors size={13} className="qc-row-icon" />
                  <span>Condense Summary</span>
                </button>
                <button
                  type="button"
                  className="quick-chip-row"
                  onClick={() => handleApplyInstruct("Strengthen action verbs and highlight quantified metrics in experience bullets")}
                  disabled={instructing}
                >
                  <Zap size={13} className="qc-row-icon" />
                  <span>Quantify Bullets</span>
                </button>
                <button
                  type="button"
                  className="quick-chip-row"
                  onClick={() => handleApplyInstruct("Ensure all technical skills are categorized cleanly")}
                  disabled={instructing}
                >
                  <Layers size={13} className="qc-row-icon" />
                  <span>Clean Taxonomy</span>
                </button>
              </div>
            </section>
          </div>
        )}
      </div>

      <footer className="drawer-footer">
        <a href="https://enally.in" target="_blank" rel="noopener noreferrer" className="drawer-footer-link">
          Developed by Enally.in with <span className="drawer-footer-heart">💝</span>
        </a>
      </footer>
    </aside>
  );
}
