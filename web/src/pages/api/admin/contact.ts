// GET /api/admin/contact — admin-only list of contact-form submissions, newest first.
import type { APIRoute } from "astro";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

export const prerender = false;

interface Row {
  id: string;
  name: string | null;
  email: string;
  message: string;
  created_at: string;
}

export const GET: APIRoute = async (ctx) => {
  const admin = await requireAdmin(ctx);
  if (!admin) return json(403, { error: { code: "FORBIDDEN", message: "Admins only." } });

  const messages = await query<Row>(
    "SELECT id, name, email, message, created_at FROM contact_messages ORDER BY created_at DESC LIMIT 500",
  );
  return json(200, { messages });
};

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
