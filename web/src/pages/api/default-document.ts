// GET /api/default-document — the starter .tex the editor loads on first open.
import type { APIRoute } from "astro";
import { defaultDocument } from "@/lib/compiler";

export const prerender = false;

export const GET: APIRoute = async () => {
  const latex = await defaultDocument();
  return new Response(JSON.stringify({ latex }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
