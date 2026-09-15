import { useCallback, useEffect, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

// Below this width we treat the device as "mobile": panels stack column-wise
// (vertically) and stay resizable via horizontal drag handles; the left rail
// becomes a floating bottom menu bar. Kept in sync with the CSS breakpoint.
const MOBILE_QUERY = "(max-width: 820px)";
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return isMobile;
}
import MenuBar, { type SaveState } from "./MenuBar";
import LeftRail, { type DrawerTab } from "./LeftRail";
import Drawer, { type Intensity, type TailorPhase } from "./Drawer";
import EditorPane from "./EditorPane";
import PreviewPane from "./PreviewPane";
import FilesView from "../pages/FilesView";
import UsageView from "../pages/UsageView";
import Toaster, { toast } from "../ui/toast";
import type { View } from "./LeftRail";
import type { CompileResult, TemplateId } from "@/lib/types";
import type { Analysis } from "@/lib/ai/analyze";
import { detectTemplate, applyTemplateToLatex } from "@/lib/templates";

// Aptora: menu bar (top) · [ icon rail | (drawer ‖ editor ‖ preview) all resizable ].
// AI tailoring streams new content into the editor live, with visible progress.

export default function Workspace() {
  const isMobile = useIsMobile();
  const [latex, setLatex] = useState("");
  const [templateId, setTemplateId] = useState<TemplateId>("T02");
  const [jd, setJd] = useState("");
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [docName, setDocName] = useState("Untitled Resume");
  const [resumeName, setResumeName] = useState<string | null>(null);

  const [documentId, setDocumentId] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [usage, setUsage] = useState<{ freeLimit: number; used: number; allowed: boolean }>({ freeLimit: 3, used: 0, allowed: true });
  const exportsLeft = usage.allowed ? Math.max(0, usage.freeLimit - usage.used) : 0;
  const [showAccountPrompt, setShowAccountPrompt] = useState(false);

  const refreshUsage = useCallback(async () => {
    try {
      const r = await fetch("/api/usage");
      if (r.ok) {
        const u = (await r.json()) as { freeLimit: number; aiCalls: number; exportsUsed: number; allowed: boolean };
        setUsage({ freeLimit: u.freeLimit, used: Math.max(u.aiCalls, u.exportsUsed), allowed: u.allowed });
      }
    } catch { /* db may be down; stay permissive */ }
  }, []);
  useEffect(() => { refreshUsage(); }, [refreshUsage]);

  const [drawerOpen, setDrawerOpen] = useState(true);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("import");
  const [view, setView] = useState<View>("editor");
  const [jumpLine, setJumpLine] = useState<number | null>(null);

  const [streaming, setStreaming] = useState(false);
  const [tailorPhase, setTailorPhase] = useState<TailorPhase>("idle");
  const [aiLines, setAiLines] = useState<Set<number>>(new Set());
  const preAiRef = useRef<string | null>(null);

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [intensity, setIntensity] = useState<Intensity>("balanced");

  const revisionRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Wake/warm the rendering engine the moment the workspace opens, so it's ready by
  // the time the user finishes editing and compiles. Same-origin call; the engine URL
  // stays server-side. Fire-and-forget — never blocks the UI.
  useEffect(() => {
    fetch("/api/warm").catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/default-document");
        const body = (await res.json()) as { latex?: string };
        if (alive && body.latex) {
          setLatex(body.latex);
          setTemplateId(detectTemplate(body.latex));
        }
      } catch { /* editable empty */ }
      finally { if (alive) setLoadingDoc(false); }
    })();
    return () => { alive = false; };
  }, []);

  const runCompile = useCallback(async (source: string): Promise<boolean> => {
    if (!source.trim()) return false;
    const revision = ++revisionRef.current;
    setSaveState("updating");
    try {
      const res = await fetch("/api/compile-tex", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ latex: source, revision_id: String(revision) }),
      });
      if (revision !== revisionRef.current) return false;
      if (!res.ok) { setSaveState("error"); return false; }
      const meta = (await res.json()) as CompileResult;
      if (revision !== revisionRef.current) return false;
      setDocumentId(meta.document_id ?? null);
      setPageCount(meta.page_count ?? 0);
      setSaveState("saved");
      return true;
    } catch {
      if (revision === revisionRef.current) setSaveState("error");
      return false;
    }
  }, []);

  const onSelectTemplate = useCallback((tid: TemplateId) => {
    setTemplateId(tid);
    setLatex((prev) => {
      const next = applyTemplateToLatex(prev, tid);
      runCompile(next);
      return next;
    });
  }, [runCompile]);

  useEffect(() => {
    if (loadingDoc || !latex || streaming) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runCompile(latex), 700);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [latex, loadingDoc, streaming, runCompile]);

  const changedLines = useCallback((before: string, after: string): Set<number> => {
    const bset = new Set(before.split("\n").map((l) => l.trim()));
    const out = new Set<number>();
    after.split("\n").forEach((line, i) => { if (line.trim() && !bset.has(line.trim())) out.add(i + 1); });
    return out;
  }, []);

  const onAnalyze = useCallback(async () => {
    if (!jd.trim() || analyzing) return;
    setAnalyzing(true);
    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ latex, jd }),
      });
      if (res.status === 402) { setShowAccountPrompt(true); return; }
      if (res.ok) { setAnalysis((await res.json()) as Analysis); refreshUsage(); }
      else { toast("Fit analysis is busy — please try again in a moment.", "error"); }
    } catch { toast("Couldn't run fit analysis. Check your connection and retry.", "error"); }
    finally { setAnalyzing(false); }
  }, [jd, latex, analyzing, refreshUsage]);

  const onTailor = useCallback(async () => {
    if (!jd.trim() || streaming) return;
    setDrawerTab("intelligence"); setDrawerOpen(true);
    preAiRef.current = latex;
    setStreaming(true); setTailorPhase("connecting"); setAiLines(new Set());
    try {
      setTailorPhase("thinking");
      const res = await fetch("/api/ai/tailor-stream", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ latex, jd, intensity }),
      });
      if (res.status === 402) { setShowAccountPrompt(true); setTailorPhase("idle"); setStreaming(false); return; }
      if (!res.ok) { setTailorPhase("error"); setStreaming(false); return; }

      const body = (await res.json()) as { latex?: string; changedCount?: number; error?: unknown };
      if (!body.latex || typeof body.latex !== "string") {
        // AI returned no changes or an error
        if (preAiRef.current !== null) setLatex(preAiRef.current);
        setTailorPhase("error");
        setStreaming(false);
        return;
      }

      const finalLatex = body.latex;
      setTailorPhase("writing");
      setLatex(finalLatex);
      setAiLines(changedLines(preAiRef.current ?? "", finalLatex));

      setTailorPhase("compiling");
      const compileOk = await runCompile(finalLatex);
      if (!compileOk) {
        setTailorPhase("error");
        setStreaming(false);
        return;
      }
      setTailorPhase("done");
      refreshUsage();

      // Auto-analyze the tailored resume against the same JD — no extra button click needed.
      // Run in background after tailor completes so Intelligence tab shows fit score immediately.
      setAnalyzing(true);
      try {
        const analyzeRes = await fetch("/api/ai/analyze", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ latex: finalLatex, jd, isFollowUp: true }),
        });
        if (analyzeRes.ok) {
          setAnalysis((await analyzeRes.json()) as Analysis);
        }
      } catch { /* non-fatal — tailor succeeded, analysis is a bonus */ }
      finally { setAnalyzing(false); }

    } catch {
      if (preAiRef.current !== null) setLatex(preAiRef.current);
      setTailorPhase("error");
    } finally {
      setStreaming(false);
    }
  }, [jd, latex, streaming, intensity, changedLines, runCompile, refreshUsage]);


  const acceptAi = useCallback(() => { setAiLines(new Set()); setTailorPhase("idle"); preAiRef.current = null; }, []);
  const rejectAi = useCallback(() => {
    if (preAiRef.current !== null) { setLatex(preAiRef.current); runCompile(preAiRef.current); }
    setAiLines(new Set()); setTailorPhase("idle"); preAiRef.current = null;
  }, [runCompile]);

  const onExport = useCallback(async () => {
    if (!documentId) return;
    if (exportsLeft <= 0) { setShowAccountPrompt(true); return; }
    // HEAD-ish check via fetch so a 402 shows the prompt instead of a broken download.
    try {
      const res = await fetch(`/api/export/${documentId}`);
      if (res.status === 402) { setShowAccountPrompt(true); return; }
      if (!res.ok) { toast("Export failed. Please try again.", "error"); return; }
      const emailed = res.headers.get("x-aptora-emailed") === "1";
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "aptora-resume.pdf"; a.click();
      URL.revokeObjectURL(url);
      refreshUsage();
      toast(emailed ? "Exported — we also emailed you the PDF." : "Resume exported.", "success");
    } catch { toast("Export failed. Please try again.", "error"); }
  }, [documentId, exportsLeft, refreshUsage]);

  const [instructLoading, setInstructLoading] = useState(false);

  const onInstruct = useCallback(async (instruction: string): Promise<boolean> => {
    if (!instruction.trim() || instructLoading) return false;
    setInstructLoading(true);
    preAiRef.current = latex;
    try {
      const res = await fetch("/api/ai/instruct", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ latex, instruction }),
      });
      if (res.status === 402) { setShowAccountPrompt(true); return false; }
      if (!res.ok) return false;
      const body = (await res.json()) as { latex?: string; summary?: string };
      if (body?.latex && typeof body.latex === "string") {
        setLatex(body.latex);
        setAiLines(changedLines(preAiRef.current ?? "", body.latex));
        await runCompile(body.latex);
        refreshUsage();
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setInstructLoading(false);
    }
  }, [latex, instructLoading, changedLines, runCompile, refreshUsage]);

  const toggleDrawer = (tab: DrawerTab) => {
    setView("editor"); // rail tabs always operate on the editor view
    setDrawerOpen((open) => (open && drawerTab === tab && view === "editor" ? false : true));
    setDrawerTab(tab);
  };
  const jumpTo = (line: number) => { setJumpLine(line); setTimeout(() => setJumpLine(null), 50); };

  return (
    <div className="app" data-mobile={isMobile ? "true" : "false"}>
      <Toaster />
      <MenuBar
        docName={docName} onRename={setDocName} saveState={saveState}
        exportsLeft={exportsLeft} onExport={onExport} canExport={!!documentId && saveState !== "error"}
        aiChangedLines={aiLines.size} onAcceptAi={acceptAi} onRejectAi={rejectAi}
      />
      {showAccountPrompt && (
        <div className="modal-scrim" onClick={() => setShowAccountPrompt(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>You've used your free runs</h3>
            <p>Create a free account to keep tailoring, analyzing, and exporting. Your work stays private to you.</p>
            <div className="modal-actions">
              <a className="ui-btn primary" href="/signup">Create account</a>
              <button type="button" className="ui-btn ghost" onClick={() => setShowAccountPrompt(false)}>Maybe later</button>
            </div>
          </div>
        </div>
      )}
      <div className="app-body">
        <LeftRail drawerOpen={drawerOpen} activeTab={drawerTab} onToggle={toggleDrawer} view={view} onView={setView} />

        {view !== "editor" ? (
          <div className="view-scroll">
            {view === "files" ? <FilesView /> : <UsageView />}
          </div>
        ) : (
        <div className="workspace">
          {/* Desktop: three columns resize horizontally. Mobile: the same panels
              stack column-wise (vertically) and resize with horizontal handles.
              key forces a clean re-layout when the orientation flips. */}
          <Group
            key={isMobile ? "v" : "h"}
            orientation={isMobile ? "vertical" : "horizontal"}
            style={{ height: "100%", width: "100%" }}
          >
            {drawerOpen && (
              <>
                <Panel
                  defaultSize={isMobile ? "44" : "22"}
                  minSize={isMobile ? "20" : "16"}
                >
                  <Drawer
                    tab={drawerTab} onTab={setDrawerTab} onClose={() => setDrawerOpen(false)}
                    latex={latex} onJumpToLine={jumpTo}
                    jd={jd} onJdChange={setJd} onTailor={onTailor} tailoring={streaming} tailorPhase={tailorPhase}
                    resumeName={resumeName} onUploadName={setResumeName}
                    analysis={analysis} analyzing={analyzing} onAnalyze={onAnalyze}
                    intensity={intensity} onIntensity={setIntensity}
                    onInstruct={onInstruct} instructing={instructLoading}
                  />
                </Panel>
                <Separator className="split-handle" />
              </>
            )}
            <Panel defaultSize={isMobile ? "31" : "42"} minSize={isMobile ? "16" : "24"}>
              {loadingDoc ? (
                <div className="editor-pane"><div className="ed-loading">Preparing your workspace…</div></div>
              ) : (
                <EditorPane
                  value={latex} onChange={setLatex} saveState={saveState} pageCount={pageCount}
                  templateId={templateId} onSelectTemplate={onSelectTemplate}
                  aiLines={aiLines} streaming={streaming} jumpLine={jumpLine}
                />
              )}
            </Panel>
            <Separator className="split-handle" />
            <Panel defaultSize={isMobile ? "25" : "36"} minSize={isMobile ? "14" : "22"}>
              <PreviewPane documentId={documentId} pageCount={pageCount} saveState={saveState}
                onRecompile={() => runCompile(latex)} />
            </Panel>
          </Group>
        </div>
        )}
      </div>
    </div>
  );
}

function stripFences(s: string): string {
  // Complete fence pair: ```latex ... ``` — extract only the inner content.
  const complete = s.match(/```(?:latex|tex)?\s*([\s\S]*?)```/i);
  if (complete) return complete[1].trim();
  // Partial stream: only the opening fence has arrived — strip just the header
  // so the live editor receives valid LaTeX instead of a fence-prefixed string.
  return s.replace(/^```(?:latex|tex)?\s*/i, "").trim();
}

