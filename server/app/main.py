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
import gc
import os
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

from .compiler.models import CompileInput, CompileResult, PageImageBytes
from .compiler.tectonic import TectonicCompiler, tectonic_version, COMPILER_VERSION
from .landing import landing_html
from .default_resume import DEFAULT_RESUME_TEX


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
    # The PDF lives on DISK (a temp file), not in RAM. Only its path is held here.
    # This is the big memory win on a 512MB box: the preview needs the page images,
    # but the (often larger) PDF is only needed at export — keeping it on /tmp means
    # RAM holds just a few small preview images, never the accumulated PDFs.
    pdf_path: str
    pages: dict[int, PageImageBytes] = field(default_factory=dict)


# Where PDFs are spilled. /tmp on Render is ephemeral disk (does NOT count against the
# 512MB RAM budget). Override via env if needed.
_PDF_DIR = Path(os.environ.get("PDF_SPILL_DIR", tempfile.gettempdir())) / "aptora-pdfs"
_PDF_DIR.mkdir(parents=True, exist_ok=True)

# Transient store {document_id: _Artifact}. BOUNDED with FIFO eviction: without a cap
# this grows for every compile and eventually OOMs a small instance. The preview
# fetches happen immediately after a compile, so only a few docs are ever in flight.
_ARTIFACTS: "OrderedDict[str, _Artifact]" = OrderedDict()
_MAX_ARTIFACTS = int(os.environ.get("MAX_ARTIFACTS", "3"))


def _evict(document_id: str) -> None:
    """Drop an artifact and delete its on-disk PDF."""
    art = _ARTIFACTS.pop(document_id, None)
    if art is not None:
        try:
            Path(art.pdf_path).unlink(missing_ok=True)
        except Exception:
            pass


def _store_artifact(document_id: str, pdf_bytes: bytes, imgs: list[PageImageBytes]) -> None:
    # Spill the PDF to disk; keep only its path + the small preview images in RAM.
    pdf_path = _PDF_DIR / f"{document_id}.pdf"
    try:
        pdf_path.write_bytes(pdf_bytes)
    except Exception:
        # If disk write fails we simply don't cache the PDF; export can recompile.
        pdf_path = _PDF_DIR / f"{document_id}.pdf"
    _ARTIFACTS[document_id] = _Artifact(pdf_path=str(pdf_path), pages={i.page: i for i in imgs})
    _ARTIFACTS.move_to_end(document_id)
    while len(_ARTIFACTS) > _MAX_ARTIFACTS:
        oldest, _ = next(iter(_ARTIFACTS.items()))
        _evict(oldest)  # evict oldest + delete its PDF file
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
    with _COMPILE_LOCK:
        result, pdf, imgs = _compiler.compile(inp)
    if not result.success:
        return JSONResponse(status_code=422, content={
            "error": {"code": result.error_code, "message": result.detail}
        })
    if pdf is not None and result.document_id:
        _store_artifact(result.document_id, pdf, imgs)
    return result


@app.get("/api/default-document")
def default_document():
    # The starter .tex the editor loads on first open (the pivot: render full original).
    return {"latex": DEFAULT_RESUME_TEX}


@app.post("/api/compile-tex", response_model=CompileResult)
def compile_tex(inp: CompileTexInput):
    # Raw-LaTeX path (the pivot): arbitrary human/AI `.tex`, hardened compile + rasterize.
    # Serialized + DPI-clamped to protect a small instance from concurrent/oversized
    # rasterization OOMs.
    with _COMPILE_LOCK:
        result, pdf, imgs = _compiler.compile_tex(
            inp.latex, rasterize_pages=inp.rasterize, dpi=_clamp_dpi(inp.preview_dpi), fmt=inp.preview_format,
        )
    if not result.success:
        return JSONResponse(status_code=422, content={
            "error": {"code": result.error_code, "message": result.detail}
        })
    if pdf is not None and result.document_id:
        _store_artifact(result.document_id, pdf, imgs)
    return result


@app.get("/api/documents/{document_id}/pages/{page}")
def get_page(document_id: str, page: int):
    art = _ARTIFACTS.get(document_id)
    img = art.pages.get(page) if art else None
    if img is None:
        return JSONResponse(status_code=404, content={"error": {"code": "PAGE_NOT_FOUND", "message": "no such page"}})
    return Response(content=img.data, media_type=_MIME.get(img.fmt, "application/octet-stream"))


@app.get("/api/documents/{document_id}/pdf")
def get_pdf(document_id: str):
    art = _ARTIFACTS.get(document_id)
    if art is None or not Path(art.pdf_path).exists():
        return JSONResponse(status_code=404, content={"error": {"code": "DOCUMENT_NOT_FOUND", "message": "no such document"}})
    # Stream the PDF from disk (FileResponse streams in chunks, so it doesn't load the
    # whole file into RAM). The on-disk path is engine-internal and never returned.
    return FileResponse(art.pdf_path, media_type="application/pdf", filename="document.pdf")
