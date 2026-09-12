import { useCallback, useEffect, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import MenuBar, { type SaveState } from "./MenuBar";
import LeftRail, { type DrawerTab } from "./LeftRail";
import Drawer, { type Intensity, type TailorPhase } from "./Drawer";
import EditorPane from "./EditorPane";
import PreviewPane from "./PreviewPane";
import FilesView from "../pages/FilesView";
import UsageView from "../pages/UsageView";
import type { View } from "./LeftRail";
import type { CompileResult } from "@/lib/types";
import type { Analysis } from "@/lib/ai/analyze";

// Aptora: menu bar (top) · [ icon rail | (drawer ‖ editor ‖ preview) all resizable ].
// AI tailoring streams new content into the editor live, with visible progress.

export default function Workspace() {
  const [latex, setLatex] = useState("");
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

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/default-document");
        const body = (await res.json()) as { latex?: string };
        if (alive && body.latex) setLatex(body.latex);
      } catch { /* editable empty */ }
      finally { if (alive) setLoadingDoc(false); }
    })();
    return () => { alive = false; };
  }, []);

  const runCompile = useCallback(async (source: string) => {
    if (!source.trim()) return;
    const revision = ++revisionRef.current;
    setSaveState("updating");
    try {
      const res = await fetch("/api/compile-tex", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ latex: source, revision_id: String(revision) }),
      });
      if (revision !== revisionRef.current) return;
      if (!res.ok) { setSaveState("error"); return; }
      const meta = (await res.json()) as CompileResult;
      if (revision !== revisionRef.current) return;
      setDocumentId(meta.document_id ?? null);
      setPageCount(meta.page_count ?? 0);
      setSaveState("saved");
    } catch { if (revision === revisionRef.current) setSaveState("error"); }
  }, []);

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
    } catch { /* calm */ }
    finally { setAnalyzing(false); }
  }, [jd, latex, analyzing, refreshUsage]);

  const onTailor = useCallback(async () => {
    if (!jd.trim() || streaming) return;
    setDrawerTab("intelligence"); setDrawerOpen(true);
    preAiRef.current = latex;
    setStreaming(true); setTailorPhase("connecting"); setAiLines(new Set());
    let acc = "";
    let gotContent = false;
    try {
      const res = await fetch("/api/ai/tailor-stream", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ latex, jd, intensity }),
      });
      if (res.status === 402) { setShowAccountPrompt(true); setTailorPhase("idle"); setStreaming(false); return; }
      if (!res.ok || !res.body) { setTailorPhase("error"); setStreaming(false); return; }
      setTailorPhase("thinking");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const ev = frame.match(/event:\s*(\w+)/)?.[1] ?? "delta";
          const dm = frame.match(/data:\s*([\s\S]+)/);
          if (!dm) continue;
          try {
            const data = JSON.parse(dm[1]);
            if (ev === "delta" && typeof data.text === "string" && data.text.length) {
              acc += data.text;
              if (!gotContent) { gotContent = true; setTailorPhase("writing"); }
              setLatex(stripFences(acc)); // live: editor fills as AI writes the NEW doc
            } else if (ev === "error") {
              setTailorPhase("error");
            }
          } catch { /* skip partial frame */ }
        }
      }
      const finalLatex = stripFences(acc);
      if (gotContent && finalLatex && preAiRef.current !== null) {
        setLatex(finalLatex);
        setAiLines(changedLines(preAiRef.current, finalLatex));
        setTailorPhase("compiling");
        await runCompile(finalLatex);
        setTailorPhase("done");
        refreshUsage();
      } else {
        // Nothing came back — restore original, surface calm error.
        if (preAiRef.current !== null) setLatex(preAiRef.current);
        setTailorPhase("error");
      }
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
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "aptora-resume.pdf"; a.click();
      URL.revokeObjectURL(url);
      refreshUsage();
    } catch { /* calm */ }
  }, [documentId, exportsLeft, refreshUsage]);

  const toggleDrawer = (tab: DrawerTab) => {
    setView("editor"); // rail tabs always operate on the editor view
    setDrawerOpen((open) => (open && drawerTab === tab && view === "editor" ? false : true));
    setDrawerTab(tab);
  };
  const jumpTo = (line: number) => { setJumpLine(line); setTimeout(() => setJumpLine(null), 50); };

  return (
    <div className="app">
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
          <Group orientation="horizontal" style={{ height: "100%", width: "100%" }}>
            {drawerOpen && (
              <>
                <Panel defaultSize="22" minSize="16">
                  <Drawer
                    tab={drawerTab} onTab={setDrawerTab} onClose={() => setDrawerOpen(false)}
                    latex={latex} onJumpToLine={jumpTo}
                    jd={jd} onJdChange={setJd} onTailor={onTailor} tailoring={streaming} tailorPhase={tailorPhase}
                    resumeName={resumeName} onUploadName={setResumeName}
                    analysis={analysis} analyzing={analyzing} onAnalyze={onAnalyze}
                    intensity={intensity} onIntensity={setIntensity}
                  />
                </Panel>
                <Separator className="split-handle" />
              </>
            )}
            <Panel defaultSize="42" minSize="24">
              {loadingDoc ? (
                <div className="editor-pane"><div className="ed-loading">Preparing your workspace…</div></div>
              ) : (
                <EditorPane
                  value={latex} onChange={setLatex} saveState={saveState} pageCount={pageCount}
                  templateLabel="Classic · Serif"
                  aiLines={aiLines} streaming={streaming} jumpLine={jumpLine}
                />
              )}
            </Panel>
            <Separator className="split-handle" />
            <Panel defaultSize="36" minSize="22">
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
  const m = s.match(/```(?:latex|tex)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : s).trim();
}
