// Minimal classnames joiner (shadcn components expect `cn`).
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
