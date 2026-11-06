"""FastAPI entrypoint — the STATELESS rendering engine (per ARCHITECTURE.md).

  GET  /                                         -> landing page (HTML). NOTE: an
                                                   intentional deviation from the
                                                   "engine has no UI" rule, by product
                                                   decision. Static HTML, still stateless.
  GET  /health                                  -> liveness + tectonic status
  POST /api/compile-tex                         -> raw .tex (human/AI) -> Tectonic
                                                   (hardened) -> validated PDF ->
                                                   rasterized preview (one pass).
  POST /api/compile                             -> ResumeJSON + template_id ->
                                                   Tectonic -> validated PDF ->
                                                   rasterized preview (one pass).
                                                   Returns compile metadata + page
                                                   image metadata (bytes fetched below).
  GET  /api/documents/{id}/pages/{n}            -> a preview page image (WebP/PNG)
  GET  /api/documents/{id}/pdf                  -> the validated PDF bytes (export path)

Scope: this service owns rendering only — no users, auth, quotas, or business
authorization (those live in the Astro application). It may hold PDF/image bytes
TRANSIENTLY for a request; the in-memory store below is a DEV convenience so the
image/pdf endpoints can serve the artifact produced by the preceding compile. In
production the Astro app receives the artifact server-to-server and owns durable
storage/ownership; this dict is not application state we rely on."""
from __future__ import annotations
import base64 as _base64
import gc
import hashlib
import json
import logging
import os
import re as _re
import tempfile
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Literal
from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .compiler.models import CompileInput, CompileResult, PageImageBytes, PreviewPageMeta, ResumeJSON
from .compiler.tectonic import TectonicCompiler, tectonic_version, COMPILER_VERSION
from .templates.renderers import render as _render_template
from .landing import landing_html
from .default_resume import DEFAULT_RESUME_TEX

# Surface our own "aptora.*" loggers (e.g. the remote/HF compile call + fallback lines)
# in the uvicorn console at INFO. Attach to uvicorn's handler so formatting matches its
# other lines; fall back to a basic handler if uvicorn's isn't present.
_uvicorn_handlers = logging.getLogger("uvicorn").handlers
_aptora_log = logging.getLogger("aptora")
_aptora_log.setLevel(logging.INFO)
if _uvicorn_handlers:
    _aptora_log.handlers = _uvicorn_handlers
    _aptora_log.propagate = False
else:
    logging.basicConfig(level=logging.INFO)


class CompileTexInput(BaseModel):
    latex: str
    revision_id: Optional[str] = None
    rasterize: bool = True
    # 110 DPI keeps previews crisp on screen while roughly halving the peak pixmap
    # memory vs 150 DPI — important on small (512MB) hosts where a compile + raster
    # spike can OOM. Callers can override per request.
    preview_dpi: int = 110
    preview_format: Literal["webp", "png"] = "webp"


CompileTexInput.model_rebuild()

app = FastAPI(title="Aptora Rendering Engine", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_STATIC_DIR = Path(__file__).resolve().parent / "static"
if _STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")

_compiler = TectonicCompiler(only_cached=False)

_MIME = {"webp": "image/webp", "png": "image/png"}

# Serialize compiles: on a small (512MB) instance, two concurrent Tectonic + raster
# runs stack their memory and OOM. This lock ensures only one compile executes at a
# time; other requests queue briefly. Combined with a single worker, this keeps peak
# memory to one compile's footprint.
import threading as _threading
_COMPILE_LOCK = _threading.Lock()

# Clamp preview DPI so a client can't request an enormous rasterization that OOMs the
# box (a 300 DPI A4 pixmap is ~4x the memory of 110 DPI).
_MIN_DPI, _MAX_DPI = 72, 150


def _clamp_dpi(dpi: int) -> int:
    return max(_MIN_DPI, min(_MAX_DPI, dpi))


@app.on_event("startup")
def _warm_compiler_cache() -> None:
    # Warm the Tectonic support-bundle cache on boot so the first real user compile
    # doesn't race a mid-compile bundle download against the timeout. On free hosts
    # that reset the filesystem on spin-down, this re-warms on every cold start.
    #
    # Run in a BACKGROUND thread so the server binds its port and starts accepting
    # traffic immediately (Render's health check must see the port open quickly);
    # the cache fills in the background within the first minute or so.
    import threading
    threading.Thread(target=_compiler.warmup, daemon=True).start()


@app.on_event("shutdown")
def _cleanup_pdf_spill() -> None:
    # Best-effort: remove any cached PDF files so we don't leave orphans on disk.
    for document_id in list(_ARTIFACTS.keys()):
        _evict(document_id)


@dataclass
class _Artifact:
    # The PDF lives on DISK (the compile CACHE file) — RAM holds only its path plus a
    # small in-memory window of page images. Page images not resident are read lazily
    # from the cache dir (disk_pages maps page -> (path, fmt)).
    pdf_path: str
    pages: dict[int, PageImageBytes] = field(default_factory=dict)
    disk_pages: dict[int, tuple[str, str]] = field(default_factory=dict)


# Compile cache: {sha256-key}.json (meta), {sha256-key}.pdf (PDF), {sha256-key}.p{n}.{fmt}
# (page images). Same LaTeX source -> same key -> INSTANT cache hit with the SAME
# document_id, so previews are immutable + cacheable and reloads never recompile.
# Entries are also rehydrated after a restart from these files without any recompile.
# /tmp-style ephemeral disk is fine: a cache miss after a spin-down just means one
# recompile, and the DB (documents.latex) always holds the source to rebuild.
_CACHE_DIR = Path(os.environ.get(
    "COMPILE_CACHE_DIR",
    Path(tempfile.gettempdir()) / "aptora-cache",
))
try:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    _CACHE_DIR = None  # rereadable FS / read-only — disables disk caching gracefully
# Fallback spill dir when the cache dir can't be used (rare; keeps previews alive).
_PDF_SPILL = Path(tempfile.gettempdir()) / "aptora-pdfs"
_CACHE_MAX_ENTRIES = int(os.environ.get("MAX_COMPILE_CACHE", "80"))

# Transient RAM store {document_id: _Artifact}. BOUNDED with FIFO eviction: without a cap
# this grows for every compile and eventually OOMs a small instance. The preview
# fetches happen immediately after a compile, so only a few docs are ever in flight.
_ARTIFACTS: "OrderedDict[str, _Artifact]" = OrderedDict()
_MAX_ARTIFACTS = int(os.environ.get("MAX_ARTIFACTS", "3"))


def _evict(document_id: str) -> None:
    """Drop an artifact from RAM. NOTE: the disk cache file stays — cache eviction is
    handled by _prune_cache by age/count, not by RAM-artifact churn."""
    _ARTIFACTS.pop(document_id, None)


def _sha256_key(payload: str) -> str:
    """Deterministic 64-hex key from any content payload."""
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _cache_key(latex: str, dpi: int, fmt: str, rasterize: bool) -> str:
    """Raw-.tex path key: same source + same render params -> same key."""
    return _sha256_key(f"{COMPILER_VERSION}|{dpi}|{fmt}|{int(rasterize)}\x00{latex}")


def _compile_input_key(inp: CompileInput, dpi: int, fmt: str, rasterize: bool) -> str:
    """Template path key: same template + resume + render params -> same key."""
    return _sha256_key(
        f"{COMPILER_VERSION}|{dpi}|{fmt}|{int(rasterize)}\x00{inp.template_id}\x00{inp.resume.model_dump_json()}"
    )


def _cache_paths(key: str) -> tuple[Path | None, Path | None]:
    if _CACHE_DIR is None:
        return None, None
    return _CACHE_DIR / f"{key}.json", _CACHE_DIR / f"{key}.pdf"


def _prune_cache() -> None:
    """Keep the newest _CACHE_MAX_ENTRIES cache triples (json+pdf+pages)."""
    if _CACHE_DIR is None:
        return
    try:
        metas = sorted(_CACHE_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime)
    except Exception:
        return
    for m in metas[:-_CACHE_MAX_ENTRIES]:
        stem = m.stem
        for f in _CACHE_DIR.glob(f"{stem}.*"):
            try:
                f.unlink(missing_ok=True)
            except Exception:
                pass


def _store_cache(key: str, meta: dict, page_specs: list[tuple[int, str, bytes]]) -> None:
    """Write page image files + meta json. The PDF (already on disk at pdf_path) and the
    meta share the key stem; page files are `{key}.p{n}.{fmt}`."""
    if _CACHE_DIR is None:
        return
    try:
        for page, fmt, data in page_specs:
            (_CACHE_DIR / f"{key}.p{page}.{fmt}").write_bytes(data)
        (_CACHE_DIR / f"{key}.json").write_text(json.dumps(meta), encoding="utf-8")
        _prune_cache()
    except Exception:
        return


def _artifact_from_cache(key: str) -> _Artifact | None:
    """Rehydrate an artifact (pdf + lazy page refs) from the disk cache."""
    meta_p, pdf_p = _cache_paths(key)
    if meta_p is None or pdf_p is None or not (meta_p.exists() and pdf_p.exists()):
        return None
    try:
        meta = json.loads(meta_p.read_text(encoding="utf-8"))
        disk_pages: dict[int, tuple[str, str]] = {}
        for pm in meta.get("pages", []):
            p = int(pm["page"])
            fmt = pm.get("fmt", "webp")
            img = _CACHE_DIR / f"{key}.p{p}.{fmt}"
            if img.exists():
                disk_pages[p] = (str(img), fmt)
        return _Artifact(pdf_path=str(pdf_p), pages={}, disk_pages=disk_pages)
    except Exception:
        return None


def _get_artifact(document_id: str) -> _Artifact | None:
    """RAM artifact if present, else rehydrate from disk cache (deterministic ids make
    this possible without a recompile)."""
    art = _ARTIFACTS.get(document_id)
    if art is not None:
        _ARTIFACTS.move_to_end(document_id)
        return art
    if document_id and _re.fullmatch(r"[0-9a-f]{64}", document_id):
        art = _artifact_from_cache(document_id)
        if art is not None:
            _ARTIFACTS[document_id] = art
            while len(_ARTIFACTS) > _MAX_ARTIFACTS:
                oldest, _ = next(iter(_ARTIFACTS.items()))
                _evict(oldest)
            return art
    return None


def _store_artifact(document_id: str, art: _Artifact) -> None:
    _ARTIFACTS[document_id] = art
    _ARTIFACTS.move_to_end(document_id)
    while len(_ARTIFACTS) > _MAX_ARTIFACTS:
        oldest, _ = next(iter(_ARTIFACTS.items()))
        _evict(oldest)
    gc.collect()  # release the just-handled PDF bytes / evicted image buffers promptly


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    fav_file = _STATIC_DIR / "favicon.webp"
    if fav_file.exists():
        return FileResponse(fav_file, media_type="image/webp")
    return Response(status_code=404)


@app.get("/ads.txt", include_in_schema=False)
def ads_txt():
    # IAB ads.txt must be served from the domain root (static is under /static).
    f = _STATIC_DIR / "ads.txt"
    if f.exists():
        return FileResponse(f, media_type="text/plain")
    return Response(status_code=404)


@app.get("/", response_class=HTMLResponse)
def landing():
    # Product landing page (intentional deviation; see module docstring + landing.py).
    return HTMLResponse(content=landing_html())


@app.get("/health")
def health():
    return {"status": "ok", "compiler": tectonic_version(), "compiler_version": COMPILER_VERSION}


@app.post("/api/compile", response_model=CompileResult)
def compile_resume(inp: CompileInput):
    # Template path (ResumeJSON -> trusted renderer -> Tectonic). Same content-addressed
    # cache contract as /api/compile-tex: identical template+resume+preview params ->
    # identical key -> instant hit with a STABLE document_id (the old uuid-per-compile id
    # made previews uncacheable and every reload a full recompile).
    dpi = _clamp_dpi(inp.preview_dpi)
    fmt = inp.preview_format
    key = _compile_input_key(inp, dpi, fmt, inp.rasterize)

    if _artifact_from_cache(key) is not None:
        return CompileResult(
            success=True, compile_time_ms=0, compiler_version=COMPILER_VERSION,
            document_id=key, sha256=_key_sha(key), **_meta_from_cache(key),
        )

    with _COMPILE_LOCK:
        result, pdf, imgs = _compiler.compile(inp)
    if not result.success:
        return JSONResponse(status_code=422, content={
            "error": {"code": result.error_code, "message": result.detail}
        })
    return _persist_and_serve(key, result, pdf, imgs, inp.rasterize)


@app.get("/api/default-document")
def default_document():
    # The starter .tex the editor loads on first open (the pivot: render full original).
    return {"latex": DEFAULT_RESUME_TEX}


class RenderTexInput(BaseModel):
    # ResumeJSON -> trusted template LaTeX. Used by the ingestion pipeline (upload a
    # resume PDF -> AI structures the facts -> this renders them into a real template).
    # AI never writes layout LaTeX — templates own layout (ARCHITECTURE rule).
    template_id: Literal["T01", "T02", "T03", "T04", "T05", "T06"] = "T02"
    resume: ResumeJSON


@app.post("/api/render-tex")
def render_tex(inp: RenderTexInput):
    try:
        latex = _render_template(inp.template_id, inp.resume)
    except Exception as e:  # unknown id, untrusted path, or renderer edge case
        return JSONResponse(status_code=422, content={
            "error": {"code": "TEMPLATE_RENDER_FAILED", "message": str(e) or "render failed"}
        })
    return {"latex": latex, "template_id": inp.template_id}


class ExtractTextInput(BaseModel):
    # The resume PDF, base64-encoded (the Astro app sends uploaded client bytes
    # server-to-server; nothing is stored by the engine).
    file_base64: str
    # Extraction budget: 60k chars comfortably covers any multi-page resume while
    # keeping the AI-ingestion prompt bounded (the Astro app enforces its own cap too).
    max_chars: int = 60_000


@app.post("/api/extract-text")
def extract_text(inp: ExtractTextInput):
    """Resume PDF -> plain text for AI ingestion.

    Uses PyMuPDF (already a pinned dependency for rasterization) — no new package,
    no new cold-start cost on Render free. Stateless: bytes come in, text goes out,
    nothing is cached or stored here."""
    if not inp.file_base64.strip():
        return JSONResponse(status_code=400, content={
            "error": {"code": "BAD_REQUEST", "message": "file_base64 is required"}
        })
    try:
        pdf_bytes = _base64.b64decode(inp.file_base64, validate=True)
    except Exception:
        return JSONResponse(status_code=400, content={
            "error": {"code": "BAD_REQUEST", "message": "file_base64 is not valid base64"}
        })
    if not pdf_bytes:
        return JSONResponse(status_code=400, content={
            "error": {"code": "BAD_REQUEST", "message": "empty file"}
        })
    # Quick PDF magic-number sanity check (avoids obscure fitz exceptions on JPGs etc.)
    if not pdf_bytes.startswith(b"%PDF"):
        return JSONResponse(status_code=422, content={
            "error": {"code": "NOT_A_PDF", "message": "the uploaded file is not a PDF"}
        })

    import fitz  # PyMuPDF
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return JSONResponse(status_code=422, content={
            "error": {"code": "PDF_UNREADABLE", "message": "the PDF could not be opened"}
        })
    try:
        max_chars = max(1_000, min(120_000, inp.max_chars))
        pages: list[str] = []
        total = 0
        truncated = False
        for page in doc:
            text = page.get_text("text", flags=fitz.TEXT_PRESERVE_WHITESPACE)
            if pages:
                pages.append("")  # structural page break marker, collapsed below
            pages.append(text)
            total += len(text) + 2
            if total >= max_chars:
                truncated = True
                break
        page_count = doc.page_count
    finally:
        doc.close()

    text = _re.sub(r"\n[ \t]+(\d+)\s*$", "", "\n".join(pages))  # drop stray page-number lines
    text = _re.sub(r"\n{4,}", "\n\n\n", text).strip()
    if len(text) > max_chars:
        truncated = True
        text = text[:max_chars]
    return {
        "text": text,
        "page_count": page_count,
        "chars": len(text),
        "truncated": truncated,
    }


@app.post("/api/compile-tex", response_model=CompileResult)
def compile_tex(inp: CompileTexInput):
    # Raw-LaTeX path (the pivot): arbitrary human/AI `.tex`, hardened compile + rasterize.
    # Content-addressed disk cache FIRST: same source -> same key -> instant hit with the
    # SAME document_id (no Tectonic run, no raster run). Only a cache miss takes the
    # serialized compile path below (DPI-clamped to protect small hosts).
    key = _cache_key(inp.latex, _clamp_dpi(inp.preview_dpi), inp.preview_format, inp.rasterize)

    cached = _artifact_from_cache(key)
    if cached is not None:
        return CompileResult(
            success=True, compile_time_ms=0, compiler_version=COMPILER_VERSION,
            document_id=key, sha256=_key_sha(key), **_meta_from_cache(key),
        )

    with _COMPILE_LOCK:
        result, pdf, imgs = _compiler.compile_tex(
            inp.latex, rasterize_pages=inp.rasterize, dpi=_clamp_dpi(inp.preview_dpi), fmt=inp.preview_format,
        )
    if not result.success:
        return JSONResponse(status_code=422, content={
            "error": {"code": result.error_code, "message": result.detail}
        })
    # Store into the disk cache keyed by the source (deterministic ids), and serve.
    if pdf is not None:
        page_specs = [(i.page, i.fmt, i.data) for i in imgs] if inp.rasterize else []
        meta_p, pdf_path = _cache_paths(key)
        if pdf_path is not None:
            try:
                pdf_path.write_bytes(pdf)
                _store_cache(key, {
                    "sha256": result.sha256,
                    "page_count": result.page_count,
                    "pages": [pm.model_dump() for pm in result.pages],
                }, page_specs)
            except Exception:
                pass  # cache write is best-effort; the returned result is still fresh
        else:
            # Disk cache unavailable: spill so exports/previews still work this boot.
            _PDF_SPILL.mkdir(parents=True, exist_ok=True)
            pdf_path = _PDF_SPILL / f"{key}.pdf"
            try:
                pdf_path.write_bytes(pdf)
            except Exception:
                pdf_path = None
        if pdf_path is not None:
            _store_artifact(key, _Artifact(pdf_path=str(pdf_path), pages={i.page: i for i in imgs}))
            result = result.model_copy(update={"document_id": key})
    return result


def _key_sha(key: str) -> str:
    # The document's PDF hash is stored in the cached meta; fall back to the key itself
    # (both are opaque identifiers to clients).
    meta_p, _ = _cache_paths(key)
    try:
        data = json.loads(meta_p.read_text(encoding="utf-8"))
        return data.get("sha256") or key
    except Exception:
        return key


def _meta_from_cache(key: str) -> dict:
    meta_p, _ = _cache_paths(key)
    try:
        data = json.loads(meta_p.read_text(encoding="utf-8"))
        pages = [PreviewPageMeta(**pm) for pm in data.get("pages", [])
                 if (_CACHE_DIR / f"{key}.p{pm.get('page')}.{pm.get('fmt', 'webp')}").exists()]
        return {"page_count": data.get("page_count", len(pages)), "pages": pages}
    except Exception:
        return {"page_count": None, "pages": []}


@app.get("/api/documents/{document_id}/pages/{page}")
def get_page(document_id: str, page: int):
    art = _get_artifact(document_id)
    img = art.pages.get(page) if art else None
    if img is None and art is not None:
        lazy = art.disk_pages.get(page)
        if lazy is not None:
            # Lazy-load a non-resident page image from the cache dir (small: <60KB WebP).
            path, fmt = lazy
            try:
                art.pages[page] = PageImageBytes(page=page, fmt=fmt, data=Path(path).read_bytes())
                img = art.pages[page]
            except Exception:
                img = None
    if img is None:
        return JSONResponse(status_code=404, content={"error": {"code": "PAGE_NOT_FOUND", "message": "no such page"}})
    return Response(content=img.data, media_type=_MIME.get(img.fmt, "application/octet-stream"))


@app.get("/api/documents/{document_id}/pdf")
def get_pdf(document_id: str):
    art = _get_artifact(document_id)
    if art is None or not Path(art.pdf_path).exists():
        return JSONResponse(status_code=404, content={"error": {"code": "DOCUMENT_NOT_FOUND", "message": "no such document"}})
    # Stream the PDF from disk (FileResponse streams in chunks, so it doesn't load the
    # whole file into RAM). The on-disk path is engine-internal and never returned.
    return FileResponse(art.pdf_path, media_type="application/pdf", filename="document.pdf")
