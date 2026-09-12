// POST /api/ai/tailor — AI rewrites the Resume LaTeX to fit the JD.
// The NVIDIA key stays server-side (this route never runs in the browser).
import type { APIRoute } from "astro";
import { tailorLatex } from "@/lib/ai/tailor";

export const prerender = false;

const MAX_LATEX = 400_000;
const MAX_JD = 20_000;

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: { code: "BAD_REQUEST", message: "invalid JSON body" } }, 400);
  }
  const { latex, jd } = (body ?? {}) as { latex?: string; jd?: string };
  if (typeof latex !== "string" || !latex.trim()) {
    return json({ error: { code: "EMPTY_SOURCE", message: "LaTeX source is required" } }, 400);
  }
  if (typeof jd !== "string" || !jd.trim()) {
    return json({ error: { code: "EMPTY_JD", message: "Job description is required" } }, 400);
  }
  if (latex.length > MAX_LATEX || jd.length > MAX_JD) {
    return json({ error: { code: "INPUT_TOO_LARGE", message: "Input is too large" } }, 400);
  }

  try {
    const tailored = await tailorLatex(latex, jd);
    if (!tailored) return json({ error: { code: "AI_EMPTY", message: "No result produced" } }, 502);
    return json({ latex: tailored }, 200);
  } catch {
    // Never leak provider errors / keys.
    return json({ error: { code: "AI_UNAVAILABLE", message: "Tailoring is unavailable right now." } }, 502);
  }
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
