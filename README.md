# JD-Resume

An AI-assisted **structured** resume editor that renders trusted LaTeX templates
into genuine PDFs with **Tectonic** — not an HTML/CSS resume builder.

> Structured resume data → trusted template → real LaTeX → real PDF.
> What the preview shows is exactly what you download.

## Status

| Layer | State |
| --- | --- |
| LaTeX compiler (Tectonic 0.17.0) | ✅ **IMPLEMENTED** — validated in `compiler-poc/` |
| FastAPI backend | 🔜 PLANNED (Phase 1) |
| Astro + React frontend / editor | 🔜 PLANNED |
| PostgreSQL (local now) | 🔜 PLANNED |
| Cloudinary storage | 🔜 PLANNED |
| AI extraction / tailoring | 🔜 PLANNED |
| Auth / accounts | 🔜 PLANNED (anonymous-first) |
| Template visual polish | ⏸ DEFERRED (design phase) |

The compiler gate is passed: T01 (Lato), T02 (NewTX/Termes), T03 (Charter/XCharter)
compile with real embedded fonts, offline (`--only-cached`), ~1.7s warm, 15/15 edge
cases, on native Windows (no WSL/Docker). See `docs/COMPILER.md`.

## Stack

Astro + React · Python + FastAPI · PostgreSQL (local) · Cloudinary · Tectonic · PDF preview (rasterized).

## Repository (target)

```
JD-Resume/
├── server/        FastAPI app (compiler, resumes, jobs, tailoring, templates,
│                  documents, storage, ai, usage, db) + tests
├── web/           Astro + React (public site + editor islands)
├── docs/          single source of truth (see below)
├── compiler-poc/  the validated Tectonic POC (kept as reference/regression)
└── .kiro/steering/project-rules.md
```

## Docs (single source of truth)

- `docs/ARCHITECTURE.md` — layers, data flow, component boundaries
- `docs/PLAN.md` — phased build order + definition of done
- `docs/DATABASE.md` — PostgreSQL schema (local now)
- `docs/COMPILER.md` — Tectonic decision + measured POC gate results
- `docs/SECURITY.md` — anonymous export model, ownership, compiler sandboxing
- `docs/PRIVACY.md` — data handling, retention, logging rules
- `docs/AI.md` — provider abstraction, anti-hallucination, prompt-injection safety
- `docs/API.md` — endpoints, request/response, error model
- `docs/HOSTING.md` — local dev + portable deployment target
- `docs/DESIGN-SYSTEM.md` — colors, type, motion, icons, editor layout

## Local dev prerequisites (planned)

Python 3.10+, Node 18+, a local **PostgreSQL**, and **Tectonic** (native binary; the
POC vendors `compiler-poc/tools/tectonic.exe` on Windows). No Docker/WSL required.
