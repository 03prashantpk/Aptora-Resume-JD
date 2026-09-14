// GET /api/warm — wake/warm the rendering engine when a user actually opens the
// workspace. The browser calls THIS (same-origin) on mount; Astro pings the engine's
// /health server-to-server so COMPILER_URL is never exposed to the client. This
// defeats free-tier spin-down only when there's a real visitor — no cron, so it
// doesn't burn the monthly instance-hours when nobody is using the app.
import type { APIRoute } from "astro";
import { engineHealthUrl } from "@/lib/compiler";

export const prerender = false;

export const GET: APIRoute = async () => {
  // Fire-and-forget: don't block the response on the engine waking up (a cold
  // instance can take ~50s). We just kick it and return immediately.
  try {
    void fetch(engineHealthUrl(), { method: "GET" }).catch(() => {});
  } catch {
    /* never surface engine/infra errors to the client */
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 202,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
