// Owner-scoped repository. EVERY read/write filters by owner_id (app-level row security).
// Never trust a client-supplied id; owner_id comes only from the server session.
import { randomUUID } from "node:crypto";
import { query } from "./index";

// ---------- Uploads (reusable resume PDFs + JD text, ~60 min) ----------
export interface UploadRow {
  id: string;
  kind: "resume_pdf" | "jd";
  name: string | null;
  content: string | null;
  temp_url: string | null;
  created_at: string;
  expires_at: string;
}

/** Create a reusable upload row (resume PDF temp link OR saved JD text). */
export async function createUpload(ownerId: string, u: { kind: "resume_pdf" | "jd"; name?: string; content?: string; temp_url?: string }): Promise<string> {
  const id = randomUUID();
  // Expiry windows are standardized to 60 min–48 h everywhere (product spec):
  // JD text stays reusable for 48 h; resume PDFs' temp URL is '48 hours' but the
  // parsed data on the row is permanent-ish (survives regardless).
  const expiresInterval = u.kind === "jd" ? "48 hours" : "48 hours";
  await query(
    `INSERT INTO uploads (id, owner_id, kind, name, content, temp_url, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6, now() + ($7)::interval)`,
    [id, ownerId, u.kind, u.name ?? null, u.content ?? null, u.temp_url ?? null, expiresInterval],
  );
  return id;
}

/** Attach ingestion results (extracted text + generated LaTeX) to a resume upload row.
 *  Owner-scoped: the update ignores rows the session doesn't own. */
export async function attachIngest(ownerId: string, id: string, d: { parsed_text?: string; latex?: string }): Promise<void> {
  if (!d.parsed_text && !d.latex) return;
  await query(
    `UPDATE uploads SET parsed_text = COALESCE($3, parsed_text), latex = COALESCE($4, latex)
     WHERE id=$1 AND owner_id=$2`,
    [id, ownerId, d.parsed_text ?? null, d.latex ?? null],
  );
  // A freshly parsed resume stays loadable for the full window regardless of the
  // temp-file host — the value lives on the row now.
  await query(
    `UPDATE uploads SET expires_at = GREATEST(expires_at, now() + interval '48 hours') WHERE id=$1 AND owner_id=$2`,
    [id, ownerId],
  );
}

/** The most recent ingest result (latex) for a given upload — used to re-load a resume. */
export async function getIngestedLatex(ownerId: string, id: string): Promise<string | null> {
  const rows = await query<{ latex: string | null }>(
    "SELECT latex FROM uploads WHERE id=$1 AND owner_id=$2 AND latex IS NOT NULL",
    [id, ownerId],
  );
  return rows[0]?.latex ?? null;
}

export async function listUploads(ownerId: string, kind?: "resume_pdf" | "jd"): Promise<UploadRow[]> {
  if (kind) {
    return query<UploadRow>(
      `SELECT id, kind, name, content, temp_url, created_at, expires_at FROM uploads
       WHERE owner_id=$1 AND kind=$2 AND expires_at > now() ORDER BY created_at DESC LIMIT 25`,
      [ownerId, kind],
    );
  }
  return query<UploadRow>(
    `SELECT id, kind, name, content, temp_url, created_at, expires_at FROM uploads
     WHERE owner_id=$1 AND expires_at > now() ORDER BY created_at DESC LIMIT 25`,
    [ownerId],
  );
}

export async function getUpload(ownerId: string, id: string): Promise<UploadRow | null> {
  const rows = await query<UploadRow>(
    `SELECT id, kind, name, content, temp_url, created_at, expires_at FROM uploads
     WHERE id=$1 AND owner_id=$2 AND expires_at > now()`,
    [id, ownerId],
  );
  return rows[0] ?? null;
}

export async function deleteUpload(ownerId: string, id: string): Promise<void> {
  await query(`DELETE FROM uploads WHERE id=$1 AND owner_id=$2`, [id, ownerId]);
}

// ---------- Exports (temporarily-hosted generated PDFs) ----------
export interface ExportRow {
  id: string;
  title: string | null;
  temp_url: string | null;
  page_count: number | null;
  sha256: string | null;
  created_at: string;
  expires_at: string;
}

export async function createExport(ownerId: string, e: { title?: string; temp_url?: string; page_count?: number; sha256?: string }): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO exports (id, owner_id, title, temp_url, page_count, sha256) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, ownerId, e.title ?? null, e.temp_url ?? null, e.page_count ?? null, e.sha256 ?? null],
  );
  return id;
}

export async function listExports(ownerId: string): Promise<ExportRow[]> {
  return query<ExportRow>(
    `SELECT id, title, temp_url, page_count, sha256, created_at, expires_at FROM exports
     WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 50`,
    [ownerId],
  );
}

export async function deleteExport(ownerId: string, id: string): Promise<void> {
  await query(`DELETE FROM exports WHERE id=$1 AND owner_id=$2`, [id, ownerId]);
}

// ---------- Documents (persistent working resume per owner) ----------
export interface DocumentRow {
  id: string;
  owner_id: string;
  title: string | null;
  latex: string;
  sha256: string | null;
  page_count: number | null;
  created_at: string;
}

/** Upsert the working document. `id` is the engine's content-addressed document id, so
 *  re-compiles of the same source converge on one row. First writer owns the row; later
 *  writes by the SAME owner refresh content, other owners are ignored (row security). */
export async function upsertDocument(
  ownerId: string,
  d: { id: string; latex: string; title?: string | null; sha256?: string | null; page_count?: number | null },
): Promise<void> {
  await query(
    `INSERT INTO documents (id, owner_id, title, latex, sha256, page_count)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET
       title = CASE WHEN documents.owner_id = EXCLUDED.owner_id THEN EXCLUDED.title ELSE documents.title END,
       latex = CASE WHEN documents.owner_id = EXCLUDED.owner_id THEN EXCLUDED.latex ELSE documents.latex END,
       sha256 = CASE WHEN documents.owner_id = EXCLUDED.owner_id THEN EXCLUDED.sha256 ELSE documents.sha256 END,
       page_count = CASE WHEN documents.owner_id = EXCLUDED.owner_id THEN EXCLUDED.page_count ELSE documents.page_count END,
       created_at = documents.created_at`,
    [d.id, ownerId, d.title ?? null, d.latex, d.sha256 ?? null, d.page_count ?? null],
  );
}

/** The owner's most recently created working document (restore-on-load). */
export async function getCurrentDocument(ownerId: string): Promise<DocumentRow | null> {
  const rows = await query<DocumentRow>(
    `SELECT id, owner_id, title, latex, sha256, page_count, created_at FROM documents
     WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [ownerId],
  );
  return rows[0] ?? null;
}

/** The owner_id of a compiled document row, or null when unknown (no row yet). */
export async function getDocumentOwner(id: string): Promise<string | null> {
  const rows = await query<{ owner_id: string }>(
    "SELECT owner_id FROM documents WHERE id=$1",
    [id],
  );
  return rows[0]?.owner_id ?? null;
}

// ---------- Ownership transfer (anonymous -> user on login/verify) ----------
/** Move ALL owner-scoped rows from an anonymous session to a user id. Called once after
 *  a successful login/verify so the user's work follows them across devices. Usage rows
 *  MERGE (conflict: same owner_id+day) so anti-abuse counters can't be reset by a login. */
export async function transferOwnership(oldOwner: string, newOwner: string): Promise<void> {
  if (oldOwner === newOwner) return;
  await query(
    `UPDATE documents SET owner_id=$2 WHERE owner_id=$1 AND NOT EXISTS
       (SELECT 1 FROM documents d2 WHERE d2.id = documents.id AND d2.owner_id=$2)`,
    [oldOwner, newOwner],
  );
  await query(`UPDATE uploads SET owner_id=$2 WHERE owner_id=$1`, [oldOwner, newOwner]);
  await query(
    `UPDATE exports SET owner_id=$2 WHERE owner_id=$1 AND NOT EXISTS
       (SELECT 1 FROM exports e2 WHERE e2.id = exports.id AND e2.owner_id=$2)`,
    [oldOwner, newOwner],
  );
  // Guest PAID state must follow the account too — a guest who bought credits and
  // then signs in keeps every purchase record, every credit, and any Pro time.
  // credit_balance is keyed one-row-per-owner: merge balances, never drop them;
  // Pro entitlement keeps whichever expiration is later.
  await query(`UPDATE purchases SET owner_id=$2 WHERE owner_id=$1`, [oldOwner, newOwner]);
  // BYOK: the guest's own API key becomes the account's key (their key, their usage).
  await query(
    `UPDATE api_keys SET owner_id=$2 WHERE owner_id=$1
       AND NOT EXISTS (SELECT 1 FROM api_keys k2 WHERE k2.owner_id=$2)`,
    [oldOwner, newOwner],
  );
  await query(`DELETE FROM api_keys WHERE owner_id = $1`, [oldOwner]); // key collision → account key wins (never orphan two rows per PK)
  await query(
    `UPDATE credit_balance dst
        SET credits = dst.credits + src.credits,
            pro_until = GREATEST(dst.pro_until, src.pro_until),
            updated_at = now()
       FROM credit_balance src
      WHERE src.owner_id = $1 AND dst.owner_id = $2`,
    [oldOwner, newOwner],
  );
  await query(
    `INSERT INTO credit_balance (owner_id, credits, pro_until, updated_at)
     SELECT $2, src.credits, src.pro_until, now() FROM credit_balance src WHERE src.owner_id = $1
       AND NOT EXISTS (SELECT 1 FROM credit_balance dst2 WHERE dst2.owner_id = $2)`,
    [oldOwner, newOwner],
  );
  await query(`DELETE FROM credit_balance WHERE owner_id = $1`, [oldOwner]);
  // Usage rows MERGE per (owner_id, day). NOTE: `UPDATE ... ON CONFLICT` is NOT valid
  // Postgres (ON CONFLICT is an INSERT-only clause) — doing it that way fails on a
  // same-day collision. Correct pattern: INSERT the guest's rows into the account with
  // ON CONFLICT DO UPDATE to sum the counters, then delete the guest's rows.
  await query(
    `INSERT INTO usage (owner_id, day, compiles, ai_calls, exports_used, byok_ai_calls)
       SELECT $2, day, compiles, ai_calls, exports_used, byok_ai_calls FROM usage WHERE owner_id=$1
     ON CONFLICT (owner_id, day) DO UPDATE SET
       compiles      = usage.compiles + EXCLUDED.compiles,
       ai_calls      = usage.ai_calls + EXCLUDED.ai_calls,
       exports_used  = usage.exports_used + EXCLUDED.exports_used,
       byok_ai_calls = usage.byok_ai_calls + EXCLUDED.byok_ai_calls`,
    [oldOwner, newOwner],
  );
  await query(`DELETE FROM usage WHERE owner_id=$1`, [oldOwner]);
}

// ---------- Cleanup (expired rows) ----------
export async function cleanupExpired(): Promise<void> {
  await query(`DELETE FROM uploads WHERE expires_at <= now()`);
  await query(`DELETE FROM exports WHERE expires_at <= now()`);
}
