// GET /api/admin/documents — admin-only per-owner document + export volume (abuse/usage signal).
import type { APIRoute } from "astro";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const admin = await requireAdmin(ctx);
  if (!admin) return json(403, { error: { code: "FORBIDDEN", message: "Admins only." } });

  // Two cheap aggregates, merged by owner_id in JS (avoids a FULL OUTER JOIN).
  const [docs, exports] = await Promise.all([
    query<{ owner_id: string; docs: number; last_at: string }>(
      `SELECT owner_id, COUNT(*)::int AS docs, MAX(created_at) AS last_at
         FROM documents GROUP BY owner_id ORDER BY docs DESC LIMIT 500`,
    ),
    query<{ owner_id: string; exports: number }>(
      `SELECT owner_id, COUNT(*)::int AS exports FROM exports GROUP BY owner_id`,
    ),
  ]);

  const exportsByOwner = new Map(exports.map((e) => [e.owner_id, e.exports]));
  const rows = docs.map((d) => ({
    owner_id: d.owner_id,
    docs: d.docs,
    exports: exportsByOwner.get(d.owner_id) ?? 0,
    last_at: d.last_at,
  }));
  return json(200, { rows });
};

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
