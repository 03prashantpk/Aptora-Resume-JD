# Hosting

Status: local dev now; deployment **PLANNED**. Product requirements are locked;
hosts/providers are replaceable behind abstractions. Do not couple domain logic to any host.

## Local development (now)

```
Frontend  Astro dev server (web/)
Backend   FastAPI (server/) — uvicorn
Database  LOCAL PostgreSQL     DATABASE_URL=postgresql://localhost:5432/jdresume
Storage   Cloudinary (dev cloud) or a local stub behind StorageProvider
Compiler  Tectonic native binary (POC vendors compiler-poc/tools/tectonic.exe on Windows)
```
No Docker/WSL required. Compiler runs offline (`--only-cached`).

## Deployment target (initial, PLANNED)

```
Astro (static/SSR)  → static host (e.g. Render Static / Vercel)
FastAPI             → container/web service (e.g. Render Web Service) — Linux Tectonic in image
PostgreSQL          → managed Postgres (local now → hosted later; same schema)
Storage             → Cloudinary (private assets)
```
Keep the backend **portable**: stateless where practical, external Postgres + external
storage, config via env. Migrating hosts must not touch AI/database/compiler/documents code.

### Free-tier caveat (why persistence is external)
Free web tiers commonly **spin down when idle** and have an **ephemeral local filesystem**.
Therefore: never store persistent user data on the server's local disk. Local disk is only
for transient compile/rasterize/upload work under `/tmp/<random-job>/`, deleted after use.

### Provider portability (do NOT over-build now)
Build the abstraction (`StorageProvider`, data-access layer, config) so a host can be
swapped later. Do **not** implement automatic multi-host failover yet — that's an
infrastructure concern, not application logic.

## Tectonic in production

Image must contain the Tectonic binary + support bundle + bundled fonts (real Lato TTFs).
Production compile must run with **no network** and pass the regression gate
(T01/T02/T03 + 15 edge cases, real fonts, offline) before deploy.

## Environment variables

```
APP_ENV
APP_SECRET / SESSION_SECRET / EXPORT_TOKEN_SECRET
DATABASE_URL
WEB_ORIGIN                       # exact CORS origin(s)
CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET
AI_PROVIDER / AI_API_KEY
MAX_UPLOAD_MB / MAX_RESUME_PAGES
MAX_CONCURRENT_COMPILATIONS
FREE_EXPORT_LIMIT                # e.g. 1 for anonymous
SESSION_TTL / DOCUMENT_RETENTION_DAYS
ENABLE_API_DOCS                  # false in production
```
All product limits are configuration, not hardcoded. Never commit secrets. Never commit
generated PDFs / resumes / uploads.

## Minimal first deployment

One Astro static site + one FastAPI service + Postgres + Cloudinary + Tectonic.
No Redis/queues/workers/microservices until a measured need appears.
