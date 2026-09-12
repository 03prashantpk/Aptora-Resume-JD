// GET  /api/uploads?kind=resume_pdf|jd  -> owner's reusable uploads (non-expired)
// POST /api/uploads  { kind, name?, content?, fileBase64? }  -> create (resume PDF to tmpfiles, or JD text)
import type { APIRoute } from "astro";
import { getOwnerId } from "@/lib/session";
import { createUpload, listUploads, cleanupExpired } from "@/lib/db/repo";
import { uploadTemp } from "@/lib/hosting";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  await cleanupExpired();
  const ownerId = await getOwnerId(ctx);
  const kind = ctx.url.searchParams.get("kind");
  const k = kind === "resume_pdf" || kind === "jd" ? kind : undefined;
  const rows = await listUploads(ownerId, k);
  return json({ uploads: rows });
};

export const POST: APIRoute = async (ctx) => {
  const ownerId = await getOwnerId(ctx);
  let body: unknown;
  try { body = await ctx.request.json(); } catch { return json({ error: { code: "BAD_REQUEST", message: "invalid JSON" } }, 400); }
  const { kind, name, content, fileBase64 } = (body ?? {}) as { kind?: string; name?: string; content?: string; fileBase64?: string };

  if (kind === "jd") {
    if (!content || !content.trim()) return json({ error: { code: "EMPTY", message: "JD text required" } }, 400);
    const id = await createUpload(ownerId, { kind: "jd", name: name || content.slice(0, 40), content });
    return json({ id }, 201);
  }
  if (kind === "resume_pdf") {
    if (!fileBase64) return json({ error: { code: "EMPTY", message: "file required" } }, 400);
    // Decode base64 -> bytes, host on tmpfiles (~60 min), store the temp URL.
    const bytes = Uint8Array.from(atob(fileBase64), (c) => c.charCodeAt(0));
    if (bytes.length > 10 * 1024 * 1024) return json({ error: { code: "TOO_LARGE", message: "max 10 MB" } }, 400);
    const url = await uploadTemp(bytes, name || "resume.pdf", 3600);
    const id = await createUpload(ownerId, { kind: "resume_pdf", name: name || "resume.pdf", temp_url: url ?? undefined });
    return json({ id, temp_url: url }, 201);
  }
  return json({ error: { code: "BAD_KIND", message: "kind must be jd or resume_pdf" } }, 400);
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
