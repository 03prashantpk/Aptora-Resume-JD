// BYOK endpoint — the ONLY surface that touches api_keys.
//   GET    → status only (hint of last 4 chars, never the key)
//   POST   → validate LIVE against NVIDIA, then encrypt + store
//   DELETE → remove (falls back to the plan budget immediately)
import type { APIRoute } from "astro";
import { getOwnerId } from "@/lib/session";
import { requireUser } from "@/lib/auth";
import { saveKey, getStatus, deleteKey, ApiKeyError } from "@/lib/keys";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const ownerId = await getOwnerId(ctx);
  const status = await getStatus(ownerId);
  return json(200, status);
};

export const POST: APIRoute = async (ctx) => {
  // BYOK is a verified-account feature: a key is a persistent credential, so we only
  // attach it to a real, verified account (never a guest cookie or an unverified login).
  const user = await requireUser(ctx);
  if (!user) {
    return json(401, { error: { code: "LOGIN_REQUIRED", message: "Sign in to connect your own API key — it stays with your account." } });
  }
  const ownerId = `user:${user.id}`;
  let body: unknown;
  try { body = await ctx.request.json(); } catch { return json(400, { error: { code: "BAD_REQUEST", message: "invalid JSON" } }); }
  const { key } = (body ?? {}) as { key?: string };
  if (typeof key !== "string" || !key.trim()) {
    return json(400, { error: { code: "EMPTY_KEY", message: "Paste your NVIDIA API key first." } });
  }
  try {
    const status = await saveKey(ownerId, key);
    return json(200, status);
  } catch (e) {
    if (e instanceof ApiKeyError) return json(e.status, { error: { code: "KEY_INVALID", message: e.message } });
    console.error("[byok] save failed:", e instanceof Error ? e.message : String(e));
    return json(500, { error: { code: "STORE_FAILED", message: "Couldn't save your key. Try again in a moment." } });
  }
};

export const DELETE: APIRoute = async (ctx) => {
  const ownerId = await getOwnerId(ctx);
  await deleteKey(ownerId);
  return json(200, { has: false, provider: "nvidia", hint: "", createdAt: null, lastUsedAt: null });
};

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
