// POST /api/auth/logout — drop back to a fresh anonymous session.
import type { APIRoute } from "astro";
import { clearUserSession } from "@/lib/auth";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  clearUserSession(ctx);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
};
