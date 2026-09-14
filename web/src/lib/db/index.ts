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

-- Reusable uploads (resume PDFs + JD text). Short-lived temp files (~60 min) so users
-- can pick a previously uploaded resume/JD instead of re-uploading.
CREATE TABLE IF NOT EXISTS uploads (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  kind        TEXT NOT NULL,            -- 'resume_pdf' | 'jd'
  name        TEXT,                     -- filename or short JD label
  content     TEXT,                     -- JD text (for kind='jd')
  temp_url    TEXT,                     -- tmpfiles URL (for kind='resume_pdf')
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + interval '60 minutes'
);
CREATE INDEX IF NOT EXISTS idx_uploads_owner ON uploads(owner_id);

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
