// Custom-template placeholder injection.
//
// A user's custom .tex template can contain explicit placeholders like {{NAME}} or
// {{EXPERIENCE}}. Rendering the template = LITERAL, SURGICAL replacement of each
// {{KEY}} token with the escaped value. NOTHING else in the .tex is touched — the
// user's \Huge, \textbf, [5pt], packages, spacing, and every surrounding command stay
// byte-for-byte identical. This is the presentation layer for custom templates: the
// .tex remains the source of truth; we only fill placeholder holes.
//
// Server-side/isomorphic (pure string ops, no I/O). The AI never runs here.
import { escapeLatex } from "../ai/latexRegions";

/** The placeholder keys we officially recognize. Extra/unknown keys in a template are
 *  reported (not silently ignored) so the user can fix typos. */
export const KNOWN_PLACEHOLDERS = [
  "NAME", "HEADLINE", "CONTACT", "SUMMARY", "EXPERIENCE", "PROJECTS",
  "SKILLS", "EDUCATION", "CERTIFICATIONS", "ACHIEVEMENTS", "INTERESTS",
] as const;

export type PlaceholderKey = (typeof KNOWN_PLACEHOLDERS)[number];

/** Values map: placeholder key (case-insensitive) -> replacement text. */
export type PlaceholderValues = Partial<Record<string, string>>;

// A placeholder token: {{KEY}} where KEY is letters/digits/underscore. We intentionally
// match the whole {{...}} and never anything else — no single-brace, no LaTeX command.
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export interface RenderOptions {
  /** If true, values are inserted verbatim (already-LaTeX). Default false = escape as
   *  plain text so user content can't break the .tex or inject commands. */
  raw?: boolean;
  /** What to do with a {{KEY}} that has no provided value:
   *  "empty" (default) removes it, "keep" leaves the token, "error" fails validation. */
  onMissing?: "empty" | "keep" | "error";
}

export interface RenderResult {
  latex: string;
  /** Distinct placeholder keys found in the template (as written, upper-cased). */
  found: string[];
  /** Keys present in the template but not in KNOWN_PLACEHOLDERS. */
  unknown: string[];
  /** Keys in the template that had no value supplied. */
  missing: string[];
  /** Keys provided in values that never appeared in the template. */
  unused: string[];
}

/** List the distinct placeholder keys used in a template (upper-cased, in order). */
export function findPlaceholders(template: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(template)) !== null) {
    const key = m[1].toUpperCase();
    if (!seen.has(key)) { seen.add(key); out.push(key); }
  }
  return out;
}

/** Case-insensitive lookup of a value for a placeholder key. */
function valueFor(values: PlaceholderValues, key: string): string | undefined {
  if (key in values) return values[key];
  const lowerKey = key.toLowerCase();
  for (const k of Object.keys(values)) {
    if (k.toUpperCase() === key || k.toLowerCase() === lowerKey) return values[k];
  }
  return undefined;
}

/**
 * Render a custom template by replacing {{KEY}} tokens with values. LITERAL + SURGICAL:
 * only the {{...}} tokens change; all surrounding LaTeX is preserved exactly.
 *
 * Example: "{\\Huge \\textbf{{{NAME}}}}\\\\[5pt]" + { NAME: "Prashant Kumar" }
 *       => "{\\Huge \\textbf{Prashant Kumar}}\\\\[5pt]"   (\\Huge, \\textbf, [5pt] intact)
 */
export function renderTemplate(
  template: string,
  values: PlaceholderValues,
  opts: RenderOptions = {},
): RenderResult {
  const onMissing = opts.onMissing ?? "empty";
  const found = findPlaceholders(template);
  const unknown = found.filter((k) => !(KNOWN_PLACEHOLDERS as readonly string[]).includes(k));
  const missing: string[] = [];
  const providedKeys = new Set(Object.keys(values).map((k) => k.toUpperCase()));
  const usedKeys = new Set<string>();

  const latex = template.replace(PLACEHOLDER_RE, (whole, rawKey: string) => {
    const key = rawKey.toUpperCase();
    const val = valueFor(values, key);
    if (val === undefined || val === null) {
      if (!missing.includes(key)) missing.push(key);
      if (onMissing === "keep") return whole;   // leave {{KEY}} untouched
      return "";                                // "empty" (and "error" — validated separately)
    }
    usedKeys.add(key);
    return opts.raw ? val : escapeLatex(val);
  });

  const unused = [...providedKeys].filter((k) => !usedKeys.has(k) && !missing.includes(k));

  return { latex, found, unknown, missing, unused };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a template + values BEFORE compiling:
 *  - the template must contain at least one placeholder (otherwise it isn't a template),
 *  - it must look like a complete LaTeX document,
 *  - unknown placeholder keys are warnings (typos),
 *  - with onMissing="error", any missing value is an error.
 */
export function validateTemplate(
  template: string,
  values: PlaceholderValues = {},
  opts: RenderOptions = {},
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!/\\documentclass/.test(template) || !/\\begin\{document\}/.test(template) || !/\\end\{document\}/.test(template)) {
    errors.push("Template must be a complete LaTeX document (\\documentclass … \\begin{document} … \\end{document}).");
  }

  const found = findPlaceholders(template);
  if (found.length === 0) {
    warnings.push("Template has no {{PLACEHOLDER}} tokens — nothing will be injected.");
  }

  const unknown = found.filter((k) => !(KNOWN_PLACEHOLDERS as readonly string[]).includes(k));
  for (const k of unknown) warnings.push(`Unknown placeholder {{${k}}} (not one of the recognized fields).`);

  if ((opts.onMissing ?? "empty") === "error") {
    const providedKeys = new Set(Object.keys(values).map((x) => x.toUpperCase()));
    for (const k of found) {
      if ((KNOWN_PLACEHOLDERS as readonly string[]).includes(k) && !providedKeys.has(k)) {
        errors.push(`Missing value for {{${k}}}.`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
