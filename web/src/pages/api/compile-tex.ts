// POST /api/compile-tex — the browser's entry point for raw-LaTeX compilation.
// Astro proxies to the Python engine server-to-server; the browser never calls it directly.
import type { APIRoute } from "astro";
import { compileTex } from "@/lib/compiler";

export const prerender = false;

const MAX_LEN = 400_000; // mirror the engine's source cap

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: { code: "BAD_REQUEST", message: "invalid JSON body" } }, 400);
  }

  const { latex, revision_id } = (body ?? {}) as { latex?: string; revision_id?: string };
  if (typeof latex !== "string" || latex.trim() === "") {
    return json({ error: { code: "EMPTY_SOURCE", message: "LaTeX source is required" } }, 400);
  }
  if (latex.length > MAX_LEN) {
    return json({ error: { code: "SOURCE_TOO_LARGE", message: "LaTeX source is too large" } }, 400);
  }

  const out = await compileTex({ latex, revision_id });
  if (!out.ok) return json({ error: out.error }, out.status);
  return json(out.result, 200);
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
