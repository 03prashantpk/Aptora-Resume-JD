// GET /api/export/:id — stream the validated PDF from the engine to the browser as a
// download. (Export entitlement/quota will gate this once the DB slice lands.)
import type { APIRoute } from "astro";
import { pdf } from "@/lib/compiler";
import { getOwnerId, getUsage, bumpUsage } from "@/lib/session";
import { uploadTemp } from "@/lib/hosting";
import { createExport } from "@/lib/db/repo";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const id = ctx.params.id;
  if (!id) return new Response("bad request", { status: 400 });

  const ownerId = await getOwnerId(ctx);
  const usage = await getUsage(ownerId);
  if (!usage.allowed) {
    return new Response(JSON.stringify({ error: { code: "FREE_LIMIT", message: "You've used your free exports. Create an account for more." } }), {
      status: 402, headers: { "content-type": "application/json" },
    });
  }

  const upstream = await pdf(id);
  if (!upstream.ok || !upstream.body) {
    return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "document not found" } }), {
      status: upstream.status || 404, headers: { "content-type": "application/json" },
    });
  }

  // Buffer the PDF once: stream to the user AND host a temp copy + record it (6h expiry).
  const buf = new Uint8Array(await upstream.arrayBuffer());
  await bumpUsage(ownerId, "exports_used");
  const tempUrl = await uploadTemp(buf, "aptora-resume.pdf", 21_600);
  await createExport(ownerId, { title: "Resume", temp_url: tempUrl ?? undefined });

  return new Response(buf as BlobPart, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="aptora-resume.pdf"`,
      "cache-control": "no-store",
    },
  });
};
