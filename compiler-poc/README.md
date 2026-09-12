# JD-Resume — Tectonic Compiler POC

**Compiler candidate validation only.** No app, no AI, no DB, no auth, no UI.

One question:

> Can **Tectonic** reliably compile our exact trusted **T01/T02/T03** templates
> with the **correct fonts** (Lato / NewTX / Charter), **without runtime CTAN/network**?

```
synthetic ResumeJSON  →  trusted T01/T02/T03 renderer  →  Tectonic  →  PDF
                      →  PDF validation + font verification + benchmark + offline check
```

Tectonic is a **candidate**, not yet the production compiler. If this gate passes,
we promote `TectonicCompiler` behind the `ResumeCompiler` interface. If it fails,
we report the exact failure and change nothing else.

## Layout

```
compiler-poc/
├── pyproject.toml
├── README.md
├── fixtures/synthetic_resume.json    synthetic (non-PII) data
├── src/
│   ├── models.py            ResumeJSON + ResumeCompiler protocol + CompileResult
│   ├── render.py            trusted T01/T02/T03 renderers (carried forward faithfully)
│   ├── compiler.py          TectonicCompiler (real tectonic; --only-cached offline)
│   ├── font_verification.py assert real font; reject cm-super/Computer Modern
│   ├── edge_cases.py        special chars / unicode / long / minimal / long URLs
│   └── run.py               gate + reliability + benchmark runner
└── output/                  generated PDFs (created on run)
```

## Prerequisites

- **Python 3.10+** (standard library only — no pip installs needed).
- **Tectonic** on PATH:
  - Linux/WSL: `cargo install tectonic`, or download a release binary
    (https://tectonic-typesetting.github.io/).
  - macOS: `brew install tectonic`.
  - Windows: download the release `.exe` and add to PATH, or use WSL.
- Optional: poppler's **`pdffonts`** for a precise embedded-font list (the runner
  falls back to a byte-scan if it's missing).

## Run

```bash
cd compiler-poc

# 1) WARM the Tectonic support-bundle cache ONCE (network allowed this time only):
python -m src.run --warm

# 2) THE REAL GATE — offline, no runtime network (--only-cached):
python -m src.run
```

`--warm` fetches Tectonic's TeX support bundle into its local cache. The real gate
runs with `--only-cached`, proving compilation needs **no runtime network**. If a
package/font is missing from the cache, it FAILS (correct, honest result).

## Acceptance gate

```text
tectonic present ....................... required
T01 → PDF + Lato embedded .............. PASS
T02 → PDF + NewTX (Times/Nimbus) ....... PASS
T03 → PDF + Charter embedded ........... PASS
No cm-super / Computer Modern fallback . PASS
Runtime CTAN / network (offline run) ... NONE
Edge cases compile without error ....... PASS
```

Font mismatch = FAIL. Never fixed by swapping the template font.
"PDF exists" is NOT "compiler works" — the font must be correct.

## GATE REPORT — fill after running

| Template | Gate | Pages | Size | Cold ms | Warm ms | Real font? | cm-super? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T01 Lato | ? | ? | ? | ? | ? | ? | ? |
| T02 NewTX | ? | ? | ? | ? | ? | ? | ? |
| T03 Charter | ? | ? | ? | ? | ? | ? | ? |

- tectonic version + bundle: …
- pdffonts available? …
- offline (`--only-cached`) gate passed with 0 network? …
- reliability: __/15 edge-case compiles passed

If Tectonic fails a template: report tectonic version, bundle, command, the missing
package/font, and root cause. Do NOT redesign the template or swap fonts.
