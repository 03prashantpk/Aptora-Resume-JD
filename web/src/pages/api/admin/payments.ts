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
}

export const GET: APIRoute = async (ctx) => {
  const admin = await requireAdmin(ctx);
  if (!admin) return json(403, { error: { code: "FORBIDDEN", message: "Admins only." } });

  const payments = await query<Row>(
    `SELECT id, owner_id, plan_code, amount, status, refund_amt, created_at, updated_at
       FROM purchases
      ORDER BY created_at DESC
      LIMIT 500`,
  );
  return json(200, { payments });
};

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
