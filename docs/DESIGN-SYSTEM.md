# Design System

**Feel:** Apple Pages × Linear × Raycast × editorial publishing. Quiet, expensive,
trustworthy, fast. Premium comes from typography, spacing, motion restraint, and the
document itself — not gradients, blobs, glassmorphism, or animated icons.

> **No visual element should compete with the resume.** The document is the hero.

## Color

```
Background   #FAFAF8      Surface     #FFFFFF
Text         #111111      Secondary   #6B6B6B      Muted    #999999
Border       #E7E7E4      Accent      #2563EB (one restrained blue)
Success      #16803C      Warning     #B7791F      Danger   #C24141
```

No purple AI gradients, neon, rainbow gradients, heavy shadows, or animated backgrounds.

## Radius

```
buttons 10px   inputs 10px   cards 14px   document 2px
```

Not everything `rounded-3xl`.

## Shadows (almost invisible)

```
0 1px 2px rgba(0,0,0,.04)
0 8px 30px rgba(0,0,0,.06)
```

Document preview may use a slightly deeper "physical sheet" shadow:
`0 20px 50px rgba(0,0,0,.08), 0 2px 8px rgba(0,0,0,.05)`.

## Typography

- UI: **Inter** (or Geist). Editorial: Inter Tight / Geist / IBM Plex Sans.
- Resume preview font = whatever the LaTeX template specifies (bundled, not system).
- Headings win with **letter-spacing**, not size:
  `font-size: clamp(44px,6vw,76px); font-weight:600; letter-spacing:-0.055em; line-height:.98;`
- Max ~2 fonts. Self-host where licensing permits; preload only truly critical fonts.

## Motion

```
micro 120–160ms   normal 180–240ms   page 300–400ms
```

Animate **opacity** and **transform** only. Never continuously animate decoration.
Every animation must communicate state, hierarchy, feedback, navigation, or progress.
No spin/bounce/shake/wiggle/pulse without meaning. Respect `prefers-reduced-motion`.

Hover language: buttons lift `translateY(-1px)`; arrows `→` shift to `↗`; checks draw in;
document `scale(1.02)`. Page transitions via **Astro View Transitions** (fade / fade+slight
translate). No animation libraries (GSAP/Three/Lottie) for ordinary UI — the one exception
is `motion` (via `lucide-motion`) used **only** to drive hover icon animation, not general UI.

## Icons

```
Primary UI (interactive nav/actions): lucide-motion   (animated Lucide; hover-to-draw)
Tiny utility (chevron/close/check/arrow/sort/menu): @radix-ui/react-icons or lucide-motion
Brand/product illustrations: custom inline SVG (resume, job-match, analysis, tailor, export)
```

**Founder override (locked):** `lucide-motion` (the maintained package behind
lucide-animated.com — animated Lucide, inline SVG, per-icon imports, powered by
`motion/react`) **is the chosen interactive icon set.** This supersedes the earlier
"Forbidden: Lucide / no animated icons" rule. Rationale: hover-triggered draw-in
communicates feedback and fits the Linear/Raycast feel.

**Motion constraints still apply:** icons animate on **hover/focus only** (`trigger="hover"`,
the default) — **never** on load, never looping/continuous, never as decoration. Respect
`prefers-reduced-motion` (the engine + a global reduced-motion rule disable it). Import
icons **individually** (tree-shake).

**Still forbidden:** Font Awesome, HugeIcons, icon fonts, remote icon CDNs,
Iconify-with-huge-runtime, and any continuously-animating/decorative icon.

## Product UI shape

Three-zone editor: left **workflow rail** (01 Resume · 02 Job · 03 Match · 04 Tailor ·
05 Preview · 06 Export), center **PDF preview**, right **insights** (match %, skills).
Progress checks draw in via tiny SVG. Avoid "card soup" — use whitespace + hierarchy.

## States (every interactive component)

`default · hover · focus-visible · active · disabled · loading`. Never remove focus
outlines without replacing them. Icon-only buttons need `aria-label`. Keyboard accessible.

## Loading & errors (feel trustworthy)

Show real process state, not "Loading...":
`✓ Reading document · ✓ Extracting experience · ● Matching skills · ○ Preparing`.
PDF area uses a document skeleton, then crossfades to the real PDF.
Errors are calm and safe: "We couldn't generate this version. Your previous version is
safe. [Try again] [Use previous version]" — never raw `pdflatex` logs.

## Signature promise (make it visible)

> **What you see is what you download.** Preview and export come from the **same
> generated PDF artifact** (verified by SHA-256). The free live preview shows
> server-rendered page **images** of that PDF; the export releases the identical PDF
> bytes. There is never a separate "preview compile" and "download compile".

## SEO/AEO performance rules

Astro-first rendering; React only for interactive islands; SEO-critical content in
initial HTML (never hidden inside React fetches); inline SVG icons; no icon fonts / remote
icon CSS; no huge decorative images; lazy-load below-the-fold; avoid layout shift;
answer-oriented guides + FAQ (structured data only when the visible page contains it).

## Product UI contract (LOCKED)

The app is a **premium AI resume workspace** — not a dashboard, not a compiler demo,
not a CRUD form. Any screen that looks like `form → button → PDF` is wrong.

### App shell (persistent)

```
┌────────────┬─────────────────────────────┬─────────────────┐
│ Sidebar    │ Document canvas (preview /   │ AI / Insights   │
│ (nav)      │ structured editor)          │ (contextual)    │
└────────────┴─────────────────────────────┴─────────────────┘
```

- **Left sidebar (persistent, quiet):** brand, `+ New`, WORKSPACE (Resume · Job ·
  AI Tailoring · Editor), DOCUMENTS (My Resumes · Templates), TOOLS (Reference design ·
  Import), and a bottom **Free plan** indicator + Help/Settings. Restrained line icons
  only (Phosphor/Radix per the Icons section) — no colorful "AI magic" icons, no emoji.
- **Top bar:** brand / document title / calm save state ("Saved ✓" · "Updated just now"),
  and the primary actions **Preview · Export PDF**. `⌘K` command palette is a good fit.
- **Center:** a **document canvas** — the resume page image on the app background with a
  physical-sheet shadow, plus zoom / fit-width / page nav / fullscreen. Never a raw PDF
  floating in a giant white card. **No PDF.js.**
- **Right panel:** contextual AI — Match %, Keywords, Gaps, Suggestions. Calm empty
  states until the data exists ("Add a job description to see your match").

### Workflow (modes, reachable from the sidebar)

`01 Import (resume · JD · optional reference LaTeX) → 02 Analyze (match · gaps ·
keywords · opportunities) → 03 Tailor (live AI workflow, not a spinner) → 04 Edit
(structured collapsible sections + live preview + inline AI edit) → 05 Export`.
The anonymous experience must feel **complete** before login is ever requested
(login appears only after the first export or two, never mid-workflow).

### Structured editor (not a form)

Collapsible document sections: Header · Summary · Experience (bullets) · Projects ·
Education · Skills · Certifications · Achievements — with `+ Add`. Feels like a document
editor. Inline AI on a selection offers Rewrite / Add detail / Make concise →
Accept / Reject.

### Templates (user-facing names)

Show **Modern / Classic / Compact** with thumbnails. Internal IDs (`T01/T02/T03`) and
font names are implementation detail — never the primary label (font may appear as
quiet secondary metadata).

### Hide ALL implementation details (hard rule)

The UI must **never** surface: LaTeX, Tectonic, compiler names/versions, compile
timings, Python, FastAPI, PDF rasterization, storage, or any infra. These are
engineering diagnostics, not product UI.

- Progress: **"Updating preview…"** / **"Rendering your resume…"** — never
  "Tectonic 0.17.0" or "2108ms".
- Success: **"Updated just now"** — not "✓ 1 page · 2108ms · tectonic-0.17.0".
- Failure: **"We couldn't update the preview. Your previous version is still shown."**
  + a small "Try again" — never raw compiler logs or error codes.

Diagnostics may live in dev-only tooling/console, never in the product surface.

## Aptora Workspace layout (LOCKED — supersedes earlier three-column spec)

Brand: **Aptora, by Enally.** Tagline: *Make your experience count.* Match the landing
page's visual language (Inter + IBM Plex Mono, `#FAFAF8` bg, `#111` primary buttons,
hairline `#E5E5E1` borders, subtle lift on hover, calm/editorial).

```
┌────────────────────────────────────────────────────────────────────────────┐
│ A  Aptora   /   <doc name>                    Saved      Export PDF   ⋯     │  topbar (56–64px)
├────┬──────────────────────────────────────┬────────────────────────────────┤
│ ▣  │                                      ║                                │
│ ↥  │        LATEX EDITOR                  ║        LIVE RENDER (PDF images) │
│ ✦  │  line #s · syntax · AI decorations   ║        zoom · page nav          │
│ ▤  │                                      ║                                │
│ ⚙  │                                      ║                                │
├────┴──────────────────────────────────────╨────────────────────────────────┤
│  editor status bar (Ln/Col · UTF-8 · LaTeX · template · pages)             │
└────────────────────────────────────────────────────────────────────────────┘
        ↑ thin icon rail        ↑ DRAGGABLE vertical divider (resize X)
```

**Left rail (LOCKED):** thin **icon-only** nav, ~64–72px. Expand on click/hover to show
labels. Items: Aptora mark, Resume, Import (opens drawer), Aptora Intelligence (opens
drawer on Intelligence tab), Versions, Settings. It is **navigation/tools only** — it does
NOT contain the upload card, JD textarea, or a workflow list.

**Right-edge drawer (LOCKED):** opens on click (trigger button, hugs the right edge).
Overlays the workspace (does not steal editor width; editor/preview state preserved).
Two tabs:
- **Import** — Upload résumé PDF + Job Description textarea + `Analyze with Aptora`.
- **Intelligence** — Role alignment %, Strong matches, Gaps, Opportunities, Weak evidence,
  suggestions. (Analysis backend is a later slice → honest empty/ready states until then,
  never fabricated numbers.)

**Center + right = LaTeX editor ↔ live render**, separated by a **draggable vertical
divider** (resize the X split: e.g. 40/60↔60/40, sensible min/max). Each pane scrolls
independently; the page itself never scrolls (100vh shell, `overflow:hidden`).

**AI inline editing (LOCKED):** when Aptora tailors, it applies changes **into the editor**
and **highlights the changed ranges inline** (CodeMirror decorations — not fake `\color`
in the source; the `.tex` stays valid). A contextual indicator ("Aptora changed N lines")
offers Accept / Reject / Review. Streaming: as AI streams, the editor updates and the
preview recompiles (debounced) so the user sees it come alive.

**Mental model:** Left rail = navigate · Main workspace = create · Right drawer =
understand / import / instruct. Not a static 3-column AI dashboard.

Libraries: `react-resizable-panels` (divider), CodeMirror 6 (editor + decorations),
`lucide-motion` (icons). Real rasterized page images for preview (no PDF.js, no HTML resume).
