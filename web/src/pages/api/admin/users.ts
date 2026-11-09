// GET /api/admin/users — admin-only roster with plan + lifetime usage.
// Plan/usage tables are keyed by the PREFIXED owner_id ('user:'||u.id), so every join
// below must use that prefix to map credits/BYOK/usage to the right account.
import type { APIRoute } from "astro";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

export const prerender = false;

interface Row {
  id: string;
  email: string;
  name: string | null;
  verified: boolean;
  is_admin: boolean;
  has_key: boolean;
  credits: number;
  pro_until: string | null;
  total_ai: number;
  total_exports: number;
}

export const GET: APIRoute = async (ctx) => {
  const admin = await requireAdmin(ctx);
  if (!admin) return json(403, { error: { code: "FORBIDDEN", message: "Admins only." } });

  const rows = await query<Row>(
    `SELECT u.id, u.email, u.name, u.verified, u.is_admin,
            (k.owner_id IS NOT NULL) AS has_key,
            COALESCE(c.credits,0) AS credits, c.pro_until,
            COALESCE(t.ai_calls,0) AS total_ai, COALESCE(t.exports_used,0) AS total_exports
       FROM users u
       LEFT JOIN api_keys k ON k.owner_id = 'user:'||u.id
       LEFT JOIN credit_balance c ON c.owner_id = 'user:'||u.id
       LEFT JOIN usage_totals t ON t.owner_id = 'user:'||u.id
      ORDER BY u.created_at DESC
      LIMIT 1000`,
  );

  const now = Date.now();
  const users = rows.map((r) => ({
    ...r,
    isPro: r.pro_until != null && new Date(r.pro_until).getTime() > now,
  }));
  return json(200, { users });
};

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
