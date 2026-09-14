// Template upvotes. Owner-scoped, one vote per (owner, template). The displayed count
// is a per-template BASE (seeded here to show genuity) + the real votes recorded in the
// DB. Base counts are stable constants (not random at runtime) so the numbers never
// jump around between requests. owner_id is the server session identity, never trusted
// from the client.
import type { TemplateId } from "../types";
import { query } from "./index";

// Seeded base upvotes (6k–24k). Overleaf = 18k and Classic = 20k per product spec; the
// rest are fixed, believable values in range. These are DISPLAY baselines only.
const BASE_UPVOTES: Record<TemplateId, number> = {
  T04: 18000, // Overleaf_base
  T02: 20000, // Classic
  T01: 15400, // Modern
  T03: 9200,  // Compact
  T05: 12600, // Elegant
  T06: 7300,  // Minimal
};

export const TEMPLATE_IDS = Object.keys(BASE_UPVOTES) as TemplateId[];

function isTemplateId(v: string): v is TemplateId {
  return v in BASE_UPVOTES;
}

export interface VoteState {
  /** template_id -> total displayed upvotes (base + real). */
  counts: Record<string, number>;
  /** template_ids the current owner has already upvoted. */
  voted: string[];
}

/** Real vote counts per template from the DB (owner-independent). */
async function realCounts(): Promise<Record<string, number>> {
  const rows = await query<{ template_id: string; n: string }>(
    "SELECT template_id, COUNT(*)::int AS n FROM template_votes GROUP BY template_id",
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.template_id] = Number(r.n);
  return out;
}

/** Full vote state for a given owner: displayed counts + which ones they voted for. */
export async function getVoteState(ownerId: string): Promise<VoteState> {
  const real = await realCounts();
  const counts: Record<string, number> = {};
  for (const tid of TEMPLATE_IDS) counts[tid] = BASE_UPVOTES[tid] + (real[tid] ?? 0);

  const votedRows = await query<{ template_id: string }>(
    "SELECT template_id FROM template_votes WHERE owner_id=$1",
    [ownerId],
  );
  return { counts, voted: votedRows.map((r) => r.template_id) };
}

export interface VoteResult {
  ok: boolean;
  alreadyVoted: boolean;
  count: number; // updated displayed count for this template
}

/** Record one upvote for (owner, template). Idempotent: a repeat vote is a no-op.
 *  Returns the updated displayed count. */
export async function addVote(ownerId: string, templateId: string): Promise<VoteResult> {
  if (!isTemplateId(templateId)) return { ok: false, alreadyVoted: false, count: 0 };

  // ON CONFLICT DO NOTHING makes the PK enforce one-vote-per-owner atomically.
  const inserted = await query<{ template_id: string }>(
    `INSERT INTO template_votes (template_id, owner_id) VALUES ($1, $2)
     ON CONFLICT (template_id, owner_id) DO NOTHING RETURNING template_id`,
    [templateId, ownerId],
  );
  const alreadyVoted = inserted.length === 0;

  const rows = await query<{ n: string }>(
    "SELECT COUNT(*)::int AS n FROM template_votes WHERE template_id=$1",
    [templateId],
  );
  const real = Number(rows[0]?.n ?? 0);
  return { ok: true, alreadyVoted, count: BASE_UPVOTES[templateId] + real };
}
