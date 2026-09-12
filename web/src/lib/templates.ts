// User-facing template catalog. Internal IDs (T01/T02/T03) are implementation detail
// and never shown as the primary label (rule 32). Users see Modern / Classic / Compact.
import type { TemplateId } from "./types";

export interface TemplateOption {
  id: TemplateId; // internal, not surfaced prominently
  name: string; // user-facing
  description: string;
  /** Quiet secondary metadata; a typeface hint, not the internal font package name. */
  typeface: string;
}

export const TEMPLATES: TemplateOption[] = [
  { id: "T01", name: "Modern", description: "Clean sans-serif, generous spacing.", typeface: "Sans" },
  { id: "T02", name: "Classic", description: "Traditional serif, formal tone.", typeface: "Serif" },
  { id: "T03", name: "Compact", description: "Dense serif, fits more on one page.", typeface: "Serif" },
];

const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

export function templateName(id: TemplateId): string {
  return BY_ID.get(id)?.name ?? "Modern";
}

export const DEFAULT_TEMPLATE: TemplateId = "T01";
