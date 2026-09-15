// Shared contracts + helpers for the AI providers (Gemini, NVIDIA). Kept in one place so
// both provider modules import the SAME types with no circular dependency.
//
// Server-ONLY. Never import provider modules into client/React code — they read API keys
// from server env.

// Runtime env (Node SSR): read when the server RUNS so keys/models aren't baked at build.
export const env = (k: string): string | undefined =>
  process.env[k] ?? (import.meta.env as Record<string, string | undefined>)[k];

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
  /** Enable reasoning/thinking traces where the provider supports it. */
  enableThinking?: boolean;
  signal?: AbortSignal;
}

export interface StreamChunk {
  /** Reasoning trace text (thinking models). */
  reasoning?: string;
  /** Visible content delta. */
  content?: string;
}

/** Error carrying the upstream HTTP status so the orchestrator can retry/fall back on
 *  transient failures (e.g. 503 model-overloaded) vs. give up on hard errors (4xx). */
export class AIProviderError extends Error {
  status: number;
  provider: string;
  constructor(status: number, message: string, provider = "ai") {
    super(message);
    this.name = "AIProviderError";
    this.status = status;
    this.provider = provider;
  }
}

/** Back-compat alias: existing code imported `NvidiaError` from the old single-file client. */
export const NvidiaError = AIProviderError;

/** True for transient upstream failures worth retrying on a different model (overloaded,
 *  gateway, rate-limited). Not for 4xx (bad request) which would just fail again. */
export function isTransientStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

// ---- Shared server-side logging (terminal only) ----------------------------
// Prints what the model is doing to the SERVER console. NEVER prints resume/JD prompt
// content or PII (rules 24/25) — only sizes, counts, timings, and (optionally) the
// model's own reasoning/answer. AI_LOG=0 silences; AI_LOG_VERBOSE=1 echoes answers.
export const AI_LOG = (env("AI_LOG") ?? "1") !== "0";
export const AI_LOG_VERBOSE = (env("AI_LOG_VERBOSE") ?? "0") === "1";

export function aiLog(...args: unknown[]): void {
  if (AI_LOG) console.log("[AI]", ...args);
}

let _aiSeq = 0;
export function nextAiId(): number {
  return ++_aiSeq;
}

/** Rough prompt size (chars) without ever logging the content itself. */
export function promptChars(messages: ChatMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (typeof m.content === "string") n += m.content.length;
    else for (const p of m.content) if (p.type === "text") n += p.text.length;
  }
  return n;
}
