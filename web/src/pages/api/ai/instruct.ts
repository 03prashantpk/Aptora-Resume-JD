// POST /api/ai/instruct — Natural language manual update & layout optimization.
import type { APIRoute } from "astro";
import { instructLatex } from "@/lib/ai/instruct";
import { AIProviderError, withOwnerKey } from "@/lib/ai/provider";
import { getRawKey } from "@/lib/keys";
import { getOwnerId, peekBudget, settleSpend } from "@/lib/session";
import { logRoute } from "@/lib/ai/log";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const { request } = ctx;
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: { code: "BAD_REQUEST", message: "invalid JSON" } }, 400); }
  const { latex, instruction } = (body ?? {}) as { latex?: string; instruction?: string };

  if (typeof latex !== "string" || !latex.trim()) return json({ error: { code: "EMPTY_SOURCE", message: "Resume required" } }, 400);
  if (typeof instruction !== "string" || !instruction.trim()) return json({ error: { code: "EMPTY_INSTRUCTION", message: "Instruction required" } }, 400);
  if (latex.length > 400_000 || instruction.length > 5_000) return json({ error: { code: "INPUT_TOO_LARGE", message: "input too large" } }, 400);

  // Log the instruction VERB only (first ~40 chars) — a user command, not resume/PII.
  const rlog = logRoute("ai/instruct", { resume: `${latex.length}c`, cmd: JSON.stringify(instruction.slice(0, 40)) });
  const ownerId = await getOwnerId(ctx);
  const budget = await peekBudget(ownerId);
  if (!budget.allowed) {
    rlog.done("402 budget");
    return json({ error: { code: "BUDGET_EXHAUSTED", message: "Daily limit reached. Add credits, use your own free API key, or continue tomorrow." } }, 402);
  }
  const ownerKey = budget.ownKey ? await getRawKey(ownerId) : null;

  // Full run (including the SSE stream) executes under the owner's own key when set.
  const isPreset = /fit\s*(to\s*)?(1|one)\s*page|reduce\s*margin|standard\s*margin|font\s*size/i.test(instruction);
  const wantsStream = (body as { stream?: boolean }).stream === true && !isPreset;

  return withOwnerKey(ownerKey, async () => {
  try {
    if (!wantsStream) {
      const result = await instructLatex(latex, instruction);
      // Only count an AI run if one was performed (layout presets are free of charge!)
      if (!isPreset) {
        await settleSpend(ownerId, budget.source, "ai_calls");
      }
      rlog.done(isPreset ? "200 ok (preset, free)" : "200 ok");
      return json(result, 200);
    }

    // ── SSE mode: stage + live reasoning + final result ─────────────────────
    // Newline-delimited JSON frames (-streamingly-):
    //   {"type":"stage","stage":"ai|reason|compile|repair|reverted","detail":...}
    //   {"type":"reason","text":"<reasoning delta>"}
    //   {"type":"result", ...InstructResult}
    //   {"type":"error","code":"AI_UNAVAILABLE"}
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) => {
          controller.enqueue(enc.encode(JSON.stringify(obj) + "\n\n"));
        };
        try {
          const result = await instructLatex(latex, instruction, {
            onStage: (stage, detail) => send({ type: "stage", stage, detail }),
            onReason: (text) => send({ type: "reason", text }),
          });
          if (!isPreset) await settleSpend(ownerId, budget.source, "ai_calls");
          send({ type: "result", ...result });
          rlog.done("200 ok (stream)");
        } catch (se) {
          console.error("[AI] ai/instruct (stream) FAILED:", se instanceof Error ? `${se.name}: ${se.message}` : String(se));
          send({ type: "error", code: "AI_UNAVAILABLE", message: "Update is unavailable right now." });
          rlog.done("502 unavailable (stream)");
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" },
    });
  } catch (e) {
    // Log the real cause server-side (never returned to the client) so failures are
    // diagnosable instead of a blind 502.
    console.error("[AI] ai/instruct FAILED:", e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    if (e instanceof Error && e.stack) console.error(e.stack.split("\n").slice(1, 4).join("\n"));
    if (e instanceof AIProviderError && e.status === 401) {
      rlog.done("401 key-rejected");
      return json({ error: { code: "KEY_REJECTED", message: e.message } }, 401);
    }
    rlog.done("502 unavailable");
    return json({ error: { code: "AI_UNAVAILABLE", message: "Update is unavailable right now." } }, 502);
  }
  });
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
