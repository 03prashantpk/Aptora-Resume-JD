// Server-only: Natural Language Manual Update & Pinpoint Layout Engine.
// Handles user instructions (e.g. "reduce margins", "fit to 1 page", "update bullet 2", "make summary punchier")
// with a hybrid of instant deterministic layout adjustments and targeted AI refinement.

import { chatWithRole, chatWithRoleStream, chatWithFallback, type ChatMessage } from "./nvidia";
import { extractRegions, patchLatex, type AiRegionOutput } from "./latexRegions";
import { checkIntegrity, type EditIntent } from "./integrity";
import { compileTex } from "../compiler";

/** Live coverage for long-running edits: reasoning deltas + pipeline stage notices. */
export interface InstructHooks {
  /** Raw reasoning deltas as the model thinks (drives the "Aptora is working…" badge). */
  onReason?: (delta: string) => void;
  /** Stage notices: "intent" | "regions" | "ai" | "compile" | "repair" | "reverted". */
  onStage?: (stage: string, detail?: string) => void;
}

export interface InstructResult {
  latex: string;
  summary: string;
  /** How the edit was handled (for logging/telemetry; safe to ignore in the UI). */
  intent?: EditIntent | "layout-preset";
  /** Set when an unsafe edit was rejected and the original .tex was preserved. */
  rejected?: boolean;
}

// ─── Deterministic Layout Helpers ────────────────────────────────────────────

/**
 * Optimizes margins, font size, and spacing to fit the resume cleanly on 1 page.
 */
export function fitToOnePage(latex: string): string {
  let tex = latex;

  // 1. Font size: 11pt/12pt -> 10pt
  tex = tex.replace(/(\\documentclass\[[^\]]*)(?:11pt|12pt)([^\]]*\]\{article\})/, "$110pt$2");
  if (!/\\documentclass\[[^\]]*10pt/.test(tex)) {
    tex = tex.replace(/\\documentclass\[([^\]]*)\]\{article\}/, "\\documentclass[$1,10pt]{article}");
  }

  // 2. Geometry margins (Classic / Modern / Compact templates)
  if (/\\usepackage\[[^\]]*\]\{geometry\}/.test(tex)) {
    tex = tex.replace(
      /\\usepackage\[[^\]]*\]\{geometry\}/,
      "\\usepackage[margin=0.45in,top=0.35in,bottom=0.35in]{geometry}",
    );
  }

  // 3. Overleaf_base margin adjustments
  if (/\\addtolength\{\\oddsidemargin\}/.test(tex)) {
    tex = tex
      .replace(/\\addtolength\{\\oddsidemargin\}\{[^}]*\}/, "\\addtolength{\\oddsidemargin}{-0.65in}")
      .replace(/\\addtolength\{\\evensidemargin\}\{[^}]*\}/, "\\addtolength{\\evensidemargin}{-0.65in}")
      .replace(/\\addtolength\{\\textwidth\}\{[^}]*\}/, "\\addtolength{\\textwidth}{1.3in}")
      .replace(/\\addtolength\{\\topmargin\}\{[^}]*\}/, "\\addtolength{\\topmargin}{-0.65in}")
      .replace(/\\addtolength\{\\textheight\}\{[^}]*\}/, "\\addtolength{\\textheight}{1.3in}");
  }

  // 4. Line stretch & parskip
  tex = tex.replace(/\\renewcommand\{\\baselinestretch\}\{[^}]*\}/, "\\renewcommand{\\baselinestretch}{0.98}");
  tex = tex.replace(/\\setlength\{\\parskip\}\{[^}]*\}/, "\\setlength{\\parskip}{2.5pt}");

  // 5. Itemize spacing in Overleaf_base
  tex = tex.replace(/\\vspace\{-5pt\}/g, "\\vspace{-7pt}");

  return tex;
}

/**
 * Adjusts margin size across templates.
 */
export function setMargins(latex: string, marginInches: number): string {
  let tex = latex;
  const m = marginInches.toFixed(2);
  const v = (marginInches * 0.75).toFixed(2);

  if (/\\usepackage\[[^\]]*\]\{geometry\}/.test(tex)) {
    tex = tex.replace(
      /\\usepackage\[[^\]]*\]\{geometry\}/,
      `\\usepackage[margin=${m}in,top=${v}in,bottom=${v}in]{geometry}`,
    );
  } else if (/\\addtolength\{\\oddsidemargin\}/.test(tex)) {
    const diff = (marginInches - 0.5).toFixed(2);
    const tw = (1.0 - (marginInches - 0.5) * 2).toFixed(2);
    tex = tex
      .replace(/\\addtolength\{\\oddsidemargin\}\{[^}]*\}/, `\\addtolength{\\oddsidemargin}{-${diff}in}`)
      .replace(/\\addtolength\{\\evensidemargin\}\{[^}]*\}/, `\\addtolength{\\evensidemargin}{-${diff}in}`)
      .replace(/\\addtolength\{\\textwidth\}\{[^}]*\}/, `\\addtolength{\\textwidth}{${tw}in}`);
  }
  return tex;
}

/**
 * Adjusts base font size (10pt, 11pt, 12pt).
 */
export function setFontSize(latex: string, pt: 10 | 11 | 12): string {
  return latex.replace(
    /(\\documentclass\[[^\]]*)(?:10pt|11pt|12pt)([^\]]*\]\{article\})/,
    `$1${pt}pt$2`,
  );
}

// ─── Intent classification ───────────────────────────────────────────────────
// A user instruction is one of three kinds. The kind decides HOW the edit is applied
// and how strictly the result is validated (see integrity.ts):
//   FORMAT     — explicit typography/layout request ("make my name bigger", "change font").
//   STRUCTURAL — add/remove/reorder a whole section or entry.
//   CONTENT    — everything else (rewrite/shorten/fix wording): the safe default.
// CONTENT is the default because a mis-classified content edit must never be allowed to
// touch formatting — and the CONTENT path physically cannot (it only patches text).

const FORMAT_RE = new RegExp(
  [
    "\\bfont\\b", "\\btypeface\\b", "\\bbigger\\b", "\\bsmaller\\b", "\\blarger\\b",
    "\\bfont\\s*size\\b", "\\bpt\\b", "\\bmargin", "\\bspacing\\b", "\\bline\\s*spacing\\b",
    "\\bbold\\b", "\\bitalic\\b", "\\bunderline\\b", "\\bcolou?r\\b", "\\balign", "\\bcenter\\b",
    "\\bindent\\b", "\\bcompact\\b", "\\btighter\\b", "\\bwider\\b", "\\bnarrower\\b",
    "\\bone\\s*page\\b", "\\b1\\s*page\\b", "\\blayout\\b", "\\bstyle\\b",
  ].join("|"),
  "i",
);

const STRUCTURAL_RE = new RegExp(
  [
    "\\badd\\s+(a\\s+)?(new\\s+)?(section|entry|bullet|experience|project|skill|education|certificat|achievement)",
    "\\b(remove|delete|drop)\\s+(the\\s+)?(section|entry|bullet|experience|project|skill|education|certificat|achievement)",
    "\\b(reorder|move|swap|rearrange)\\b",
    "\\bnew\\s+section\\b", "\\bnew\\s+entry\\b",
  ].join("|"),
  "i",
);

export function classifyIntent(instruction: string): EditIntent {
  const s = instruction.trim();
  if (FORMAT_RE.test(s)) return "format";
  if (STRUCTURAL_RE.test(s)) return "structural";
  return "content";
}

// ─── CONTENT path: surgical text-only rewrite (cannot touch formatting) ────────

const CONTENT_SYSTEM = [
  "You are a resume content editor. You receive extracted resume TEXT snippets as JSON and a user's edit instruction.",
  "Rewrite ONLY the text values to satisfy the instruction (improve wording, fix grammar, shorten, clarify, add relevant detail).",
  "You must keep every fact truthful — never invent employers, dates, degrees, or metrics.",
  "You are editing PLAIN TEXT only. Do NOT add LaTeX commands, font sizes, or formatting. Do NOT include braces, backslashes, or math.",
  "Output ONLY minified JSON: { \"regions\": [ { \"id\": \"...\", \"text\": \"...\" }, ... ] }.",
  "Return ONLY the regions you changed. No markdown fences, no explanation.",
].join(" ");

async function contentEdit(latex: string, instruction: string, hooks: InstructHooks = {}): Promise<InstructResult> {
  console.log("[AI] instruct: contentEdit extracting regions…");
  const regions = extractRegions(latex);
  console.log(`[AI] instruct: extracted ${regions.length} regions`);
  if (regions.length === 0) {
    // Nothing safely editable as text; leave the document untouched rather than risk a
    // whole-.tex rewrite for a CONTENT instruction.
    return { latex, summary: "No editable text regions found; document left unchanged.", intent: "content" };
  }

  const input = JSON.stringify({ regions: regions.map((r) => ({ id: r.id, kind: r.kind, text: r.text })) });
  const user = [
    "<INSTRUCTION>", instruction.trim(), "</INSTRUCTION>", "",
    "<RESUME_SNIPPETS>", input, "</RESUME_SNIPPETS>", "",
    "Return the edited JSON now.",
  ].join("\n");

  const opts = { temperature: 0.2, max_tokens: 4096 } as const;
  const out = hooks.onReason
    ? await chatWithRoleStream(
        [{ role: "system", content: CONTENT_SYSTEM }, { role: "user", content: user }],
        opts, "fixer", hooks.onReason,
      )
    : await chatWithRole(
        [{ role: "system", content: CONTENT_SYSTEM }, { role: "user", content: user }],
        opts, "fixer",
      );

  let aiRegions: AiRegionOutput[] = [];
  const jsonMatch = out.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { regions?: AiRegionOutput[] };
      if (Array.isArray(parsed.regions)) aiRegions = parsed.regions;
    } catch { /* fall through: no changes */ }
  }

  const patched = patchLatex(latex, regions, aiRegions);

  // Strict integrity: a CONTENT edit must not have changed ANY formatting/structure.
  // (The offset patcher only replaces text, so this should always pass — it's the
  // safety net that guarantees the contract and catches any regex edge case.)
  const integ = checkIntegrity(latex, patched.latex, "content");
  if (!integ.ok) {
    return {
      latex, // preserve the original — never ship a formatting-mutating "content" edit
      summary: `Kept your formatting: the edit would have altered layout (${integ.violations[0]}). No changes applied.`,
      intent: "content",
      rejected: true,
    };
  }

  const n = patched.changed.length;
  if (n > 0) {
    return {
      latex: patched.latex,
      summary: `Updated ${n} section${n > 1 ? "s" : ""} — formatting untouched.`,
      intent: "content",
    };
  }

  // The surgical patch touched nothing — the target text lives OUTSIDE the extracted
  // regions (e.g. the phone/email/contact line, a header, or free-form text). Fall back
  // to a scoped whole-.tex edit, but keep CONTENT-strict integrity so typography still
  // can't change. This guarantees the edit actually happens instead of a silent no-op.
  return scopedEdit(latex, instruction, "content", hooks);
}

// ─── STRUCTURAL / FORMAT path: scoped whole-.tex edit ──────────────────────────

const SCOPED_SYSTEM = [
  "You are an expert LaTeX resume editor. You receive a full LaTeX resume and a user's edit command.",
  "Apply ONLY the requested change and return the COMPLETE, compilable LaTeX document.",
  "Rules:",
  "1. Change ONLY what the instruction asks for. Leave every unrelated line byte-for-byte identical.",
  "2. Preserve all \\documentclass, \\usepackage, \\newcommand/\\renewcommand, \\titleformat and custom macros (\\resumeItem, \\resumeSubheading, etc.) UNLESS the instruction is explicitly about that formatting.",
  "3. Keep every \\begin{...}/\\end{...} balanced and every brace/math delimiter paired.",
  "4. Keep special characters escaped in text (\\& \\% \\$ \\# \\_).",
  "5. Do NOT add markdown, code fences, comments, or prose. Output ONLY the LaTeX document.",
  "6. The output MUST start with \\documentclass and end with \\end{document}.",
].join(" ");

async function scopedEdit(latex: string, instruction: string, intent: EditIntent, hooks: InstructHooks = {}): Promise<InstructResult> {
  const scopeNote = intent === "format"
    ? "This is a FORMATTING request: you MAY change the specific typography/layout the user asked for (font, size, margins, spacing, alignment). Do not change anything else."
    : intent === "structural"
      ? "This is a STRUCTURAL request: you may add/remove/reorder the specific section or entry requested. Do not change typography, fonts, margins, packages, or unrelated content."
      : "This is a CONTENT request: change ONLY the text the user asked about (e.g. a phone number, email, a word, a sentence). Do NOT change any LaTeX commands, font sizes, margins, spacing, packages, or layout — only the literal text content.";

  const user = [
    "<USER_INSTRUCTION>", instruction.trim(), "</USER_INSTRUCTION>", "",
    scopeNote, "",
    "<CURRENT_LATEX>", latex, "</CURRENT_LATEX>", "",
    "Apply the requested edit and return the complete LaTeX now.",
  ].join("\n");

  const opts = { temperature: 0.2, max_tokens: 8192 } as const;
  const rawOut = hooks.onReason
    ? await chatWithRoleStream(
        [{ role: "system", content: SCOPED_SYSTEM }, { role: "user", content: user }],
        opts, "writer", hooks.onReason,
      )
    : await chatWithRole(
        [{ role: "system", content: SCOPED_SYSTEM }, { role: "user", content: user }],
        opts, "writer",
      );

  let updatedTex = rawOut
    .replace(/^```(?:latex|tex)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  // No escaping rewrites here: the AI returns a complete document and it is validated by
  // an actual COMPILE below (repair loop in the route) — rewriting `\\&`->`\&` etc.
  // corrupted legitimate `\\` row separators in tabular layouts.

  // Operation-aware integrity: structural = typography must be unchanged (section counts
  // may shift); format = only require a complete document. On violation, keep the original.
  const integ = checkIntegrity(latex, updatedTex, intent);
  if (!integ.ok) {
    return {
      latex,
      summary: `Couldn't apply that safely (${integ.violations[0]}). Your document was left unchanged — try rephrasing.`,
      intent,
      rejected: true,
    };
  }

  return {
    latex: updatedTex,
    summary: `Applied ${intent} edit: "${instruction.slice(0, 50)}${instruction.length > 50 ? "..." : ""}"`,
    intent,
  };
}

// ─── Compile validation + AI self-repair ─────────────────────────────────────
// An AI-generated document can contain an unescaped `&` or `_`, an unbalanced
// brace, etc. that CRASHES the Tectonic compile. Instead of shipping a crash to
// the user, we: (1) compile the candidate for real; (2) if it fails, send the
// compiler's actual error + the failing document back to the AI for ONE syntax
// repair round; (3) if that still fails, ship the ORIGINAL document untouched.
// A crash never reaches the user.

const REPAIR_SYSTEM = [
  "You are a LaTeX syntax repair service. You are given a LaTeX resume document that",
  "failed to compile, plus the compiler's error message (and, when available, the lines",
  "that were most recently changed — the error is almost always there).",
  "",
  "First, REASON briefly about WHERE the error is and WHAT is wrong — name the offending",
  "line/construct and the exact cause (e.g. an unescaped & in a URL, a missing closing",
  "brace, an unterminated environment, a stray math character). Then fix ONLY that error",
  "(wrong/missing escapes like & % _ # $ ^ ~, unbalanced braces or environments, stray",
  "math characters, undefined commands). Make the SMALLEST change that compiles.",
  "Do NOT change wording, content, layout, fonts, margins, packages, or anything else.",
  "",
  "On the VERY FIRST line, emit a single short comment naming what you fixed, in the",
  "exact form: %FIX: <plain-English one-liner> (e.g. '%FIX: escaped an & in the LinkedIn",
  "URL on line 20'). Keep it under 90 characters. Then from the next line return ONLY the",
  "complete corrected LaTeX document — start with \\documentclass, end with \\end{document},",
  "no markdown fences and no prose after it.",
].join(" ");

export interface RepairOutcome {
  ok: boolean;
  latex?: string;
  error?: string;
  /** Short human note of what was fixed (from the model's %FIX: line), e.g.
   *  "escaped an & in the LinkedIn URL". Undefined when the model didn't provide one. */
  note?: string;
}

/** Compile-error repair round, callable from BOTH the edit pipeline and the public
 *  /api/ai/fix-tex route (the user-facing "Fix" button). Benchmark role: "repair"
 *  (nemotron-3-ultra primary — visible reasoning — Gemini fallback). */
export async function repairLatexDocument(
  candidate: string,
  compileError: string,
  hooks: InstructHooks = {},
  /** Optional: the lines that changed just before the failure. Sent to the model as a
   *  focus hint ("the error is almost certainly here") so it locates the fault fast,
   *  WITHOUT replacing the full document (LaTeX must be returned whole to recompile). */
  changedLines?: string[],
): Promise<RepairOutcome> {
  hooks.onStage?.("repair");
  const focus = changedLines && changedLines.length
    ? ["<RECENTLY_CHANGED_LINES>", changedLines.slice(0, 40).join("\n").slice(0, 4000), "</RECENTLY_CHANGED_LINES>", ""]
    : [];
  const user = [
    "The following LaTeX document failed to compile with this compiler error:",
    "<COMPILER_ERROR>", compileError.slice(0, 3000), "</COMPILER_ERROR>", "",
    ...focus,
    "<LATEX>", candidate, "</LATEX>", "",
    "Identify where the error is, then return the complete corrected LaTeX document now.",
  ].join("\n");
  const opts = { temperature: 0, max_tokens: 8192 } as const;
  const out = hooks.onReason
    ? await chatWithRoleStream(
        [{ role: "system", content: REPAIR_SYSTEM }, { role: "user", content: user }],
        opts, "repair", hooks.onReason,
      )
    : await chatWithRole(
        [{ role: "system", content: REPAIR_SYSTEM }, { role: "user", content: user }],
        opts, "repair",
      );
  let cleaned = out
    .replace(/^```(?:latex|tex)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  // Pull the model's "%FIX: ..." note off the top (if present) and strip it so it never
  // lands in the compiled document.
  let note: string | undefined;
  const m = cleaned.match(/^\s*%\s*FIX:\s*(.+)$/im);
  if (m) {
    note = m[1].trim().replace(/\s+/g, " ").slice(0, 120);
    cleaned = cleaned.replace(/^\s*%\s*FIX:.*$/im, "").trim();
  }
  const tex = cleaned;
  if (!(tex.startsWith("\\documentclass") && tex.includes("\\end{document}"))) {
    return { ok: false, error: "repair did not return a complete document" };
  }
  const c = await compileTex({ latex: tex, rasterize: false });
  if (c.ok) return { ok: true, latex: tex, note };
  return { ok: false, error: c.error.message || c.error.code };
}

/** Compile-validate an InstructResult; self-repair once; revert on persistent failure. */
async function validateAndRepair(
  result: InstructResult,
  original: string,
  log: (...a: unknown[]) => void,
  hooks: InstructHooks = {},
): Promise<InstructResult> {
  // Layout presets run on the user's ALREADY-COMPILING document and only tweak
  // numerics; rejections and no-ops have nothing to validate.
  if (result.rejected || result.latex === original) return result;
  hooks.onStage?.("compile");
  const first = await compileTex({ latex: result.latex, rasterize: false });
  if (first.ok) return result;
  // Engine unreachable/down is NOT a LaTeX error — the edit is fine; let the normal
  // compile path surface availability later. Only real compiler failures repair.
  if (first.error.code !== "COMPILE_FAILED") {
    log(`skip repair: compile validation unavailable (${first.error.code})`);
    return result;
  }
  log(`candidate failed compile (${first.error.code}) -> AI self-repair`);
  // Focus the repair on the lines this edit introduced (not in the original) — the
  // break is almost always in the new text.
  const origSet = new Set(original.split("\n").map((l) => l.trim()));
  const changed = result.latex.split("\n").filter((l) => l.trim() && !origSet.has(l.trim()));
  const repaired = await repairLatexDocument(result.latex, first.error.message, hooks, changed);
  if (repaired.ok && repaired.latex && repaired.latex !== result.latex) {
    log("self-repair compiled OK");
    return { ...result, latex: repaired.latex, summary: `${result.summary} (fixed a LaTeX syntax slip automatically.)` };
  }
  log(`self-repair failed (${repaired.error ?? "?"}) -> reverting to original document`);
  hooks.onStage?.("reverted", repaired.error);
  return {
    latex: original,
    summary: "The edit broke the document's LaTeX, so it was rolled back — nothing changed. Try rephrasing the edit, or press Fix to repair it directly.",
    intent: result.intent,
    rejected: true,
  };
}

// ─── AI-Powered Natural Language Update (entry point) ──────────────────────────

export async function instructLatex(
  latex: string,
  instruction: string,
  hooks: InstructHooks = {},
): Promise<InstructResult> {
  const log = (...a: unknown[]) => console.log("[AI] instruct:", ...a);
  const norm = instruction.trim().toLowerCase();
  hooks.onStage?.("intent", instruction);

  // 1. Deterministic layout fast-paths (0 tokens, 0ms, zero chance of syntax error).
  //    These are known FORMAT operations handled without any AI call.
  if (/fit\s*(to\s*)?(1|one)\s*page/i.test(norm) || /make\s*it\s*(1|one)\s*page/i.test(norm)) {
    return { latex: fitToOnePage(latex), summary: "Optimized margins, font size (10pt), and spacing to fit on 1 page.", intent: "layout-preset" };
  }
  const marginMatch = norm.match(/(?:margin|margins)\s*(?:to\s*)?([0-9.]+)\s*(?:in|inch|inches)?/i) ||
                      norm.match(/(?:set|change|make)\s*(?:the\s*)?(?:margin|margins)\s*(?:to\s*)?([0-9.]+)/i);
  if (marginMatch) {
    const val = parseFloat(marginMatch[1]);
    if (!isNaN(val) && val >= 0.2 && val <= 1.5) {
      return { latex: setMargins(latex, val), summary: `Set document margins to ${val.toFixed(2)}in.`, intent: "layout-preset" };
    }
  }
  if (/reduce\s*margin|smaller\s*margin|tighten\s*margin|compact\s*margin/i.test(norm)) {
    return { latex: setMargins(latex, 0.45), summary: "Reduced document margins to 0.45in for a compact layout.", intent: "layout-preset" };
  }
  if (/standard\s*margin|increase\s*margin|default\s*margin/i.test(norm)) {
    return { latex: setMargins(latex, 0.65), summary: "Restored standard document margins (0.65in).", intent: "layout-preset" };
  }
  if (/font\s*(size\s*)?(to\s*)?10\s*pt/i.test(norm) || /10\s*pt\s*font/i.test(norm)) {
    return { latex: setFontSize(latex, 10), summary: "Set document base font size to 10pt.", intent: "layout-preset" };
  }
  if (/font\s*(size\s*)?(to\s*)?11\s*pt/i.test(norm) || /11\s*pt\s*font/i.test(norm)) {
    return { latex: setFontSize(latex, 11), summary: "Set document base font size to 11pt.", intent: "layout-preset" };
  }
  if (/font\s*(size\s*)?(to\s*)?12\s*pt/i.test(norm) || /12\s*pt\s*font/i.test(norm)) {
    return { latex: setFontSize(latex, 12), summary: "Set document base font size to 12pt.", intent: "layout-preset" };
  }

  // 2. Classify the instruction and route to the right (safe) handler.
  const intent = classifyIntent(instruction);
  log(`intent=${intent}`);
  hooks.onStage?.("ai", intent);
  try {
    const r = intent === "content"
      ? await contentEdit(latex, instruction, hooks)
      : await scopedEdit(latex, instruction, intent, hooks);
    return await validateAndRepair(r, latex, log, hooks);
  } catch (e) {
    // Any failure in the surgical/scoped path (region extraction edge case, provider
    // hiccup) must NOT hard-fail the edit. Fall back to a single whole-.tex edit; if that
    // also fails, rethrow so the route reports it.
    log(`primary path threw (${e instanceof Error ? e.message : e}) -> scoped fallback`);
    const r = await scopedEdit(latex, instruction, intent === "content" ? "content" : intent, hooks);
    return await validateAndRepair(r, latex, log, hooks);
  }
}
