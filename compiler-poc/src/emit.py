"""Emit generated PDFs (and .tex) for all three templates from the synthetic
fixture into output/, so they can be compared against fixtures/original_sample.tex.
  python -m src.emit
"""
from __future__ import annotations
import json
from pathlib import Path

from .models import ResumeJSON, CompileInput
from .render import render
from .compiler import TectonicCompiler, tectonic_version

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "output"


def main() -> int:
    if tectonic_version() is None:
        print("tectonic not found (expected tools/tectonic.exe or on PATH)")
        return 2
    OUT.mkdir(exist_ok=True)
    resume = ResumeJSON.from_dict(json.loads((ROOT / "fixtures" / "synthetic_resume.json").read_text(encoding="utf-8")))
    compiler = TectonicCompiler(only_cached=False)  # allow bundle fetch if needed
    for tid in ("T01", "T02", "T03"):
        (OUT / f"{tid}.tex").write_text(render(tid, resume), encoding="utf-8")
        r = compiler.compile(CompileInput(tid, resume))
        if r.success and r.pdf:
            (OUT / f"{tid}.pdf").write_bytes(r.pdf)
            print(f"{tid}: {len(r.pdf)}B, {r.page_count}p -> output/{tid}.pdf  (and output/{tid}.tex)")
        else:
            print(f"{tid}: FAIL {r.error_code}: {r.detail}")
    print(f"\nCompare against: fixtures/original_sample.tex -> output/original_sample.pdf")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
