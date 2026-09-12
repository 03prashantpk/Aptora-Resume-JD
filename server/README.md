# JD-Resume — Rendering Engine (`server/`)

The **stateless rendering engine** for JD-Resume. Its only job:

> trusted template + `ResumeJSON` → **Tectonic** → validated PDF → SHA-256 → rasterized preview images

It has **no users, auth, quotas, database, or business authorization** — those live in
the Astro application (`web/`). This service may hold PDF/image bytes *transiently* for
a single request but does **not** persist application state. See `../docs/ARCHITECTURE.md`
and `../.kiro/steering/project-rules.md` for the locked boundary.

## What it does

- Renders one of the trusted templates **T01 (Lato) · T02 (TeX Gyre Termes) · T03 (XCharter)**
  from structured `ResumeJSON` — content is LaTeX-escaped; users/AI never write LaTeX.
- Compiles with **Tectonic 0.17.0** offline (`--only-cached`, no runtime CTAN), in an
  isolated temp dir, no shell-escape, with a timeout.
- Validates the PDF, computes SHA-256, and **rasterizes preview page images in the same
  pass** (PyMuPDF → WebP via Pillow). The one PDF powers both preview (images) and export
  (bytes) — never a second compile.

## Requirements

- **Python 3.10+** (developed on 3.13, native Windows — no Docker/WSL).
- The **Tectonic binary is vendored** at `app/compiler/bin/tectonic.exe` (~49 MB) and the
  **Lato TTFs are bundled** at `app/templates/fonts/lato/` — both are tracked in git so
  offline compiles work with no download step. On Linux, `find_tectonic()` falls back to a
  `tectonic` on `PATH`.
- First-ever Tectonic run needs network **once** to fill its support-bundle cache. After
  that, everything runs offline. (The vendored setup here is already cached on this machine.)

## Setup

From this `server/` directory:

```powershell
# (recommended) create an isolated environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1          # Windows PowerShell
# source .venv/bin/activate            # macOS/Linux

# runtime deps
pip install -r requirements.txt
# ...or include test deps
pip install -r requirements-dev.txt
```

## Run the server

```powershell
# from server/  — dev server with autoreload (works even if Scripts\ isn't on PATH)
python -m uvicorn app.main:app --reload --port 8000
```

> If you see `uvicorn: The term 'uvicorn' is not recognized…`, it just means Python's
> `Scripts\` folder isn't on your PATH. Use the `python -m uvicorn` form above — it runs
> the identical server. (The bare `uvicorn app.main:app --reload --port 8000` works too,
> but only once `Scripts\` is on PATH.)

Then:

- Health: <http://127.0.0.1:8000/health>
- Interactive API docs (Swagger): <http://127.0.0.1:8000/docs>

> On Windows, run this in your own terminal — don't background a dev server from a
> script; it blocks. Use `--port` to change the port.

## API

### `GET /health`
Liveness + engine version.
```json
{ "status": "ok", "compiler": "Tectonic 0.17.0", "compiler_version": "tectonic-0.17.0" }
```

### `POST /api/compile`
Compile + rasterize in one pass. Body:
```json
{
  "template_id": "T01",
  "resume": { "name": "Alex Morgan", "headline": "Software Engineer",
              "contact": { "email": "alex@example.test" },
              "summary": "…",
              "experience": [ { "title": "Developer", "org": "Example",
                                "dates": "2024-Present", "bullets": ["…"] } ] },
  "revision_id": "rev_123",
  "rasterize": true,
  "preview_dpi": 150,
  "preview_format": "webp"
}
```
`200` response (metadata only — image/PDF bytes are fetched separately):
```json
{
  "success": true,
  "document_id": "…",
  "sha256": "…",
  "page_count": 1,
  "compile_time_ms": 1712,
  "rasterize_time_ms": 320,
  "compiler_version": "tectonic-0.17.0",
  "pages": [ { "page": 1, "width": 1241, "height": 1754, "fmt": "webp" } ]
}
```
On failure → `422` with `{ "error": { "code": "...", "message": "..." } }`
(`TEMPLATE_NOT_FOUND`, `COMPILATION_FAILED`, `PDF_VALIDATION_FAILED`,
`RASTERIZE_FAILED`, `COMPILATION_TIMEOUT`, `TECTONIC_NOT_FOUND`). Raw TeX logs are never
returned to clients.

### `GET /api/documents/{document_id}/pages/{page}`
A preview **page image** (`image/webp` or `image/png`). This is the free/preview path —
the browser gets an image, never the PDF.

### `GET /api/documents/{document_id}/pdf`
The validated **PDF bytes** (the export path artifact). SHA-256 matches the compile
result, proving preview and export are the same document.

> The `document_id` store here is an **in-memory, dev-only** convenience so these two
> endpoints can serve the artifact from the preceding compile. It is not durable state.
> In production the Astro app receives the artifact server-to-server and owns storage,
> ownership, and export authorization.

## Tests / regression gate

The compiler gate must stay green on **any** change to rendering or the compiler:

```powershell
# from server/
python tests/test_compile.py
# or, with pytest
pytest tests/
```

Asserts: T01/T02/T03 compile, correct real fonts embedded (no cm-super/Latin Modern
fallback), one WebP preview image per page. See `../docs/COMPILER.md` for the full
acceptance criteria and the 15 edge-case fixtures carried from the POC.

## Layout

```
server/
├── app/
│   ├── main.py                     FastAPI: /health, /api/compile, page & pdf endpoints
│   ├── compiler/
│   │   ├── models.py               ResumeJSON, CompileInput/Result, ResumeCompiler protocol
│   │   ├── tectonic.py             TectonicCompiler (offline, real fonts, same-pass raster)
│   │   ├── rasterize.py            PDF -> WebP/PNG page images (PyMuPDF + Pillow)
│   │   ├── pdf_inspect.py          stdlib page-count + embedded-font inspection
│   │   └── bin/tectonic.exe        vendored Tectonic 0.17.0 (tracked)
│   └── templates/
│       ├── renderers.py            trusted T01/T02/T03 renderers (ResumeJSON -> .tex)
│       ├── escape.py               LaTeX escaping
│       └── fonts/lato/*.ttf        bundled real Lato (OFL, tracked)
├── tests/test_compile.py           regression gate
├── requirements.txt                pinned runtime deps
├── requirements-dev.txt            + test deps
└── pyproject.toml
```
