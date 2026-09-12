# JD-Resume — Web Application (`web/`)

The **application layer** for JD-Resume: Astro (public/SEO + server routes) with React
islands for interactivity. It owns everything the product is — UI, API routes, sessions,
AI orchestration, quotas, export authorization, document ownership, and **rasterized
preview delivery**. It talks to the Python rendering engine (`../server/`)
server-to-server; the browser never calls the engine directly and never receives PDF bytes.

See `../docs/ARCHITECTURE.md` and `../.kiro/steering/project-rules.md` for the locked boundary.

## The boundary in one line

> **Astro is the application. Python is the stateless rendering engine.**
> Preview = page **images**. Export = the original validated **PDF**. No PDF.js.

## Requirements

- **Node 20+** (developed on Node 22, npm 11).
- The **Python rendering engine must be running** (see `../server/README.md`). Its base
  URL is configured via `COMPILER_URL`.

## Setup

```powershell
# from web/
npm install
cp .env.example .env      # then fill in real values
```

### Environment (`web/.env`, gitignored)

| Var | Purpose |
| --- | --- |
| `COMPILER_URL` | Base URL of the Python rendering engine (default `http://127.0.0.1:8000`). |
| `NV_BASE_URL` | NVIDIA NIM base URL. |
| `NV_API_KEY` | NVIDIA API key. **Server-side only — never exposed to the browser.** |
| `NV_TEXT_FAST_MODEL` | Text model id. |
| `NV_TEXT_FAST_VISION_MODEL` | Vision model id. |

> The NVIDIA key lives **only** here (server-side Astro). It is read in `src/lib/ai/nvidia.ts`,
> which must never be imported into a React island or any client code. The Python engine
> has no AI key by design.

## Run

Two processes, two terminals. **Start the engine first** — the web app proxies compile/
preview to it (`COMPILER_URL`), so if it's down the preview shows the calm "couldn't
update" state.

**Terminal 1 — backend (Python rendering engine, from `../server/`):**

```powershell
cd ..\server
python -m uvicorn app.main:app --reload --port 8000
```

> Use `python -m uvicorn` (not bare `uvicorn`) unless Python's `Scripts\` folder is on
> your PATH — both run the same server. See `../server/README.md`.

**Terminal 2 — frontend (this app, from `web/`):**

```powershell
npm run dev            # dev with HMR → http://localhost:4321

# or a production build + run
npm run build
node ./dist/server/entry.mjs
```

Open <http://localhost:4321> — edit the resume, pick a template (Modern / Classic /
Compact), and the preview pane shows rendered page images from the engine.

## How requests flow

```
Browser (React island)
   │  POST /api/compile          (never talks to the engine directly)
   ▼
Astro server route  src/pages/api/compile.ts
   │  validate template_id + resume.name, then proxy
   ▼
src/lib/compiler.ts  ──►  Python engine  POST /api/compile
   │                         └── Tectonic → PDF → SHA-256 → WebP page images
   ▼
Astro returns compile metadata (document_id, page_count, sha256, …)

Browser then requests each page image:
   GET /api/preview/:id/pages/:n
      → src/pages/api/preview/[id]/pages/[page].ts
      → src/lib/compiler.ts pageImage()  ──►  engine  → streams WebP back
```

## Layout

```
web/
├── astro.config.mjs             output:"server", node standalone adapter, react
├── tsconfig.json                strict, @/* -> src/*
├── src/
│   ├── layouts/Base.astro       Inter font + design tokens (DESIGN-SYSTEM.md)
│   ├── pages/
│   │   ├── index.astro          mounts the editor island
│   │   └── api/
│   │       ├── compile.ts               POST — proxy to engine compile
│   │       └── preview/[id]/pages/[page].ts   GET — stream a page image
│   ├── components/
│   │   └── ResumeEditor.tsx     React island: edit ResumeJSON, debounce-compile, show images
│   └── lib/
│       ├── types.ts             ResumeJSON / CompileResult (mirror of Python models)
│       ├── compiler.ts          server-only engine client (compile / pageImage / pdf)
│       └── ai/nvidia.ts         server-only NVIDIA client (chat + streaming + vision)
└── .env.example
```

## Notes

- `npm audit` reports issues in `sharp` (Astro's optional image-optimization dep). We do
  **not** use Astro image optimization — preview images come from the engine as WebP — so
  it's outside our runtime path. Don't run `npm audit fix --force` (it downgrades Astro).
- This is a **proof-of-slice** editor, not the full three-zone product UI in
  `DESIGN-SYSTEM.md` (a later phase). AI routes/islands are wired in the AI phase using
  the existing `src/lib/ai/nvidia.ts` client.
