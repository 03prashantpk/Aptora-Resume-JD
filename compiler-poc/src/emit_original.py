"""Compile the ORIGINAL reference .tex with REAL Lato (fontspec + bundled TTFs),
leaving all original content/layout untouched. Only the two Lato-loading lines
are swapped so it renders in genuine Lato instead of the Latin Modern fallback.
  python -m src.emit_original
Output: output/original_lato.pdf  (+ output/original_lato.tex)
"""
from __future__ import annotations
import shutil
import subprocess
import tempfile
from pathlib import Path

from .compiler import find_tectonic
from .render import FONTS_DIR

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "output"

FONTSPEC_BLOCK = (
    "\\usepackage{fontspec}\n"
    "\\setmainfont{Lato-Regular.ttf}[\n"
    "  BoldFont=Lato-Bold.ttf,\n"
    "  ItalicFont=Lato-Italic.ttf,\n"
    "  BoldItalicFont=Lato-BoldItalic.ttf ]"
)


def main() -> int:
    exe = find_tectonic()
    if not exe:
        print("tectonic not found")
        return 2

    src = (ROOT / "fixtures" / "original_sample.tex").read_text(encoding="utf-8")

    # Swap ONLY the font-loading lines; keep everything else identical.
    out_lines = []
    replaced = False
    for line in src.splitlines():
        stripped = line.strip()
        if stripped.startswith("\\usepackage[default]{lato}"):
            out_lines.append(FONTSPEC_BLOCK)
            replaced = True
            continue
        if stripped.startswith("\\renewcommand{\\familydefault}{\\sfdefault}"):
            # fontspec already makes Lato the main font; drop this line.
            continue
        out_lines.append(line)
    if not replaced:
        print("WARNING: did not find the lato \\usepackage line to swap")
    fixed = "\n".join(out_lines)

    OUT.mkdir(exist_ok=True)
    (OUT / "original_lato.tex").write_text(fixed, encoding="utf-8")

    work = Path(tempfile.mkdtemp(prefix="orig-lato-"))
    try:
        (work / "document.tex").write_text(fixed, encoding="utf-8")
        for f in FONTS_DIR.glob("*.ttf"):
            shutil.copy2(f, work / f.name)
        proc = subprocess.run(
            [exe, "-X", "compile", str(work / "document.tex"), "--outdir", str(work)],
            capture_output=True, text=True, timeout=180, cwd=work,
        )
        pdf = work / "document.pdf"
        if proc.returncode == 0 and pdf.exists():
            data = pdf.read_bytes()
            (OUT / "original_lato.pdf").write_bytes(data)
            from .pdf_validation import analyze
            pages, fonts = analyze(data)
            print(f"OK: output/original_lato.pdf  {len(data)}B, {pages}p, fonts={fonts}")
        else:
            print("FAIL:\n" + (proc.stdout or "") + "\n" + (proc.stderr or ""))
            return 1
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print("Compare: output/original_sample.pdf (Latin Modern fallback) vs output/original_lato.pdf (real Lato)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
