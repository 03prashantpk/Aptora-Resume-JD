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
const NV_TEXT_FAST_VISION_MODEL = env("NV_TEXT_FAST_VISION_MODEL") ?? "meta/llama-3.2-90b-vision-instruct";

export const models = {
  text: NV_TEXT_FAST_MODEL,
  vision: NV_TEXT_FAST_VISION_MODEL,
};

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
  const res = await fetch(`${NV_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(buildPayload(messages, opts, false)),
    signal: opts.signal,
  });
  if (!res.ok) {
    throw new Error(`NVIDIA chat failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
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
  const res = await fetch(`${NV_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(buildPayload(messages, opts, true)),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`NVIDIA stream failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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
        if (data === "[DONE]") return;
        try {
          const json = JSON.parse(data) as {
            choices?: { delta?: { content?: string | null; reasoning_content?: string | null } }[];
          };
          const delta = json.choices?.[0]?.delta;
          if (!delta) continue;
          const chunk: StreamChunk = {};
          if (delta.reasoning_content) chunk.reasoning = delta.reasoning_content;
          if (delta.content) chunk.content = delta.content;
          if (chunk.reasoning || chunk.content) yield chunk;
        } catch {
          /* skip malformed frame */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
