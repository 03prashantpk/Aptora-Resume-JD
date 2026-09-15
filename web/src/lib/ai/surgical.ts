// Server-only: Universal Surgical LaTeX tailoring.
//
// HOW IT WORKS:
//   1. Universal extraction:
//      - Candidate Target Title (e.g. FULL-STACK DEVELOPER -> JR. UNITY / GAME DEVELOPER)
//      - Professional Summary (rewritten to pitch candidate for the target role)
//      - Technical Skills Categories AND Skill Lists (re-categorized & prioritized for the role)
//      - Experience & Project Bullets (reframed to emphasize transferable skills)
//      - Role Headers (adapted to reflect transferable domain)
//      Supports BOTH standard LaTeX (\\item, \\section*{...}) AND Overleaf_base (\\resumeItem, \\resumeSubheading)
//   2. AI receives compact JSON (~50 short strings) and rewrites text to match the target JD
//   3. Patched back into the untouched template with exact offset safety

import { chatWithFallback } from "./nvidia";
import type { Intensity } from "./tailor";

// ─── Types ──────────────────────────────────────────────────────────────────

export type RegionKind =
  | "title"
  | "summary"
  | "bullet"
  | "skills"
  | "skill_category"
  | "skill_list"
  | "role_header"
  | "heading_detail";

export interface TextRegion {
  id: string;         // unique stable key (e.g. "bullet_0")
  kind: RegionKind;
  text: string;       // the raw text content (for AI consumption)
  _raw: string;       // the exact matched string in the source LaTeX
  _start: number;     // char offset in original LaTeX
  _end: number;       // char offset (exclusive)
}

export interface SurgicalResult {
  latex: string;
  changed: TextRegion[];
  skipped: string[];
}

// ─── Extractor ───────────────────────────────────────────────────────────────

export function extractRegions(latex: string): TextRegion[] {
  const regions: TextRegion[] = [];
  let idx = 0;

  const add = (id: string, kind: RegionKind, raw: string, start: number) => {
    const trimmed = raw.trim();
    if (trimmed.length < 2) return;
    const text = unescapeLatex(trimmed);
    regions.push({ id, kind, text, _raw: trimmed, _start: start, _end: start + trimmed.length });
  };

  // 1. Candidate Target Role / Subtitle in Header (before first \section)
  const firstSectionIdx = latex.search(/\\section\*?\{/);
  const headerScope = firstSectionIdx > 0 ? latex.slice(0, firstSectionIdx) : latex.slice(0, 1500);

  const titlePatterns = [
    /\{\s*(?:\\large|\\Large|\\normalsize)\s*\\textbf\{([^}]+)\}\s*\}/,
    /\\textbf\{\s*(?:\\large|\\Large|\\normalsize)\s*([^}]+)\}/,
    /\{\s*(?:\\large|\\Large)\s+([^}\\]+)\}/,
  ];

  for (const re of titlePatterns) {
    const tm = re.exec(headerScope);
    if (tm && tm[1] && tm[1].trim().length > 3) {
      const rawTitle = tm[1].trim();
      const pos = headerScope.indexOf(rawTitle);
      if (pos !== -1) {
        add(`role_title_${idx++}`, "title", rawTitle, pos);
        break;
      }
    }
  }

  // 2. Summary / Objective paragraph
  const summaryHeaderRe = /\\section\*?\s*\{[^}]*(?:[Ss]ummary|[Oo]bjective|[Pp]rofile|[Aa]bout)[^}]*\}/i;
  const sm = summaryHeaderRe.exec(latex);
  if (sm) {
    const afterHeaderIdx = sm.index + sm[0].length;
    const nextSectionRel = latex.slice(afterHeaderIdx).search(/\\section\*?\{|\\end\{document\}/);
    const endIdx = nextSectionRel !== -1 ? afterHeaderIdx + nextSectionRel : latex.length;
    let block = latex.slice(afterHeaderIdx, endIdx).trim();
    block = block.replace(/\n\s*%.*$/g, "").replace(/\n\s*\\vspace\{[^}]*\}\s*$/g, "").trim();
    if (block.length > 20) {
      const pos = latex.indexOf(block, afterHeaderIdx);
      if (pos !== -1) {
        add(`summary_${idx++}`, "summary", block, pos);
      }
    }
  }

  // 3. Technical Skills (Universal: Overleaf_base AND Classic itemize)
  const skillsIdx = latex.search(/\\section\*?\s*\{[^}]*[Ss]kill[^}]*\}/i);
  if (skillsIdx !== -1) {
    const afterSkills = latex.slice(skillsIdx);
    const headerMatch = afterSkills.match(/^\\section\*?\s*\{[^}]*\}/);
    if (headerMatch) {
      const skillsStart = skillsIdx + headerMatch[0].length;
      const nextSecMatch = latex.slice(skillsStart).search(/\\section\*?\{|\\end\{document\}/);
      const skillsEnd = nextSecMatch !== -1 ? skillsStart + nextSecMatch : latex.length;
      const skillsBlock = latex.slice(skillsStart, skillsEnd);

      const skillLineRe = /\\textbf\{([^}]+)\}\s*\{?[:\s]*([^\n\\}]+)\}?/g;
      let skm: RegExpExecArray | null;
      while ((skm = skillLineRe.exec(skillsBlock)) !== null) {
        const rawCat = skm[1].trim();
        const rawList = skm[2].trim();
        if (rawCat.length > 2) {
          const catPos = latex.indexOf(rawCat, skillsStart + skm.index);
          if (catPos !== -1) {
            add(`skill_cat_${idx++}`, "skill_category", rawCat, catPos);
          }
        }
        if (rawList.length > 3) {
          const listPos = latex.indexOf(rawList, skillsStart + skm.index);
          if (listPos !== -1) {
            add(`skill_list_${idx++}`, "skill_list", rawList, listPos);
          }
        }
      }
    }
  }

  // 4. Overleaf_base: \resumeItem{...}
  const resumeItemRe = /\\resumeItem\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = resumeItemRe.exec(latex)) !== null) {
    const content = m[1];
    add(`bullet_${idx++}`, "bullet", content, m.index + m[0].indexOf(m[1]));
  }

  // 5. Overleaf_base: \resumeSubheading{Company}{Date}{Role}{Location}
  const subheadingRe = /\\resumeSubheading\s*\{([^{}]+)\}\s*\{([^{}]*)\}\s*\{([^{}]+)\}\s*\{([^{}]*)\}/g;
  while ((m = subheadingRe.exec(latex)) !== null) {
    const role = m[3].trim(); // m[3] is the job title; m[1] is the company name
    if (role.length > 3) {
      const thirdBraceStart = m[0].indexOf(`{${m[3]}}`);
      const offset = thirdBraceStart !== -1 ? m.index + thirdBraceStart + 1 : m.index + m[0].lastIndexOf(m[3]);
      add(`role_header_${idx++}`, "role_header", role, offset);
    }
  }

  // 6. Standard LaTeX \item in itemize / enumerate (outside skills section)
  const itemizeRe = /\\begin\{(?:itemize|enumerate)\}([\s\S]*?)\\end\{(?:itemize|enumerate)\}/g;
  let listMatch: RegExpExecArray | null;
  while ((listMatch = itemizeRe.exec(latex)) !== null) {
    const listPos = listMatch.index;
    const preceding = latex.slice(Math.max(0, listPos - 300), listPos);
    // Skip if inside skills section (already handled in step 3)
    if (/\\section\*?\s*\{[^}]*[Ss]kill[^}]*\}/i.test(preceding)) {
      continue;
    }

    const listContent = listMatch[1];
    const listStart = listMatch.index + listMatch[0].indexOf(listContent);
    const itemParts = listContent.split(/\\item\s+/);
    let currOffset = listStart;

    for (let i = 1; i < itemParts.length; i++) {
      const rawItem = itemParts[i].trim();
      if (rawItem.length < 5) continue;
      const pos = latex.indexOf(rawItem, currOffset);
      if (pos !== -1) {
        add(`bullet_${idx++}`, "bullet", rawItem, pos);
        currOffset = pos + rawItem.length;
      }
    }
  }

  // 7. Role headers in standard LaTeX (e.g. \textbf{Full-Stack Developer --- Mojo Web Technology})
  const roleHeaderRe = /\\textbf\{([^}]+(?:Developer|Engineer|Programmer|Intern|Lead|Specialist|Manager|Consultant|Architect)[^}]*---[^}]+)\}/g;
  while ((m = roleHeaderRe.exec(latex)) !== null) {
    const rawRole = m[1].trim();
    if (rawRole.length > 5) {
      add(`role_header_${idx++}`, "role_header", rawRole, m.index + m[0].indexOf(m[1]));
    }
  }

  // 8. Overleaf_base: \resumeProjectHeading{\textbf{Project Name} $|$ Tech Stack/Detail}{Date/Link}
  const projHeadingRe = /\\resumeProjectHeading\s*\{[^{}]*\\textbf\{[^{}]+\}\s*\|\s*([^{}]+)\}/g;
  while ((m = projHeadingRe.exec(latex)) !== null) {
    const detail = m[1].trim();
    if (detail.length > 3) {
      const pos = latex.indexOf(detail, m.index);
      if (pos !== -1) {
        add(`proj_detail_${idx++}`, "heading_detail", detail, pos);
      }
    }
  }

  return regions;
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

interface AiRegionOutput {
  id: string;
  text: string;
}

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

// ─── Patcher ─────────────────────────────────────────────────────────────────

function patchLatex(
  original: string,
  regions: TextRegion[],
  aiOutput: AiRegionOutput[],
): { latex: string; changed: TextRegion[]; skipped: string[] } {
  const outputMap = new Map<string, string>(aiOutput.map((r) => [r.id, r.text]));
  const changed: TextRegion[] = [];
  const skipped: string[] = [];

  // Sort descending by _start so replacing later text doesn't shift earlier offsets
  const sorted = [...regions].sort((a, b) => b._start - a._start);
  let latex = original;

  for (const region of sorted) {
    const newText = outputMap.get(region.id);
    if (!newText) { skipped.push(region.id); continue; }
    const escaped = escapeLatex(newText.trim());

    const searchFrom = Math.max(0, region._start - 100);
    const searchTo = Math.min(latex.length, region._end + 100);
    const searchWindow = latex.slice(searchFrom, searchTo);
    const pos = searchWindow.indexOf(region._raw);

    if (pos === -1) {
      const fallbackPos = latex.indexOf(region._raw);
      if (fallbackPos === -1) {
        skipped.push(region.id);
        continue;
      }
      if (escaped !== region._raw && newText.trim() !== region.text) {
        latex = latex.slice(0, fallbackPos) + escaped + latex.slice(fallbackPos + region._raw.length);
        changed.push(region);
      }
      continue;
    }

    const absPos = searchFrom + pos;
    if (escaped !== region._raw && newText.trim() !== region.text) {
      latex = latex.slice(0, absPos) + escaped + latex.slice(absPos + region._raw.length);
      changed.push(region);
    }
  }

  // Safety sanitizer: ensure no accidental double-escapes like \\& or \\% break tabular/macros
  latex = latex
    .replace(/\\\\&/g, "\\&")
    .replace(/\\\\%/g, "\\%")
    .replace(/\\\\#/g, "\\#")
    .replace(/\\\\_/g, "\\_");

  return { latex, changed, skipped };
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

// ─── LaTeX text utilities ─────────────────────────────────────────────────────

function unescapeLatex(s: string): string {
  return s
    .replace(/\\&/g, "&")
    .replace(/\\%/g, "%")
    .replace(/\\\$/g, "$")
    .replace(/\\#/g, "#")
    .replace(/\\_/g, "_")
    .replace(/\\{/g, "{")
    .replace(/\\}/g, "}")
    .replace(/\\textbf\{([^}]+)\}/g, "$1")
    .replace(/\\textit\{([^}]+)\}/g, "$1")
    .replace(/\\emph\{([^}]+)\}/g, "$1")
    .replace(/\\href\{[^}]+\}\{([^}]+)\}/g, "$1")
    .replace(/\\texttt\{([^}]+)\}/g, "$1")
    .trim();
}

function escapeLatex(s: string): string {
  return s
    .replace(/(?<!\\)&/g, "\\&")
    .replace(/(?<!\\)%/g, "\\%")
    .replace(/(?<!\\)\$/g, "\\$")
    .replace(/(?<!\\)#/g, "\\#")
    .replace(/(?<!\\)\{/g, "\\{")
    .replace(/(?<!\\)\}/g, "\\}");
}
