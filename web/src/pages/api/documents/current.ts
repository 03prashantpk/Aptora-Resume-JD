// GET  /api/documents/current — the owner's most recent working document (restore on load).
// PUT  /api/documents/current — autosave: { latex, title?, documentId?, pageCount?, sha256? }.
//
// The documents table is the durable source of truth: content-addressed by the engine's
// document id, so re-compiles converge onto one row and the editor restores exactly where
// the user left off (no default-template reset, no forced recompile — the engine's
// content-addressed cache serves identical sources instantly).
import type { APIRoute } from "astro";
import { createHash } from "node:crypto";
import { getOwnerId } from "@/lib/session";
import { getCurrentDocument, upsertDocument } from "@/lib/db/repo";

export const prerender = false;
export const maxDuration = 15;

const MAX_LEN = 400_000;

export const GET: APIRoute = async (ctx) => {
  const ownerId = await getOwnerId(ctx);
  const row = await getCurrentDocument(ownerId);
  if (!row) return json({ latex: null }, 200);
  return json({ latex: row.latex, title: row.title, documentId: row.id, pdf_sha256: row.sha256, pageCount: row.page_count });
};

export const PUT: APIRoute = async (ctx) => {
  const ownerId = await getOwnerId(ctx);
  let body: unknown;
  try { body = await ctx.request.json(); } catch { return json({ error: { code: "BAD_REQUEST", message: "invalid JSON" } }, 400); }
  const { latex, title, documentId, pageCount, sha256 } = (body ?? {}) as {
    latex?: string; title?: string; documentId?: string; pageCount?: number; sha256?: string;
  };
  if (typeof latex !== "string" || latex.trim() === "") return json({ error: { code: "EMPTY", message: "latex required" } }, 400);
  if (latex.length > MAX_LEN) return json({ error: { code: "SOURCE_TOO_LARGE", message: "document too large to save" } }, 413);

  // The server derives the content id itself when the client doesn't have one yet —
  // a client-supplied documentId is only accepted as a HINT (key collision would make
  // another owner's row it's an id first-writer-wins; we never trust the client).
  const id = documentId && typeof documentId === "string" && /^[0-9a-f]{64}$/.test(documentId)
    ? documentId
    : createHash("sha256").update(latex).digest("hex");
  try {
    await upsertDocument(ownerId, {
      id, latex, title: sanitizeTitle(title), sha256: sha256 ?? null, page_count: pageCount ?? null,
    });
  } catch {
    return json({ error: { code: "SAVE_FAILED", message: "couldn't save right now" } }, 503);
  }
  return json({ saved: true, documentId: id });
};

function sanitizeTitle(t: string | undefined): string | undefined {
  if (typeof t !== "string") return undefined;
  const clean = t.replace(/[\u0000-\u001f]+/g, " ").trim();
  return clean ? clean.slice(0, 120) : undefined;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
