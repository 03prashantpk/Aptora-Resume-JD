// Minimal classnames joiner (shadcn components expect `cn`).
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ── Plan label (single source of truth for the chip shown everywhere) ──────────
// Precedence mirrors peekBudget: own key → Pro → (paid credits) → Free.
// Returns { label, tone } so the popover, Usage page and anywhere else stay in sync.
export type PlanTone = "byok" | "pro" | "credit" | "free";
export interface PlanBadge { label: string; tone: PlanTone }

export function planBadge(snap: { hasOwnKey?: boolean; ownKey?: boolean; isPro?: boolean; credits?: number } | null | undefined): PlanBadge {
  const ownKey = !!(snap?.hasOwnKey ?? snap?.ownKey);
  if (ownKey) return { label: "BYOK", tone: "byok" };
  if (snap?.isPro) return { label: "Pro", tone: "pro" };
  if ((snap?.credits ?? 0) > 0) return { label: "Credits", tone: "credit" };
  return { label: "Free", tone: "free" };
}
