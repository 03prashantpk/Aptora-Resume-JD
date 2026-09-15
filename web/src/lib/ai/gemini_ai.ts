// Server-ONLY Google Gemini provider. The API key is read from server env and NEVER
// reaches the browser. Do NOT import into client/React code.
//
// Exposes the SAME shapes as the NVIDIA client (ChatMessage[] in, text/StreamChunk out)
// so the orchestrator in nvidia.ts can treat both providers uniformly. Uses the Gemini
// REST API via fetch (no SDK dependency).
//
// Security: GOOGLE_AI_API_KEY stays server-side, sent only as the x-goog-api-key header,
// never logged, never returned to the client. Resume/JD text is untrusted DATA.
import {
  env, aiLog, AI_LOG_VERBOSE, nextAiId, promptChars,
  AIProviderError,
  type ChatMessage, type ChatOptions, type StreamChunk, type ContentPart,
} from "./provider";

const GOOGLE_AI_API_KEY = env("GOOGLE_AI_API_KEY");
const GOOGLE_BASE_URL = (env("GOOGLE_BASE_URL") ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");

/** Model id Gemini expects in the URL path: it wants "models/xyz". Accept either form. */
function toPath(model: string): string {
  return model.startsWith("models/") ? model : `models/${model}`;
}

function assertKey(): string {
  if (!GOOGLE_AI_API_KEY) throw new AIProviderError(401, "GOOGLE_AI_API_KEY not set (server env)", "gemini");
  return GOOGLE_AI_API_KEY;
}

// --- Message translation: our ChatMessage[] -> Gemini request ----------------
// Gemini uses `contents` with roles "user" | "model", a separate top-level
// `systemInstruction`, and multimodal "parts". We map: system -> systemInstruction,
// assistant -> model, user -> user.
function toGeminiParts(content: string | ContentPart[]): Record<string, unknown>[] {
  if (typeof content === "string") return [{ text: content }];
  return content.map((p) =>
    p.type === "text"
      ? { text: p.text }
      // data URLs -> inline_data; http(s) URLs are passed as text note (Gemini fetches
      // file_data only from its own file API, so we avoid remote URL fetches here).
      : dataUrlToInline(p.image_url.url) ?? { text: `[image] ${p.image_url.url}` },
  );
}

function dataUrlToInline(url: string): Record<string, unknown> | null {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(url);
  if (!m) return null;
  return { inline_data: { mime_type: m[1], data: m[2] } };
}

function buildBody(messages: ChatMessage[], opts: ChatOptions): Record<string, unknown> {
  const contents: Record<string, unknown>[] = [];
  const systemParts: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(...toGeminiParts(m.content));
    } else {
      contents.push({ role: m.role === "assistant" ? "model" : "user", parts: toGeminiParts(m.content) });
    }
  }
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: opts.temperature ?? 1,
      topP: opts.top_p ?? 0.95,
      maxOutputTokens: opts.max_tokens ?? 4096,
    },
  };
  if (systemParts.length) body.systemInstruction = { parts: systemParts };
  return body;
}

function extractText(data: unknown): string {
  const d = data as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const parts = d.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("");
}

/** Non-streaming Gemini completion. Returns the assistant text. */
export async function chatGemini(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const key = assertKey();
  const model = opts.model ?? "models/gemini-2.5-flash";
  const id = nextAiId();
  const t0 = Date.now();
  aiLog(
    `#${id} gemini → model=${model} msgs=${messages.length} ` +
    `prompt≈${promptChars(messages)}c max_tokens=${opts.max_tokens ?? 4096} temp=${opts.temperature ?? 1}`,
  );
  const res = await fetch(`${GOOGLE_BASE_URL}/${toPath(model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify(buildBody(messages, opts)),
    signal: opts.signal,
  });
  if (!res.ok) {
    aiLog(`#${id} gemini ✗ HTTP ${res.status} in ${Date.now() - t0}ms`);
    throw new AIProviderError(res.status, `Gemini failed: ${res.status}`, "gemini");
  }
  const data = await res.json();
  const out = extractText(data);
  const u = (data as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } }).usageMetadata;
  aiLog(
    `#${id} gemini ✓ ${Date.now() - t0}ms out≈${out.length}c` +
    (u ? ` tokens(p=${u.promptTokenCount ?? "?"} c=${u.candidatesTokenCount ?? "?"} t=${u.totalTokenCount ?? "?"})` : ""),
  );
  if (AI_LOG_VERBOSE && out) aiLog(`#${id} answer:\n${out}`);
  return out;
}

/** Streaming Gemini completion. Yields visible content deltas as they arrive.
 *  Uses the streamGenerateContent SSE endpoint (alt=sse). */
export async function* chatGeminiStream(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): AsyncGenerator<StreamChunk, void, unknown> {
  const key = assertKey();
  const model = opts.model ?? "models/gemini-2.5-flash";
  const id = nextAiId();
  const t0 = Date.now();
  aiLog(`#${id} gemini-stream → model=${model} msgs=${messages.length} prompt≈${promptChars(messages)}c`);
  const res = await fetch(`${GOOGLE_BASE_URL}/${toPath(model)}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(buildBody(messages, opts)),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    aiLog(`#${id} gemini-stream ✗ HTTP ${res.status} in ${Date.now() - t0}ms`);
    throw new AIProviderError(res.status, `Gemini stream failed: ${res.status}`, "gemini");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outChars = 0;
  let firstContent = true;

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
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const text = extractText(JSON.parse(payload));
          if (text) {
            if (firstContent) { aiLog(`#${id} gemini writing… (first token ${Date.now() - t0}ms)`); firstContent = false; }
            outChars += text.length;
            yield { content: text };
          }
        } catch {
          /* skip malformed frame */
        }
      }
    }
  } finally {
    reader.releaseLock();
    aiLog(`#${id} gemini-stream ✓ ${Date.now() - t0}ms out≈${outChars}c`);
  }
}
