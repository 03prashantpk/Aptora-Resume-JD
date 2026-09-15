// Server-only: Natural Language Manual Update & Pinpoint Layout Engine.
// Handles user instructions (e.g. "reduce margins", "fit to 1 page", "update bullet 2", "make summary punchier")
// with a hybrid of instant deterministic layout adjustments and targeted AI refinement.

import { chatWithFallback, type ChatMessage } from "./nvidia";
import { extractRegions, patchLatex, type AiRegionOutput } from "./latexRegions";
import { checkIntegrity, type EditIntent } from "./integrity";

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

async function contentEdit(latex: string, instruction: string): Promise<InstructResult> {
  const regions = extractRegions(latex);
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

  const out = await chatWithFallback(
    [{ role: "system", content: CONTENT_SYSTEM }, { role: "user", content: user }],
    { temperature: 0.2, max_tokens: 4096 },
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
  return scopedEdit(latex, instruction, "content");
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

async function scopedEdit(latex: string, instruction: string, intent: EditIntent): Promise<InstructResult> {
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

  const rawOut = await chatWithFallback(
    [{ role: "system", content: SCOPED_SYSTEM }, { role: "user", content: user }],
    { temperature: 0.2, max_tokens: 8192 },
  );

  let updatedTex = rawOut
    .replace(/^```(?:latex|tex)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  updatedTex = updatedTex
    .replace(/\\\\&/g, "\\&")
    .replace(/\\\\%/g, "\\%")
    .replace(/\\\\#/g, "\\#");

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

// ─── AI-Powered Natural Language Update (entry point) ──────────────────────────

export async function instructLatex(latex: string, instruction: string): Promise<InstructResult> {
  const norm = instruction.trim().toLowerCase();

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
  if (intent === "content") return contentEdit(latex, instruction);
  return scopedEdit(latex, instruction, intent);
}
