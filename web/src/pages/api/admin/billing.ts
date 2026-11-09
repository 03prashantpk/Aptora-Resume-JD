// GET /api/admin/billing — admin-only credit/Pro balances (who is paid), newest Pro first.
import type { APIRoute } from "astro";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

export const prerender = false;

interface Row {
  owner_id: string;
  credits: number;
  pro_until: string | null;
}

export const GET: APIRoute = async (ctx) => {
  const admin = await requireAdmin(ctx);
  if (!admin) return json(403, { error: { code: "FORBIDDEN", message: "Admins only." } });

  const rows = await query<Row>(
    `SELECT owner_id, credits, pro_until
       FROM credit_balance
      WHERE credits > 0 OR pro_until IS NOT NULL
      ORDER BY pro_until DESC NULLS LAST, credits DESC
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
