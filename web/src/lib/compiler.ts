// Server-only client for the Python rendering engine.
// The browser NEVER calls the engine directly — it calls Astro routes, which use this.
import type { CompileResult, ResumeJSON, TemplateId } from "./types";

// Runtime env (Node SSR) so COMPILER_URL is read when the server RUNS, not baked at build.
const COMPILER_URL = (process.env.COMPILER_URL ?? import.meta.env.COMPILER_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

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
  const res = await fetch(`${COMPILER_URL}/api/compile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rasterize: true, ...params }),
  });
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
  return { ok: true, result: (await res.json()) as CompileResult };
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
  const res = await fetch(`${COMPILER_URL}/api/compile-tex`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rasterize: true, ...params }),
  });
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
  return { ok: true, result: (await res.json()) as CompileResult };
}

/** The starter .tex the editor loads on first open. */
export async function defaultDocument(): Promise<string> {
  const res = await fetch(`${COMPILER_URL}/api/default-document`);
  if (!res.ok) return "";
  const body = (await res.json()) as { latex?: string };
  return body.latex ?? "";
}

/** Fetch a preview page image (bytes) from the engine. Server-to-server. */
export async function pageImage(documentId: string, page: number): Promise<Response> {
  return fetch(`${COMPILER_URL}/api/documents/${encodeURIComponent(documentId)}/pages/${page}`);
}

/** Fetch the validated PDF bytes (export path). Only call after entitlement checks. */
export async function pdf(documentId: string): Promise<Response> {
  return fetch(`${COMPILER_URL}/api/documents/${encodeURIComponent(documentId)}/pdf`);
}

export function engineHealthUrl(): string {
  return `${COMPILER_URL}/health`;
}
