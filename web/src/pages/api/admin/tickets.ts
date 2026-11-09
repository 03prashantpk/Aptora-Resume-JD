// GET /api/admin/tickets — admin-only list of support tickets, newest first.
import type { APIRoute } from "astro";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

export const prerender = false;

interface Row {
  id: string;
  owner_id: string;
  email: string | null;
  subject: string | null;
  body: string | null;
  status: string;
  created_at: string;
}

export const GET: APIRoute = async (ctx) => {
  const admin = await requireAdmin(ctx);
  if (!admin) return json(403, { error: { code: "FORBIDDEN", message: "Admins only." } });

  const tickets = await query<Row>(
    "SELECT id, owner_id, email, subject, body, status, created_at FROM tickets ORDER BY created_at DESC LIMIT 500",
  );
  return json(200, { tickets });
};

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
