# Privacy

Status: **PLANNED**. Resumes and JDs are sensitive career data — treat as private by default.

## Data handling

- Originals, generated PDFs, and preview images are **private** assets (no public URLs).
- The DB stores metadata + storage keys, not file contents.
- AI providers receive **only** the data required for the requested operation.

## Retention (configurable — not hardcoded in logic)

```
Original uploads ....... 30 days
Generated PDFs ......... 30 days
Preview images ......... 30 days
AI intermediate data ... 7 days
Compiler temp files .... deleted immediately after compilation
Anonymous sessions ..... short-lived (configurable)
```
"Delete my data" (and expiry cleanup) removes: PostgreSQL rows + Cloudinary objects +
any temp artifacts. Never depend on server local disk for persistence.

## Logging (hard rules)

**Never log:** full resume/JD text, name/email/phone/address, PDF bytes, AI prompts
containing resume/JD content, generated resume contents.

**Do log (safe ops telemetry):** request_id, session **hash**, operation, latency,
status, compile duration, AI duration, template_id, revision_id, document_id, error_code.

No resume PII in analytics, URLs, storage keys, Redis keys (if used), or error tracking.

## Secrets

No secrets in frontend/client code or the repo. Env-only (see HOSTING.md). Never commit
generated PDFs, resumes, uploads, or user files to git.
