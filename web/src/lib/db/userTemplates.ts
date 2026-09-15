// User-saved templates. Owner-scoped: a logged-in user stores the current editor
// document as a reusable starting point. EVERY read/write filters by owner_id
// (app-level row security). owner_id comes only from the server session, never the
// client. A small per-user cap keeps this bounded.
import { randomUUID } from "node:crypto";
import { query } from "./index";

export interface UserTemplate {
  id: string;
  name: string;
  latex: string;
  created_at: string;
}

const MAX_PER_USER = 20;

/** List a user's saved templates, newest first. */
export async function listUserTemplates(ownerId: string): Promise<UserTemplate[]> {
  return query<UserTemplate>(
    `SELECT id, name, latex, created_at
       FROM user_templates
      WHERE owner_id = $1
      ORDER BY created_at DESC`,
    [ownerId],
  );
}

/** Fetch a single owner-scoped template (used to load its LaTeX). */
export async function getUserTemplate(ownerId: string, id: string): Promise<UserTemplate | null> {
  const rows = await query<UserTemplate>(
    `SELECT id, name, latex, created_at FROM user_templates WHERE id = $1 AND owner_id = $2`,
    [id, ownerId],
  );
  return rows[0] ?? null;
}

export interface SaveResult {
  ok: boolean;
  reason?: "limit" | "empty";
  template?: UserTemplate;
}

/** Save the current document as a new owner-scoped template. */
export async function saveUserTemplate(ownerId: string, name: string, latex: string): Promise<SaveResult> {
  const trimmedName = (name || "").trim().slice(0, 80) || "Untitled template";
  if (!latex || !latex.trim()) return { ok: false, reason: "empty" };

  const countRows = await query<{ n: string }>(
    "SELECT COUNT(*)::int AS n FROM user_templates WHERE owner_id = $1",
    [ownerId],
  );
  if (Number(countRows[0]?.n ?? 0) >= MAX_PER_USER) return { ok: false, reason: "limit" };

  const id = randomUUID();
  const rows = await query<UserTemplate>(
    `INSERT INTO user_templates (id, owner_id, name, latex) VALUES ($1,$2,$3,$4)
     RETURNING id, name, latex, created_at`,
    [id, ownerId, trimmedName, latex],
  );
  return { ok: true, template: rows[0] };
}

/** Delete an owner-scoped template. Returns true if a row was removed. */
export async function deleteUserTemplate(ownerId: string, id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM user_templates WHERE id = $1 AND owner_id = $2 RETURNING id`,
    [id, ownerId],
  );
  return rows.length > 0;
}
