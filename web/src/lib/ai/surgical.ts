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
  if (regions.length === 0) {
    return { latex, changed: [], skipped: [] };
  }

  const aiOutput = await callSurgicalAI(regions, jd, intensity);
  return patchLatex(latex, regions, aiOutput);
}
