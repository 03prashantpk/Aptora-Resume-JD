// BYOK (Bring-Your-Own-Key) store — server-ONLY.
//
// Users on build.nvidia.com can generate a free personal NIM key and paste it here;
// from then on THEIR key serves THEIR AI runs (no plan consumption). The key is:
//   - encrypted at rest (AES-256-GCM, key from BYOK_SECRET env),
//   - never logged, never returned by any API (only a last-4 hint),
//   - validated LIVE against the NVIDIA API before it is saved,
//   - migrated to the account automatically on sign-in (transferOwnership), like the
//     rest of the guest's work.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { query } from "./db";
import { env } from "./ai/provider";

// ── Envelope: iv(12) : tag(16) : ciphertext ───────────────────────────────────
function masterKey(): Buffer {
  const secret = env("BYOK_SECRET") ?? `aptora-byok::${env("PAYU_SALT2") ?? "aptora"}`;
  return createHash("sha256").update(secret).digest();
}

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", masterKey(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${iv.toString("hex")}:${c.getAuthTag().toString("hex")}:${data.toString("hex")}`;
}

function decrypt(enc: string): string {
  const [ivHex, tagHex, dataHex] = enc.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("corrupt api key envelope");
  const d = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivHex, "hex"));
  d.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([d.update(Buffer.from(dataHex, "hex")), d.final()]).toString("utf8");
}

export interface ApiKeyStatus {
  has: boolean;
  provider: "nvidia";
  hint: string;          // "…4f2a" display only
  createdAt: string | null;
  lastUsedAt: string | null;
}

function rowToStatus(r: { key_hint: string; created_at: Date | string; last_used_at: Date | string | null }): ApiKeyStatus {
  return {
    has: true,
    provider: "nvidia",
    hint: r.key_hint ? `•••• ${r.key_hint}` : "",
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : new Date(r.created_at).toISOString(),
    lastUsedAt: r.last_used_at ? (r.last_used_at instanceof Date ? r.last_used_at.toISOString() : new Date(r.last_used_at).toISOString()) : null,
  };
}

const NV_BASE_URL = (env("NV_BASE_URL") ?? "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");

export class ApiKeyError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** LIVE validation: prove the key works on the NVIDIA API before we store it.
 *  A wrong/partial key must never silently degrade every later AI run.
 *  NOTE: GET /v1/models is PUBLIC (returns 200 for any bearer) — the only honest
 *  check is a minimal 1-token chat completion with the provided key. */
export async function validateNvidiaKey(key: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${NV_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        model: env("NV_LIGHTNING_FAST_MODEL") ?? "nvidia/nemotron-3.5-lightning-30b-a3b",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ApiKeyError("Couldn't reach NVIDIA to verify the key — try again in a moment.", 504);
  }
  if (res.status === 401 || res.status === 403) {
    throw new ApiKeyError("NVIDIA rejected this key. Generate a fresh one at build.nvidia.com and paste it again.", 401);
  }
  if (res.status === 429) {
    throw new ApiKeyError("NVIDIA is rate-limiting this key right now. Try again in a minute.", 429);
  }
  if (!res.ok) {
    throw new ApiKeyError(`NVIDIA returned ${res.status} for this key. Double-check that it's a complete nvapi-… key.`, 400);
  }
}

/** Save (or replace) the owner's key after validation. */
export async function saveKey(ownerId: string, rawKey: string): Promise<ApiKeyStatus> {
  const key = rawKey.trim();
  if (key.length < 20 || key.length > 400) throw new ApiKeyError("That doesn't look like a valid NVIDIA API key.", 400);
  if (/[\r\n]/.test(key)) throw new ApiKeyError("Paste the key as a single line, without breaks.", 400);
  await validateNvidiaKey(key);
  const hint = key.slice(-4);
  await query(
    `INSERT INTO api_keys (owner_id, provider, key_enc, key_hint, created_at, last_used_at)
     VALUES ($1, 'nvidia', $2, $3, now(), NULL)
     ON CONFLICT (owner_id) DO UPDATE SET provider='nvidia', key_enc=EXCLUDED.key_enc,
       key_hint=EXCLUDED.key_hint, created_at=now(), last_used_at=NULL`,
    [ownerId, encrypt(key), hint],
  );
  return { has: true, provider: "nvidia", hint: `•••• ${hint}`, createdAt: new Date().toISOString(), lastUsedAt: null };
}

/** The DECRYPTED key for server-side use only. Returns null when the owner has none. */
export async function getRawKey(ownerId: string): Promise<string | null> {
  try {
    const rows = await query<{ key_enc: string; last_used_at: Date | string | null }>(
      "SELECT key_enc, last_used_at FROM api_keys WHERE owner_id=$1",
      [ownerId],
    );
    const r = rows[0];
    if (!r) return null;
    if (!r.last_used_at) {
      // Best-effort "first use" marker; never let a bookkeeping hiccup block a run.
      query("UPDATE api_keys SET last_used_at = now() WHERE owner_id=$1", [ownerId]).catch(() => {});
    }
    return decrypt(r.key_enc);
  } catch {
    return null; // DB hiccup → behave as "no own key" (plan budget applies)
  }
}

export async function getStatus(ownerId: string): Promise<ApiKeyStatus> {
  try {
    const rows = await query<{ key_hint: string; created_at: Date | string; last_used_at: Date | string | null }>(
      "SELECT key_hint, created_at, last_used_at FROM api_keys WHERE owner_id=$1",
      [ownerId],
    );
    const r = rows[0];
    if (!r) return { has: false, provider: "nvidia", hint: "", createdAt: null, lastUsedAt: null };
    return rowToStatus(r);
  } catch {
    return { has: false, provider: "nvidia", hint: "", createdAt: null, lastUsedAt: null };
  }
}

export async function deleteKey(ownerId: string): Promise<void> {
  await query("DELETE FROM api_keys WHERE owner_id=$1", [ownerId]);
}
