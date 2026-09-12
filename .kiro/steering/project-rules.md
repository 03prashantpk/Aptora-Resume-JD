# JD-Resume — Project Rules (always in context)

Single source of truth for behavior. If a request conflicts with these, flag it
before acting. Status tags used across docs: **IMPLEMENTED / PLANNED / DEFERRED /
EXPERIMENTAL**. Do not write planned work as if it exists.

## PRODUCT PIVOT (LOCKED 2026-09 — supersedes the structured-editor model)

> **JD-Resume is an Overleaf-style LaTeX résumé workspace.** The user works on the
> **full `.tex` source directly**, editable by **both the human and AI**, with a **live
> preview** beside it. This replaces the earlier structured-form / ResumeJSON-only model.

New pipeline:

```
Upload resume PDF + paste JD text
   → editor pre-loaded with full .tex (real résumé by default)
   → human edits .tex  AND/OR  AI rewrites .tex given the JD
   → Tectonic (offline) → real PDF → rasterized page images → live preview
   → export = the same validated PDF
```

Consequences (these OVERRIDE the older rules where they conflict):
- **Arbitrary `.tex` is now first-class.** The editor sends raw LaTeX to a compile
  endpoint; there is no forced trusted-template gate on this path.
- **AI edits LaTeX directly** (given the résumé + JD). The old "AI never writes LaTeX"
  rule is repealed for this product.
- **LaTeX is visible to the user** — it's the whole point. Rule 32's "hide LaTeX" no
  longer applies to the code editor (compiler *internals* — Tectonic name/version/
  timings, Python, paths, logs — stay hidden).
- Trusted templates (T01/T02/T03) become **optional starting points**, not a wall.
- **Preview stays rasterized images** (browser gets images, not PDF) unless the founder
  explicitly opts into in-browser PDF. Export still releases the real PDF.
- Because arbitrary LaTeX now runs, the compiler MUST be **hardened**: `--only-cached`
  offline, no-shell-escape / no `\write18`, isolated temp dir, strict timeout, input
  size cap, output validation, temp cleanup. Treat every `.tex` as untrusted.

The structured-editor pipeline below is kept for historical context; the pivot wins.

## The (superseded) structured pipeline

```
Resume PDF → extraction → ResumeJSON → JD → JD analysis → gap analysis
→ tailored ResumeJSON → trusted template → deterministic renderer → .tex
→ Tectonic → real PDF → (preview rasterization | one-time export) → download
```

## Architectural boundary (LOCKED)

> **Astro/React is the application. Python is the stateless rendering engine.**

- **Astro + React (`web/`)** owns: UI/editor, API/server routes, anonymous sessions +
  auth, database, Redis (when needed), AI orchestration, resume/JD/tailoring logic,
  storage metadata, usage/quotas, **export authorization**, **document ownership &
  lifecycle**, and **rasterized preview delivery** to the browser.
- **Python + FastAPI (`server/`)** owns ONLY: LaTeX compilation (raw `.tex` **and**
  optional trusted templates), PDF validation, SHA-256, **PDF → PNG/WebP
  rasterization**. It has **no users, no auth, no quotas, no business authorization,
  no persisted application state**. It **does** compile arbitrary `.tex` (the pivot),
  but always **hardened**: offline, no-shell-escape, isolated temp, timeout, size cap.
- Python may hold PDF/image bytes **transiently** for one request; it must **not**
  persist them. Durable ownership/storage/lifecycle live in Astro + DB + storage.
- Astro reaches the compiler over an **internal HTTP API**; Astro never runs Tectonic.
- Invariant: **Preview = rasterized images. Export = the original validated PDF.** No PDF.js.

## Stack (decided)

- Application: **Astro + React (islands)**, TypeScript — the whole product (UI, API routes, sessions, DB, AI, quotas, export auth, ownership, preview delivery).
- Rendering engine: **Python + FastAPI** — a **stateless** compiler service (LaTeX → PDF → images). Not the application backend.
- Database: **PostgreSQL** (LOCAL for now; hosted later — via a data-access layer, no vendor lock).
- Storage: **Cloudinary** behind a `StorageProvider` abstraction (PLANNED).
- Compiler: **Tectonic 0.17.0** behind a `ResumeCompiler` abstraction (IMPLEMENTED in POC).
- Preview: server-side **rasterized page images** for free/anonymous mode.
- Hosting (initial target, PLANNED): FastAPI on Render, Astro static, local→hosted Postgres, Cloudinary.

## Hard rules — MUST

1. Real LaTeX via Tectonic; real PDF; run offline (`--only-cached`), no runtime CTAN.
2. AI edits the **`.tex` source** (given résumé + JD). AI output is still just text placed
   in the editor; the human can review/override before it renders. (Pivot: repeals the old
   "AI content-only, never LaTeX" rule.)
3. Trusted templates (T01/T02/T03) are **optional starting points**; template IDs still validated when used.
4. Arbitrary `.tex` IS accepted on the compile path, but the compiler is **hardened**
   (offline, no-shell-escape / no `\write18`, isolated temp, timeout, input size cap,
   output validation, cleanup). Treat all `.tex` as untrusted input.
5. Preview and export use the **same generated PDF artifact** (verified by SHA-256).
6. Export is a **server-side entitlement**; a failed compile never consumes quota; a one-time
   token cannot be reused. The frontend cannot grant itself exports.
7. Free preview does **not** send PDF bytes — it sends rasterized page images. PDF bytes are
   released only through the authorized export flow.
8. Every user-owned resource is checked for ownership server-side (`WHERE id=? AND owner_id=?`).
   Never trust client-supplied user_id/document_id/token.
9. Resume versions and generated documents are **immutable**; edits create new revisions.
10. Revision IDs prevent stale previews (latest-revision-wins).

## Hard rules — MUST NOT

11. No HTML/CSS resume renderer, no `window.print()`, no browser/JS PDF generation, no screenshot/canvas PDF,
    and **no PDF.js / browser-side PDF rendering on the preview path** — the browser gets page images, not PDF bytes.
12. (Pivot: repealed.) AI-generated LaTeX and arbitrary user LaTeX ARE now allowed, but ONLY through
    the hardened Tectonic path (rule 4): offline, no-shell-escape, isolated temp, timeout, size cap.
13. No public PDF URLs; no Cloudinary credentials in the frontend; no secrets in client code.
14. No compiler logs / filesystem paths / env exposed to users.
15. Do not replace Tectonic, Python/FastAPI, or Astro without explicit instruction.
16. No Cloudflare/Siglum/browser-WASM (abandoned). No Docker/WSL required for local dev.
17. No premature infra: no Kubernetes/Kafka; no Redis until a measured need; no microservices without need.
18. Never trust frontend quota counters (localStorage/cookies) as authoritative.
19. Do not compile twice (once for preview, once for download).
20. Do not require login for the initial workflow; but keep identity/ownership abstracted so
    login can be added later without redesigning the data model.

## Security / privacy

21. Anonymous session = opaque, high-entropy, HttpOnly/Secure/SameSite cookie; not derived from IP/email.
22. Validate uploads: MIME, magic bytes, size, page count, PDF validity; never trust extension.
23. Rate-limit uploads/compiles/AI/exports; compiler runs with timeouts, isolated temp dir,
    no shell-escape, resource limits, temp cleanup. IP is an abuse signal, not identity.
24. Never log resume/JD contents, PII, PDF bytes, or AI prompts containing resumes.
25. Treat resume/JD text as untrusted (prompt-injection aware): AI must separate system
    instructions from user document text and never execute instructions inside a resume/JD.

## Process

26. Build vertically, one layer at a time (compiler → API → DB → editor → preview → export → AI).
    Prove each slice before the next. Do not build the whole app at once.
27. Reuse the validated compiler POC; do not rebuild it. Preserve its tests as regression tests
    (gate: 3/3 templates + 15/15 edge cases, real fonts, offline).
28. Template visual polish (one-page fit, Overleaf match) is a DEFERRED design phase, not compiler work.
29. Before a feature: read existing code + docs, make the smallest change, run tests, update docs.
    If an existing implementation conflicts with these rules, stop and report — don't create a third architecture.
30. Icons: **lucide-motion** (animated Lucide, hover-to-draw) for interactive nav/actions; Radix/custom SVG also allowed.
    Hover/focus-triggered only — never on load, looping, or decorative; respect prefers-reduced-motion. No icon fonts /
    remote icon CDNs. (Founder override: Lucide is now allowed, superseding the old ban.) Design system per DESIGN-SYSTEM.md.
31. The product UI is a **premium AI resume workspace** (persistent sidebar · document canvas · contextual AI),
    NOT a dashboard, CRUD form, or compiler demo. Follow the "Product UI contract (LOCKED)" in DESIGN-SYSTEM.md.
32. (Pivot: amended.) The **LaTeX source is intentionally visible** — it's the editor. What stays hidden
    is compiler *internals*: Tectonic name/version, compile timings, Python/FastAPI, filesystem paths, raw
    logs, infra. Compile errors shown to the user should be readable, not raw engine stack traces.
33. UI features are wired only when their slice exists; unbuilt features show calm empty states, never fake data.
