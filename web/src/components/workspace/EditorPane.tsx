import { useEffect, useRef, useState } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import type { ViewUpdate } from "@codemirror/view";
import { EditorView, Decoration, type DecorationSet } from "@codemirror/view";
import { StateField, StateEffect, RangeSetBuilder } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { Check, CircleAlert, LoaderCircle } from "lucide-motion";
import { EditorSelection } from "@codemirror/state";
import type { SaveState } from "./MenuBar";

// Center pane: header (file · template · compile status) + CodeMirror LaTeX editor with
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
  templateLabel: string;
  aiLines: Set<number>; // 1-based lines to highlight as AI-changed
  streaming: boolean;
  jumpLine: number | null; // outline click -> scroll editor to this 1-based line
}

function CompileStatus({ state, streaming }: { state: SaveState; streaming: boolean }) {
  if (streaming) return <span className="ed-status updating"><LoaderCircle size={13} /> Writing…</span>;
  if (state === "updating") return <span className="ed-status updating"><LoaderCircle size={13} /> Compiling…</span>;
  if (state === "saved") return <span className="ed-status ok"><Check size={13} /> Compiled</span>;
  if (state === "error") return <span className="ed-status err"><CircleAlert size={13} /> Compile failed</span>;
  return <span className="ed-status" />;
}

export default function EditorPane({ value, onChange, saveState, pageCount, templateLabel, aiLines, streaming, jumpLine }: Props) {
  const [pos, setPos] = useState({ line: 1, col: 1 });
  const ref = useRef<ReactCodeMirrorRef>(null);

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
          <span className="ed-template">{templateLabel}</span>
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
        <span className="sb-sep">{templateLabel}</span>
        <span className="sb-sep">{pageCount > 0 ? `${pageCount} page${pageCount > 1 ? "s" : ""}` : "—"}</span>
      </div>
    </div>
  );
}
