// GET /api/preview/:id/pages/:page — streams a preview PAGE IMAGE (WebP/PNG) from the
// engine to the browser. This is the free/preview path: the browser gets an image,
// never the PDF (project rules 7 / 11).
import type { APIRoute } from "astro";
import { pageImage } from "@/lib/compiler";

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  const page = Number(params.page);
  if (!id || !Number.isInteger(page) || page < 1) {
    return new Response(JSON.stringify({ error: { code: "BAD_REQUEST", message: "invalid id or page" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const upstream = await pageImage(id, page);
  if (!upstream.ok || !upstream.body) {
    return new Response(JSON.stringify({ error: { code: "PAGE_NOT_FOUND", message: "no such page" } }), {
      status: upstream.status || 404,
      headers: { "content-type": "application/json" },
    });
  }

  // Stream the image bytes straight through with the engine's content type.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "image/webp",
      // Preview images are per-revision and short-lived; don't let intermediaries cache.
      "cache-control": "no-store",
    },
  });
};
