// Server-only: AI "tailor" — rewrite the Resume LaTeX to fit a job description.
// Prompt-injection aware (rule 25): system rules are fixed; the Resume and JD are
// clearly delimited as untrusted DATA the model must not treat as instructions.
import { chatWithFallback, chatStream, models, type ChatMessage } from "./nvidia";

const SYSTEM = [
  "You are a Resume-tailoring assistant that edits LaTeX source.",
  "You receive a LaTeX Resume and a job description.",
  "Rewrite ONLY the textual content so the Resume better matches the job description.",
  "Keep every factual claim truthful. Never invent employers, degrees, dates, skills, metrics, technologies, or projects.",

  "ABSOLUTE LATEX STRUCTURE RULES:",
  "1. The supplied LaTeX document is a protected source template.",
  "2. Preserve the exact document structure.",
  "3. NEVER modify, remove, reorder, or rename \\documentclass, \\usepackage, \\newcommand, \\renewcommand, \\titleformat, or any other structural command.",
  "4. NEVER modify custom macro definitions.",
  "5. NEVER modify macro names including \\resumeItem, \\resumeSubheading, \\resumeProjectHeading, \\resumeSubItem, \\resumeSubHeadingListStart, \\resumeSubHeadingListEnd, \\resumeItemListStart, and \\resumeItemListEnd.",
  "6. NEVER modify \\begin{...} or \\end{...} pairs.",
  "7. NEVER add or remove LaTeX environments.",
  "8. NEVER change existing curly-brace structure.",
  "9. Every { must have a matching }.",
  "10. Preserve all existing $, &, %, _, #, {, and } escaping.",
  "11. In prose, &, %, _, #, and $ must be escaped when required by LaTeX.",
  "12. Preserve all alignment & characters inside tabular/tabularx structures.",
  "13. Do not introduce new LaTeX packages or commands.",
  "14. Do not convert working LaTeX syntax into different LaTeX syntax.",
  "15. When rewriting a bullet, change only the text inside the existing \\resumeItem{...}.",
  "16. When rewriting a summary, change only the text of the existing summary.",
  "17. Preserve all links, URLs, commands, formatting macros, and structural delimiters unless changing their visible text is explicitly necessary.",
  "18. Before output, validate brace balance, environment balance, math-mode delimiters, command delimiters, and escaped special characters.",
  "19. If uncertain, preserve the original source rather than risking structural damage.",

  "OUTPUT RULES:",
  "Return a COMPLETE LaTeX document beginning with \\documentclass and ending with \\end{document}.",
  "Return ONLY LaTeX source. No Markdown fences. No explanation. No commentary.",
].join(" ");

export type Intensity = "light" | "balanced" | "aggressive";

const INTENSITY_NOTE: Record<Intensity, string> = {
  light: "Make MINIMAL edits: only adjust wording and emphasis of a few lines. Keep almost everything as-is.",
  balanced: "Make MODERATE edits: refine the summary, reorder/emphasize relevant bullets, keep the person's voice.",
  aggressive: "Make STRONGER edits: substantially rewrite summary and bullet phrasing for maximum relevance — but still never invent facts.",
};

function buildMessages(latex: string, jd: string, intensity: Intensity): ChatMessage[] {
  const user = [
    "<RESUME>", latex, "</RESUME>", "",
    "<JOB_DESCRIPTION>", jd, "</JOB_DESCRIPTION>", "",
    `Tailoring intensity: ${INTENSITY_NOTE[intensity]}`,
    "Return the full tailored LaTeX document only.",
  ].join("\n");
  return [{ role: "system", content: SYSTEM }, { role: "user", content: user }];
}

export function stripFences(s: string): string {
  const m = s.match(/```(?:latex|tex)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : s).trim();
}

/** Non-streaming tailor. Default lightning model with automatic fallback chain. */
export async function tailorLatex(latex: string, jd: string, intensity: Intensity = "balanced"): Promise<string> {
  const out = await chatWithFallback(buildMessages(latex, jd, intensity), { temperature: 0.4, max_tokens: 8192 });
  return stripFences(out);
}

/** Streaming tailor: yields visible content deltas (LaTeX) as they arrive.
 *  Uses the default lightning model; keeps a reasoning fallback for thinking models.
 *  (Streaming can't switch models mid-stream, so it uses the primary only.) */
export async function* tailorLatexStream(latex: string, jd: string, intensity: Intensity = "balanced"): AsyncGenerator<string, void, unknown> {
  let reasoningBuf = "";
  let hadContent = false;

  for await (const chunk of chatStream(buildMessages(latex, jd, intensity), {
    model: models.text,   // default model (Gemini 2.5 Flash); streams content deltas
    temperature: 0.4,
    max_tokens: 8192,
  })) {
    if (chunk.content) {
      hadContent = true;
      yield chunk.content;
    } else if (chunk.reasoning) {
      // Thinking model: collect reasoning — we'll extract LaTeX from it at the end
      // if no content ever arrived (don't yield mid-stream: reasoning is English prose).
      reasoningBuf += chunk.reasoning;
    }
  }

  // Fallback: if a thinking model was used and put the entire LaTeX document
  // inside its reasoning trace rather than content, extract and yield it once.
  if (!hadContent && reasoningBuf) {
    // Look for a complete LaTeX document in the reasoning buffer.
    const latexDoc = reasoningBuf.match(/\\documentclass[\s\S]+?\\end\{document\}/i);
    if (latexDoc) {
      yield latexDoc[0];
    }
    // If no LaTeX document found, yield nothing — Workspace will see gotContent=false
    // and restore the original, showing an error. No garbage is forwarded.
  }
}

