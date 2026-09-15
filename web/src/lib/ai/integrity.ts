// Operation-aware formatting-integrity check for AI LaTeX edits.
//
// The rule (per product decision): a CONTENT edit must never change typography/layout;
// a STRUCTURAL edit may touch a small allowlisted set (add/remove a section/entry); a
// FORMAT edit is explicitly allowed to change formatting, so we only sanity-check that
// the document is still structurally whole. This is NOT a naive global before/after
// token compare — it is scoped to the operation kind so legitimate edits aren't rejected.

export type EditIntent = "content" | "structural" | "format";

/** A stable "formatting signature" of a .tex document: the counts of the commands that
 *  define typography and layout. If a CONTENT edit changed any of these, the AI altered
 *  formatting it should not have. */
export interface FormatSignature {
  documentclass: string;               // the full \documentclass[...]{...} line
  packages: string[];                  // sorted \usepackage names
  fontSizeCmds: Record<string, number>; // counts of \Huge, \LARGE, \Large, \large, \normalsize, \small, \footnotesize, \scriptsize, \tiny
  geometry: string;                    // folded geometry options + margin values (order-stable)
  sectionDefs: number;                 // count of \titleformat / \section definitions style commands
  customCmds: string[];                // sorted names defined via \newcommand / \renewcommand
  spacingCmds: number;                 // count of \vspace / \hspace / \setlength / \baselinestretch / \titlespacing
  fontSelect: number;                  // count of \fontsize / \selectfont / \setmainfont / \setlist
}

const FONT_SIZE_CMDS = [
  "Huge", "huge", "LARGE", "Large", "large", "normalsize", "small", "footnotesize", "scriptsize", "tiny",
];

function countAll(hay: string, re: RegExp): number {
  const m = hay.match(re);
  return m ? m.length : 0;
}

/** Compute the formatting signature of a document. Pure + cheap. */
export function formatSignature(tex: string): FormatSignature {
  const documentclass = (tex.match(/\\documentclass[^\n]*/) ?? [""])[0].trim();

  const packages = Array.from(tex.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]*)\}/g))
    .flatMap((m) => m[1].split(",").map((s) => s.trim()))
    .filter(Boolean)
    .sort();

  const fontSizeCmds: Record<string, number> = {};
  for (const c of FONT_SIZE_CMDS) {
    fontSizeCmds[c] = countAll(tex, new RegExp(`\\\\${c}\\b`, "g"));
  }

  // Capture geometry PRESENCE *and* its actual margin values, so a change like
  // margin=0.65in -> margin=0.3in (same package, different layout) is detected. We fold
  // the \geometry{...} args, the \usepackage[...]{geometry} options, and every
  // \addtolength{\...margin/width/height}{value} into one stable string.
  const geomParts: string[] = [];
  for (const m of tex.matchAll(/\\usepackage\[([^\]]*)\]\{geometry\}/g)) geomParts.push(`pkg[${m[1].replace(/\s+/g, "")}]`);
  for (const m of tex.matchAll(/\\geometry\{([^}]*)\}/g)) geomParts.push(`geo{${m[1].replace(/\s+/g, "")}}`);
  for (const m of tex.matchAll(/\\addtolength\{\\(oddsidemargin|evensidemargin|textwidth|textheight|topmargin)\}\{([^}]*)\}/g)) {
    geomParts.push(`${m[1]}=${m[2].replace(/\s+/g, "")}`);
  }
  const geometry = geomParts.sort().join("|");

  const sectionDefs = countAll(tex, /\\titleformat\b/g) + countAll(tex, /\\titlespacing\b/g);

  const customCmds = Array.from(tex.matchAll(/\\(?:new|renew)command\s*\{?\\([a-zA-Z@]+)\}?/g))
    .map((m) => m[1])
    .sort();

  const spacingCmds = countAll(tex, /\\vspace\b/g) + countAll(tex, /\\hspace\b/g)
    + countAll(tex, /\\setlength\b/g) + countAll(tex, /\\baselinestretch\b/g);

  const fontSelect = countAll(tex, /\\fontsize\b/g) + countAll(tex, /\\selectfont\b/g)
    + countAll(tex, /\\setmainfont\b/g) + countAll(tex, /\\setlist\b/g);

  return { documentclass, packages, fontSizeCmds, geometry, sectionDefs, customCmds, spacingCmds, fontSelect };
}

export interface IntegrityResult {
  ok: boolean;
  /** Human-readable reasons a check failed (empty when ok). */
  violations: string[];
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function recordsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

/** True when the output still looks like a complete LaTeX document. Cheap structural
 *  sanity — used for every intent so an edit can't silently drop the preamble/body. */
export function looksLikeCompleteDoc(tex: string): boolean {
  return /\\documentclass/.test(tex) && /\\begin\{document\}/.test(tex) && /\\end\{document\}/.test(tex);
}

/**
 * Verify an AI edit didn't overstep its operation kind.
 *   - content:    STRICT — no formatting/typography/structure command may change.
 *   - structural: ALLOWLIST — section/entry counts may change, but typography commands
 *                 (font sizes, documentclass, packages, custom cmds, geometry) must not.
 *   - format:     SCOPE-ONLY — formatting is allowed to change; we only require the doc
 *                 stays a complete, compilable-looking document.
 */
export function checkIntegrity(before: string, after: string, intent: EditIntent): IntegrityResult {
  const violations: string[] = [];

  // Every edit must keep a whole document (guards against truncation / dropped preamble).
  if (before && looksLikeCompleteDoc(before) && !looksLikeCompleteDoc(after)) {
    violations.push("Result is not a complete LaTeX document (missing documentclass/document body).");
    return { ok: false, violations };
  }

  if (intent === "format") {
    // Formatting is intentionally allowed to change; nothing more to check.
    return { ok: true, violations: [] };
  }

  const a = formatSignature(before);
  const b = formatSignature(after);

  // These protections apply to BOTH content and structural edits: neither should ever
  // change the base typography system.
  if (a.documentclass !== b.documentclass) violations.push("\\documentclass changed.");
  if (!arraysEqual(a.packages, b.packages)) violations.push("\\usepackage set changed.");
  if (!recordsEqual(a.fontSizeCmds, b.fontSizeCmds)) violations.push("Font-size commands (\\Huge/\\Large/…) changed.");
  if (a.geometry !== b.geometry) violations.push("Page geometry/margins changed.");
  if (!arraysEqual(a.customCmds, b.customCmds)) violations.push("Custom command definitions changed.");
  if (a.fontSelect !== b.fontSelect) violations.push("Font-selection commands (\\fontsize/\\setmainfont/…) changed.");

  if (intent === "content") {
    // CONTENT is strict: section-definition and spacing commands must also be unchanged.
    if (a.sectionDefs !== b.sectionDefs) violations.push("Section-format definitions changed.");
    if (a.spacingCmds !== b.spacingCmds) violations.push("Spacing commands (\\vspace/\\setlength/…) changed.");
  }
  // STRUCTURAL: sectionDefs/spacing may shift when a whole section/entry is added or
  // removed, so those two are NOT enforced here (allowlist). The typography protections
  // above still hold.

  return { ok: violations.length === 0, violations };
}
