# Architecture

Status tags: **IMPLEMENTED / PLANNED / DEFERRED / EXPERIMENTAL**. Only the compiler
(Tectonic, in `compiler-poc/`) is IMPLEMENTED; everything else is PLANNED.

## PIVOT (LOCKED 2026-09): Overleaf-style LaTeX workspace

The product is now a **LaTeX résumé workspace**: the user edits the full `.tex` source
(human **and** AI), with a live preview beside it.

```
Upload resume PDF + paste JD
→ editor pre-loaded with full .tex (real résumé by default)
→ human edits .tex  AND/OR  AI rewrites .tex from the JD
→ Tectonic (offline, hardened) → real PDF → validation → rasterized page images
→ live preview (images);  export = the same validated PDF
```

Arbitrary `.tex` is first-class (compiled by the hardened Tectonic path). AI edits the
LaTeX directly. LaTeX source is visible (it's the editor); compiler *internals* stay
hidden. Preview = images (browser never gets PDF) unless in-browser PDF is explicitly
chosen. See `.kiro/steering/project-rules.md` "PRODUCT PIVOT".

## The (superseded) structured pipeline

```
Resume PDF → extraction → ResumeJSON → JD → JD analysis → gap analysis
→ tailored ResumeJSON → trusted template → deterministic renderer → .tex
→ Tectonic → real PDF → PDF validation → GeneratedDocument
→ (preview rasterization | one-time export) → download
```

## The architectural boundary (LOCKED)

> **Astro/React is the application. Python is the stateless rendering engine.**

Two deployables with a hard responsibility split. They talk over an internal API.

**Astro + React (`web/`) — the application (owns everything the product is):**
UI/editor, API/server routes, anonymous sessions + auth, database (PostgreSQL),
Redis (when needed), AI orchestration, resume/JD/tailoring logic, storage metadata
(Cloudinary keys), usage/quotas, **export authorization**, **document ownership &
lifecycle**, and **rasterized preview delivery** to the browser.

**Python + FastAPI (`server/`) — the stateless compiler service (owns LaTeX only):**
trusted template rendering, LaTeX escaping, Tectonic compilation, PDF validation,
SHA-256, and **PDF → PNG/WebP rasterization**. It has **no users, no auth, no
quotas, no business authorization, and executes no arbitrary user LaTeX.**

**State nuance:** Python may hold PDF/image bytes *transiently* during a single
compile/rasterize request, but must **not persist them as application state**.
Durable document ownership, storage, and lifecycle belong to Astro + DB + storage.

The invariant: **Preview = rasterized images. Export = the original validated PDF.**
No PDF.js. The browser never receives PDF bytes on the preview path.

## Layers

```
Presentation      Astro (public/SEO) + React islands (editor)      [PLANNED]
      │ HTTPS
Application        Astro server routes / lib:                       [PLANNED]
      │            sessions, auth, resumes, jobs, tailoring, AI,
      │            db, storage-metadata, usage/quota, export auth,
      │            document ownership, preview-image delivery
      │ internal API (server-to-server)
Rendering engine   Python/FastAPI (stateless):                      [IMPLEMENTED (POC→server)]
      │            trusted renderer, Tectonic, PDF validation,
      │            SHA-256, rasterization
Ports (abstractions, owned by Astro unless noted)
      ├─ ResumeCompiler ──► Python compiler service (HTTP)          [IMPLEMENTED (POC)]
      ├─ StorageProvider ─► CloudinaryStorage                       [PLANNED]
      ├─ AIProvider ──────► (provider TBD)                          [PLANNED]
      └─ IdentityProvider ► Anonymous / Authenticated               [PLANNED]
Infrastructure     PostgreSQL (LOCAL now), Cloudinary               [mixed]
```

Ports keep infrastructure replaceable. Product requirements are locked; hosts/providers are not.

## System diagram (target MVP)

```
Browser (Astro + React editor, image-based live preview — NO PDF.js)
   │ HTTPS
Astro/React application  (web/)
   ├── PostgreSQL   (metadata, versions, usage, export tokens)   LOCAL for now
   ├── Cloudinary   (originals, generated PDFs, preview images)  private
   ├── AIProvider   (extract / analyze JD / gap / tailor)
   ├── sessions · ownership · quota · EXPORT AUTHORIZATION
   └── internal API ──► Python compiler service  (server/)   [stateless]
                          └── ResumeCompiler → Tectonic 0.17.0 → PDF
                                 ├── PDF validation + SHA-256
                                 ├── rasterize → page images ─┐
                                 └── validated PDF bytes ──────┤
                                                               ▼
   Astro persists artifact (SHA-256, keys) as GeneratedDocument (immutable)
        ├── page images → browser                         (FREE preview path)
        └── one-time export token → PDF bytes → download  (EXPORT path)
```

## Two data paths (the most important product rule)

**Preview path (free):** `ResumeJSON → Tectonic → PDF → rasterized page images → browser`.
The browser never receives the PDF.

**Export path:** `same PDF → private storage → one-time authorization → download`.
PDF bytes released only through the entitlement-checked export flow.

The **same** `GeneratedDocument` artifact powers both — never "preview compile A,
download compile B". Guaranteed by SHA-256 identity.

## Compiler boundary

Inside the Python service, one abstraction with one implementation:

```python
class ResumeCompiler(Protocol):
    def compile(self, inp: CompileInput) -> tuple[CompileResult, bytes | None]: ...
```
`TectonicCompiler` is the only implementation. The Python service never shells out
to Tectonic anywhere but here. From Astro's side, the "compiler" is reached over the
**internal HTTP API** (`POST /api/compile`) — Astro never runs Tectonic itself.
Runtime: `--only-cached` (offline), isolated temp dir, no shell-escape, bundled fonts
(Lato bundled; Termes/XCharter from Tectonic's bundle). Dev on Windows, production on
Linux — same interface, only packaging differs.

## Trusted templates

T01 Lato · T02 NewTX (TeX Gyre Termes) · T03 Charter (XCharter). Server-controlled
renderers turn ResumeJSON → `.tex`. Switching template does not change ResumeJSON.
AI/users never write LaTeX. Template IDs validated against a registry (reject path traversal).

## Identity & ownership

Anonymous-first: opaque session cookie. `owner_id` is `anonymous:<session>` or
`user:<id>` — same ownership model, so login is added later without a data redesign.
Every protected resource resolves identity → ownership → resource, server-side.

## Versioning / reproducibility

Resume versions immutable; edits → new revisions. Each GeneratedDocument records
(resume version, JD, tailoring, template_id+version, compiler+version, sha256,
page_count, timestamp) so any PDF is reproducible.

## What we deliberately avoid

HTML/CSS resume rendering, `window.print()`, browser/JS PDF, **PDF.js / any
browser-side PDF rendering on the preview path** (browser gets images, not PDF bytes),
AI-generated LaTeX, arbitrary user LaTeX in the trusted path, public PDF URLs,
business authorization inside the Python service, Cloudflare/Siglum/browser-WASM,
Docker/WSL as a dev requirement, Kubernetes/Kafka, Redis/microservices without a measured need.
