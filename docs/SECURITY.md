# Security

Status: **PLANNED** (enforced from Phase 4). The compiler sandboxing is IMPLEMENTED
in the POC. All controls are **server-side**; hiding UI/endpoints is never a control.

## The anonymous export model (core)

Free users edit and preview freely, but **PDF bytes are only released through an
authorized, quota-checked export**. Two paths:

- **Preview (free):** `Tectonic → PDF → server-side rasterization → page images → browser`.
  The browser never receives the PDF.
- **Export:** `same PDF → private storage → one-time token → download`.

### Export rules
- Export is a **server-side entitlement**, not a frontend button.
- Consumption is **atomic**: verify current revision + successful PDF + quota, then
  reserve/consume in one transaction, then issue a **single-use, short-lived** token.
- A **failed compile never consumes** quota. A consumed token **cannot be reused**.
- Store only a **hash** of the token; validate: not expired, not consumed, owner matches,
  document exists; mark consumed atomically on download.
- Download streams the stored PDF (`Content-Disposition: attachment`); never redirect to
  a public storage URL.

### Honest limitation
If a browser is authorized to display a PDF, a determined user can save those bytes. The
realistic goal is preventing **unauthorized acquisition, API bypass, public-URL reuse,
quota bypass, and cross-user access** — not DRM. The free path avoids sending PDF bytes at all.

## Identity & ownership

- Anonymous session id: opaque, high-entropy, `HttpOnly` + `Secure` (prod) + `SameSite`;
  never derived from IP or email. IP is an abuse signal only, not identity.
- `owner_id` = `anonymous:<session>` | `user:<id>`. Every protected request resolves
  identity → ownership → resource. Never trust client-supplied `user_id`/`document_id`/token.
- Document IDs are random (UUID/ULID) but IDs are **not** authorization — ownership is.

## Compiler sandboxing (IMPLEMENTED in POC)

Only trusted T01/T02/T03 render; content LaTeX-escaped; `-no-shell-escape`/no `\write18`;
`openin/openout` restricted; isolated temp dir; timeout + resource/output-size limits;
temp cleaned; no filesystem paths / logs / env exposed. Offline (`--only-cached`) — no
runtime CTAN. Concurrency limited (semaphore) per session/host.

### Arbitrary user LaTeX — EXPERIMENTAL, separate boundary
"Use my LaTeX template" is **not** in the trusted path. If ever built, it runs in a
**separate hardened sandbox** with strict resource/network isolation. It must never
weaken the trusted-template compiler. Until then, user-provided LaTeX is treated as a
**reference** for AI to analyze (layout/structure), not executed.

## Input validation

- Uploads: MIME + magic bytes + max size + max page count + PDF validity; reject malformed
  and unsafe encrypted PDFs; never trust the filename/extension; random storage keys.
- JD/resume text is untrusted: escape on output; never render arbitrary HTML; never let it
  inject HTML/LaTeX/SQL. Prompt-injection handling in AI.md.

## Rate limiting & abuse

Per-session limits on upload / compile / preview / AI / export attempts / downloads
(configurable, server-owned — never localStorage). Cookies can be cleared, so combine
session limits + IP abuse signals + request-size/concurrency limits. No invasive tracking.

## Transport & app

- CORS: only the real frontend origin(s); never `*` with credentials.
- CSRF: cookie-auth state-changing requests protected (SameSite + Origin/Referer check +
  CSRF token where needed). CORS is not CSRF protection.
- No secrets in frontend (AI keys, Cloudinary secret, DB creds, token-signing secrets).
- Errors are safe (`code` + message + request_id); no stack traces / compiler logs / paths.
- Production may disable `/docs`, `/redoc`, `/openapi.json` (discoverability only, not a control).

## Required security tests

Cross-user document/preview access → 403; expired session → 401; expired/used export
token → reject; quota exhausted → reject; fake/guessed document ID → reject; replayed
token → reject; frontend-modified counter → irrelevant; path traversal in template_id →
reject; malicious LaTeX-y content in fields → escaped/safe; `SHA256(preview)==SHA256(download)`.
