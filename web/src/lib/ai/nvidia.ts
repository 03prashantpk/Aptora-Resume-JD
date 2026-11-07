// Server-ONLY NVIDIA NIM client + the multi-provider ORCHESTRATOR for all AI text tasks.
// API keys are read from server env and NEVER reach the browser. Do NOT import into a
// React island or any client code.
//
// This module keeps the historical public surface (chat / chatStream / chatWithFallback /
// models / TEXT_MODEL_CHAIN + the shared types) so task code doesn't change. Internally:
//   - chatNvidia / chatNvidiaStream  -> the NVIDIA NIM (OpenAI-compatible) provider.
//   - Gemini lives in ./gemini_ai.ts.
//   - chat() / chatStream() DISPATCH by model name (models/… or gemini… -> Gemini).
//   - chatWithFallback() walks TEXT_MODEL_CHAIN (Gemini -> Lightning -> Super -> Gemma),
//     advancing only on transient failures.
//
// Security notes (rules 13, 24, 25): keys stay server-side, never logged; resume/JD text
// is untrusted DATA; full prompts/PII are never logged.
import {
  env, aiLog, AI_LOG_VERBOSE, nextAiId, promptChars,
  AIProviderError, isTransientStatus,
  type ChatMessage, type ChatOptions, type StreamChunk,
} from "./provider";
import { chatGemini, chatGeminiStream } from "./gemini_ai";

// Re-export shared types + helpers so existing imports from "./nvidia" keep working.
export type { ChatMessage, ChatOptions, StreamChunk, Role, ContentPart } from "./provider";
export { isTransientStatus } from "./provider";
// Back-compat: some callers import NvidiaError from here.
export { AIProviderError as NvidiaError } from "./provider";

// --- Google Gemini (default provider) — model ids only; client is gemini_ai.ts ---
const GOOGLE_FAST_MODAL = env("GOOGLE_FAST_MODAL") ?? "models/gemini-2.5-flash";

// --- NVIDIA NIM (fallback provider) ---
const NV_BASE_URL = (env("NV_BASE_URL") ?? "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");
const NV_API_KEY = env("NV_API_KEY");
const NV_LIGHTNING_FAST_MODEL = env("NV_LIGHTNING_FAST_MODEL") ?? "nvidia/nemotron-3.5-lightning-30b-a3b";
const NV_TEXT_FAST_MODEL = env("NV_TEXT_FAST_MODEL") ?? "nvidia/nemotron-3-super-120b-a12b";
const NV_TEXT_ALT_MODEL = env("NV_TEXT_ALT_MODEL") ?? "google/gemma-4-31b-it";
const NV_TEXT_FAST_VISION_MODEL = env("NV_TEXT_FAST_VISION_MODEL") ?? "meta/llama-3.2-90b-vision-instruct";
// Bench-added slots (tests/model-bench-*.cjs, 2026-11-07):
// ultra: winner for interactive edit/repair roles (2.6s TTFT, 224 TPS, streams reasoning).
// glimmer: honest but 90s TTFT — chain end only. minimax/glm/gemma: benched, not routed
// (minimax slow + repair compile FAIL once; glm ignores timeout/stalls platform-side).
const NV_ULTRA_MODEL = env("NV_ULTRA_MODEL") ?? "nvidia/nemotron-3-ultra-550b-a55b";
const NV_GLIMMER_MODEL = env("NV_GLIMMER_MODEL") ?? "meta/muse-glimmer-30b";

export const models = {
  /** DEFAULT for all text tasks: Google Gemini 2.5 Flash. */
  text: GOOGLE_FAST_MODAL,
  /** Fallback A: Nemotron-3.5 Lightning (fast NVIDIA model). */
  lightning: NV_LIGHTNING_FAST_MODEL,
  /** Fallback B: Nemotron-3 Super (adaptive reasoning). */
  fast: NV_TEXT_FAST_MODEL,
  /** Fallback C: Gemma 4 (standard instruction model). */
  textAlt: NV_TEXT_ALT_MODEL,
  vision: NV_TEXT_FAST_VISION_MODEL,
  /** Role-workhorse: ultra-fast repair/fixer with streamable reasoning. */
  ultra: NV_ULTRA_MODEL,
  /** Bench spare: last link in role chains. */
  glimmer: NV_GLIMMER_MODEL,
};

/** Ordered model chain for text tasks: Gemini → Lightning → Super → Gemma. De-duplicated. */
export const TEXT_MODEL_CHAIN: string[] = [...new Set([models.text, models.lightning, models.fast, models.textAlt])];

/** Which upstream serves a given model name. Gemini ids start with "models/" or "gemini". */
function providerFor(model: string): "gemini" | "nvidia" {
  return /^models\/|^gemini/i.test(model) ? "gemini" : "nvidia";
}

function assertKey(): string {
  if (!NV_API_KEY) throw new AIProviderError(401, "NV_API_KEY not set (server env)", "nvidia");
  return NV_API_KEY;
}

function buildPayload(messages: ChatMessage[], opts: ChatOptions, stream: boolean) {
  const payload: Record<string, unknown> = {
    model: opts.model ?? models.lightning,
    messages,
    temperature: opts.temperature ?? 1,
    top_p: opts.top_p ?? 0.95,
    max_tokens: opts.max_tokens ?? 4096,
    stream,
  };
  if (opts.frequency_penalty !== undefined) payload.frequency_penalty = opts.frequency_penalty;
  if (opts.presence_penalty !== undefined) payload.presence_penalty = opts.presence_penalty;
  if (opts.enableThinking) payload.chat_template_kwargs = { enable_thinking: true };
  return payload;
}

// ---- NVIDIA provider -------------------------------------------------------

/** Non-streaming NVIDIA NIM completion. Returns the assistant text. */
async function chatNvidia(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const key = assertKey();
  const id = nextAiId();
  const model = opts.model ?? models.lightning;
  const t0 = Date.now();
  aiLog(
    `#${id} nvidia → model=${model} msgs=${messages.length} prompt≈${promptChars(messages)}c ` +
    `max_tokens=${opts.max_tokens ?? 4096} temp=${opts.temperature ?? 1} thinking=${opts.enableThinking ? "on" : "off"}`,
  );
  const res = await fetch(`${NV_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(buildPayload(messages, opts, false)),
    signal: opts.signal,
  });
  if (!res.ok) {
    aiLog(`#${id} nvidia ✗ HTTP ${res.status} in ${Date.now() - t0}ms`);
    throw new AIProviderError(res.status, `NVIDIA chat failed: ${res.status}`, "nvidia");
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const out = data.choices?.[0]?.message?.content ?? "";
  const u = data.usage;
  aiLog(
    `#${id} nvidia ✓ ${Date.now() - t0}ms out≈${out.length}c` +
    (u ? ` tokens(p=${u.prompt_tokens ?? "?"} c=${u.completion_tokens ?? "?"} t=${u.total_tokens ?? "?"})` : ""),
  );
  if (AI_LOG_VERBOSE && out) aiLog(`#${id} answer:\n${out}`);
  // Bench finding: Lightning/Super can burn the ENTIRE token budget on thinking and
  // return zero content. Empty output must be a TRANSIENT failure so the model chain
  // advances instead of silently handing "" to a task.
  if (!out.trim()) {
    aiLog(`#${id} nvidia ✗ EMPTY output (thinking burned budget?) in ${Date.now() - t0}ms`);
    throw new AIProviderError(503, "NVIDIA returned empty output", "nvidia");
  }
  return out;
}

/** Streaming NVIDIA NIM completion. Yields incremental chunks parsed from the SSE stream. */
async function* chatNvidiaStream(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): AsyncGenerator<StreamChunk, void, unknown> {
  const key = assertKey();
  const id = nextAiId();
  const model = opts.model ?? models.lightning;
  const t0 = Date.now();
  aiLog(`#${id} nvidia-stream → model=${model} msgs=${messages.length} prompt≈${promptChars(messages)}c`);
  const res = await fetch(`${NV_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(buildPayload(messages, opts, true)),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    aiLog(`#${id} nvidia-stream ✗ HTTP ${res.status} in ${Date.now() - t0}ms`);
    throw new AIProviderError(res.status, `NVIDIA stream failed: ${res.status}`, "nvidia");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // Live logging state: flush whole reasoning lines to the terminal (no per-token spam).
  let thinkChars = 0, outChars = 0;
  let thinkBuf = "", firstThink = true, firstContent = true;
  const flushThink = (final = false) => {
    let nl: number;
    while ((nl = thinkBuf.indexOf("\n")) !== -1) {
      const l = thinkBuf.slice(0, nl); thinkBuf = thinkBuf.slice(nl + 1);
      if (l.trim()) aiLog(`#${id} 🧠 ${l.trim()}`);
    }
    if (final && thinkBuf.trim()) { aiLog(`#${id} 🧠 ${thinkBuf.trim()}`); thinkBuf = ""; }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, sep).trim();
        buffer = buffer.slice(sep + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") { flushThink(true); break; }
        try {
          const json = JSON.parse(data) as {
            choices?: { delta?: { content?: string | null; reasoning_content?: string | null } }[];
          };
          const delta = json.choices?.[0]?.delta;
          if (!delta) continue;
          const chunk: StreamChunk = {};
          if (delta.reasoning_content) chunk.reasoning = delta.reasoning_content;
          if (delta.content) chunk.content = delta.content;
          if (chunk.reasoning) {
            if (firstThink) { aiLog(`#${id} thinking…`); firstThink = false; }
            thinkChars += chunk.reasoning.length;
            thinkBuf += chunk.reasoning;
            flushThink();
          }
          if (chunk.content) {
            if (firstContent) {
              flushThink(true);
              aiLog(`#${id} writing answer… (first token ${Date.now() - t0}ms)`);
              firstContent = false;
            }
            outChars += chunk.content.length;
          }
          if (chunk.reasoning || chunk.content) yield chunk;
        } catch {
          /* skip malformed frame */
        }
      }
    }
  } finally {
    reader.releaseLock();
    flushThink(true);
    aiLog(`#${id} nvidia-stream ✓ ${Date.now() - t0}ms thinking≈${thinkChars}c out≈${outChars}c`);
  }
}

// ---- Orchestrator (public API) ---------------------------------------------

/** Non-streaming chat. Dispatches to Gemini or NVIDIA based on the model name. */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const model = opts.model ?? models.text;
  return providerFor(model) === "gemini"
    ? chatGemini(messages, { ...opts, model })
    : chatNvidia(messages, { ...opts, model });
}

/** Streaming chat. Dispatches to Gemini or NVIDIA based on the model name. */
export function chatStream(messages: ChatMessage[], opts: ChatOptions = {}): AsyncGenerator<StreamChunk, void, unknown> {
  const model = opts.model ?? models.text;
  return providerFor(model) === "gemini"
    ? chatGeminiStream(messages, { ...opts, model })
    : chatNvidiaStream(messages, { ...opts, model });
}

/** Non-streaming chat with automatic model fallback across providers. Tries each model in
 *  `chain` (default: Gemini → Lightning → Super → Gemma) and moves to the next only on a
 *  TRANSIENT failure (503/429/5xx/network). Hard errors (4xx) and success stop immediately.
 *  This is the default entry point for all text tasks. */
export async function chatWithFallback(
  messages: ChatMessage[],
  opts: ChatOptions = {},
  chain: string[] = TEXT_MODEL_CHAIN,
): Promise<string> {
  const TOTAL_MS = Number(process.env.STALL_TOTAL_MS ?? 210_000);
  let lastErr: unknown;
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    let totalTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Watchdog: a model that never answers must never park the chain (glm-style stalls).
      const stall = new Promise<never>((_, rej) => {
        totalTimer = setTimeout(() => rej(new AIProviderError(504, `model stalled: ${model}`, "nvidia")), TOTAL_MS);
      });
      const out = await Promise.race([chat(messages, { ...opts, model }), stall]);
      return out;
    } catch (e) {
      lastErr = e;
      const transient = e instanceof AIProviderError ? isTransientStatus(e.status) : true; // network error -> try next
      const hasNext = i < chain.length - 1;
      if (transient && hasNext) {
        aiLog(`fallback: "${model}" failed (${e instanceof AIProviderError ? e.status : "network"}) -> trying "${chain[i + 1]}"`);
        continue;
      }
      throw e; // hard error, or no models left
    } finally {
      if (totalTimer) clearTimeout(totalTimer);
    }
  }
  throw lastErr;
}

// ─── Role routing (bench: tests/model-bench-all.cjs / -new.cjs, 2026-11-07) ────
//
// Aptora's AI jobs measured on real workloads (heavy tailor rewrite, scoped symbol
// edits, compile-error repair — every LaTeX output compile-validated):
//
//   writer  Gemini 2.5 Flash   13.1s heavy rewrite, honest, no fabrication, 100 TPS
//           ultra              32.0s, honest  (fallback)
//           glimmer            95s, honest    (last resort — 90s TTFT)
//   fixer   ultra              5.4s total, 2.6s TTFT, 224 TPS, streams reasoning
//           Gemini             3.1s on same task           (fallback)
//   repair  ultra              12.3s, reasoning visible    (primary)
//           Gemini             6.3s but FAILED one repair  (fallback)
//
// Rejected by bench: minimax (86-128s + one failed repair), glm (115-236s, stalls),
// lightning/super as PRIMARY (often 0 output tokens — kept as generic fallbacks),
// gemma (145-185s), muse-glimmer as primary (90s TTFT).

export type AiRole = "writer" | "fixer" | "repair";

const ROLE_CHAINS: Record<AiRole, string[]> = {
  writer: [models.text, models.ultra, models.textAlt, models.glimmer],
  fixer: [models.ultra, models.text, models.textAlt, models.glimmer],
  repair: [models.ultra, models.text, models.textAlt, models.glimmer],
};

/** Role-routed chat: picks the bench-winning model chain for the job type. */
export function chatWithRole(
  messages: ChatMessage[],
  opts: ChatOptions = {},
  role: AiRole = "writer",
): Promise<string> {
  return chatWithFallback(messages, opts, ROLE_CHAINS[role]);
}

/** Role-routed STREAMING chat with live reasoning relay. Aggregates the stream into the
 *  final text; every reasoning delta is forwarded to `onReason` (drives the "thinking"
 *  badge). Empty stream output is treated as transient so the chain advances.
 *
 *  Anti-stall watchdog (bench: glm stalls forever, gemma 145-185s, muse-glimmer 90s TTFT):
 *  - INACTIVITY: no chunk of any kind for STALL_INACTIVITY_MS (default 45s) → abort →
 *    classified 504 → transient → the chain advances to the next model.
 *  - TOTAL wall clock: STALL_TOTAL_MS (default 210s) per model attempt.
 *  Never leaves a user parked on a dead model. */
export async function chatWithRoleStream(
  messages: ChatMessage[],
  opts: ChatOptions = {},
  role: AiRole = "writer",
  onReason?: (delta: string) => void,
): Promise<string> {
  const chain = ROLE_CHAINS[role];
  const INACTIVITY_MS = Number(process.env.STALL_INACTIVITY_MS ?? 45_000);
  const TOTAL_MS = Number(process.env.STALL_TOTAL_MS ?? 210_000);
  let lastErr: unknown;
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    const ac = new AbortController();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let totalTimer: ReturnType<typeof setTimeout> | undefined;
    let aborted = false;
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { aborted = true; ac.abort(); }, INACTIVITY_MS);
    };
    const armTotal = () => {
      totalTimer = setTimeout(() => { aborted = true; ac.abort(); }, TOTAL_MS);
    };
    try {
      armTotal();
      armIdle();
      let text = "";
      for await (const chunk of chatStream(messages, { ...opts, model, signal: ac.signal })) {
        armIdle(); // any chunk of any kind proves the model is alive
        if (chunk.reasoning) onReason?.(chunk.reasoning);
        if (chunk.content) text += chunk.content;
      }
      if (!text.trim()) {
        aiLog(`role[${role}] ${model} ✗ empty stream output`);
        throw new AIProviderError(503, "empty stream output", "nvidia");
      }
      return text;
    } catch (e) {
      lastErr = e;
      if (aborted) {
        // The watchdog, not the provider, pulled the plug — treat as transient stall.
        const reason = e instanceof Error && e.name === "AbortError"
          ? `stalled inactivity/timeout (${Math.round(INACTIVITY_MS / 1000)}s no tokens or ${Math.round(TOTAL_MS / 1000)}s cap)`
          : "stalled";
        aiLog(`role[${role}] "${model}" ⏱ watchdog: ${reason}`);
        lastErr = new AIProviderError(504, `model stalled: ${model}`, "nvidia");
      }
      const transient = e instanceof AIProviderError ? isTransientStatus(e.status) : true;
      if (transient && i < chain.length - 1) {
        aiLog(`role[${role}]: "${model}" failed transient (${e instanceof AIProviderError ? e.status : "network"}) -> trying "${chain[i + 1]}"`);
        continue;
      }
      throw e;
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      if (totalTimer) clearTimeout(totalTimer);
    }
  }
  throw lastErr;
}
