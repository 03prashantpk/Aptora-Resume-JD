// GET /api/activity — recent activity for the CURRENT owner.
// Merges the real event sources into one timeline (newest first):
//   ai runs      — usage rows with ai_calls/exports deltas (per day: rolled up)
//   uploads      — resume / JD uploads (boundary events, not PII: filenames only)
//   exports      — generated PDFs
//   purchases    — PayU transactions
// Anonymous owners (guests) get their cookie-scoped history too.
import type { APIRoute } from "astro";
import { getOwnerId } from "@/lib/session";
import { ensureSchema, query } from "@/lib/db";

export const prerender = false;

interface Item {
  kind: "ai" | "export" | "upload" | "purchase";
  title: string;
  detail?: string;
  at: string;
}

export interface PaymentRow {
  id: string;             // txnid
  plan: "TOPUP" | "PRO";
  planName: string;
  amount: string;         // "1.00"
  status: string;         // success | failed | initiated | …
  payuMihpayid: string | null;
  email: string | null;
  at: string;             // created_at (ISO)
}

export const GET: APIRoute = async (ctx) => {
  await ensureSchema();
  const ownerId = await getOwnerId(ctx);
  const items: Item[] = [];
  const payments: PaymentRow[] = [];

  // pg returns timestamptz columns as JS Date objects (not strings) — every `at`
  // MUST be normalized to an ISO string or the newest-first sort would crash
  // ("b.at.localeCompare is not a function") and the page would 500.
  const iso = (v: Date | string | number): string => (v instanceof Date ? v : new Date(v)).toISOString();

  try {
    // Exports (PDFs generated).
    const exports = await query<{ title: string | null; page_count: number | null; created_at: Date | string }>(
      "SELECT title, page_count, created_at FROM exports WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 30",
      [ownerId],
    );
    for (const e of exports) {
      items.push({
        kind: "export",
        title: e.title || "Resume export",
        detail: e.page_count ? `${e.page_count} page${e.page_count === 1 ? "" : "s"} · PDF` : "PDF",
        at: iso(e.created_at),
      });
    }

    // Uploads (resume PDF / JD).
    const uploads = await query<{ kind: string; name: string | null; created_at: Date | string }>(
      "SELECT kind, name, created_at FROM uploads WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 30",
      [ownerId],
    );
    for (const up of uploads) {
      items.push({
        kind: "upload",
        title: up.kind === "jd" ? "Job description added" : "Resume uploaded",
        detail: up.name ?? undefined,
        at: iso(up.created_at),
      });
    }

    // Purchases (PayU) — full ledger for the payment-history view.
    const purchases = await query<{ id: string; plan_code: string; amount: string; status: string; payu_mihpayid: string | null; email: string | null; created_at: Date | string }>(
      "SELECT id, plan_code, amount, status, payu_mihpayid, email, created_at FROM purchases WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 50",
      [ownerId],
    );
    for (const p of purchases) {
      payments.push({
        id: p.id,
        plan: (p.plan_code === "PRO" ? "PRO" : "TOPUP"),
        planName: p.plan_code === "PRO" ? "Aptora Pro" : "Credit top-up",
        amount: p.amount,
        status: p.status,
        payuMihpayid: p.payu_mihpayid,
        email: p.email,
        at: iso(p.created_at),
      });
      items.push({
        kind: "purchase",
        title: p.plan_code === "PRO" ? "Pro plan purchase" : "Credit top-up",
        detail: `₹${p.amount} · ${p.status}`,
        at: iso(p.created_at),
      });
    }

    // AI activity: usage rows carry daily counters; show days with AI/exports used.
    // Own-key runs (BYOK) get their own clearly-labeled line — the usage record stays honest.
    const usageRows = await query<{ day: string; ai_calls: number; byok_ai_calls: number; exports_used: number }>(
      "SELECT day::text AS day, ai_calls, byok_ai_calls, exports_used FROM usage WHERE owner_id=$1 AND (ai_calls > 0 OR byok_ai_calls > 0 OR exports_used > 0) ORDER BY day DESC LIMIT 30",
      [ownerId],
    );
    for (const ur of usageRows) {
      if (ur.ai_calls > 0) {
        items.push({
          kind: "ai",
          title: `AI worked — ${ur.ai_calls} run${ur.ai_calls === 1 ? "" : "s"}`,
          detail: `tailor · analyze · edits on ${ur.day}`,
          at: `${ur.day}T23:59:00Z`,
        });
      }
      if (ur.byok_ai_calls > 0) {
        items.push({
          kind: "ai",
          title: `AI on your own key — ${ur.byok_ai_calls} run${ur.byok_ai_calls === 1 ? "" : "s"}`,
          detail: `billed to your NVIDIA key, not your plan · ${ur.day}`,
          at: `${ur.day}T23:58:00Z`,
        });
      }
    }
  } catch {
    // DB down → empty timeline, page renders its empty state.
  }

  items.sort((a, b) => b.at.localeCompare(a.at));
  return new Response(JSON.stringify({ items: items.slice(0, 60), payments }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
