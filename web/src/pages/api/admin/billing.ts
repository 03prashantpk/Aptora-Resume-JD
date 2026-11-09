// GET /api/admin/billing — admin-only credit/Pro balances (who is paid), newest Pro first.
import type { APIRoute } from "astro";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

export const prerender = false;

interface Row {
  owner_id: string;
  credits: number;
  pro_until: string | null;
  email: string | null;
  name: string | null;
}

export const GET: APIRoute = async (ctx) => {
  const admin = await requireAdmin(ctx);
  if (!admin) return json(403, { error: { code: "FORBIDDEN", message: "Admins only." } });

  // Join to the account behind the prefixed owner_id so the UI shows name/email, not a UUID.
  const rows = await query<Row>(
    `SELECT c.owner_id, c.credits, c.pro_until, u.email, u.name
       FROM credit_balance c
       LEFT JOIN users u ON 'user:'||u.id = c.owner_id
      WHERE c.credits > 0 OR c.pro_until IS NOT NULL
      ORDER BY c.pro_until DESC NULLS LAST, c.credits DESC
      LIMIT 500`,
  );
  const now = Date.now();
  const balances = rows.map((r) => ({
    ...r,
    isPro: r.pro_until != null && new Date(r.pro_until).getTime() > now,
  }));
  return json(200, { balances });
};

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
