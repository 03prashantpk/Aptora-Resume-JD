// POST /api/ai/tailor-stream — streams tailored LaTeX as Server-Sent Events.
// The browser consumes deltas so the editor fills live while AI writes. Key stays server-side.
import type { APIRoute } from "astro";
import { tailorLatexStream } from "@/lib/ai/tailor";
import { getOwnerId, getUsage, bumpUsage } from "@/lib/session";

export const prerender = false;

const MAX_LATEX = 400_000;
const MAX_JD = 20_000;

export const POST: APIRoute = async (ctx) => {
  const { request } = ctx;
  let body: unknown;
  try { body = await request.json(); } catch { return bad("invalid JSON body"); }
  const { latex, jd, intensity } = (body ?? {}) as { latex?: string; jd?: string; intensity?: "light" | "balanced" | "aggressive" };
  if (typeof latex !== "string" || !latex.trim()) return bad("LaTeX source is required");
  if (typeof jd !== "string" || !jd.trim()) return bad("Job description is required");
  if (latex.length > MAX_LATEX || jd.length > MAX_JD) return bad("Input is too large");
  const level = intensity === "light" || intensity === "aggressive" ? intensity : "balanced";

  const ownerId = await getOwnerId(ctx);
  const usage = await getUsage(ownerId);
  if (!usage.allowed) {
    return new Response(JSON.stringify({ error: { code: "FREE_LIMIT", message: "You've used your free runs. Create an account for more." } }), {
      status: 402, headers: { "content-type": "application/json" },
    });
  }
  await bumpUsage(ownerId, "ai_calls");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        for await (const delta of tailorLatexStream(latex, jd, level)) {
          send("delta", { text: delta });
        }
        send("done", {});
      } catch {
        // Never leak provider errors / keys.
        send("error", { message: "Tailoring is unavailable right now." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
};

function bad(message: string): Response {
  return new Response(JSON.stringify({ error: { code: "BAD_REQUEST", message } }), {
    status: 400, headers: { "content-type": "application/json" },
  });
}
