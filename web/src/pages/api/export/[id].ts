// GET /api/export/:id — stream the validated PDF from the engine to the browser as a
// download. (Export entitlement/quota will gate this once the DB slice lands.)
import type { APIRoute } from "astro";
import { pdf } from "@/lib/compiler";
import { getOwnerId, getUsage, bumpUsage } from "@/lib/session";
import { uploadTemp } from "@/lib/hosting";
import { createExport } from "@/lib/db/repo";
import { currentUserId } from "@/lib/auth";
import { query } from "@/lib/db";
import { sendExportPdf } from "@/lib/email";

export const prerender = false;

/** The signed-in user's email + name, or null for anonymous sessions. */
async function loggedInUser(ctx: Parameters<APIRoute>[0]): Promise<{ email: string; name: string | null } | null> {
  const uid = currentUserId(ctx);
  if (!uid) return null;
  const rows = await query<{ email: string; name: string | null }>(
    "SELECT email, name FROM users WHERE id=$1", [uid],
  );
  return rows[0] ?? null;
}

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
  // 60-minute temp link — matches what the export email promises ("valid ~60 minutes").
  const tempUrl = await uploadTemp(buf, "aptora-resume.pdf", 3600);
  await createExport(ownerId, { title: "Resume", temp_url: tempUrl ?? undefined });

  // For logged-in users, also email the finished PDF as an attachment (best-effort,
  // fire-and-forget — never blocks or fails the download). Anonymous sessions have no
  // email, so they just get the download. The client reads X-Aptora-Emailed to toast.
  const user = await loggedInUser(ctx);
  let emailed = false;
  if (user?.email) {
    emailed = true; // optimistic hint; the actual send is fire-and-forget below
    void sendExportPdf(user.email, buf, {
      name: user.name ?? undefined,
      docTitle: "Your resume",
      filename: "aptora-resume.pdf",
      link: tempUrl ?? undefined, // temp download link (~60 min); template states the expiry
    });
  }

  return new Response(buf as BlobPart, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="aptora-resume.pdf"`,
      "cache-control": "no-store",
      "x-aptora-emailed": emailed ? "1" : "0",
    },
  });
};
