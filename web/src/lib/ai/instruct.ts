// Server-only: Natural Language Manual Update & Pinpoint Layout Engine.
// Handles user instructions (e.g. "reduce margins", "fit to 1 page", "update bullet 2", "make summary punchier")
// with a hybrid of instant deterministic layout adjustments and targeted AI refinement.

import { chat, models, type ChatMessage } from "./nvidia";

export interface InstructResult {
  latex: string;
  summary: string;
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

// ─── AI-Powered Natural Language Update ──────────────────────────────────────

const INSTRUCT_SYSTEM = [
  "You are an expert LaTeX resume editor. You receive a full LaTeX resume and a user's natural language edit command.",
  "Your job is to apply ONLY the requested change to the document.",
  "Rules:",
  "1. Precision: Modify ONLY what the user asked. Never rephrase, delete, or rewrite unrelated sections.",
  "2. Syntax Integrity: The resulting LaTeX must be 100% valid. Never leave open braces {}, broken environments, or misplaced & characters.",
  "3. Format Preservation: Preserve all \\documentclass, \\usepackage, custom macros (like \\resumeItem, \\resumeSubheading), and page structures.",
  "4. Output: Return ONLY the complete modified LaTeX code. Do NOT wrap in ```latex markdown fences. Do NOT add conversational replies.",
].join(" ");

export async function instructLatex(latex: string, instruction: string): Promise<InstructResult> {
  const norm = instruction.trim().toLowerCase();

  // 1. Fast path for common layout instructions (0 tokens, 0ms latency, zero chance of syntax error)
  if (/fit\s*(to\s*)?(1|one)\s*page/i.test(norm) || /make\s*it\s*(1|one)\s*page/i.test(norm)) {
    return {
      latex: fitToOnePage(latex),
      summary: "Optimized margins, font size (10pt), and spacing to fit on 1 page.",
    };
  }

  // Dynamic margin parsing in natural language: e.g. "margins 0.4in", "set margin to 0.35", "reduce margin to 0.5 inch"
  const marginMatch = norm.match(/(?:margin|margins)\s*(?:to\s*)?([0-9.]+)\s*(?:in|inch|inches)?/i) ||
                      norm.match(/(?:set|change|make)\s*(?:the\s*)?(?:margin|margins)\s*(?:to\s*)?([0-9.]+)/i);
  if (marginMatch) {
    const val = parseFloat(marginMatch[1]);
    if (!isNaN(val) && val >= 0.2 && val <= 1.5) {
      return {
        latex: setMargins(latex, val),
        summary: `Set document margins to ${val.toFixed(2)}in.`,
      };
    }
  }

  if (/reduce\s*margin|smaller\s*margin|tighten\s*margin|compact\s*margin/i.test(norm)) {
    return {
      latex: setMargins(latex, 0.45),
      summary: "Reduced document margins to 0.45in for a compact layout.",
    };
  }
  if (/standard\s*margin|increase\s*margin|default\s*margin/i.test(norm)) {
    return {
      latex: setMargins(latex, 0.65),
      summary: "Restored standard document margins (0.65in).",
    };
  }
  if (/font\s*(size\s*)?(to\s*)?10\s*pt/i.test(norm) || /10\s*pt\s*font/i.test(norm)) {
    return {
      latex: setFontSize(latex, 10),
      summary: "Set document base font size to 10pt.",
    };
  }
  if (/font\s*(size\s*)?(to\s*)?11\s*pt/i.test(norm) || /11\s*pt\s*font/i.test(norm)) {
    return {
      latex: setFontSize(latex, 11),
      summary: "Set document base font size to 11pt.",
    };
  }
  if (/font\s*(size\s*)?(to\s*)?12\s*pt/i.test(norm) || /12\s*pt\s*font/i.test(norm)) {
    return {
      latex: setFontSize(latex, 12),
      summary: "Set document base font size to 12pt.",
    };
  }

  // 2. Semantic & Targeted Natural Language Updates via LLM
  const userPrompt = [
    "<USER_INSTRUCTION>",
    instruction.trim(),
    "</USER_INSTRUCTION>",
    "",
    "<CURRENT_LATEX>",
    latex,
    "</CURRENT_LATEX>",
    "",
    "Apply the requested edit and return the complete LaTeX now.",
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: INSTRUCT_SYSTEM },
    { role: "user", content: userPrompt },
  ];

  const rawOut = await chat(messages, {
    model: models.textAlt,
    temperature: 0.2,
    max_tokens: 8192,
  });

  // Clean fences if model added them
  let updatedTex = rawOut
    .replace(/^```(?:latex|tex)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Safety sanitizer: ensure no accidental double-escapes break tabular/macros
  updatedTex = updatedTex
    .replace(/\\\\&/g, "\\&")
    .replace(/\\\\%/g, "\\%")
    .replace(/\\\\#/g, "\\#");

  return {
    latex: updatedTex,
    summary: `Applied update: "${instruction.slice(0, 50)}${instruction.length > 50 ? "..." : ""}"`,
  };
}
