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
import BudgetModal from "./BudgetModal";
import PricingModal from "./PricingModal";
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
  // Budget snapshot mirrors /api/usage: runsLeft/exportsLeft null = unlimited (own key,
  // Pro); source tells whether the NEXT gated action bills free/credit/own-key/pro.
  const [usage, setUsage] = useState<{ freeLimit: number; used: number; allowed: boolean; exportsLeft: number }>({ freeLimit: 3, used: 0, allowed: true, exportsLeft: 3 });
  const exportsLeft = usage.exportsLeft;
  const [showAccountPrompt, setShowAccountPrompt] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);

  const refreshUsage = useCallback(async () => {
    try {
      const r = await fetch("/api/usage");
      if (r.ok) {
        const u = (await r.json()) as {
          freeLimit?: number; aiCalls?: number; exportsUsed?: number; allowed?: boolean;
          runsLeft?: number | null; exportsLeft?: number | null; source?: string;
        };
        // New schema first; fall back to the legacy shape when fields are absent.
        const unlimited = u.runsLeft === null && u.exportsLeft === null;
        setUsage({
          freeLimit: u.freeLimit ?? 3,
          used: Math.max(u.aiCalls ?? 0, u.exportsUsed ?? 0),
          allowed: u.allowed ?? true,
          exportsLeft: unlimited ? 9_999 : (u.exportsLeft ?? u.runsLeft ?? (u.allowed ? Math.max(0, (u.freeLimit ?? 3) - Math.max(u.aiCalls ?? 0, u.exportsUsed ?? 0)) : 0)),
        });
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
  const [ingesting, setIngesting] = useState(false);


  const revisionRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Wake/warm the rendering engine the moment the workspace opens, so it's ready by
  // the time the user finishes editing and compiles. Same-origin call; the engine URL
  // stays server-side. Fire-and-forget — never blocks the UI.
  useEffect(() => {
    fetch("/api/warm").catch(() => {});
  }, []);

  // PayU bounces back here after checkout: surface the result once, then clean the URL.
  // Also supports workspace deep links: /?view=usage | activity | files
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const payment = p.get("payment");
    const v = p.get("view");
    const auth = p.get("auth");
    const tab = p.get("tab");
    // Legacy deep links (/?view=usage) now redirect to the real standalone page, so
    // these screens render in exactly ONE place (no duplicate embedded copy).
    if (v === "usage" || v === "activity" || v === "files") { window.location.replace(`/${v}`); return; }
    if (tab === "outline" || tab === "import" || tab === "intelligence" || tab === "instruct") {
      setView("editor"); setDrawerTab(tab); setDrawerOpen(true);
      p.delete("tab");
      const qs1 = p.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs1 ? `?${qs1}` : ""));
    }
    if (auth === "login" || auth === "signup") {
      setAuthModal(auth);
      p.delete("auth");
      const qs0 = p.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs0 ? `?${qs0}` : ""));
    }
    if (!payment) return;
    if (payment === "success") toast("Payment received — credits added. You're all set!", "success");
    else if (payment === "failed") toast("Payment failed or was cancelled. Nothing was charged.", "error");
    else toast("We couldn't verify that payment. If you were charged, it will settle within minutes.", "info");
    p.delete("payment");
    const qs = p.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      // ── Instant paint first: the local snapshot survives refresh/close, costs zero
      // network, and makes the workspace feel immediate even when the durable restore
      // is slow (Neon cold or the fallback chain hitting a sleeping Render engine).
      // The authoritative restore below then reconciles over it silently.
      let painted = false;
      try {
        const draft = window.localStorage.getItem("aptora_draft");
        if (draft && draft.trim()) {
          setLatex(draft);
          setTemplateId(detectTemplate(draft));
          setLoadingDoc(false);
          painted = true;
        }
      } catch { /* quota/private mode */ }

      // ── Durable restore (authoritative): the owner's most recent working document.
      // When we already painted from the newer local draft, we reconcile METADATA only —
      // never overwrite the user's newer local content with an older server copy.
      try {
        const res = await fetch("/api/documents/current");
        if (res.ok) {
          const doc = (await res.json()) as { latex?: string | null; title?: string | null; documentId?: string | null; pageCount?: number | null };
          if (alive && typeof doc.latex === "string" && doc.latex.trim() && !painted) {
            setLatex(doc.latex);
            setTemplateId(detectTemplate(doc.latex));
            if (doc.title) setDocName(doc.title);
            if (typeof doc.documentId === "string") { setDocumentId(doc.documentId); setPageCount(doc.pageCount ?? 0); }
            setLoadingDoc(false);
            return;
          }
          if (alive && painted && typeof doc.documentId === "string") {
            setDocumentId(doc.documentId);
            setPageCount(doc.pageCount ?? 0);
            if (doc.title) setDocName(doc.title);
          }
        }
      } catch { /* fall through to starter */ }

      if (painted) return;
      // Anonymous/first-visit fallback: the starter template (kept as-is — the normal
      // engine warmup route covers it; no bundled copy, no extra Render compute).
      try {
        const res2 = await fetch("/api/default-document");
        const body = (await res2.json()) as { latex?: string };
        if (alive && body.latex) {
          setLatex(body.latex);
          setTemplateId(detectTemplate(body.latex));
        }
      } catch { /* editable empty */ }
      if (alive) setLoadingDoc(false);
    })();
    return () => { alive = false; };
  }, []);

  // Autosave the working document (debounced, silent). Latex saves are cheap upserts on
  // the content-addressed id; the user's work survives refresh/close even before a compile.
  useEffect(() => {
    if (loadingDoc || !latex || streaming) return;
    const t = setTimeout(() => {
      fetch("/api/documents/current", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          latex, title: docName, documentId: documentId, pageCount,
        }),
      }).catch(() => { /* silent */ });
      try { window.localStorage.setItem("aptora_draft", latex); } catch { /* quota/private mode */ }
    }, 1500);
    return () => clearTimeout(t);
  }, [latex, docName, documentId, pageCount, loadingDoc, streaming]);

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

  // Resume ingestion: the server parses the uploaded PDF and returns a real LaTeX
  // document BUILT FROM THE USER'S DATA (see ai/ingest-resume). We auto-replace the
  // loaded document and compile (the user's confirmed default behavior).
  const onIngested = useCallback(async (ok: { latex: string; uploadId?: string | null }) => {
    const { latex } = ok;
    if (!latex) return;
    setLatex(latex);
    setTemplateId(detectTemplate(latex));
    setDocumentId(null); // the old preview is not this document; force a clean compile
    await runCompile(latex);
  }, [runCompile]);

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

  // Badge realism: show the model's LATEST full words — collapse whitespace, cut at a
  // whole word boundary (never a half-typed word like "write new te…", which reads fake).
  const badgeReason = useCallback((raw: string, max = 96): string => {
    let t = raw.replace(/\s+/g, " ").trim();
    if (!t) return "";
    if (t.length > max) {
      t = t.slice(-(max + 10));                 // grab a slightly wider window from the end
      const sp = t.indexOf(" ");
      if (sp > 0 && sp <= 14) t = t.slice(sp + 1);  // drop the leading partial word
      if (t.length > max) t = t.slice(0, max).trim();
    }
    // Prefer ending on a comma/period if there is one in reach (reads like narration).
    const punct = Math.max(t.lastIndexOf(". "), t.lastIndexOf(", "));
    if (punct > max * 0.55) t = t.slice(0, punct + 1).trim();
    return t;
  }, []);

  const onAnalyze = useCallback(async () => {
    if (!jd.trim() || analyzing) return;
    setAnalyzing(true);
    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ latex, jd }),
      });
      if (res.status === 402 || res.status === 401) {
        if (res.status === 401) {
          const j = (await res.clone().json().catch(() => null)) as { error?: { message?: string } } | null;
          toast(j?.error?.message ?? "Your API key was rejected. Manage it in the next panel.", "error");
        }
        setShowAccountPrompt(true); return;
      }
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
    // Drive the bottom-center reasoning badge for the tailor flow too.
    setInstructLoading(true); setAiReason(""); setAiFail(null); setAiStage("reading-resume");
    try {
      const res = await fetch("/api/ai/tailor-stream", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ latex, jd, intensity, stream: true }),
      });
      if (res.status === 402) { setShowAccountPrompt(true); setTailorPhase("idle"); return; }
      if (res.status === 401) {
        const j = (await res.clone().json().catch(() => null)) as { error?: { message?: string } } | null;
        toast(j?.error?.message ?? "Your API key was rejected.", "error");
        setTailorPhase("idle"); return;
      }
      if (!res.ok || !res.body) { setTailorPhase("error"); setAiFail({ latex, error: `AI_UNAVAILABLE: tailoring failed (HTTP ${res.status})` }); return; }

      // Consume the tailor SSE frame stream (stage / reasoning / result) — the same
      // protocol as the manual-edit instruct stream, so the badge behaves identically.
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = ""; let lastReasonUi = 0; let gotResult = false;
      let finalLatex = "";
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n\n")) !== -1) {
          const raw = buf.slice(0, nl).trim(); buf = buf.slice(nl + 2);
          if (!raw) continue;
          let frame: { type?: string; stage?: string; detail?: string; text?: string; latex?: string; changedCount?: number; code?: string; message?: string };
          try { frame = JSON.parse(raw); } catch { continue; }
          if (frame.type === "stage") {
            const s = frame.stage ?? "";
            setAiStage(s === "rewriting" ? "rewriting" : s === "patching" ? "patching" : "reading-resume");
            setTailorPhase(s === "rewriting" || s === "patching" ? "writing" : "thinking");
          } else if (frame.type === "reason") {
            // Keep ONLY the newest sentence fragment for the badge (cheap, readable).
            const now = Date.now();
            if (now - lastReasonUi > 400) {
              lastReasonUi = now;
              const t = badgeReason(frame.text ?? "");
              if (t) setAiReason(t);
            }
          } else if (frame.type === "result") {
            gotResult = true;
            finalLatex = frame.latex ?? "";
            setTailorPhase("writing");
            if (finalLatex) {
              setLatex(finalLatex);
              setAiLines(changedLines(preAiRef.current ?? "", finalLatex));
              setTailorPhase("compiling");
              const ok = await runCompile(finalLatex);
              setTailorPhase(ok ? "done" : "error");
              refreshUsage();
            }
          } else if (frame.type === "error") {
            setTailorPhase("error");
            setAiFail({ latex, error: `${frame.code ?? "AI_UNAVAILABLE"}: ${frame.message ?? "tailoring failed"}` });
          }
        }
      }
      if (!gotResult || !finalLatex) return;

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
      setInstructLoading(false);
      setAiStage(null);
      setAiReason("");
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

  const [exportingAnalysis, setExportingAnalysis] = useState(false);
  const onExportAnalysis = useCallback(async () => {
    if (!analysis || exportingAnalysis) return;
    setExportingAnalysis(true);
    try {
      const res = await fetch("/api/ai/analysis-pdf", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ analysis }),
      });
      if (!res.ok) { toast("Couldn't export the analysis. Try again.", "error"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "aptora-fit-analysis.pdf"; a.click();
      URL.revokeObjectURL(url);
      toast("Fit analysis exported.", "success");
    } catch { toast("Couldn't export the analysis. Try again.", "error"); }
    finally { setExportingAnalysis(false); }
  }, [analysis, exportingAnalysis]);

  const [instructLoading, setInstructLoading] = useState(false);
  // Live "Aptora is working…" coverage: stage text, latest reasoning snippet, and the
  // Fix flow (a repairable failure keeps latex+error so the user can press Fix, which
  // sends ONLY the failing document + compiler error to the repair model).
  // Lifted auth-modal state: every "create account" action opens the SAME in-app popup.
  const [authModal, setAuthModal] = useState<null | "login" | "signup">(null);
  const openAuth = useCallback((mode: "login" | "signup") => { setAuthModal(mode); }, []);
  const [aiStage, setAiStage] = useState<string | null>(null);
  const [aiReason, setAiReason] = useState<string>("");
  const [aiFail, setAiFail] = useState<{ latex: string; error: string } | null>(null);
  const onFix = useCallback(async () => {
    if (!aiFail) return;
    const { latex: bad, error } = aiFail;
    setAiFail(null);
    setInstructLoading(true);
    setAiStage("fixing");
    try {
      const res = await fetch("/api/ai/fix-tex", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ latex: bad, error }),
      });
      const body = (await res.json().catch(() => ({}))) as { latex?: string; error?: { message?: string } };
      if (res.ok && body?.latex) {
        setLatex(body.latex);
        await runCompile(body.latex);
        toast("Fixed — the document compiles now.", "success");
      } else {
        setAiFail({ latex: bad, error });
        toast(body?.error?.message || "Couldn't auto-fix that one. Try hand-editing the highlighted spot.", "error");
      }
    } catch {
      setAiFail({ latex: bad, error });
      toast("Fix is unavailable right now.", "error");
    } finally {
      setInstructLoading(false);
      setAiStage(null);
    }
  }, [aiFail, runCompile]);

  const onInstruct = useCallback(async (instruction: string): Promise<boolean> => {
    if (!instruction.trim() || instructLoading) return false;
    setInstructLoading(true);
    setAiReason("");
    setAiFail(null);
    setAiStage("understanding");
    preAiRef.current = latex;
    try {
      const res = await fetch("/api/ai/instruct", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ latex, instruction, stream: true }),
      });
      if (res.status === 402) { setShowAccountPrompt(true); return false; }
      if (res.status === 401) {
        const j = (await res.clone().json().catch(() => null)) as { error?: { message?: string } } | null;
        toast(j?.error?.message ?? "Your API key was rejected.", "error");
        return false;
      }
      if (!res.ok || !res.body) return false;

      // Consume the stage / reasoning / result frame stream.
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = ""; let lastReasonUi = 0; let applied = false;
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n\n")) !== -1) {
          const raw = buf.slice(0, nl).trim(); buf = buf.slice(nl + 2);
          if (!raw) continue;
          let frame: { type?: string; stage?: string; detail?: string; text?: string; latex?: string; summary?: string; rejected?: boolean; code?: string; message?: string };
          try { frame = JSON.parse(raw); } catch { continue; }
          if (frame.type === "stage") {
            if (frame.stage === "compile") setAiStage("compiling & validating");
            else if (frame.stage === "repair") setAiStage("repairing a syntax slip");
            else if (frame.stage === "reverted") setAiStage("rolled back");
            else setAiStage("working");
          } else if (frame.type === "reason") {
            // Keep ONLY the newest sentence fragment for the badge (cheap, readable).
            const now = Date.now();
            if (now - lastReasonUi > 400) {
              lastReasonUi = now;
              const t = badgeReason(frame.text ?? "");
              if (t) setAiReason(t);
            }
          } else if (frame.type === "result") {
            applied = true;
            if (frame.latex && typeof frame.latex === "string") {
              setLatex(frame.latex);
              setAiLines(changedLines(preAiRef.current ?? "", frame.latex));
              await runCompile(frame.latex);
              refreshUsage();
            }
          } else if (frame.type === "error") {
            setAiFail({ latex, error: `${frame.code ?? "AI_UNAVAILABLE"}: ${frame.message ?? "update failed"}` });
          }
        }
      }
      return applied;
    } catch {
      return false;
    } finally {
      setInstructLoading(false);
      setAiStage(null);
      setAiReason("");
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
      {(instructLoading || aiFail) && (
        <div className="ai-status-badge" role="status" aria-live="polite">
          {instructLoading ? (
            <span className="ai-status-live">
              <span className="ai-status-dot" />
              <span className="ai-status-title">
                {aiStage === "fixing" ? "Repairing LaTeX"
                  : aiStage === "reading-resume" ? "Reading your resume"
                  : aiStage === "rewriting" ? "Aptora is tailoring your resume"
                  : aiStage === "patching" ? "Applying tailored edits"
                  : "Aptora is working"}
              </span>
              <span className="ai-status-text">
                {aiReason ||
                  (aiStage === "compiling & validating" ? "Compiling & validating…"
                  : aiStage === "repairing a syntax slip" ? "Sending the error back to the model…"
                  : aiStage === "understanding" ? "Understanding your edit…"
                  : aiStage === "reading-resume" ? "Aligning with the job description…"
                  : aiStage === "rewriting" ? "Rewriting title, summary & bullets…"
                  : aiStage === "patching" ? "Patching text into your template…"
                  : "Applying changes…")}
              </span>
            </span>
          ) : (
            <>
              <span className="ai-status-title">That edit broke the LaTeX</span>
              <button type="button" className="ai-fix-btn" onClick={onFix}>⚙ Fix</button>
              <button type="button" className="ai-badge-close" aria-label="Dismiss"
                onClick={() => { setAiFail(null); toast("Edit discarded — document unchanged.", "info"); }}>✕</button>
            </>
          )}
        </div>
      )}
      <MenuBar
        docName={docName} onRename={setDocName} saveState={saveState}
        exportsLeft={exportsLeft} onExport={onExport} canExport={!!documentId && saveState !== "error"}
        aiChangedLines={aiLines.size} onAcceptAi={acceptAi} onRejectAi={rejectAi}
        authModal={authModal} onAuthModalChange={setAuthModal}
      />
      {showAccountPrompt && (
        <BudgetModal
          onClose={() => setShowAccountPrompt(false)}
          onOpenAuth={(m) => setAuthModal(m)}
          onOpenPricing={() => setPricingOpen(true)}
        />
      )}
      {pricingOpen && <PricingModal onClose={() => { setPricingOpen(false); void refreshUsage(); }} />}
      <div className="app-body">
        <LeftRail drawerOpen={drawerOpen} activeTab={drawerTab} onToggle={toggleDrawer} view={view} onOpenAuth={openAuth} />

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
                    onExportAnalysis={onExportAnalysis} exportingAnalysis={exportingAnalysis}
                    intensity={intensity} onIntensity={setIntensity}
                    onInstruct={onInstruct} instructing={instructLoading}
                    onIngested={onIngested} ingesting={ingesting} setIngesting={setIngesting}
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
                  onOpenAuth={openAuth}
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

