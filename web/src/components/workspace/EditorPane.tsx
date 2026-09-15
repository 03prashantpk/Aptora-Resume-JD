import { useCallback, useEffect, useRef, useState } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import type { ViewUpdate } from "@codemirror/view";
import { EditorView, Decoration, type DecorationSet, GutterMarker, gutter } from "@codemirror/view";
import { StateField, StateEffect, RangeSet } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { Check, CircleAlert, LoaderCircle, ChevronDown, Check as CheckIcon, ChevronUp, Trash2, Plus } from "lucide-motion";
import { EditorSelection } from "@codemirror/state";
import type { SaveState } from "./MenuBar";
import { TEMPLATES, templateLabel as getTemplateLabel } from "@/lib/templates";
import type { TemplateId } from "@/lib/types";
import { toast } from "../ui/toast";

// Center pane: header (file · template switcher · compile status) + CodeMirror LaTeX editor with
// AI inline highlighting + status bar. LaTeX is intentionally visible; compiler internals
// are not. AI-changed lines are decorated (not fake \color in the source).

const latexLang = StreamLanguage.define(stex);

// --- AI highlight decorations + pencil gutter: mark 1-based line numbers as AI-changed.
// The set is applied via a StateEffect. On document changes we REMAP the decorations
// through the change (so they follow the text) instead of dropping them — the highlight
// only clears when an explicit empty set is pushed (Keep/Undo) or a new set replaces it.
const setAiLines = StateEffect.define<Set<number>>();
const aiLineDeco = Decoration.line({ class: "cm-ai-line" });

/** Pencil (✎) gutter marker rendered on every AI-changed line. */
class PencilMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-ai-pencil";
    el.textContent = "✎";
    el.title = "Edited by Aptora AI";
    return el;
  }
}
const pencilMarker = new PencilMarker();

function buildAiSets(doc: import("@codemirror/state").Text, lines: Set<number>) {
  const decos: { from: number; deco: Decoration }[] = [];
  const marks: { from: number; marker: GutterMarker }[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    if (lines.has(n)) {
      const at = doc.line(n).from;
      decos.push({ from: at, deco: aiLineDeco });
      marks.push({ from: at, marker: pencilMarker });
    }
  }
  return {
    deco: RangeSet.of(decos.map((d) => d.deco.range(d.from)), true),
    marks: RangeSet.of(marks.map((m) => m.marker.range(m.from)), true),
  };
}

interface AiState { deco: DecorationSet; marks: RangeSet<GutterMarker> }

const aiField = StateField.define<AiState>({
  create: () => ({ deco: Decoration.none, marks: RangeSet.empty }),
  update(state, tr) {
    for (const e of tr.effects) {
      if (e.is(setAiLines)) return buildAiSets(tr.state.doc, e.value);
    }
    // Follow the text through edits rather than clearing (kept until Keep/Undo replaces it).
    if (tr.docChanged) {
      return { deco: state.deco.map(tr.changes), marks: state.marks.map(tr.changes) };
    }
    return state;
  },
  provide: (f) => EditorView.decorations.from(f, (s) => s.deco),
});

// Gutter that shows the pencil marker for AI-changed lines (reads the same field).
const aiPencilGutter = gutter({
  class: "cm-ai-gutter",
  markers: (view) => view.state.field(aiField).marks,
});

const cmTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", backgroundColor: "var(--surface)" },
  ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.6", overflow: "auto" },
  ".cm-gutters": { backgroundColor: "var(--surface)", border: "none", color: "var(--muted)" },
  ".cm-activeLine": { backgroundColor: "rgba(37,99,235,0.05)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--secondary)" },
  ".cm-ai-line": { backgroundColor: "rgba(37,99,235,0.10)", boxShadow: "inset 2px 0 0 var(--accent)" },
  // Pencil gutter: a thin column that shows ✎ next to AI-edited lines.
  ".cm-ai-gutter": { width: "16px" },
  ".cm-ai-pencil": {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: "16px", color: "var(--accent)", fontSize: "11px", lineHeight: "1.6",
    cursor: "default", opacity: "0.9",
  },
  "&.cm-focused": { outline: "none" },
});

interface Props {
  value: string;
  onChange: (next: string) => void;
  saveState: SaveState;
  pageCount: number;
  templateId: TemplateId;
  onSelectTemplate: (t: TemplateId) => void;
  aiLines: Set<number>; // 1-based lines to highlight as AI-changed
  streaming: boolean;
  jumpLine: number | null; // outline click -> scroll editor to this 1-based line
}

// Compact upvote count, e.g. 18000 -> "18k", 20400 -> "20.4k".
function formatK(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return (k >= 100 || Number.isInteger(k) ? Math.round(k) : k.toFixed(1)) + "k";
}

function CompileStatus({ state, streaming }: { state: SaveState; streaming: boolean }) {
  if (streaming) return <span className="ed-status updating"><LoaderCircle size={13} className="spin-animate" /> Writing…</span>;
  if (state === "updating") return <span className="ed-status updating"><LoaderCircle size={13} className="spin-animate" /> Compiling…</span>;
  if (state === "saved") return <span className="ed-status ok"><Check size={13} /> Compiled</span>;
  if (state === "error") return <span className="ed-status err"><CircleAlert size={13} /> Compile failed</span>;
  return <span className="ed-status" />;
}

export default function EditorPane({ value, onChange, saveState, pageCount, templateId, onSelectTemplate, aiLines, streaming, jumpLine }: Props) {
  const [pos, setPos] = useState({ line: 1, col: 1 });
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const templateMenuRef = useRef<HTMLDivElement>(null);
  const ref = useRef<ReactCodeMirrorRef>(null);

  // Template upvotes: displayed counts + which ones this session already upvoted.
  const [voteCounts, setVoteCounts] = useState<Record<string, number>>({});
  const [voted, setVoted] = useState<Set<string>>(new Set());
  // Logged-in user's own saved templates (owner-scoped). Empty for anonymous sessions.
  const [myTemplates, setMyTemplates] = useState<{ id: string; name: string; latex: string }[]>([]);
  const [savingTpl, setSavingTpl] = useState(false);
  // In-app "name this template" modal (replaces window.prompt).
  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  // Delete-confirmation modal for a saved template.
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [votingId, setVotingId] = useState<string | null>(null);

  // Load vote state when the template menu opens (once per open).
  useEffect(() => {
    if (!templateMenuOpen) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/templates/votes");
        if (!r.ok) return;
        const s = (await r.json()) as { counts: Record<string, number>; voted: string[] };
        if (!alive) return;
        setVoteCounts(s.counts ?? {});
        setVoted(new Set(s.voted ?? []));
      } catch { /* votes are non-critical; menu still works */ }
      // Logged-in user's saved templates (empty for anonymous — endpoint returns []).
      try {
        const r = await fetch("/api/templates/mine");
        if (!r.ok) return;
        const d = (await r.json()) as { templates?: { id: string; name: string; latex: string }[] };
        if (alive) setMyTemplates(d.templates ?? []);
      } catch { /* non-critical */ }
    })();
    return () => { alive = false; };
  }, [templateMenuOpen]);

  // Load a saved template's LaTeX into the editor.
  const loadMyTemplate = useCallback((tpl: { name: string; latex: string }) => {
    onChange(tpl.latex);
    setTemplateMenuOpen(false);
    toast(`Loaded "${tpl.name}".`, "success");
  }, [onChange]);

  // Open the in-app "name this template" modal with a sensible default.
  const saveCurrentAsTemplate = useCallback(() => {
    if (savingTpl) return;
    setNameDraft(`My template ${myTemplates.length + 1}`);
    setTemplateMenuOpen(false);
    setNameModalOpen(true);
  }, [savingTpl, myTemplates.length]);

  // Save the current document as a new owner-scoped template (confirmed from the modal).
  const confirmSaveTemplate = useCallback(async () => {
    if (savingTpl) return;
    const name = nameDraft.trim() || "Untitled template";
    setSavingTpl(true);
    try {
      const r = await fetch("/api/templates/mine", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, latex: value }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) { toast("Sign in to save your own templates.", "info"); setNameModalOpen(false); return; }
      if (!r.ok) { toast(d?.error?.message ?? "Couldn't save the template.", "error"); return; }
      if (d?.template) setMyTemplates((prev) => [d.template, ...prev]);
      toast("Saved to your templates.", "success");
      setNameModalOpen(false);
    } catch {
      toast("Couldn't save the template. Try again.", "error");
    } finally { setSavingTpl(false); }
  }, [value, savingTpl, nameDraft]);

  // Ask before deleting a saved template (opens the confirm modal).
  const requestDeleteTemplate = useCallback((tpl: { id: string; name: string }, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingDelete(tpl);
  }, []);

  // Confirmed delete of an owner-scoped template.
  const confirmDeleteTemplate = useCallback(async () => {
    if (!pendingDelete || deleting) return;
    const { id } = pendingDelete;
    setDeleting(true);
    try {
      const r = await fetch(`/api/templates/mine/${id}`, { method: "DELETE" });
      if (r.ok) {
        setMyTemplates((prev) => prev.filter((t) => t.id !== id));
        toast("Template removed.", "info");
        setPendingDelete(null);
      } else {
        toast("Couldn't remove the template. Try again.", "error");
      }
    } catch {
      toast("Couldn't remove the template. Try again.", "error");
    } finally { setDeleting(false); }
  }, [pendingDelete, deleting]);

  const upvote = useCallback(async (tid: string, e: React.MouseEvent) => {
    e.stopPropagation(); // don't select the template when clicking its upvote
    if (votingId) return;
    if (voted.has(tid)) { toast("You already upvoted this template", "info"); return; }
    const tplName = TEMPLATES.find((t) => t.id === tid)?.name ?? "template";
    setVotingId(tid);
    // Optimistic: bump + mark voted immediately.
    setVoted((prev) => new Set(prev).add(tid));
    setVoteCounts((prev) => ({ ...prev, [tid]: (prev[tid] ?? 0) + 1 }));
    try {
      const r = await fetch("/api/templates/vote", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId: tid }),
      });
      if (r.ok) {
        const body = (await r.json()) as { count?: number; alreadyVoted?: boolean };
        if (typeof body.count === "number") setVoteCounts((prev) => ({ ...prev, [tid]: body.count! }));
        if (body.alreadyVoted) toast("You already upvoted this template", "info");
        else toast(`Upvoted ${tplName} — thanks!`, "success");
      } else {
        // roll back optimistic state on failure
        setVoted((prev) => { const n = new Set(prev); n.delete(tid); return n; });
        setVoteCounts((prev) => ({ ...prev, [tid]: Math.max(0, (prev[tid] ?? 1) - 1) }));
        if (r.status === 401) {
          toast("Sign in to upvote templates.", "info");
        } else {
          toast("Couldn't record your upvote. Try again.", "error");
        }
      }
    } catch {
      setVoted((prev) => { const n = new Set(prev); n.delete(tid); return n; });
      setVoteCounts((prev) => ({ ...prev, [tid]: Math.max(0, (prev[tid] ?? 1) - 1) }));
      toast("Couldn't record your upvote. Try again.", "error");
    } finally { setVotingId(null); }
  }, [voted, votingId]);

  // Close template menu on outside click
  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (templateMenuRef.current && !templateMenuRef.current.contains(e.target as Node)) {
        setTemplateMenuOpen(false);
      }
    };
    if (templateMenuOpen) document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [templateMenuOpen]);

  // Push AI-highlight lines into the editor whenever they change.
  useEffect(() => {
    const view = ref.current?.view;
    if (view) view.dispatch({ effects: setAiLines.of(aiLines) });
  }, [aiLines, value]);

  // Outline jump: scroll + place cursor at the requested line.
  useEffect(() => {
    const view = ref.current?.view;
    if (!view || jumpLine == null || jumpLine < 1 || jumpLine > view.state.doc.lines) return;
    const pos = view.state.doc.line(jumpLine).from;
    view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true });
    view.focus();
  }, [jumpLine]);

  const onUpdate = (vu: ViewUpdate) => {
    if (vu.selectionSet || vu.docChanged) {
      const head = vu.state.selection.main.head;
      const line = vu.state.doc.lineAt(head);
      setPos({ line: line.number, col: head - line.from + 1 });
    }
  };

  return (
    <div className="editor-pane">
      <div className="ed-header">
        <div className="ed-header-left">
          <span className="ed-file">document.tex</span>
          <div className="ed-template-wrap" ref={templateMenuRef}>
            <button
              type="button"
              className="ed-template-btn"
              onClick={() => setTemplateMenuOpen((o) => !o)}
              aria-haspopup="listbox"
              aria-expanded={templateMenuOpen}
              title="Switch document template / style"
            >
              <span className="ed-template-text">{getTemplateLabel(templateId)}</span>
              <ChevronDown size={12} className={`ed-template-chev ${templateMenuOpen ? "open" : ""}`} />
            </button>

            {templateMenuOpen && (
              <div className="ed-template-menu" role="listbox">
                <div className="ed-template-menu-header">Typography & Template</div>
                {TEMPLATES.map((t) => {
                  const active = t.id === templateId;
                  const hasVoted = voted.has(t.id);
                  const count = voteCounts[t.id];
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={`ed-template-item ${active ? "active" : ""}`}
                      onClick={() => {
                        onSelectTemplate(t.id);
                        setTemplateMenuOpen(false);
                      }}
                    >
                      <div className="ed-template-item-top">
                        <span className="ed-template-item-name">{t.name}</span>
                        <span className="ed-template-item-badge">{t.typeface}</span>
                        {active && <CheckIcon size={13} className="ed-template-item-check" />}
                        <span
                          role="button"
                          tabIndex={0}
                          className={`tpl-upvote ${hasVoted ? "voted" : ""}`}
                          title={hasVoted ? "You upvoted this" : "Upvote this template"}
                          aria-label={`Upvote ${t.name}`}
                          aria-pressed={hasVoted}
                          onClick={(e) => upvote(t.id, e)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") upvote(t.id, e as unknown as React.MouseEvent); }}
                        >
                          <ChevronUp size={12} className="tpl-upvote-icon" />
                          <span className="tpl-upvote-count">{count != null ? formatK(count) : "—"}</span>
                        </span>
                      </div>
                      <p className="ed-template-item-desc">{t.description}</p>
                    </button>
                  );
                })}

                {myTemplates.length > 0 && (
                  <>
                    <div className="ed-template-menu-header">Your templates</div>
                    {myTemplates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        role="option"
                        aria-selected={false}
                        className="ed-template-item"
                        onClick={() => loadMyTemplate(t)}
                      >
                        <div className="ed-template-item-top">
                          <span className="ed-template-item-name">{t.name}</span>
                          <span className="ed-template-item-badge">Saved</span>
                          <span
                            role="button"
                            tabIndex={0}
                            className="tpl-del"
                            title="Delete this template"
                            aria-label={`Delete ${t.name}`}
                            onClick={(e) => requestDeleteTemplate({ id: t.id, name: t.name }, e)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") requestDeleteTemplate({ id: t.id, name: t.name }, e as unknown as React.MouseEvent); }}
                          >
                            <Trash2 size={12} />
                          </span>
                        </div>
                        <p className="ed-template-item-desc">Your saved starting point.</p>
                      </button>
                    ))}
                  </>
                )}

                <button type="button" className="ed-template-save" onClick={saveCurrentAsTemplate} disabled={savingTpl}>
                  <Plus size={13} /> {savingTpl ? "Saving…" : "Save current as template"}
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="ed-header-right">
          <CompileStatus state={saveState} streaming={streaming} />
        </div>
      </div>

      <div className="ed-host">
        <CodeMirror
          ref={ref}
          value={value}
          onChange={onChange}
          onUpdate={onUpdate}
          editable={!streaming}
          extensions={[latexLang, aiField, aiPencilGutter, EditorView.lineWrapping]}
          theme={cmTheme}
          basicSetup={{ lineNumbers: true, highlightActiveLine: true, highlightActiveLineGutter: true, foldGutter: false, bracketMatching: true }}
          height="100%"
          style={{ height: "100%" }}
        />
      </div>

      <div className="ed-statusbar">
        <span>Ln {pos.line}, Col {pos.col}</span>
        <span className="sb-sep">UTF-8</span>
        <span className="sb-sep">LaTeX</span>
        <span className="sb-sep">{getTemplateLabel(templateId)}</span>
        <span className="sb-sep">{pageCount > 0 ? `${pageCount} page${pageCount > 1 ? "s" : ""}` : "—"}</span>
      </div>

      {nameModalOpen && (
        <div className="about-scrim" onClick={() => !savingTpl && setNameModalOpen(false)}>
          <div
            className="name-tpl-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Name this template"
          >
            <h3 className="name-tpl-title">Save as template</h3>
            <p className="name-tpl-sub">Give this starting point a name you'll recognize later.</p>
            <input
              className="name-tpl-input"
              type="text"
              value={nameDraft}
              maxLength={80}
              placeholder="e.g. Data Engineer — 1 page"
              autoFocus
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmSaveTemplate();
                if (e.key === "Escape" && !savingTpl) setNameModalOpen(false);
              }}
            />
            <div className="name-tpl-actions">
              <button type="button" className="name-tpl-cancel" onClick={() => setNameModalOpen(false)} disabled={savingTpl}>
                Cancel
              </button>
              <button type="button" className="name-tpl-save" onClick={confirmSaveTemplate} disabled={savingTpl}>
                {savingTpl ? "Saving…" : "Save template"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="about-scrim" onClick={() => !deleting && setPendingDelete(null)}>
          <div className="name-tpl-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Delete template">
            <h3 className="name-tpl-title">Delete template?</h3>
            <p className="name-tpl-sub">
              "{pendingDelete.name}" will be permanently removed from your saved templates. This can't be undone.
            </p>
            <div className="name-tpl-actions">
              <button type="button" className="name-tpl-cancel" onClick={() => setPendingDelete(null)} disabled={deleting}>
                Cancel
              </button>
              <button type="button" className="name-tpl-danger" onClick={confirmDeleteTemplate} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
