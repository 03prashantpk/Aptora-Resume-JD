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
    preview_dpi: int = 150
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

_compiler = TectonicCompiler(only_cached=True)

_MIME = {"webp": "image/webp", "png": "image/png"}


@dataclass
class _Artifact:
    pdf: bytes
    pages: dict[int, PageImageBytes] = field(default_factory=dict)


# DEV-only transient store {document_id: _Artifact}. Not durable app state.
_ARTIFACTS: dict[str, _Artifact] = {}


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    fav_file = _STATIC_DIR / "favicon.webp"
    if fav_file.exists():
        return FileResponse(fav_file, media_type="image/webp")
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
    result, pdf, imgs = _compiler.compile(inp)
    if not result.success:
        return JSONResponse(status_code=422, content={
            "error": {"code": result.error_code, "message": result.detail}
        })
    if pdf is not None and result.document_id:
        _ARTIFACTS[result.document_id] = _Artifact(pdf=pdf, pages={i.page: i for i in imgs})
    return result


@app.get("/api/default-document")
def default_document():
    # The starter .tex the editor loads on first open (the pivot: render full original).
    return {"latex": DEFAULT_RESUME_TEX}


@app.post("/api/compile-tex", response_model=CompileResult)
def compile_tex(inp: CompileTexInput):
    # Raw-LaTeX path (the pivot): arbitrary human/AI `.tex`, hardened compile + rasterize.
    result, pdf, imgs = _compiler.compile_tex(
        inp.latex, rasterize_pages=inp.rasterize, dpi=inp.preview_dpi, fmt=inp.preview_format,
    )
    if not result.success:
        return JSONResponse(status_code=422, content={
            "error": {"code": result.error_code, "message": result.detail}
        })
    if pdf is not None and result.document_id:
        _ARTIFACTS[result.document_id] = _Artifact(pdf=pdf, pages={i.page: i for i in imgs})
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
    if art is None:
        return JSONResponse(status_code=404, content={"error": {"code": "DOCUMENT_NOT_FOUND", "message": "no such document"}})
    return Response(content=art.pdf, media_type="application/pdf")
