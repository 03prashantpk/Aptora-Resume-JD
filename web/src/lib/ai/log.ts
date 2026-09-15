// Tiny server-side logger for AI HTTP routes. Prints a "request received" line and a
// result line to the terminal so you can correlate an incoming request with the
// underlying model call (which nvidia.ts logs with its own #id). NEVER logs resume/JD
// content or PII (rules 24/25) — only route, sizes, outcome, and timing.
// Silence with AI_LOG=0.
const env = (k: string): string | undefined => process.env[k] ?? (import.meta.env as Record<string, string | undefined>)[k];
const AI_LOG = (env("AI_LOG") ?? "1") !== "0";

let seq = 0;

export interface RouteLog {
  /** Log the outcome of the request. */
  done: (outcome: string) => void;
}

/** Log "route ← request (meta)" and return a handle to log the result with timing. */
export function logRoute(route: string, meta: Record<string, unknown> = {}): RouteLog {
  const id = ++seq;
  const t0 = Date.now();
  if (AI_LOG) {
    const bits = Object.entries(meta).map(([k, v]) => `${k}=${v}`).join(" ");
    console.log("[AI]", `R${id} ${route} ← request${bits ? " " + bits : ""}`);
  }
  return {
    done(outcome: string) {
      if (AI_LOG) console.log("[AI]", `R${id} ${route} → ${outcome} in ${Date.now() - t0}ms`);
    },
  };
}
