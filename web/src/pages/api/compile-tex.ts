// POST /api/compile-tex — the browser's entry point for raw-LaTeX compilation.
// Astro proxies to the Python engine server-to-server; the browser never calls it directly.
// On success the document is recorded owner-scoped in the `documents` table (this both
// autosaves the working source and binds the compiled artifact for export access checks).
import type { APIRoute } from "astro";
import { compileTex } from "@/lib/compiler";
import { getOwnerId } from "@/lib/session";
import { upsertDocument } from "@/lib/db/repo";

export const prerender = false;
export const maxDuration = 60;

const MAX_LEN = 400_000; // mirror the engine's source cap
const SIXTY_FOUR_HEX = /^[0-9a-f]{64}$/;

export const POST: APIRoute = async (ctx) => {
  const { request } = ctx;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: { code: "BAD_REQUEST", message: "invalid JSON body" } }, 400);
  }

  const { latex, revision_id } = (body ?? {}) as { latex?: string; revision_id?: string };
  if (typeof latex !== "string" || latex.trim() === "") {
    return json({ error: { code: "EMPTY_SOURCE", message: "LaTeX source is required" } }, 400);
  }
  if (latex.length > MAX_LEN) {
    return json({ error: { code: "SOURCE_TOO_LARGE", message: "LaTeX source is too large" } }, 400);
  }

  const out = await compileTex({ latex, revision_id });
  if (!out.ok) return json({ error: out.error }, out.status);

  // Record the compiled document for this owner (cheap; same id converges to one row).
  const documentId = out.result.document_id ?? null;
  if (documentId && SIXTY_FOUR_HEX.test(documentId)) {
    try {
      const ownerId = await getOwnerId(ctx);
      await upsertDocument(ownerId, {
        id: documentId,
        latex,
        sha256: out.result.sha256 ?? null,
        page_count: out.result.page_count ?? null,
      });
    } catch { /* db may be down — compile result is still returned */ }
  }
  return json(out.result, 200);
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
