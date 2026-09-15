// User-saved templates. Owner-scoped: a logged-in user stores the current editor
// document as a reusable starting point, OR a reusable CUSTOM LaTeX template with
// {{PLACEHOLDER}} tokens. EVERY read/write filters by owner_id (app-level row security).
// owner_id comes only from the server session, never the client. A small per-user cap
// keeps this bounded.
import { randomUUID } from "node:crypto";
import { query } from "./index";

/** 'snapshot' = a saved editor document (latex only). 'custom' = a reusable LaTeX
 *  template with {{PLACEHOLDER}} tokens (source_latex is the original, never overwritten). */
export type TemplateKind = "snapshot" | "custom";

export interface UserTemplate {
  id: string;
  name: string;
  latex: string;
  kind: TemplateKind;
  /** For custom templates: the ORIGINAL template verbatim (preserved, never overwritten). */
  source_latex: string | null;
  /** For custom templates: optional field -> placeholder/value hints. */
  mappings: Record<string, string> | null;
  created_at: string;
}

const MAX_PER_USER = 20;

const SELECT_COLS = "id, name, latex, kind, source_latex, mappings, created_at";

/** List a user's saved templates, newest first. */
export async function listUserTemplates(ownerId: string): Promise<UserTemplate[]> {
  return query<UserTemplate>(
    `SELECT ${SELECT_COLS} FROM user_templates WHERE owner_id = $1 ORDER BY created_at DESC`,
    [ownerId],
  );
}

/** Fetch a single owner-scoped template (used to load its LaTeX). */
export async function getUserTemplate(ownerId: string, id: string): Promise<UserTemplate | null> {
  const rows = await query<UserTemplate>(
    `SELECT ${SELECT_COLS} FROM user_templates WHERE id = $1 AND owner_id = $2`,
    [id, ownerId],
  );
  return rows[0] ?? null;
}

export interface SaveResult {
  ok: boolean;
  reason?: "limit" | "empty";
  template?: UserTemplate;
}

async function atCap(ownerId: string): Promise<boolean> {
  const countRows = await query<{ n: string }>(
    "SELECT COUNT(*)::int AS n FROM user_templates WHERE owner_id = $1",
    [ownerId],
  );
  return Number(countRows[0]?.n ?? 0) >= MAX_PER_USER;
}

/** Save the current editor document as a new owner-scoped snapshot template. */
export async function saveUserTemplate(ownerId: string, name: string, latex: string): Promise<SaveResult> {
  const trimmedName = (name || "").trim().slice(0, 80) || "Untitled template";
  if (!latex || !latex.trim()) return { ok: false, reason: "empty" };
  if (await atCap(ownerId)) return { ok: false, reason: "limit" };

  const id = randomUUID();
  const rows = await query<UserTemplate>(
    `INSERT INTO user_templates (id, owner_id, name, latex, kind) VALUES ($1,$2,$3,$4,'snapshot')
     RETURNING ${SELECT_COLS}`,
    [id, ownerId, trimmedName, latex],
  );
  return { ok: true, template: rows[0] };
}

/** Save a reusable CUSTOM LaTeX template (with {{PLACEHOLDER}} tokens). The provided
 *  sourceLatex is stored verbatim in BOTH latex and source_latex; source_latex is the
 *  preserved original and is never overwritten by later renders/edits. */
export async function saveCustomTemplate(
  ownerId: string,
  name: string,
  sourceLatex: string,
  mappings?: Record<string, string>,
): Promise<SaveResult> {
  const trimmedName = (name || "").trim().slice(0, 80) || "Custom template";
  if (!sourceLatex || !sourceLatex.trim()) return { ok: false, reason: "empty" };
  if (await atCap(ownerId)) return { ok: false, reason: "limit" };

  const id = randomUUID();
  const rows = await query<UserTemplate>(
    `INSERT INTO user_templates (id, owner_id, name, latex, kind, source_latex, mappings)
     VALUES ($1,$2,$3,$4,'custom',$5,$6)
     RETURNING ${SELECT_COLS}`,
    [id, ownerId, trimmedName, sourceLatex, sourceLatex, mappings ? JSON.stringify(mappings) : null],
  );
  return { ok: true, template: rows[0] };
}

/** Update only the mappings of a custom template. Never touches source_latex. */
export async function updateTemplateMappings(
  ownerId: string,
  id: string,
  mappings: Record<string, string>,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE user_templates SET mappings = $3
       WHERE id = $1 AND owner_id = $2 AND kind = 'custom' RETURNING id`,
    [id, ownerId, JSON.stringify(mappings)],
  );
  return rows.length > 0;
}

/** Delete an owner-scoped template. Returns true if a row was removed. */
export async function deleteUserTemplate(ownerId: string, id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM user_templates WHERE id = $1 AND owner_id = $2 RETURNING id`,
    [id, ownerId],
  );
  return rows.length > 0;
}
