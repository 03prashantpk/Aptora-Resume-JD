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
  email: string | null;
  name: string | null;
}

export const GET: APIRoute = async (ctx) => {
  const admin = await requireAdmin(ctx);
  if (!admin) return json(403, { error: { code: "FORBIDDEN", message: "Admins only." } });

  // Resolve the account behind each prefixed owner_id ('user:'||id) so the admin UI can
  // show a name/email instead of a raw UUID. Anonymous owners have no row -> null.
  const keys = await query<Row>(
    `SELECT k.owner_id, k.provider, k.created_at, u.email, u.name
       FROM api_keys k
       LEFT JOIN users u ON 'user:'||u.id = k.owner_id
      ORDER BY k.created_at DESC LIMIT 500`,
  );
  return json(200, { keys });
};

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
