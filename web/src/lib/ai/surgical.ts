// Tailor (surgical): rewrite ONLY resume text to match a job description, patched back
// into the untouched LaTeX template at exact offsets.
//
// HOW IT WORKS:
//   1. Universal extraction (shared module ./latexRegions): pull editable text regions
//      (title, summary, skills, bullets, role headers, project details) with offsets.
//   2. AI receives compact JSON (~50 short strings) and rewrites text to match the JD.
//   3. Patched back into the untouched template with exact offset safety — surrounding
//      LaTeX (\Huge, \vspace, margins, packages, section formatting) is never touched.
import { chatWithFallback } from "./nvidia";
import type { Intensity } from "./tailor";
import {
  extractRegions, patchLatex,
  type TextRegion, type AiRegionOutput,
} from "./latexRegions";
import { checkIntegrity } from "./integrity";

// Re-export region types for existing importers of surgical.ts.
export type { RegionKind, TextRegion } from "./latexRegions";

export interface SurgicalResult {
  latex: string;
  changed: TextRegion[];
  skipped: string[];
}

// ─── AI Rewriter ─────────────────────────────────────────────────────────────

const SURGICAL_SYSTEM = [
  "You are an elite Resume-tailoring assistant. You receive extracted resume text snippets as JSON and a target job description.",
  "Rewrite ONLY the text values in the JSON to strongly align the candidate's real experience with the target job description.",
  "Rules:",
  "1. For 'title' kind: Rewrite the target professional title to match or bridge directly towards the role in the job description (e.g., 'FULL-STACK DEVELOPER' -> 'JR. UNITY / GAME DEVELOPER'). Match the capitalization style of the original (e.g. ALL CAPS if original was ALL CAPS).",
  "2. For 'summary' kind: You MUST thoroughly rewrite the professional summary to position the candidate as a high-potential developer for this target role. NEVER leave the candidate claiming to be their old role (e.g. do NOT say 'full-stack developer' if targeting a Unity/Gaming role!). Reframe to emphasize transferable capabilities: C#, C++, Java, native Android SDK integration, real-time networking (Socket.io/WebSockets), 3D/AR prototyping workflows, and performance optimization, while keeping all actual employment and educational background authentic.",
  "3. For 'skill_category' kind: Adapt the skill category heading so it directly serves the target role (e.g. rename 'Data Engineering & ETL:' or 'Cloud, Database & DevOps:' to 'Game & AR/VR Development:', 'Languages & Core:', 'Mobile & Native SDKs:', or 'Graphics & Real-Time Tools:').",
  "4. For 'skill_list' kind: Prioritize and emphasize technologies explicitly requested in the target JD (e.g. prioritize C#, C++, Unity 3D, AR Foundation/ARCore, Android SDK Integration, Java, REST APIs, Socket.io, Computer Vision basics, Git). Never invent fake academic degrees or non-existent companies.",
  "5. For 'role_header' kind: If appropriate, refine the role description to highlight transferable focus (e.g. 'Software & Game Developer --- Mojo Web Technology' or keep as is). Never alter company names or dates.",
  "6. For 'bullet' kind: Substantially reword and reframe bullets to emphasize relevant capabilities (SDK integration, cross-platform Android/Windows, C#, C++, 3D modeling pipelines, real-time Socket.io, API performance, client collaboration). Keep facts, metrics, and outcomes grounded in reality.",
  "7. For 'heading_detail' kind: Adapt project tech stack descriptors to highlight relevant tech for the JD (e.g. emphasize real-time networking, mobile SDK, C++, or ML).",
  "8. Output ONLY minified JSON: { \"regions\": [ { \"id\": \"...\", \"text\": \"...\" }, ... ] }",
  "9. Diff-Only Optimization: Return ONLY the regions that need modification. You may omit completely unchanged regions to maximize speed and token efficiency.",
  "10. Never include markdown fences or explanation.",
].join(" ");

async function callSurgicalAI(
  regions: TextRegion[],
  jd: string,
  intensity: Intensity,
): Promise<AiRegionOutput[]> {
  const INTENSITY_NOTE: Record<Intensity, string> = {
    light: "Minimal edits: adjust wording and emphasis of relevant bullets. Keep almost everything as-is.",
    balanced: "Moderate edits: rewrite target title, refine summary, and reorder/emphasize relevant bullets for strong role fit.",
    aggressive: "Strong edits: rewrite target title, substantially reframe summary and bullet phrasing for maximum alignment — never invent fake companies or degrees.",
  };

  const inputJson = JSON.stringify({
    intensity: INTENSITY_NOTE[intensity],
    regions: regions.map((r) => ({ id: r.id, kind: r.kind, text: r.text })),
  });

  const user = [
    "<RESUME_SNIPPETS>",
    inputJson,
    "</RESUME_SNIPPETS>",
    "",
    "<JOB_DESCRIPTION>",
    jd,
    "</JOB_DESCRIPTION>",
    "",
    "Return the tailored JSON now.",
  ].join("\n");

  const out = await chatWithFallback(
    [{ role: "system", content: SURGICAL_SYSTEM }, { role: "user", content: user }],
    { temperature: 0.35, max_tokens: 4096 },
  );

  const jsonMatch = out.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { regions?: AiRegionOutput[] };
    return Array.isArray(parsed.regions) ? parsed.regions : [];
  } catch {
    return [];
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function surgicalTailor(
  latex: string,
  jd: string,
  intensity: Intensity = "balanced",
): Promise<SurgicalResult> {
  const regions = extractRegions(latex);
  if (regions.length > 0) {
    const aiOutput = await callSurgicalAI(regions, jd, intensity);
    const patched = patchLatex(latex, regions, aiOutput);
    // If the surgical pass actually changed something, we're done — typography is safe
    // by construction (offset patch of text only).
    if (patched.changed.length > 0) return patched;
  }

  // Fallback: the extractor found nothing editable, or the model returned no edits. Do a
  // whole-.tex tailor so JD tailoring still produces changes, but keep typography frozen
  // via the CONTENT-strict integrity check — if the model touched fonts/margins/layout,
  // we discard it and keep the original.
  const whole = await wholeDocTailor(latex, jd, intensity);
  if (whole && whole !== latex && checkIntegrity(latex, whole, "content").ok) {
    return { latex: whole, changed: [], skipped: [] };
  }
  return { latex, changed: [], skipped: [] };
}

const WHOLE_TAILOR_SYSTEM = [
  "You are a resume-tailoring assistant editing a full LaTeX resume against a job description.",
  "Rewrite ONLY the textual CONTENT (summary sentences, bullet wording, the target title, skill lists) to align with the JD, truthfully — never invent employers, dates, degrees, or metrics.",
  "Do NOT change any LaTeX commands, font sizes (\\Huge/\\large/etc.), margins, \\usepackage, custom macros, spacing, section formatting, or layout. Only the human-readable text between commands may change.",
  "Keep special characters escaped (\\& \\% \\$ \\# \\_). Keep every environment and brace balanced.",
  "Output ONLY the complete LaTeX document — no markdown fences, no commentary. Must start with \\documentclass and end with \\end{document}.",
].join(" ");

async function wholeDocTailor(latex: string, jd: string, intensity: Intensity): Promise<string> {
  const note: Record<Intensity, string> = {
    light: "Make minimal wording tweaks.",
    balanced: "Refine the summary and emphasize relevant bullets/skills for the role.",
    aggressive: "Substantially reframe summary and bullet phrasing for maximum relevance (still truthful).",
  };
  const user = [
    "<RESUME>", latex, "</RESUME>", "",
    "<JOB_DESCRIPTION>", jd, "</JOB_DESCRIPTION>", "",
    note[intensity],
    "Return the full tailored LaTeX now.",
  ].join("\n");
  const out = await chatWithFallback(
    [{ role: "system", content: WHOLE_TAILOR_SYSTEM }, { role: "user", content: user }],
    { temperature: 0.35, max_tokens: 8192 },
  );
  return out
    .replace(/^```(?:latex|tex)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
    .replace(/\\\\&/g, "\\&").replace(/\\\\%/g, "\\%").replace(/\\\\#/g, "\\#");
}
