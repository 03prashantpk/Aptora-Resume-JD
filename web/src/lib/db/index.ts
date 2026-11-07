// Server-only Postgres data-access layer. Thin, no ORM (rule: swappable later).
// Degrades gracefully: if the DB is unreachable, calls resolve to safe defaults so the
// app never hard-crashes in local dev.
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL ?? (import.meta.env as Record<string, string>).DATABASE_URL;

let pool: pg.Pool | null = null;
let initTried = false;
let healthy = false;

function getPool(): pg.Pool | null {
  if (!DATABASE_URL) return null;
  if (!pool) {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 4_000 });
    pool.on("error", () => { healthy = false; });
  }
  return pool;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS anonymous_sessions (
  id          TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 days'
);
CREATE TABLE IF NOT EXISTS usage (
  owner_id     TEXT NOT NULL,
  day          DATE NOT NULL DEFAULT current_date,
  compiles     INTEGER NOT NULL DEFAULT 0,
  ai_calls     INTEGER NOT NULL DEFAULT 0,
  exports_used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, day)
);
CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  title       TEXT,
  latex       TEXT NOT NULL,
  sha256      TEXT,
  page_count  INTEGER,
  temp_url    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id);
-- Working-document restore lists the most recent per owner; created_at is kept on
-- upsert (repo.ts) so ordering is stable across re-compiles of the same source.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Reusable uploads (resume PDFs + JD text). Short-lived temp files (~60 min) so users
-- can pick a previously uploaded resume/JD instead of re-uploading.
-- NOTE: resume ingestion stores parsed_text + latex ON THE ROW, so the user's parsed
-- resume survives the temp-file expiry (see attachIngest in repo.ts).
CREATE TABLE IF NOT EXISTS uploads (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  kind        TEXT NOT NULL,            -- 'resume_pdf' | 'jd'
  name        TEXT,                     -- filename or short JD label
  content     TEXT,                     -- JD text (for kind='jd')
  temp_url    TEXT,                     -- tmpfiles URL (for kind='resume_pdf')
  parsed_text TEXT,                     -- resume text extracted by the engine
  latex       TEXT,                     -- generated LaTeX from the parsed resume
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + interval '60 minutes'
);
CREATE INDEX IF NOT EXISTS idx_uploads_owner ON uploads(owner_id);
-- Idempotent upgrade for rows created before parsing columns existed.
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS parsed_text TEXT;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS latex TEXT;

-- Export records: each generated PDF we host temporarily. Rows expire and are cleaned up.
CREATE TABLE IF NOT EXISTS exports (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  title       TEXT,
  temp_url    TEXT,
  page_count  INTEGER,
  sha256      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + interval '6 hours'
);
CREATE INDEX IF NOT EXISTS idx_exports_owner ON exports(owner_id);

-- Template upvotes. One row per (owner, template) enforces one vote each — the PK does
-- the de-duplication. Displayed count = a per-template base (seeded in code) + real rows.
-- owner_id is anonymous:<sid> today and user:<id> once auth lands (no schema change).
CREATE TABLE IF NOT EXISTS template_votes (
  template_id TEXT NOT NULL,
  owner_id    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, owner_id)
);
CREATE INDEX IF NOT EXISTS idx_template_votes_tid ON template_votes(template_id);

-- Accounts. Password is stored only as a scrypt hash (salt:hash). Email is unique and
-- lowercased. verified flips true after OTP confirmation.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  password_hash TEXT NOT NULL,
  verified      BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Short-lived OTP codes for signup email verification (and future flows). Code is stored
-- HASHED, never in plaintext. attempts caps brute force; expires_at bounds the window.
CREATE TABLE IF NOT EXISTS email_verifications (
  email       TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL,
  purpose     TEXT NOT NULL DEFAULT 'signup',
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + interval '15 minutes'
);

-- User-saved templates. Owner-scoped starting points a logged-in user stores from the
-- current editor document. owner_id is always user:<id> (anonymous sessions don't save
-- templates). Shown in the picker alongside the built-in catalog.
CREATE TABLE IF NOT EXISTS user_templates (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL,
  name          TEXT NOT NULL,
  latex         TEXT NOT NULL,
  -- Custom-template fields (optional). kind='snapshot' = a saved editor doc (latex only);
  -- kind='custom' = a reusable LaTeX template with {{PLACEHOLDER}} tokens. For custom
  -- templates, source_latex holds the ORIGINAL template verbatim (never overwritten) and
  -- mappings is an optional JSON map of field -> placeholder/value hints.
  kind          TEXT NOT NULL DEFAULT 'snapshot',
  source_latex  TEXT,
  mappings      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_templates_owner ON user_templates(owner_id);
-- Idempotent upgrades for databases created before the custom-template columns existed.
ALTER TABLE user_templates ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'snapshot';
ALTER TABLE user_templates ADD COLUMN IF NOT EXISTS source_latex TEXT;
ALTER TABLE user_templates ADD COLUMN IF NOT EXISTS mappings JSONB;

-- Contact-form submissions.
CREATE TABLE IF NOT EXISTS contact_messages (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  email       TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_created ON contact_messages(created_at);

-- Payments (PayU). One row per gateway transaction, statused through the lifecycle:
-- initiated -> success | failure | cancelled. udf2 carries the owner id verbatim.
-- amount is INR rupees as NUMERIC(10,2) to match PayU's "10.00" format.
CREATE TABLE IF NOT EXISTS purchases (
  id           TEXT PRIMARY KEY,              -- our txnid (APT...)
  owner_id     TEXT NOT NULL,
  plan_code    TEXT NOT NULL,                 -- 'TOPUP' | 'PRO'
  amount       NUMERIC(10,2) NOT NULL,        -- INR rupees, e.g. 10.00
  status       TEXT NOT NULL DEFAULT 'initiated',
  payu_mihpayid TEXT,
  payu_mode    TEXT,                          -- captured gateway mode / bank
  email        TEXT,
  refund_amt   NUMERIC(10,2),                 -- set when PayU reports a refund
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchases_owner ON purchases(owner_id);
CREATE INDEX IF NOT EXISTS idx_purchases_txn ON purchases(id);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS refund_amt NUMERIC(10,2);

-- Paid credit balance + Pro entitlement, one row per owner. Purchased credits are
-- consumed before the free daily budget; pro_until unlocks premium features.
CREATE TABLE IF NOT EXISTS credit_balance (
  owner_id     TEXT PRIMARY KEY,
  credits      INTEGER NOT NULL DEFAULT 0,
  pro_until    TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bring-your-own-key (BYOK): a user's own NVIDIA NIM key, encrypted at rest.
-- Key material NEVER leaves the server in plaintext and is never returned by any API.
CREATE TABLE IF NOT EXISTS api_keys (
  owner_id     TEXT PRIMARY KEY,              -- one key per owner (guest or account)
  provider     TEXT NOT NULL DEFAULT 'nvidia',
  key_enc      TEXT NOT NULL,                 -- AES-256-GCM ciphertext (iv:tag:data)
  key_hint     TEXT NOT NULL DEFAULT '',      -- last 4 chars, display only
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

-- Usage runs performed on the OWNER'S OWN key don't consume the plan budget; they're
-- recorded separately so Activity can show honest, clean usage records.
ALTER TABLE usage ADD COLUMN IF NOT EXISTS byok_ai_calls INTEGER NOT NULL DEFAULT 0;
`;

/** Ensure schema exists. Safe to call repeatedly; runs once. */
export async function ensureSchema(): Promise<boolean> {
  if (initTried) return healthy;
  initTried = true;
  const p = getPool();
  if (!p) return false;
  try {
    await p.query(SCHEMA);
    healthy = true;
  } catch {
    healthy = false;
  }
  return healthy;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string, params: unknown[] = [],
): Promise<T[]> {
  const p = getPool();
  if (!p) return [];
  try {
    await ensureSchema();
    const r = await p.query<T>(text, params);
    return r.rows;
  } catch {
    return [];
  }
}

export function dbConfigured(): boolean {
  return !!DATABASE_URL;
}
