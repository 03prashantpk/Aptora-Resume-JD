// Lightweight, dependency-free toast system. A tiny global event bus + a Toaster
// island that any component can trigger via `toast("message", "success")`. On-brand,
// bottom-center, auto-dismiss, prefers-reduced-motion aware.
import { useEffect, useState } from "react";
import { Check, CircleAlert, Info } from "lucide-motion";

export type ToastKind = "success" | "error" | "info";
interface ToastItem { id: number; message: string; kind: ToastKind }

type Listener = (t: ToastItem) => void;
const listeners = new Set<Listener>();
let seq = 0;

/** Fire a toast from anywhere (client-side). */
export function toast(message: string, kind: ToastKind = "info"): void {
  const item: ToastItem = { id: ++seq, message, kind };
  listeners.forEach((l) => l(item));
}

export default function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast: Listener = (t) => {
      setItems((prev) => [...prev, t]);
      const ttl = t.kind === "error" ? 4500 : 3000;
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), ttl);
    };
    listeners.add(onToast);
    return () => { listeners.delete(onToast); };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span className="toast-icon">
            {t.kind === "success" ? <Check size={15} /> : t.kind === "error" ? <CircleAlert size={15} /> : <Info size={15} />}
          </span>
          <span className="toast-msg">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
