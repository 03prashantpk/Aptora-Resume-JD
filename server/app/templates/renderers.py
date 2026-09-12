"""Trusted T01/T02/T03 renderers (ResumeJSON -> .tex). Ported verbatim from the
validated compiler POC. Layout/typography live here; AI/users never write LaTeX.

T01 loads REAL Lato via fontspec by filename (TTFs are copied into the compile dir
by the compiler). T02 uses newtx (bundled Termes); T03 uses XCharter (bundled)."""
from __future__ import annotations
from pathlib import Path
from ..compiler.models import ResumeJSON
from .escape import esc, href, BULLET

# Bundled Lato TTFs (real font, OFL). Compiler copies these into the compile CWD.
FONTS_DIR = Path(__file__).resolve().parent / "fonts" / "lato"

EXPECTED_FONTS = {"T01": "Lato", "T02": "NewTX", "T03": "Charter"}


def _contact(d: ResumeJSON) -> str:
    c, parts = d.contact, []
    if c.phone:
        parts.append(esc(c.phone))
    if c.email:
        parts.append(f"\\href{{mailto:{c.email}}}{{{esc(c.email)}}}")
    if c.linkedin:
        parts.append(href(f"https://{c.linkedin}", c.linkedin))
    if c.github:
        parts.append(href(f"https://{c.github}", c.github))
    if c.location:
        parts.append(esc(c.location))
    return (" " + BULLET).join(parts)


def _sec(title: str, body: str) -> str:
    return f"\\section*{{{esc(title)}}}\n{body}\n"


def render_t01(d: ResumeJSON) -> str:
    def experience() -> str:
        out = ""
        for e in d.experience:
            out += f"\\textbf{{{esc(e.title)}}} \\\\\n{esc(e.org)} \\hfill {esc(e.dates)}\n\\begin{{itemize}}\n"
            for b in e.bullets:
                out += f"    \\item {esc(b)}\n"
            out += "\\end{itemize}\n"
        for g in d.extra_groups:
            out += f"\n\\textbf{{{esc(g.heading)}}}\n\\begin{{itemize}}\n"
            for b in g.bullets:
                out += f"    \\item {esc(b)}\n"
            out += "\\end{itemize}\n"
        return out

    def projects() -> str:
        if not d.projects:
            return ""
        out = "\\begin{itemize}\n"
        for p in d.projects:
            out += f"  \\item[\\textbullet] \\textbf{{{esc(p.name)}}} \\\\\n  {esc(p.description)}\n  \\vspace{{2pt}}\n"
        return out + "\\end{itemize}\n"

    def skills() -> str:
        return " \\\\\n".join(f"\\noindent \\textbf{{{esc(s.label)}:}} {esc(s.items)}" for s in d.skills)

    def education() -> str:
        return " \\\\\n".join(f"{esc(e.text)} \\hfill {esc(e.dates)}" for e in d.education)

    summary = _sec("Summary", esc(d.summary)) if d.summary else ""
    exp = _sec("Experience", experience()) if (d.experience or d.extra_groups) else ""
    proj = _sec("Projects", projects()) if d.projects else ""
    sk = _sec("Technical Skills", skills()) if d.skills else ""
    edu = _sec("Education", education()) if d.education else ""
    cert = _sec("Certifications", f"\\begin{{itemize}}[label=--, leftmargin=*]\n    \\item {esc(d.certifications)}\n\\end{{itemize}}") if d.certifications else ""
    soft = _sec("Soft Skills and Interests", esc(d.soft_skills)) if d.soft_skills else ""
    footer = (f"\\vspace{{5pt}}\n\\begin{{center}}\n    \\textbf{{Portfolio and More Projects: {href(d.portfolio_line, d.portfolio_line)}}}\n\\end{{center}}\n" if d.portfolio_line else "")
    return f"""\\documentclass[a4paper,11pt]{{article}}
\\usepackage[margin=0.34in,top=0.2in,bottom=0.2in]{{geometry}}
\\usepackage{{enumitem}}
\\usepackage[hidelinks]{{hyperref}}
\\usepackage{{titlesec}}
\\usepackage{{parskip}}
\\usepackage{{xcolor}}
\\usepackage{{fontspec}}
\\setmainfont{{Lato-Regular.ttf}}[
  BoldFont=Lato-Bold.ttf,
  ItalicFont=Lato-Italic.ttf,
  BoldItalicFont=Lato-BoldItalic.ttf ]
\\pagenumbering{{gobble}}
\\titleformat{{\\section}}{{\\large\\bfseries}}{{}}{{0em}}{{}}[\\titlerule]
\\titlespacing*{{\\section}}{{0pt}}{{2pt}}{{1pt}}
\\setlist[itemize]{{noitemsep, topsep=0.4pt, itemsep=0pt, left=0pt}}
\\setlength{{\\parskip}}{{0.4pt}}
\\renewcommand{{\\baselinestretch}}{{0.84}}
\\begin{{document}}
\\begin{{center}}
    {{\\Huge \\textbf{{{esc(d.name)}}}}}\\\\[1pt]
    {{\\color{{gray}}\\textbf{{{esc(d.headline)}}}}}\\\\[6pt]
    \\small
    {BULLET}{_contact(d)}
\\end{{center}}
{summary}{exp}{proj}{sk}{edu}{cert}{soft}{footer}
\\end{{document}}
"""


def render_t02(d: ResumeJSON) -> str:
    def experience() -> str:
        blocks = []
        for i, e in enumerate(d.experience):
            head = f"\\textbf{{{esc(e.title)}}} \\hfill \\textit{{{esc(e.dates)}}}"
            out = ("\\vspace{5pt}\n" if i else "") + head + "\n\\begin{itemize}\n"
            for b in e.bullets:
                out += f"    \\item {esc(b)}\n"
            blocks.append(out + "\\end{itemize}\n")
        return "".join(blocks)

    def skills() -> str:
        return "\\noindent\n" + " \\\\[5pt]\n".join(f"\\textbf{{{esc(s.label)}:}} {esc(s.items)}" for s in d.skills)

    def education() -> str:
        out = "\\begin{tabularx}{\\textwidth}{@{}Xr@{}}\n"
        for e in d.education:
            out += f"{esc(e.text)} & {esc(e.dates)} \\\\\n"
        return out + "\\end{tabularx}\n"

    summary = _sec("SUMMARY", esc(d.summary)) if d.summary else ""
    exp = _sec("EXPERIENCE", experience()) if d.experience else ""
    sk = _sec("KEY SKILLS", skills()) if d.skills else ""
    edu = _sec("EDUCATION", education()) if d.education else ""
    soft = _sec("ADDITIONAL INFORMATION", esc(d.soft_skills)) if d.soft_skills else ""
    return f"""\\documentclass[a4paper,11pt]{{article}}
\\usepackage[margin=0.65in,top=0.45in,bottom=0.45in]{{geometry}}
\\usepackage{{enumitem}}
\\usepackage[hidelinks]{{hyperref}}
\\usepackage{{titlesec}}
\\usepackage{{parskip}}
\\usepackage{{xcolor}}
\\usepackage{{newtxtext,newtxmath}}
\\pagenumbering{{gobble}}
\\usepackage{{tabularx}}
\\titleformat{{\\section}}
  {{\\Large\\bfseries\\uppercase}}
  {{}}{{0em}}{{}}[\\titlerule]
\\setlist[itemize]{{noitemsep, topsep=4pt, left=8pt}}
\\renewcommand{{\\baselinestretch}}{{1.12}}
\\begin{{document}}
\\begin{{center}}
    {{\\Huge \\textbf{{{esc(d.name)}}}}}\\\\[5pt]
    {{\\large\\textbf{{{esc(d.headline)}}}}}\\\\[9pt]
    \\normalsize
    {BULLET}{_contact(d)}
\\end{{center}}
{summary}{exp}{sk}{edu}{soft}
\\end{{document}}
"""


def render_t03(d: ResumeJSON) -> str:
    def experience() -> str:
        out = ""
        for e in d.experience:
            out += f"\\textbf{{{esc(e.title)}}} \\\\\n{esc(e.org)} \\hfill {esc(e.dates)}\n\\begin{{itemize}}\n"
            for b in e.bullets:
                out += f"    \\item {esc(b)}\n"
            out += "\\end{itemize}\n"
        for g in d.extra_groups:
            out += f"\n\\vspace{{2pt}}\n\\textbf{{{esc(g.heading)}}}\n\\begin{{itemize}}\n"
            for b in g.bullets:
                out += f"    \\item {esc(b)}\n"
            out += "\\end{itemize}\n"
        return out

    def projects() -> str:
        if not d.projects:
            return ""
        out = "\\begin{itemize}\n"
        for p in d.projects:
            out += f"  \\item[\\textbullet] {esc(p.name)} \\\\\n  {esc(p.description)}\n  \\vspace{{2pt}}\n"
        return out + "\\end{itemize}\n"

    def skills() -> str:
        return "\n\n".join(f"\\noindent {esc(s.label)}: {esc(s.items)}" for s in d.skills)

    def education() -> str:
        out = "\\begin{tabularx}{\\textwidth}{@{} >{\\raggedright\\arraybackslash}X >{\\raggedleft\\arraybackslash}p{1.0in} @{}}\n"
        for e in d.education:
            out += f"{esc(e.text)} & {esc(e.dates)} \\\\\n"
        return out + "\\end{tabularx}\n"

    summary = _sec("Summary", esc(d.summary)) if d.summary else ""
    exp = _sec("Experience", experience()) if (d.experience or d.extra_groups) else ""
    proj = _sec("Projects", projects()) if d.projects else ""
    sk = _sec("Technical Skills", skills()) if d.skills else ""
    edu = _sec("Education", education()) if d.education else ""
    cert = _sec("Certifications", esc(d.certifications)) if d.certifications else ""
    soft = _sec("Soft Skills and Interests", esc(d.soft_skills)) if d.soft_skills else ""
    footer = (f"\\vspace{{6pt}}\n\\begin{{center}}\n    Portfolio and More Projects: {href(d.portfolio_line, d.portfolio_line)}\n\\end{{center}}\n" if d.portfolio_line else "")
    return f"""\\documentclass[a4paper,11pt]{{article}}
\\usepackage[margin=0.34in,top=0.2in,bottom=0.2in]{{geometry}}
\\usepackage{{enumitem}}
\\usepackage[hidelinks]{{hyperref}}
\\usepackage{{titlesec}}
\\usepackage{{parskip}}
\\usepackage{{xcolor}}
\\usepackage{{XCharter}}
\\pagenumbering{{gobble}}
\\usepackage{{tabularx}}
\\usepackage{{ragged2e}}
\\titleformat{{\\section}}{{\\large\\bfseries}}{{}}{{0em}}{{}}[\\titlerule]
\\titlespacing*{{\\section}}{{0pt}}{{2pt}}{{1pt}}
\\setlist[itemize]{{noitemsep, topsep=0.4pt, itemsep=0pt, left=0pt}}
\\setlength{{\\parskip}}{{0.4pt}}
\\renewcommand{{\\baselinestretch}}{{0.92}}
\\begin{{document}}
\\begin{{center}}
    {{\\Huge \\textbf{{{esc(d.name)}}}}}\\\\[3pt]
    {{\\color{{gray}}\\textbf{{{esc(d.headline)}}}}}\\\\[9pt]
    \\small
    {BULLET}{_contact(d)}
\\end{{center}}
{summary}{exp}{proj}{sk}{edu}{cert}{soft}{footer}
\\end{{document}}
"""


REGISTRY = {"T01": render_t01, "T02": render_t02, "T03": render_t03}


def render(template_id: str, d: ResumeJSON) -> str:
    fn = REGISTRY.get(template_id)
    if fn is None:
        raise ValueError(f"unknown/untrusted templateId: {template_id}")
    return fn(d)
