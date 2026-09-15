// Server-ONLY NVIDIA NIM client. The API key is read from server env and never
// reaches the browser. Do NOT import this into a React island or any client code.
//
// Security notes (project rules 13, 24, 25):
//  - Key stays server-side (NV_API_KEY in web/.env).
//  - Treat resume/JD text as untrusted; callers must separate system instructions
//    from user document text (prompt-injection aware).
//  - Never log full prompts containing resume/JD/PII.

// Runtime env (Node SSR): read when the server RUNS so keys/models aren't baked at build.
const env = (k: string): string | undefined => process.env[k] ?? (import.meta.env as Record<string, string | undefined>)[k];
const NV_BASE_URL = (env("NV_BASE_URL") ?? "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");
const NV_API_KEY = env("NV_API_KEY");
const NV_TEXT_FAST_MODEL = env("NV_TEXT_FAST_MODEL") ?? "nvidia/nemotron-3-super-120b-a12b";
const NV_TEXT_ALT_MODEL = env("NV_TEXT_ALT_MODEL") ?? "google/gemma-4-31b-it";
const NV_TEXT_FAST_VISION_MODEL = env("NV_TEXT_FAST_VISION_MODEL") ?? "meta/llama-3.2-90b-vision-instruct";

export const models = {
  /** Adaptive reasoning model (Nemotron-3-Super). Good for analysis; uses thinking tokens. */
  text: NV_TEXT_FAST_MODEL,
  /** Standard instruction model (Gemma 4). Reliable for streaming; always outputs to `content`. */
  textAlt: NV_TEXT_ALT_MODEL,
  vision: NV_TEXT_FAST_VISION_MODEL,
};

// ---- Server-side AI logging (terminal only) --------------------------------
// Prints what the model is doing to the SERVER console: the request metadata, the
// live "thinking" (reasoning) trace, and the output size/timing. It NEVER prints the
// resume/JD prompt content or PII (rules 24/25) — only sizes, counts and the model's
// own reasoning/answer. Toggle with AI_LOG=0 to silence; AI_LOG_VERBOSE=1 to also echo
// the answer text. Reasoning traces are on by default because they're the "thinking".
const AI_LOG = (env("AI_LOG") ?? "1") !== "0";
const AI_LOG_VERBOSE = (env("AI_LOG_VERBOSE") ?? "0") === "1";
let _aiSeq = 0;

function aiLog(...args: unknown[]): void {
  if (AI_LOG) console.log("[AI]", ...args);
}

/** Rough prompt size (chars) without ever logging the content itself. */
function promptChars(messages: ChatMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (typeof m.content === "string") n += m.content.length;
    else for (const p of m.content) if (p.type === "text") n += p.text.length;
  }
  return n;
}

/** One-line request summary: id, model, message roles, size, limits, thinking flag. */
function logRequest(kind: "chat" | "stream", messages: ChatMessage[], opts: ChatOptions): number {
  const id = ++_aiSeq;
  const model = opts.model ?? models.text;
  const roles = messages.map((m) => m.role).join(">");
  aiLog(
    `#${id} ${kind} → model=${model} msgs=${messages.length} [${roles}] ` +
    `prompt≈${promptChars(messages)}c max_tokens=${opts.max_tokens ?? 4096} ` +
    `temp=${opts.temperature ?? 1} thinking=${opts.enableThinking ? "on" : "off"}`,
  );
  return id;
}

export type Role = "system" | "user" | "assistant";

// Text or multimodal content (vision).
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: Role;
  content: string | ContentPart[];
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  /** Enable Nemotron reasoning traces (chat_template_kwargs.enable_thinking). */
  enableThinking?: boolean;
  signal?: AbortSignal;
}

function assertKey(): string {
  if (!NV_API_KEY) {
    throw new Error("NV_API_KEY is not set (server env). AI is unavailable.");
  }
  return NV_API_KEY;
}

function buildPayload(messages: ChatMessage[], opts: ChatOptions, stream: boolean) {
  const payload: Record<string, unknown> = {
    model: opts.model ?? models.text,
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

/** Non-streaming chat completion. Returns the assistant text. */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const key = assertKey();
  const id = logRequest("chat", messages, opts);
  const t0 = Date.now();
  const res = await fetch(`${NV_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(buildPayload(messages, opts, false)),
    signal: opts.signal,
  });
  if (!res.ok) {
    aiLog(`#${id} chat ✗ HTTP ${res.status} in ${Date.now() - t0}ms`);
    throw new Error(`NVIDIA chat failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const out = data.choices?.[0]?.message?.content ?? "";
  const u = data.usage;
  aiLog(
    `#${id} chat ✓ ${Date.now() - t0}ms out≈${out.length}c` +
    (u ? ` tokens(p=${u.prompt_tokens ?? "?"} c=${u.completion_tokens ?? "?"} t=${u.total_tokens ?? "?"})` : ""),
  );
  if (AI_LOG_VERBOSE && out) aiLog(`#${id} answer:\n${out}`);
  return out;
}

export interface StreamChunk {
  /** Reasoning trace text (when enableThinking). */
  reasoning?: string;
  /** Visible content delta. */
  content?: string;
}

/** Streaming chat completion. Yields incremental chunks parsed from the SSE stream.
 *  Use from an Astro server route that re-streams to the browser. */
export async function* chatStream(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): AsyncGenerator<StreamChunk, void, unknown> {
  const key = assertKey();
  const id = logRequest("stream", messages, opts);
  const t0 = Date.now();
  const res = await fetch(`${NV_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(buildPayload(messages, opts, true)),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    aiLog(`#${id} stream ✗ HTTP ${res.status} in ${Date.now() - t0}ms`);
    throw new Error(`NVIDIA stream failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Live logging state: accumulate reasoning ("thinking") + content, flushing whole
  // lines to the terminal so you can watch the model work without per-token spam.
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

      // SSE frames are separated by blank lines; each carries `data: ...`.
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
    aiLog(`#${id} stream ✓ ${Date.now() - t0}ms thinking≈${thinkChars}c out≈${outChars}c`);
  }
}
