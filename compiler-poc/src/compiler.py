"""TectonicCompiler — invokes the real Tectonic engine on a trusted .tex.

Offline/cached model: after the support bundle is fetched ONCE, we compile with
`--only-cached` so no runtime CTAN/network is used. If a needed package/font is
missing from the cache, compilation FAILS (that is the correct, honest result).

Security: only trusted templates render (enforced by render.py); Tectonic does not
support \\write18 shell-escape; we run in an isolated temp dir and clean it up;
full logs are kept private.
"""
from __future__ import annotations
import hashlib
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from .models import CompileInput, CompileResult
from .render import render
from .pdf_validation import analyze

# Vendored native Windows binary (no WSL/Docker). Prefer it; fall back to PATH.
_VENDORED = Path(__file__).resolve().parent.parent / "tools" / ("tectonic.exe" if __import__("os").name == "nt" else "tectonic")


def find_tectonic() -> str | None:
    if _VENDORED.exists():
        return str(_VENDORED)
    return shutil.which("tectonic")


def tectonic_version() -> str | None:
    exe = find_tectonic()
    if not exe:
        return None
    try:
        out = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=30)
        return (out.stdout or out.stderr).strip().splitlines()[0]
    except Exception:
        return None


def _page_count(pdf: bytes) -> int:
    pages, _ = analyze(pdf)  # handles compressed Tectonic PDFs
    return pages


class TectonicCompiler:
    """ResumeCompiler impl using the Tectonic executable."""

    COMPILER_VERSION = "tectonic-poc-1"

    def __init__(self, only_cached: bool = True):
        # only_cached=True -> offline compile (proves no runtime network). Set False
        # ONCE to warm the bundle cache, then run tests with True.
        self.only_cached = only_cached
        self.exe = find_tectonic()

    def compile(self, inp: CompileInput) -> CompileResult:
        started = time.monotonic()
        if not self.exe:
            return CompileResult(False, 0, self.COMPILER_VERSION,
                                 error_code="TECTONIC_NOT_FOUND",
                                 detail="tectonic executable not on PATH")
        latex = render(inp.template_id, inp.resume)  # raises on untrusted id

        workdir = Path(tempfile.mkdtemp(prefix="resume-tectonic-"))
        tex_path = workdir / "document.tex"
        pdf_path = workdir / "document.pdf"
        tex_path.write_text(latex, encoding="utf-8")

        # T01 loads real Lato via fontspec by filename; copy the bundled TTFs into
        # the compile dir so XeTeX finds them (deterministic, offline, no Path= quirk).
        if "fontspec" in latex:
            from .render import FONTS_DIR
            for f in FONTS_DIR.glob("*.ttf"):
                shutil.copy2(f, workdir / f.name)

        # `tectonic -X compile` is the modern V2 CLI; fall back to classic if needed.
        args = [self.exe, "-X", "compile", str(tex_path), "--outdir", str(workdir), "--keep-logs"]
        if self.only_cached:
            args.append("--only-cached")

        try:
            # Warm (bundle-fetch) runs can be slow the first time; offline runs are fast.
            timeout = 600 if not self.only_cached else 120
            proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout, cwd=workdir)
            log = (proc.stdout or "") + "\n" + (proc.stderr or "")
            if proc.returncode != 0 or not pdf_path.exists():
                first = next((l for l in log.splitlines() if l.strip().lower().startswith("error")), log.strip()[:300])
                return CompileResult(False, int((time.monotonic() - started) * 1000), self.COMPILER_VERSION,
                                     error_code="TECTONIC_COMPILE_ERROR", detail=first[:300], log=log)
            pdf = pdf_path.read_bytes()
            return CompileResult(
                True, int((time.monotonic() - started) * 1000), self.COMPILER_VERSION,
                pdf=pdf, sha256=hashlib.sha256(pdf).hexdigest(), page_count=_page_count(pdf), log=log,
            )
        except subprocess.TimeoutExpired:
            return CompileResult(False, int((time.monotonic() - started) * 1000), self.COMPILER_VERSION,
                                 error_code="TECTONIC_TIMEOUT", detail="compile exceeded 120s")
        finally:
            shutil.rmtree(workdir, ignore_errors=True)
