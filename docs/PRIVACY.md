# Privacy

Status: **PLANNED**. Resumes and JDs are sensitive career data — treat as private by default.

## Data handling

- Originals, generated PDFs, and preview images are **private** assets (no public URLs).
- The DB stores metadata + storage keys, not file contents.
- AI providers receive **only** the data required for the requested operation.
- **Advertising partners never receive resume/JD content, account data, or file bytes.**
  They operate only on standard web technical signals (IP, user agent, approximate
  location, device/browser) to select and measure ads.

## Advertising

The free tier is partly funded by third-party advertising. Disclosure rules:

- The **public privacy policy** (`web/src/pages/privacy.astro`) must name advertising as a
  data-processing category and explain, in plain language, **what** technical data ad
  partners may process and that resume/JD content is **never** shared with them.
- The policy states *what* is disclosed to users, **not** the integration internals. Do
  **not** publish network names-to-endpoints mappings, zone/publisher IDs, service-worker
  registration details, or script URLs in user-facing copy, logs, or error messages — these
  are operational details that add no user value and only aid abuse.
- Ad partners are loaded **async / non-blocking** and must never touch the compile, export,
  preview, or AI paths, and never see authenticated document bytes.
- `public/ads.txt` is the only public authorized-seller declaration and is intentionally public.

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
