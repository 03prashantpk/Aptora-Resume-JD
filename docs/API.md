# API

Status: **PLANNED** (FastAPI, `/api/v1`). Route names may refine during implementation,
but responsibilities and security stay fixed. All mutations: session + ownership +
input validation + rate limit; cookie-auth mutations add CSRF protection.

## Endpoints

```
GET  /health                                        liveness

POST /api/v1/session                                create/refresh anonymous session

POST /api/v1/resumes                                create resume (+ optional upload)
GET  /api/v1/resumes/{id}
GET  /api/v1/resumes/{id}/versions
POST /api/v1/resumes/{id}/extract                   PDF -> ResumeJSON (AI/extraction)
PATCH/api/v1/resume-versions/{id}                   edit -> new revision

POST /api/v1/jobs                                    create JD (paste/upload)
GET  /api/v1/jobs/{id}
POST /api/v1/analysis                                JD analysis + gap analysis
POST /api/v1/tailoring                               tailored ResumeJSON
GET  /api/v1/tailoring/{id}

GET  /api/v1/templates                               list T01/T02/T03
GET  /api/v1/templates/{id}

POST /api/v1/compile                                 ResumeJSON+template -> GeneratedDocument
GET  /api/v1/compilations/{id}                       status

GET  /api/v1/documents/{id}                          metadata (owner-checked)
GET  /api/v1/documents/{id}/preview/pages/{page}     rasterized page IMAGE (free path)

POST /api/v1/exports                                 atomic quota check -> one-time token
GET  /api/v1/exports/{token}/download                single-use PDF stream

GET  /api/v1/usage                                   { exports_used, exports_remaining, authenticated }
```

## Compile

Request `POST /api/v1/compile`:
```json
{ "template_id": "T01", "resume": { }, "revision_id": "rev_042" }
```
Response:
```json
{ "document_id": "…", "revision_id": "rev_042", "sha256": "…",
  "page_count": 1, "compile_time_ms": 1700 }
```
Debounced by the client (300–500ms). Server associates each compile with `revision_id`;
stale results (older revision) are discarded. Reuses an existing GeneratedDocument when the
content hash (resume_json + template_id + template_version + compiler_version) matches.

## Export (never trust the client)

`POST /api/v1/exports { document_id }` → verify session/ownership/document/quota →
**atomically** consume one export → return `{ export_id, expires_at, download_url }`.
`GET /api/v1/exports/{token}/download` → hash token → validate (not expired/consumed,
owner matches, doc exists) → mark consumed atomically → stream the **same** stored PDF.
No public storage URLs anywhere in responses.

## Preview (free path)

`GET /api/v1/documents/{id}/preview/pages/{page}` → owner-checked → returns a WebP/PNG page
image rendered server-side from the stored PDF. The PDF itself is never returned here.

## Error model

```json
{ "error": { "code": "COMPILATION_FAILED", "message": "…", "request_id": "…" } }
```
Stable codes: `RESUME_INVALID, RESUME_TOO_LARGE, RESUME_EXTRACTION_FAILED, JD_INVALID,
AI_INVALID_RESPONSE, AI_TIMEOUT, TEMPLATE_NOT_FOUND, COMPILATION_FAILED,
PDF_VALIDATION_FAILED, PAGE_LIMIT_EXCEEDED, COMPILATION_TIMEOUT, EXPORT_LIMIT_REACHED,
DOCUMENT_NOT_FOUND, DOCUMENT_ACCESS_DENIED, SESSION_EXPIRED, RATE_LIMITED`.
Every response carries a `request_id`. Never leak stack traces / compiler logs / paths.

## Layering

`route → service → repository/provider`. Routes never touch Tectonic, storage, or SQL
directly — they call services (`DocumentGenerationService`, `UsageService`, …) which call ports.

## Docs exposure

Production may set `ENABLE_API_DOCS=false` → `/docs`, `/redoc`, `/openapi.json` return 404.
This is discoverability reduction, not a security boundary; authz remains the control.
