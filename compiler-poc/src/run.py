"""Tectonic compiler POC runner.
  python -m src.run            (offline/--only-cached: proves no runtime network)
  python -m src.run --warm     (allow network ONCE to populate Tectonic's cache)

Gate: T01/T02/T03 compile with correct fonts (Lato/NewTX/Charter), valid PDF,
no runtime CTAN. Also runs edge cases + a small benchmark. Prints a report; the
numbers are measured, never invented. Writes output/*.pdf.
"""
from __future__ import annotations
import json
import sys
import statistics
from pathlib import Path

from .models import CompileInput, ResumeJSON
from .compiler import TectonicCompiler, tectonic_version
from .font_verification import verify_font
from .render import EXPECTED_FONTS
from .edge_cases import edge_cases

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "output"
TEMPLATES = ["T01", "T02", "T03"]
WARM_RUNS = 3


def main() -> int:
    warm_mode = "--warm" in sys.argv  # allow network ONCE to fill the bundle cache
    ver = tectonic_version()
    if ver is None:
        print(
            "\n[X] tectonic not found on PATH.\n"
            "Install it, then re-run:\n"
            "  - Linux/WSL: `cargo install tectonic` OR download a release binary\n"
            "               (see https://tectonic-typesetting.github.io/)\n"
            "  - macOS: `brew install tectonic`\n"
            "  - Windows: download the release .exe and add it to PATH, or use WSL.\n"
            "First run may need network to fetch the support bundle: `python -m src.run --warm`.\n"
            "Then run `python -m src.run` (offline, --only-cached) for the real gate.\n"
        )
        return 2
    print(f"tectonic: {ver}")
    print(f"mode: {'WARM (network allowed to fill cache)' if warm_mode else 'OFFLINE (--only-cached, no runtime network)'}\n")

    OUT.mkdir(exist_ok=True)
    resume = ResumeJSON.from_dict(json.loads((ROOT / "fixtures" / "synthetic_resume.json").read_text(encoding="utf-8")))
    compiler = TectonicCompiler(only_cached=not warm_mode)

    print("=== GATE: T01/T02/T03 ===")
    rows, gate_pass = [], 0
    for tid in TEMPLATES:
        cold = compiler.compile(CompileInput(tid, resume))
        if not cold.success:
            print(f"[X] {tid}: COMPILE FAIL - {cold.error_code}: {cold.detail}")
            rows.append(f"{tid} | FAIL | {cold.error_code}: {cold.detail}")
            continue
        (OUT / f"{tid}.pdf").write_bytes(cold.pdf)  # type: ignore[arg-type]
        warm = [compiler.compile(CompileInput(tid, resume)) for _ in range(WARM_RUNS)]
        warm_ms = [r.compile_time_ms for r in warm if r.success]
        fc = verify_font(tid, cold.pdf)  # type: ignore[arg-type]
        ok = fc.passed and (cold.page_count or 0) >= 1
        gate_pass += 1 if ok else 0
        warm_p50 = int(statistics.median(warm_ms)) if warm_ms else 0
        print(
            f"{'[OK]' if ok else '[X]'} {tid} ({EXPECTED_FONTS[tid]}): "
            f"{len(cold.pdf or b'')}B, {cold.page_count}p, cold {cold.compile_time_ms}ms, warm~{warm_p50}ms, "
            f"font[{fc.tool}] expected={fc.has_expected} fallback={fc.has_fallback} sha={cold.sha256[:12] if cold.sha256 else '-'}"
        )
        rows.append(f"{tid} | {'PASS' if ok else 'FAIL'} | {cold.page_count}p | {len(cold.pdf or b'')}B | cold {cold.compile_time_ms}ms | warm~{warm_p50}ms | font {'OK' if fc.passed else 'BAD'}")
        if not fc.passed:
            print(f"   font evidence ({fc.tool}):\n" + "\n".join("     " + l for l in fc.evidence.splitlines()[:10]))

    print("\n=== RELIABILITY: edge cases ===")
    edge_pass = edge_total = 0
    for tid in TEMPLATES:
        for name, ec in edge_cases():
            edge_total += 1
            r = compiler.compile(CompileInput(tid, ec))
            ok = r.success and (r.page_count or 0) >= 1
            edge_pass += 1 if ok else 0
            print(f"{'[OK]' if ok else '[X]'} {tid}/{name}: " + (f"{r.page_count}p {r.compile_time_ms}ms" if r.success else f"FAIL {r.detail}"))

    print("\n=== REPORT ===")
    print("template | gate | pages | size | cold | warm | font")
    for r in rows:
        print(r)
    print(f"\nGATE: {gate_pass}/{len(TEMPLATES)} templates PASS (correct font, valid PDF).")
    print(f"RELIABILITY: {edge_pass}/{edge_total} edge-case compiles PASS.")
    print(f"PDFs: {OUT}")
    if not warm_mode:
        print("Runtime network: NONE (compiled with --only-cached).")
    return 0 if gate_pass == len(TEMPLATES) else 1


if __name__ == "__main__":
    raise SystemExit(main())
