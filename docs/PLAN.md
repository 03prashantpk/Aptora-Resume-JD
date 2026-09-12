# Build Plan

Build **vertically** — prove each layer before the next. Do not build the whole app
at once. Reuse the validated compiler POC; never rebuild it.

## Phase 0 — Docs reset ✅ (this document set)

Single source of truth in `docs/` + steering. Local Postgres for now.

## Phase 1 — Compiler promotion (FIRST vertical slice)  [PLANNED]

Move validated compiler + templates into `server/app/compiler/` and
`server/app/templates/`. Implement `ResumeCompiler`, `TectonicCompiler`, trusted
template registry, PDF validation + SHA-256, `GeneratedDocument` model.
Expose `POST /api/compile` and `GET /health`. Preserve POC tests as regression gate.

**Slice goal:** `ResumeJSON → T01/T02/T03 → Tectonic → validated PDF → GeneratedDocument`.

## Phase 2 — Minimal frontend + preview  [PLANNED]

Astro shell + one React editor island using synthetic ResumeJSON; template selector;
server-side **rasterized preview** endpoint. Goal: edit → compile → image preview.

## Phase 3 — Persistence (LOCAL Postgres)  [PLANNED]

PostgreSQL schema (see DATABASE.md), data-access layer, immutable resume versions +
generated documents. No vendor-specific coupling.

## Phase 4 — Secure preview/export  [PLANNED]

Anonymous sessions; ownership checks; usage service; one-time export token; protected
preview endpoint; private storage keys. Free path = images only; export = PDF bytes.

## Phase 5 — Resume upload + extraction  [PLANNED]

PDF validation (MIME/magic/size/pages), text extraction, quality check, OCR/multimodal
fallback → ResumeJSON.

## Phase 6 — JD + AI tailoring  [PLANNED]

JD paste/upload → JDAnalysis → GapAnalysis → tailored ResumeJSON, behind `AIProvider`,
Pydantic-validated, anti-hallucination + prompt-injection safe (see AI.md).

## Phase 7 — Live editor  [PLANNED]

Structured section editor; debounced (300–500ms) compile; revision IDs (latest wins);
compile status states.

## Phase 8 — Storage (Cloudinary)  [PLANNED]

`StorageProvider` → `CloudinaryStorage`; private assets; opaque keys.

## Phase 9 — Auth-ready  [PLANNED]

`IdentityProvider` + anonymous→account migration path. Login itself can come later.

## Phase 10 — Template visual polish  [DEFERRED]

Tune T01/T02/T03 to match reference/Overleaf with real fonts (one-page fit, spacing).

## Phase 11 — Hardening  [PLANNED]

Security tests (cross-user access, export reuse, quota bypass, PDF identity), compiler
regression, rate limits, load tests.

## Definition of done (first real MVP)

```
open site (no login) → upload resume → extract ResumeJSON → paste JD → analyze
→ gap → tailor → editor → edit → pick T01/T02/T03 → live compile → Tectonic → valid PDF
→ image preview → edit again (new revision) → preview updates → Export
→ exactly one server-authorized export → download → SHA256(download)==SHA256(preview)
→ second export attempt REJECTED
```
And none of: view-source / DevTools / localStorage edit / fake export_count / manual
API call / guessed document ID / replayed token — may bypass server-side rules.

## Rules of engagement

Smallest change that works; run tests; update docs; don't rewrite unrelated code; if an
implementation conflicts with the docs, stop and report rather than forking the architecture.
Do not tune templates until the compiler integration is functional.
