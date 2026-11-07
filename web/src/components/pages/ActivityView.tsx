// Activity page: payment history + a real timeline of what happened — AI runs,
// uploads, exports and PayU purchases, newest first. Guest histories are
// cookie-scoped; signed-in histories live with the account.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, BrainCircuit, FileDown, FileUp, IndianRupee, CreditCard,
  CircleCheck, CircleX, Clock3, Wallet,
} from "lucide-motion";

interface Item {
  kind: "ai" | "export" | "upload" | "purchase";
  title: string;
  detail?: string;
  at: string;
}

interface Payment {
  id: string;
  plan: "TOPUP" | "PRO";
  planName: string;
  amount: string;
  status: string;
  payuMihpayid: string | null;
  email: string | null;
  at: string;
}

const ICONS = { ai: BrainCircuit, export: FileDown, upload: FileUp, purchase: IndianRupee } as const;

const DAY_MS = 86_400_000;
function startOfDay(d: Date): number {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime();
}
function dayLabel(iso: string): string {
  const diff = startOfDay(new Date()) - startOfDay(new Date(iso));
  if (diff === 0) return "Today";
  if (diff === DAY_MS) return "Yesterday";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function paymentStatus(p: Payment): { cls: "ok" | "bad" | "wait"; label: string; Icon: typeof CircleCheck } {
  switch ((p.status || "").toLowerCase()) {
    case "success": return { cls: "ok", label: "Paid", Icon: CircleCheck };
    case "failed": return { cls: "bad", label: "Failed", Icon: CircleX };
    default: return { cls: "wait", label: p.status === "initiated" ? "Not completed" : "Pending", Icon: Clock3 };
  }
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function ActivityView() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "payments" | "others">("all");

  const reloadPayments = useCallback(async () => {
    try {
      const r = await fetch("/api/activity");
      if (r.ok) {
        const j = (await r.json()) as { items?: Item[]; payments?: Payment[] };
        if (j.payments) setPayments(j.payments);
      }
    } catch { /* keep previous */ }
  }, []);

  /** Ask our server → PayU verify API what really happened to an un-settled payment. */
  const reconcile = useCallback(async (txnid: string) => {
    if (checking) return;
    setChecking(txnid);
    try {
      const r = await fetch(`/api/payments/verify?txnid=${encodeURIComponent(txnid)}`);
      if (r.ok) {
        const j = (await r.json()) as { reconciled?: boolean; purchaseStatus?: string };
        if (j.reconciled) await reloadPayments();
      }
    } catch { /* leave the row as-is */ }
    finally { setChecking(null); }
  }, [checking, reloadPayments]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/activity");
        if (r.ok) {
          const j = (await r.json()) as { items: Item[]; payments?: Payment[] };
          setItems(j.items);
          setPayments(j.payments ?? []);
        } else setItems([]);
      } catch {
        setItems([]);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Timeline grouped by calendar day (Today / Yesterday / dates), newest within day.
  // Purchase rows are excluded — the Payments list already shows them; duplicates
  // ("Credit top-up" twice) read as a bug.
  const groups = useMemo(() => {
    if (!items) return [];
    const map = new Map<string, Item[]>();
    for (const it of items) {
      if (it.kind === "purchase") continue;
      const k = startOfDay(new Date(it.at)).toString();
      (map.get(k) ?? map.set(k, []).get(k)!).push(it);
    }
    return [...map.entries()]
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .map(([k, list]) => ({ label: dayLabel(list[0].at), items: list }));
  }, [items]);

  const paidPayments = payments.filter((p) => p.status === "success");
  const totalPaid = paidPayments.reduce((s, p) => s + Number(p.amount || 0), 0);

  const paymentsSection = (
    <section className="act-section" aria-label="Payment history">
      <div className="act-section-head">
        <h2><Wallet size={15} /> Payments</h2>
        {paidPayments.length > 0 && (
          <span className="act-total">₹{totalPaid} paid so far</span>
        )}
      </div>
      {payments.length === 0 ? (
        <div className="act-section-body act-empty-slim">
          <CreditCard size={16} />
          <p>No payments yet. Purchases made on this account appear here with their status and transaction reference.</p>
        </div>
      ) : (
        <div className="act-section-body pay-list">
          {payments.map((p) => {
            const st = paymentStatus(p);
            return (
              <div className="pay-row" key={p.id}>
                <span className={`activity-icon pay-ic ${st.cls}`}><IndianRupee size={15} /></span>
                <div className="pay-meta">
                  <strong>{p.planName}</strong>
                  <span className="muted">{fullDate(p.at)}{p.payuMihpayid ? ` · Ref ${p.payuMihpayid}` : ""}</span>
                </div>
                <div className="pay-right">
                  <span className={`pay-status ${st.cls}`}><st.Icon size={13} /> {st.label}</span>
                  <span className="pay-amount">₹{Number(p.amount).toFixed(2)}</span>
                  {(p.status || "").toLowerCase() === "initiated" && (
                    <button type="button" className="pay-verify-btn" disabled={checking !== null}
                      onClick={() => reconcile(p.id)}>
                      {checking === p.id ? "Checking…" : "Check status"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );

  const timelineSection = (
    <section className="act-section" aria-label="Recent activity">
      <div className="act-section-head"><h2><Activity size={15} /> Recent activity</h2></div>
      {groups.length === 0 ? (
        <div className="act-section-body act-empty-slim">
          <Activity size={16} />
          <p>No activity yet. Tailor a resume, export a PDF, or top up credits — it shows up here.</p>
        </div>
      ) : (
        <div className="act-section-body">
          {groups.map((g) => (
            <div className="act-day" key={g.label}>
              <div className="act-day-label">{g.label}</div>
              <ul className="activity-list">
                {g.items.map((it, i) => {
                  const Icon = ICONS[it.kind] ?? Activity;
                  return (
                    <li key={`${it.kind}-${it.at}-${i}`} className="activity-item">
                      <span className="activity-icon"><Icon size={15} /></span>
                      <div className="activity-meta">
                        <strong>{it.title}</strong>
                        {it.detail && <span className="muted">{it.detail}</span>}
                      </div>
                      <time className="activity-time muted">{timeOf(it.at)}</time>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className="view view-wide">
      <div className="view-head">
        <div>
          <p className="view-eyebrow">History</p>
          <h1>Activity</h1>
          <p>Payments and everything that happened in this workspace — newest first.</p>
        </div>
        <a className="view-cta" href="/">Open editor</a>
      </div>

      {/* Tab switch: All | Payments | Others */}
      <div className="act-tabs" role="tablist" aria-label="Activity sections">
        {([
          ["all", "All"],
          ["payments", "Payments"],
          ["others", "Others"],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key}
            className={`act-tab${tab === key ? " active" : ""}`}
            onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {!loaded ? (
        <div className="act-skeleton-col"><div className="act-skel" /><div className="act-skel" /><div className="act-skel" /></div>
      ) : (
        <>
          {tab !== "others" && paymentsSection}
          {tab !== "payments" && timelineSection}
        </>
      )}
    </div>
  );
}
