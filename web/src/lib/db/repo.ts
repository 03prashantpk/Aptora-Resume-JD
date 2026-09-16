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

export async function createUpload(ownerId: string, u: { kind: "resume_pdf" | "jd"; name?: string; content?: string; temp_url?: string }): Promise<string> {
  const id = randomUUID();
  // JD text is tiny and meant to be reused — keep it for 30 days. Resume PDFs stay on the
  // default short (~60 min) window since they live on the temp-file host anyway.
  const expiresInterval = u.kind === "jd" ? "30 days" : "60 minutes";
  await query(
    `INSERT INTO uploads (id, owner_id, kind, name, content, temp_url, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6, now() + ($7)::interval)`,
    [id, ownerId, u.kind, u.name ?? null, u.content ?? null, u.temp_url ?? null, expiresInterval],
  );
  return id;
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

// ---------- Cleanup (expired rows) ----------
export async function cleanupExpired(): Promise<void> {
  await query(`DELETE FROM uploads WHERE expires_at <= now()`);
  await query(`DELETE FROM exports WHERE expires_at <= now()`);
}
