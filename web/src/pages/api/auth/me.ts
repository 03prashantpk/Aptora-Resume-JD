// GET /api/auth/me — current auth state (for the UI to show logged-in vs anonymous).
import type { APIRoute } from "astro";
import { currentUserId } from "@/lib/auth";
import { query } from "@/lib/db";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const uid = currentUserId(ctx);
  if (!uid) return json({ authenticated: false });
  const rows = await query<{ email: string; name: string | null }>(
    "SELECT email, name FROM users WHERE id=$1",
    [uid],
  );
  const u = rows[0];
  if (!u) return json({ authenticated: false });
  return json({ authenticated: true, user: { email: u.email, name: u.name } });
};

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
