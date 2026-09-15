"""TectonicCompiler — production ResumeCompiler adapter (offline, real fonts).

Renders a trusted template, runs the real Tectonic engine with --only-cached (no
runtime CTAN), returns (CompileResult, pdf_bytes). Bundled Lato TTFs are copied
into the isolated compile dir for T01 (fontspec). Logs kept private."""
from __future__ import annotations
import hashlib
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path

from .models import CompileInput, CompileResult, PreviewPageMeta, PageImageBytes
from .pdf_inspect import analyze
from .rasterize import rasterize
from ..templates.renderers import render, FONTS_DIR

_log = logging.getLogger("aptora.compiler")

COMPILER_VERSION = "tectonic-0.17.0"

# Prefer the vendored binary, then PATH.
_VENDORED = Path(__file__).resolve().parent / "bin" / ("tectonic.exe" if os.name == "nt" else "tectonic")


def find_tectonic() -> str | None:
    if _VENDORED.exists():
        return str(_VENDORED)
    return shutil.which("tectonic")


def tectonic_version() -> str | None:
    exe = find_tectonic()
    if not exe:
        return None
    try:
        r = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=30)
        return (r.stdout or r.stderr).strip().splitlines()[0]
    except Exception:
        return None


class TectonicCompiler:
    def __init__(self, only_cached: bool = True):
        self.only_cached = only_cached
        self.exe = find_tectonic()
        # Serialize EVERY Tectonic run (user compiles AND the startup warmup) through one
        # lock. On a 512MB host, two concurrent Tectonic + rasterize runs stack their
        # memory and the box OOM-kills the process (seen as a 502 + restart loop). The
        # warmup thread previously bypassed the API-level lock in main.py; guarding _run
        # here guarantees only one compile ever executes at a time, warmup included.
        self._run_lock = threading.Lock()

    # Hardening limits for arbitrary .tex (the pivot). Applies to every compile.
    MAX_TEX_BYTES = 400_000   # ~400 KB of source is plenty for a résumé
    # A COLD compile (empty Tectonic support-bundle cache, e.g. right after a
    # free-tier spin-down that reset the filesystem) must download the bundle
    # mid-compile, which can exceed a tight limit. Once the cache is warm, real
    # compiles finish in ~1-3s. Keep the ceiling generous; override via env.
    TIMEOUT_S = int(os.environ.get("COMPILE_TIMEOUT_S", "150"))

    def warmup(self) -> bool:
        """Fill the Tectonic support-bundle cache with one throwaway compile.

        Called at server startup so the FIRST real user compile isn't the one
        paying the (network) bundle-download cost. Best-effort; safe to call
        repeatedly (a warm cache makes this a fast no-op-ish compile)."""
        if not self.exe:
            return False
        try:
            r, _, _ = self._run(
                r"\documentclass{article}\begin{document}Aptora warmup\end{document}",
                do_raster=False, dpi=72, fmt="webp", t0=time.monotonic(), only_cached=False,
            )
            return r.success
        except Exception:
            return False

    def compile(self, inp: CompileInput) -> tuple[CompileResult, bytes | None, list[PageImageBytes]]:
        """Trusted-template path: ResumeJSON + template_id -> .tex -> _run()."""
        t0 = time.monotonic()
        # Same as compile_tex: a missing local binary is only fatal in forced-local mode;
        # otherwise the remote service handles the compile (see _run_locked).
        if _force_local_provider() and not self.exe:
            return _fail("TECTONIC_NOT_FOUND", "tectonic not available", t0)
        try:
            latex = render(inp.template_id, inp.resume)  # raises on untrusted id
        except ValueError as e:
            return _fail("TEMPLATE_NOT_FOUND", str(e), t0)
        return self._run(latex, inp.rasterize, inp.preview_dpi, inp.preview_format, t0)

    def compile_tex(
        self, latex: str, rasterize_pages: bool = True, dpi: int = 150, fmt: str = "webp",
    ) -> tuple[CompileResult, bytes | None, list[PageImageBytes]]:
        """Raw-LaTeX path (the pivot): compile arbitrary user/AI `.tex`, hardened.

        Offline-first: try `--only-cached`; if it fails purely because a referenced
        support file isn't cached yet, retry ONCE with network to fill the cache
        (still no shell-escape, still isolated/timed). Subsequent compiles are offline."""
        t0 = time.monotonic()
        # A missing local .exe is only fatal when we're forced to use it. In the default
        # remote-first mode the remote service does the compile, so the engine can run
        # WITHOUT a local Tectonic binary (e.g. a lean Render deploy). If remote then fails
        # and there's no exe to fall back to, _run_locked returns TECTONIC_NOT_FOUND.
        if _force_local_provider() and not self.exe:
            return _fail("TECTONIC_NOT_FOUND", "tectonic not available", t0)
        if not latex or not latex.strip():
            return _fail("EMPTY_SOURCE", "no LaTeX source provided", t0)
        if len(latex.encode("utf-8")) > self.MAX_TEX_BYTES:
            return _fail("SOURCE_TOO_LARGE", "LaTeX source exceeds the size limit", t0)

        result, pdf, imgs = self._run(latex, rasterize_pages, dpi, fmt, t0, only_cached=self.only_cached)
        # Retry with network only if the failure looks like a cache miss on a support file.
        if (not result.success and self.only_cached and result.error_code == "COMPILATION_FAILED"
                and _looks_like_cache_miss(result.detail or "")):
            result, pdf, imgs = self._run(latex, rasterize_pages, dpi, fmt, t0, only_cached=False)
        return result, pdf, imgs

    def _run(
        self, latex: str, do_raster: bool, dpi: int, fmt: str, t0: float, only_cached: bool | None = None,
    ) -> tuple[CompileResult, bytes | None, list[PageImageBytes]]:
        # One compile at a time (see __init__): prevents concurrent Tectonic+raster runs
        # from stacking memory and OOM-killing a small (512MB) host. Warmup and user
        # compiles all pass through here, so all are mutually exclusive.
        with self._run_lock:
            return self._run_locked(latex, do_raster, dpi, fmt, t0, only_cached)

    def _run_locked(
        self, latex: str, do_raster: bool, dpi: int, fmt: str, t0: float, only_cached: bool | None = None,
    ) -> tuple[CompileResult, bytes | None, list[PageImageBytes]]:
        # PROVIDER STRATEGY (default): compile LaTeX->PDF on the REMOTE service (remote.py)
        # first. This keeps heavy Tectonic runs OFF the host CPU (the win on a small/free
        # Render instance). If the remote is UNAVAILABLE (unreachable / timeout / 5xx), we
        # automatically FALL BACK to the local Tectonic .exe so compiles still succeed.
        # Everything after PDF bytes — validate, rasterize, store — is identical for both.
        #
        # We do NOT fall back on a genuine LaTeX error (a valid response that just failed to
        # compile), only on transport/availability failures — otherwise a broken .tex would
        # needlessly burn CPU compiling locally too. To force local-only, set
        # COMPILER_PROVIDER=local (escape hatch; default is remote-first).
        if not _force_local_provider():
            from .remote import compile_tex_remote, RemoteCompileError, TRANSPORT_ERROR_CODES
            try:
                data = compile_tex_remote(latex)
                return self._finish_from_pdf(data, do_raster, dpi, fmt, t0)
            except RemoteCompileError as e:
                # Only availability failures trigger the local fallback; a bad-output/other
                # error is returned as-is (don't double-compile a genuinely broken document).
                if e.code not in TRANSPORT_ERROR_CODES:
                    return _fail(e.code, e.detail, t0)
                _log.warning("compile: remote unavailable (%s) -> falling back to local Tectonic", e.code)
            except Exception as e:
                # Unexpected client-side error: fall through to local Tectonic.
                _log.warning("compile: remote error (%s) -> falling back to local Tectonic", str(e)[:120])

        # Local Tectonic path (forced-local, or remote-unavailable fallback). If there's no
        # local binary to fall back to, surface a clean error rather than crashing.
        if not self.exe:
            return _fail("TECTONIC_NOT_FOUND", "compile service unavailable and no local compiler", t0)
        if not _force_local_provider():
            _log.info("compile: using LOCAL Tectonic (fallback)")

        if only_cached is None:
            only_cached = self.only_cached
        work = Path(tempfile.mkdtemp(prefix="jdr-"))
        tex = work / "document.tex"
        pdf = work / "document.pdf"
        tex.write_text(latex, encoding="utf-8")
        if "fontspec" in latex:  # bundled real fonts (e.g. Lato) for fontspec docs
            for f in FONTS_DIR.glob("*.ttf"):
                shutil.copy2(f, work / f.name)

        # Hardened invocation. Tectonic disables shell-escape / \write18 BY DEFAULT
        # (it's an opt-in unstable feature we never enable), so no flag is needed to
        # keep it off. Hardening here: offline (--only-cached), restricted file IO
        # (openin/openout=p), isolated temp dir, timeout, and the input size cap above.
        args = [self.exe, "-X", "compile", str(tex), "--outdir", str(work), "--keep-logs"]
        if only_cached:
            args.append("--only-cached")
        env = {**os.environ, "openout_any": "p", "openin_any": "p"}
        try:
            proc = subprocess.run(args, capture_output=True, text=True, timeout=self.TIMEOUT_S, cwd=work, env=env)
            log = (proc.stdout or "") + "\n" + (proc.stderr or "")
            if proc.returncode != 0 or not pdf.exists():
                return _fail("COMPILATION_FAILED", _first_error(log), t0)
            data = pdf.read_bytes()
            return self._finish_from_pdf(data, do_raster, dpi, fmt, t0)
        except subprocess.TimeoutExpired:
            return _fail("COMPILATION_TIMEOUT", f"exceeded {self.TIMEOUT_S}s", t0)
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def _finish_from_pdf(
        self, data: bytes, do_raster: bool, dpi: int, fmt: str, t0: float,
    ) -> tuple[CompileResult, bytes | None, list[PageImageBytes]]:
        """Shared tail for BOTH providers: validate the PDF, rasterize preview images in
        the same pass, and build the CompileResult. Keeps local/remote identical downstream."""
        pages, _ = analyze(data)
        if pages < 1 or not data.startswith(b"%PDF-"):
            return _fail("PDF_VALIDATION_FAILED", "invalid PDF output", t0)

        # Same PDF, one pass: rasterize preview images now. Never a second compile.
        page_meta: list[PreviewPageMeta] = []
        page_imgs: list[PageImageBytes] = []
        raster_ms: int | None = None
        if do_raster:
            r0 = time.monotonic()
            try:
                for img in rasterize(data, dpi=dpi, fmt=fmt):
                    page_meta.append(PreviewPageMeta(page=img.page, width=img.width, height=img.height, fmt=img.fmt))
                    page_imgs.append(PageImageBytes(page=img.page, fmt=img.fmt, data=img.data))
            except Exception as e:
                return _fail("RASTERIZE_FAILED", str(e)[:300], t0)
            raster_ms = int((time.monotonic() - r0) * 1000)

        return CompileResult(
            success=True, compile_time_ms=int((time.monotonic() - t0) * 1000),
            compiler_version=COMPILER_VERSION, document_id=uuid.uuid4().hex,
            sha256=hashlib.sha256(data).hexdigest(), page_count=pages,
            rasterize_time_ms=raster_ms, pages=page_meta,
        ), data, page_imgs


def _force_local_provider() -> bool:
    """Escape hatch: set COMPILER_PROVIDER=local to skip the remote service entirely and
    always use the local Tectonic .exe. Default (unset / anything else) is remote-first
    with local fallback. Read at call time so it can be toggled without reimporting."""
    return os.environ.get("COMPILER_PROVIDER", "").strip().lower() == "local"


def _fail(code: str, detail: str, t0: float) -> tuple[CompileResult, None, list[PageImageBytes]]:
    return CompileResult(
        success=False, compile_time_ms=int((time.monotonic() - t0) * 1000),
        compiler_version=COMPILER_VERSION, error_code=code, detail=detail,
    ), None, []


def _looks_like_cache_miss(detail: str) -> str | bool:
    """Heuristic: an offline compile failed because a support file wasn't cached."""
    d = detail.lower()
    return ("only-cached" in d) or ("failed to open input file" in d) or ("not found" in d and (".clo" in d or ".sty" in d or ".cls" in d
            or "file `" in d or "font" in d or "tex" in d))


def _first_error(log: str) -> str:
    """Extract a readable first error line from the TeX log (never expose the whole log)."""
    for line in log.splitlines():
        s = line.strip()
        if s.startswith("!") or s.lower().startswith("error"):
            return s[:300]
    return "compile failed"
