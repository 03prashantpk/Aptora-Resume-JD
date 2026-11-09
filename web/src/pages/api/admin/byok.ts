// GET /api/admin/byok — admin-only list of who connected their own API key.
// SECURITY: never selects key_enc or any key material — only provider + when connected.
import type { APIRoute } from "astro";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

export const prerender = false;

interface Row {
  owner_id: string;
  provider: string;
  created_at: string;
}

export const GET: APIRoute = async (ctx) => {
  const admin = await requireAdmin(ctx);
  if (!admin) return json(403, { error: { code: "FORBIDDEN", message: "Admins only." } });

  const keys = await query<Row>(
    `SELECT owner_id, provider, created_at FROM api_keys ORDER BY created_at DESC LIMIT 500`,
  );
  return json(200, { keys });
};

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
