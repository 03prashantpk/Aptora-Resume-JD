// GET /api/admin/status — admin-only live ops health snapshot.
// Returns ONLY booleans + counts. Never exposes secret values, engine versions,
// filesystem paths, or any compiler internals (project rules 14 & 32).
import type { APIRoute } from "astro";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { payuConfigured } from "@/lib/payu";
import { engineHealthUrl } from "@/lib/compiler";

export const prerender = false;

const envVal = (k: string): string | undefined =>
  process.env[k] ?? (import.meta.env as Record<string, string | undefined>)[k];

async function count(sql: string): Promise<number> {
  try {
    const rows = await query<{ n: number }>(sql);
    return rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

export const GET: APIRoute = async (ctx) => {
  const admin = await requireAdmin(ctx);
  if (!admin) return json(403, { error: { code: "FORBIDDEN", message: "Admins only." } });

  // DB reachability — a trivial probe.
  let db = false;
  try {
    const r = await query<{ ok: number }>("SELECT 1 AS ok");
    db = r[0]?.ok === 1;
  } catch {
    db = false;
  }

  const [users, verifiedUsers, documents, exportsToday, openTickets] = await Promise.all([
    count("SELECT COUNT(*)::int AS n FROM users"),
    count("SELECT COUNT(*)::int AS n FROM users WHERE verified=true"),
    count("SELECT COUNT(*)::int AS n FROM documents"),
    count("SELECT COALESCE(SUM(exports_used),0)::int AS n FROM usage WHERE day = current_date"),
    count("SELECT COUNT(*)::int AS n FROM tickets WHERE status='open'"),
  ]);

  // Engine reachability — short-timeout GET to the health endpoint. Booleans only;
  // we do NOT surface the engine's response body, version, or URL to the client.
  let engineReachable = false;
  try {
    const res = await fetch(engineHealthUrl(), { signal: AbortSignal.timeout(4000) });
    engineReachable = res.ok;
  } catch {
    engineReachable = false;
  }

  return json(200, {
    db,
    engine: { reachable: engineReachable },
    config: {
      paymentsConfigured: payuConfigured(),
      emailConfigured: !!envVal("RESEND_API_KEY"),
    },
    counts: { users, verifiedUsers, documents, exportsToday, openTickets },
  });
};

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
