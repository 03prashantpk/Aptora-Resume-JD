// GET /api/admin/payments — admin-only list of PayU purchases, newest first.
// The `purchases` table is the single source for both "transactions" and "payments".
import type { APIRoute } from "astro";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

export const prerender = false;

interface Row {
  id: string;
  owner_id: string;
  plan_code: string;
  amount: string; // NUMERIC comes back as a string from pg
  status: string;
  refund_amt: string | null;
  created_at: string;
  updated_at: string;
  email: string | null; // account email (falls back to the purchase's own email below)
  name: string | null;
}

export const GET: APIRoute = async (ctx) => {
  const admin = await requireAdmin(ctx);
  if (!admin) return json(403, { error: { code: "FORBIDDEN", message: "Admins only." } });

  // Prefer the account's name/email (joined on the prefixed owner_id); fall back to the
  // email captured on the purchase row itself (PayU callback) for anonymous buyers.
  const payments = await query<Row>(
    `SELECT p.id, p.owner_id, p.plan_code, p.amount, p.status, p.refund_amt,
            p.created_at, p.updated_at,
            COALESCE(u.email, p.email) AS email, u.name
       FROM purchases p
       LEFT JOIN users u ON 'user:'||u.id = p.owner_id
      ORDER BY p.created_at DESC
      LIMIT 500`,
  );
  return json(200, { payments });
};

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
