// POST /api/ai/tailor — surgically tailors LaTeX to a job description.
//
// HOW IT WORKS (surgical approach):
//   Old: Regenerate the entire 1000+ line LaTeX document (hit token limit mid-doc → broken LaTeX)
//   New: Extract editable text regions → AI rewrites only those snippets as JSON →
//        stitch back into the untouched original template
//
// Plain mode returns JSON: { latex: string, changedCount: number }
// SSE mode (body.stream === true) emits newline-delimited JSON frames, same protocol
// as /api/ai/instruct:
//   {"type":"stage","stage":"reading|rewriting|patching","detail":...}
//   {"type":"reason","text":"<reasoning delta>"}      ← drives the bottom-center badge
//   {"type":"result","latex":...,"changedCount":...}
//   {"type":"error","code":"AI_UNAVAILABLE|BUDGET_EXHAUSTED"}
import type { APIRoute } from "astro";
import { surgicalTailor } from "@/lib/ai/surgical";
import { AIProviderError } from "@/lib/ai/provider";
import { getOwnerId, peekBudget, settleSpend } from "@/lib/session";
import { getRawKey } from "@/lib/keys";
import { withOwnerKey } from "@/lib/ai/provider";
import { logRoute } from "@/lib/ai/log";

export const prerender = false;

const MAX_LATEX = 400_000;
const MAX_JD = 20_000;

export const POST: APIRoute = async (ctx) => {
  const { request } = ctx;
  let body: unknown;
  try { body = await request.json(); } catch { return bad("invalid JSON body"); }
  const { latex, jd, intensity, stream } = (body ?? {}) as {
    latex?: string; jd?: string; intensity?: "light" | "balanced" | "aggressive"; stream?: boolean;
  };
  if (typeof latex !== "string" || !latex.trim()) return bad("LaTeX source is required");
  if (typeof jd !== "string" || !jd.trim()) return bad("Job description is required");
  if (latex.length > MAX_LATEX || jd.length > MAX_JD) return bad("Input is too large");
  const level = intensity === "light" || intensity === "aggressive" ? intensity : "balanced";

  const rlog = logRoute("ai/tailor", { resume: `${latex.length}c`, jd: `${jd.length}c`, intensity: level });
  const ownerId = await getOwnerId(ctx);
  const budget = await peekBudget(ownerId);
  if (!budget.allowed) {
    rlog.done("402 budget");
    return new Response(JSON.stringify({ error: { code: "BUDGET_EXHAUSTED", message: "Daily limit reached. Add credits, use your own free API key, or continue tomorrow." } }), {
      status: 402, headers: { "content-type": "application/json" },
    });
  }
  const ownerKey = budget.ownKey ? await getRawKey(ownerId) : null;

  return withOwnerKey(ownerKey, async () => {
  if (stream === true) {
    // ── SSE mode: stage + live reasoning + final result ───────────────────────
    const enc = new TextEncoder();
    const tailorStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) => {
          try { controller.enqueue(enc.encode(JSON.stringify(obj) + "\n\n")); } catch { /* client gone */ }
        };
        try {
          const result = await surgicalTailor(latex, jd, level, {
            onStage: (stage, detail) => send({ type: "stage", stage, detail }),
            onReason: (text) => send({ type: "reason", text }),
          });
          if (!result.changed.length && result.latex === latex) {
            send({ type: "error", code: "NO_CHANGES", message: "The AI returned no edits for this resume." });
            rlog.done("200 ok (stream, no changes)");
          } else {
            await settleSpend(ownerId, budget.source, "ai_calls");
            send({ type: "result", latex: result.latex, changedCount: result.changed.length });
            rlog.done(`200 ok (stream, ${result.changed.length} regions)`);
          }
        } catch (se) {
          console.error("[AI] ai/tailor (stream) FAILED:", se instanceof Error ? `${se.name}: ${se.message}` : String(se));
          send({ type: "error", code: "AI_UNAVAILABLE", message: "Tailoring is unavailable right now." });
          rlog.done("502 unavailable (stream)");
        } finally {
          controller.close();
        }
      },
    });
    return new Response(tailorStream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" },
    });
  }

  try {
    const result = await surgicalTailor(latex, jd, level);
    // Only record the run AFTER a successful AI call (a failed run never costs).
    await settleSpend(ownerId, budget.source, "ai_calls");
    rlog.done(`200 ok (${result.changed.length} regions changed)`);
    return new Response(
      JSON.stringify({ latex: result.latex, changedCount: result.changed.length }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  } catch (e) {
    rlog.done("502 unavailable");
    if (e instanceof AIProviderError && e.status === 401) {
      // Owner's own key was rejected mid-run.
      return new Response(JSON.stringify({ error: { code: "KEY_REJECTED", message: e.message } }), {
        status: 401, headers: { "content-type": "application/json" },
      });
    }
    // Never leak provider errors or keys.
    return new Response(
      JSON.stringify({ error: { code: "AI_UNAVAILABLE", message: "Tailoring is unavailable right now." } }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }
  });
};

function bad(message: string): Response {
  return new Response(JSON.stringify({ error: { code: "BAD_REQUEST", message } }), {
    status: 400, headers: { "content-type": "application/json" },
  });
}
