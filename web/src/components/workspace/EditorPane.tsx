import { useEffect, useRef, useState } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import type { ViewUpdate } from "@codemirror/view";
import { EditorView, Decoration, type DecorationSet } from "@codemirror/view";
import { StateField, StateEffect, RangeSetBuilder } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { Check, CircleAlert, LoaderCircle, ChevronDown, Check as CheckIcon } from "lucide-motion";
import { EditorSelection } from "@codemirror/state";
import type { SaveState } from "./MenuBar";
import { TEMPLATES, templateLabel as getTemplateLabel } from "@/lib/templates";
import type { TemplateId } from "@/lib/types";

// Center pane: header (file · template switcher · compile status) + CodeMirror LaTeX editor with
// AI inline highlighting + status bar. LaTeX is intentionally visible; compiler internals
// are not. AI-changed lines are decorated (not fake \color in the source).

const latexLang = StreamLanguage.define(stex);

// --- AI highlight decorations: mark a set of 1-based line numbers as AI-changed. ---
const setAiLines = StateEffect.define<Set<number>>();
const aiLineDeco = Decoration.line({ class: "cm-ai-line" });

const aiField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setAiLines)) {
        const lines = e.value;
        const b = new RangeSetBuilder<Decoration>();
        for (let n = 1; n <= tr.state.doc.lines; n++) {
          if (lines.has(n)) b.add(tr.state.doc.line(n).from, tr.state.doc.line(n).from, aiLineDeco);
        }
        return b.finish();
      }
    }
    return tr.docChanged ? Decoration.none : deco; // clear on manual edits
  },
  provide: (f) => EditorView.decorations.from(f),
});

const cmTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", backgroundColor: "var(--surface)" },
  ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.6", overflow: "auto" },
  ".cm-gutters": { backgroundColor: "var(--surface)", border: "none", color: "var(--muted)" },
  ".cm-activeLine": { backgroundColor: "rgba(37,99,235,0.05)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--secondary)" },
  ".cm-ai-line": { backgroundColor: "rgba(37,99,235,0.10)", boxShadow: "inset 2px 0 0 var(--accent)" },
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
                      </div>
                      <p className="ed-template-item-desc">{t.description}</p>
                    </button>
                  );
                })}
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
          extensions={[latexLang, aiField, EditorView.lineWrapping]}
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
    </div>
  );
}
