// Server-only client for the Python rendering engine.
// The browser NEVER calls the engine directly — it calls Astro routes, which use this.
import type { CompileResult, ResumeJSON, TemplateId } from "./types";

// Runtime env (Node SSR) so COMPILER_URL is read when the server RUNS, not baked at build.
const COMPILER_URL = (process.env.COMPILER_URL ?? import.meta.env.COMPILER_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
// Failover engine (HV-primary/HF-default deployments): if the primary engine (env
// COMPILER_URL) is unreachable or 5xx-failing, requests are retried against this.
// Set COMPILER_FALLBACK_URL (e.g. the Render engine) when COMPILER_URL points at a
// Hugging Face Space. Artifact fetches always go to the engine that COMPILED the doc
// (its RAM/disk cache is the only place the artifact exists) — see ENGINE_BY_DOC.
const COMPILER_FALLBACK_URL = (process.env.COMPILER_FALLBACK_URL ?? import.meta.env.COMPILER_FALLBACK_URL ?? "").replace(/\/$/, "");
const ENGINES = COMPILER_FALLBACK_URL ? [COMPILER_URL, COMPILER_FALLBACK_URL] : [COMPILER_URL];

// document_id -> engine base that compiled it. Artifacts (page images, PDF) only exist
// on the engine that compiled them, so every artifact fetch is routed there first.
const ENGINE_BY_DOC = new Map<string, string>();
const ENGINE_BY_DOC_MAX = 400;

function rememberEngine(documentId: string, base: string): void {
  if (!documentId) return;
  ENGINE_BY_DOC.set(documentId, base);
  if (ENGINE_BY_DOC.size > ENGINE_BY_DOC_MAX) {
    // Drop the oldest entries (FIFO map semantics via first key).
    for (const k of ENGINE_BY_DOC.keys()) {
      ENGINE_BY_DOC.delete(k);
      if (ENGINE_BY_DOC.size <= ENGINE_BY_DOC_MAX) break;
    }
  }
}

/** Engines to try for a document id: the compiler first, then any other engine. */
function enginesForDoc(documentId: string): string[] {
  const seen = ENGINE_BY_DOC.get(documentId);
  if (!seen) return ENGINES;
  return [seen, ...ENGINES.filter((e) => e !== seen)];
}

/** Try each engine in order: failover on network errors and 5xx (engine down),
 *  NOT on 4xx (that's a definite answer, retrying elsewhere would just be wrong). */
async function fetchEngine(
  path: string,
  init: RequestInit,
  timeoutMs = 150_000,
): Promise<{ res: Response; base: string } | null> {
  let last: { res: Response; base: string } | null = null;
  for (const base of ENGINES) {
    try {
      const res = await fetch(`${base}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status < 500) return { res, base };
      last = { res, base }; // engine down; remember and fall through
    } catch {
      // network error / timeout -> try the next engine
    }
  }
  return last; // may be a 5xx Response or null (all unreachable)
}

export interface CompileParams {
  template_id: TemplateId;
  resume: ResumeJSON;
  revision_id?: string;
  preview_dpi?: number;
  preview_format?: "webp" | "png";
}

export interface CompileError {
  code: string;
  message: string;
}

/** Compile + rasterize in one pass. Returns metadata; image/PDF bytes are fetched
 *  via pageImage()/pdf() using the returned document_id. */
export async function compile(
  params: CompileParams,
): Promise<{ ok: true; result: CompileResult } | { ok: false; error: CompileError; status: number }> {
  const hit = await fetchEngine("/api/compile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rasterize: true, ...params }),
  }, 180_000);
  if (!hit) return { ok: false, error: { code: "ENGINE_UNREACHABLE", message: "compile engine unavailable" }, status: 503 };
  const { res, base } = hit;
  if (!res.ok) {
    // Engine returns { error: { code, message } } on 422. Never surface raw logs.
    let error: CompileError = { code: "COMPILE_FAILED", message: "compile failed" };
    try {
      const body = (await res.json()) as { error?: CompileError };
      if (body?.error) error = body.error;
    } catch {
      /* ignore parse errors */
    }
    return { ok: false, error, status: res.status };
  }
  const result = (await res.json()) as CompileResult;
  if (result.document_id) rememberEngine(result.document_id, base);
  return { ok: true, result };
}

export interface CompileTexParams {
  latex: string;
  revision_id?: string;
  preview_dpi?: number;
  preview_format?: "webp" | "png";
}

/** Raw-LaTeX compile + rasterize in one pass (the Overleaf-style path). */
export async function compileTex(
  params: CompileTexParams,
): Promise<{ ok: true; result: CompileResult } | { ok: false; error: CompileError; status: number }> {
  const hit = await fetchEngine("/api/compile-tex", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rasterize: true, ...params }),
  }, 180_000);
  if (!hit) return { ok: false, error: { code: "ENGINE_UNREACHABLE", message: "compile engine unavailable" }, status: 503 };
  const { res, base } = hit;
  if (!res.ok) {
    let error: CompileError = { code: "COMPILE_FAILED", message: "compile failed" };
    try {
      const body = (await res.json()) as { error?: CompileError };
      if (body?.error) error = body.error;
    } catch {
      /* ignore */
    }
    return { ok: false, error, status: res.status };
  }
  const result = (await res.json()) as CompileResult;
  if (result.document_id) rememberEngine(result.document_id, base);
  return { ok: true, result };
}

/** The starter .tex the editor loads on first open. */
export async function defaultDocument(): Promise<string> {
  const hit = await fetchEngine("/api/default-document", { method: "GET" }, 30_000);
  if (!hit || !hit.res.ok) return "";
  const body = (await hit.res.json()) as { latex?: string };
  return body.latex ?? "";
}

/** Resume PDF (base64) -> plain text, via the engine's stateless extractor.
 *  Errors are surfaced as { ok:false, status, code } — callers decide UX. */
export async function extractText(
  fileBase64: string,
  maxChars = 60_000,
): Promise<{ ok: true; text: string; page_count: number; truncated?: boolean } | { ok: false; status: number; code: string }> {
  const hit = await fetchEngine("/api/extract-text", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_base64: fileBase64, max_chars: maxChars }),
  }, 90_000);
  if (!hit) return { ok: false, status: 0, code: "ENGINE_UNREACHABLE" };
  const res = hit.res;
  if (!res.ok) {
    let code = "EXTRACT_FAILED";
    try {
      const body = (await res.json()) as { error?: { code?: string } };
      if (body?.error?.code) code = body.error.code;
    } catch { /* ignore parse errors */ }
    return { ok: false, status: res.status, code };
  }
  const body = (await res.json()) as { text?: string; page_count?: number; truncated?: boolean };
  return { ok: true, text: body.text ?? "", page_count: body.page_count ?? 0, truncated: body.truncated };
}

/** ResumeJSON -> trusted template LaTeX (engine renderers own ALL layout). */
export async function renderTex(
  templateId: TemplateId,
  resume: ResumeJSON,
): Promise<{ ok: true; latex: string } | { ok: false; status: number; code: string }> {
  const hit = await fetchEngine("/api/render-tex", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ template_id: templateId, resume }),
  }, 30_000);
  if (!hit) return { ok: false, status: 0, code: "ENGINE_UNREACHABLE" };
  const res = hit.res;
  if (!res.ok) {
    let code = "RENDER_FAILED";
    try {
      const body = (await res.json()) as { error?: { code?: string } };
      if (body?.error?.code) code = body.error.code;
    } catch { /* ignore */ }
    return { ok: false, status: res.status, code };
  }
  const body = (await res.json()) as { latex?: string };
  return { ok: true, latex: body.latex ?? "" };
}


/** Fetch a preview page image (bytes) from the engine. Server-to-server.
 *  Routed to the engine that compiled the doc first (artifacts live only there),
 *  then any fallback engine (a content-addressed id can exist on both after a redeploy). */
export async function pageImage(documentId: string, page: number): Promise<Response> {
  for (const base of enginesForDoc(documentId)) {
    try {
      const res = await fetch(
        `${base}/api/documents/${encodeURIComponent(documentId)}/pages/${page}`,
        { signal: AbortSignal.timeout(30_000) },
      );
      if (res.ok) { rememberEngine(documentId, base); return res; }
      if (res.status !== 404 && res.status < 500) return res; // definite answer
    } catch { /* engine unreachable -> try next */ }
  }
  return new Response(JSON.stringify({ error: { code: "DOCUMENT_NOT_FOUND", message: "no engine currently holds this preview" } }), {
    status: 404, headers: { "content-type": "application/json" },
  });
}

/** Fetch the validated PDF bytes (export path). Only call after entitlement checks.
 *  Same engine-routing rule as pageImage(). */
export async function pdf(documentId: string): Promise<Response> {
  for (const base of enginesForDoc(documentId)) {
    try {
      const res = await fetch(
        `${base}/api/documents/${encodeURIComponent(documentId)}/pdf`,
        { signal: AbortSignal.timeout(60_000) },
      );
      if (res.ok) { rememberEngine(documentId, base); return res; }
      if (res.status !== 404 && res.status < 500) return res;
    } catch { /* engine unreachable -> try next */ }
  }
  return new Response(JSON.stringify({ error: { code: "DOCUMENT_NOT_FOUND", message: "no engine currently holds this document" } }), {
    status: 404, headers: { "content-type": "application/json" },
  });
}

export function engineHealthUrl(): string {
  return `${COMPILER_URL}/health`;
}
