# Compiler

**Decision: Tectonic 0.17.0 is the selected LaTeX compiler.** Status: the compiler
POC is **complete and passed** (`compiler-poc/`). Do not reopen compiler selection;
do not rebuild the POC.

## Why not the earlier approaches (history)

- **Browser-WASM / Siglum (abandoned):** real LaTeX compiled in-browser, but heavy
  resume fonts (Lato ~12MB, NewTX ~6MB) made cold compiles 40–95s, and the WASM font
  path fell back to bitmap `cm-super` instead of real fonts. Unacceptable.
- **Cloudflare Containers (abandoned):** required Workers Paid and a Docker/WSL build
  chain the dev environment didn't have.
- **Tectonic (chosen):** modern XeTeX engine, cached/offline support bundle, invokable
  from Python, self-contained native binary (no Docker/WSL), real fonts.

## Measured gate results (POC, native Windows)

```
Engine:      Tectonic 0.17.0 (tools/tectonic.exe, vendored)
Mode:        OFFLINE (--only-cached) — runtime network = NONE

T01 Lato     PASS · 1 page · 30,598 B · cold 1.7s / warm ~1.7s · font = Lato-Regular/Bold (embedded)
T02 NewTX    PASS · 1 page · 19,836 B · ~1.8s · font = TeX Gyre Termes (Times-like)
T03 Charter  PASS · 1 page · 15,158 B · ~1.7s · font = XCharter

Reliability: 15/15 edge cases PASS (special chars & % _ $ # {}, Unicode, long,
             minimal, long URLs) across all three templates.
No cm-super / Latin Modern fallback in any passing template.
```

## Key findings baked into the design

- **Fonts not in Tectonic's bundle must be bundled with the project.** Lato is not in
  the bundle; the fix was to ship real **Lato TTFs** (OFL, in `compiler-poc/fonts/lato/`)
  and load them via `fontspec` (copied into the compile dir). This is the production
  rule: non-bundled fonts ship as bundled files — never substitute the font.
- **T03 charter fix:** `\usepackage[default]{charter}` is invalid in the bundle →
  use `\usepackage{XCharter}` (real Charter, not a swap).
- **Offline is proven, not assumed:** `--only-cached` fails if anything is missing; it
  passes, so there is zero runtime CTAN dependency.

## Interface (production adapter — IMPLEMENTED in `server/`)

```python
class ResumeCompiler(Protocol):
    def compile(self, inp: CompileInput) -> tuple[CompileResult, bytes | None, list[PageImageBytes]]: ...

# CompileInput:  template_id (T01|T02|T03), resume: ResumeJSON, revision_id?,
#                rasterize=True, preview_dpi=150, preview_format="webp"
# CompileResult: success, document_id?, sha256?, page_count?, compile_time_ms,
#                rasterize_time_ms?, pages[] (page/width/height/fmt metadata),
#                compiler_version, error_code?, detail?
# Returns (result, pdf_bytes, page_images) — pdf + image bytes travel out-of-band,
# never serialized into CompileResult.
```

`TectonicCompiler` renders the trusted `.tex`, runs Tectonic offline, validates the
PDF, computes SHA-256, **and rasterizes preview page images in the same pass** (see
below), returning metadata + the PDF bytes + the page images. Raw TeX logs stay
server-side.

## Security (compiler)

Only T01/T02/T03 render; content is LaTeX-escaped; `-no-shell-escape`/no `\write18`;
`openin/openout` restricted; isolated temp dir; timeout + resource limits; temp cleaned;
no filesystem paths/logs/env exposed. Arbitrary user LaTeX is never run in this path
(see SECURITY.md for the separate sandbox concept, EXPERIMENTAL).

## PDF validation

Every compile: valid PDF, page count, non-zero size, expected font embedded, no fatal
errors, SHA-256. The POC uses a stdlib-only PDF inspector (inflates FlateDecode streams
to read `/BaseFont` + page objects); production should use a maintained PDF library.

## Rasterization (preview, same pass)

The **one** validated PDF is rasterized into per-page images **in the same compile
call** — never a second compile. Engine: **PyMuPDF** (`fitz`) renders each page to a
pixmap at `preview_dpi` (default 150); since PyMuPDF can't emit WebP, the RGB pixmap is
transcoded to **WebP** via Pillow (PNG also supported). Output: one image per page
(1-indexed) with width/height metadata. This satisfies the product invariant:

```
Tectonic → ONE PDF ─┬─ rasterize → page images → PREVIEW (browser gets images)
                    └─ stored bytes         → EXPORT (same artifact, SHA-256 match)
```

The browser never receives PDF bytes on the preview path (rules 7/11). Measured on
native Windows: rasterize ~0.3s/page warm (first call ~1.1s one-time PyMuPDF warmup),
WebP ~34–37 KB/page at 150 DPI. Rasterization is stateless (bytes in, bytes out); no
Docker/WSL.

## Portability

Dev = Windows vendored binary; production = Linux Tectonic. Same `ResumeCompiler`
interface; only packaging/runtime changes. Bundled support files + fonts ship with the image.

## Regression gate

Keep the POC fixtures. Any compiler change must re-run: T01/T02/T03 + the 15 edge cases,
expecting 3/3 templates and 15/15 edge cases, correct fonts, offline. A regression blocks deploy.

## Deferred (design phase, NOT compiler work)

One-page fit, exact Overleaf visual match, spacing/leading/section-density tuning per
real-font metrics. Never solved by changing the compiler or swapping fonts.
