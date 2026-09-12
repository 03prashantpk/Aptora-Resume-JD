# AI

Status: **PLANNED** (Phase 6). AI controls **content only** — never layout, never LaTeX,
never fonts. Behind a provider abstraction so the vendor can change without app changes.

## Provider abstraction

```python
class AIProvider(Protocol):
    async def extract_resume(self, ...) -> ResumeJSON: ...
    async def analyze_jd(self, jd: str) -> JDAnalysis: ...
    async def analyze_gap(self, resume: ResumeJSON, jd: JDAnalysis) -> GapAnalysis: ...
    async def tailor_resume(self, resume: ResumeJSON, gap: GapAnalysis) -> ResumeJSON: ...
```
No provider-specific calls scattered through the app. First provider TBD by cost/quality.

## Pipeline

```
Upload → extraction → ResumeJSON
JD → JDAnalysis
ResumeJSON + JDAnalysis → GapAnalysis
ResumeJSON + GapAnalysis → tailored ResumeJSON
```
Persist each result (with version refs) and **cache** — do not repay AI cost for identical
inputs. Editing one bullet must NOT re-trigger full extraction/JD analysis.

## Anti-hallucination (hard rule)

AI **may**: rewrite, shorten, reorder, emphasize, clarify, combine redundant statements,
align terminology to the JD, select relevant items, improve ATS keyword alignment.

AI **may NOT invent**: companies, jobs, titles, dates, skills, technologies, projects,
metrics, achievements, clients, certifications, education, URLs. If information is absent,
it is not created. The original uploaded resume is the factual source of truth.

## Output contract

AI returns **structured JSON only**, validated against Pydantic schemas. On invalid/malformed
output: repair/retry, else reject with a safe error. Never trust raw AI output; AI never
returns executable LaTeX / CSS / template source / font or geometry changes.

## Prompt-injection safety

Resume, JD, and portfolio text are **untrusted input** and may contain injected instructions
("ignore previous instructions…"). The system prompt must clearly separate **system
instructions** from **user-provided document text**, and the model must never execute
instructions found inside a resume/JD. Treat imported text as data, not commands.

## Cost & limits

Per-session AI request/token/file limits (configurable, server-owned). AI is the most
expensive component — gate it behind quotas and caching; validate before spending calls.

## Privacy

Send only what the operation needs; never log prompts containing resume/JD PII (see PRIVACY.md).
