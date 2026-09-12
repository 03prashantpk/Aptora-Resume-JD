"""Font verification: prove the PDF embeds the template's REAL font and did NOT
fall back to Computer Modern / Latin Modern. Uses the stdlib-only PDF inspector
(pdf_validation.analyze) — no pdffonts, no WSL, no Docker."""
from __future__ import annotations
import re
from dataclasses import dataclass

from .pdf_validation import analyze

# Expected real-font signatures per template (embedded /BaseFont names).
_EXPECT = {
    "T01": re.compile(r"Lato", re.I),
    # NewTX embeds TeX Gyre Termes (Times-like); XCharter for T03.
    "T02": re.compile(r"Termes|NimbusRoman|Times|txr|zxx", re.I),
    "T03": re.compile(r"XCharter|Charter", re.I),
}
# Fallbacks that mean FAILURE (Computer Modern / Latin Modern substitution).
_FALLBACK = {
    "T01": re.compile(r"^(CMSS|SFSS|LMSans|lmss)", re.I),
    "T02": re.compile(r"^(CMR|LMRoman|lmr)", re.I),
    "T03": re.compile(r"^(CMSS|SFSS|LMSans|lmss|CMR|LMRoman)", re.I),
}


@dataclass
class FontCheck:
    tool: str
    has_expected: bool
    has_fallback: bool
    passed: bool
    evidence: str


def verify_font(template_id: str, pdf: bytes) -> FontCheck:
    _, fonts = analyze(pdf)
    joined = " ".join(fonts)
    has_expected = bool(_EXPECT[template_id].search(joined))
    # A fallback font is only damning if ALL fonts look like CM/LM (i.e. the real
    # font is absent). Check per-font against the fallback pattern.
    has_fallback = any(_FALLBACK[template_id].search(f) for f in fonts) and not has_expected
    return FontCheck(
        tool="pdf-inspect",
        has_expected=has_expected,
        has_fallback=has_fallback,
        passed=has_expected,
        evidence="\n".join(fonts) if fonts else "(no font names found)",
    )
