// Shared surgical LaTeX region extractor + offset patcher.
//
// This is the SAFE core used by both Tailor (surgical.ts) and Manual Edit (instruct.ts):
// it locates editable *text* regions inside a .tex document (bullets, summary, skills,
// titles, role headers) with exact character offsets, and patches new text back at those
// offsets WITHOUT touching any surrounding LaTeX (\Huge, \vspace, margins, packages,
// section formatting, custom commands, etc.).
//
// Extracted VERBATIM from surgical.ts to keep behavior byte-identical; surgical.ts now
// re-uses these. Server-only (no client imports needed, but it's pure/isomorphic).

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

export interface AiRegionOutput {
  id: string;
  text: string;
}

export interface PatchResult {
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

// ─── Patcher ─────────────────────────────────────────────────────────────────

export function patchLatex(
  original: string,
  regions: TextRegion[],
  aiOutput: AiRegionOutput[],
): PatchResult {
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

// ─── LaTeX text utilities ─────────────────────────────────────────────────────

export function unescapeLatex(s: string): string {
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

export function escapeLatex(s: string): string {
  return s
    .replace(/(?<!\\)&/g, "\\&")
    .replace(/(?<!\\)%/g, "\\%")
    .replace(/(?<!\\)\$/g, "\\$")
    .replace(/(?<!\\)#/g, "\\#")
    .replace(/(?<!\\)\{/g, "\\{")
    .replace(/(?<!\\)\}/g, "\\}");
}
