// POST /api/ai/analysis-pdf  { analysis }  -> streams a PDF of the AI fit analysis.
// Renders the structured Analysis to a fixed LaTeX report and compiles it through the
// SAME engine as resumes (no browser PDF generation). Owner-gated like other AI calls.
import type { APIRoute } from "astro";
import { compileTex, pdf } from "@/lib/compiler";
import { analysisReportLatex } from "@/lib/ai/analysisReport";
import type { Analysis } from "@/lib/ai/analyze";
import { getOwnerId } from "@/lib/session";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  let body: unknown;
  try { body = await ctx.request.json(); } catch { return json({ error: { code: "BAD_REQUEST", message: "invalid JSON" } }, 400); }
  const { analysis } = (body ?? {}) as { analysis?: Analysis };
  if (!analysis || typeof analysis !== "object" || typeof analysis.targetRole !== "string") {
    return json({ error: { code: "BAD_REQUEST", message: "analysis is required" } }, 400);
  }

  // Owner session (keeps parity with other AI routes; no quota consumed — it's a render
  // of data the user already generated).
  await getOwnerId(ctx);

  const latex = analysisReportLatex(analysis);
  const out = await compileTex({ latex, revision_id: `analysis-${Date.now()}` });
  if (!out.ok || !out.result.document_id) {
    return json({ error: { code: "COMPILE_FAILED", message: "Couldn't render the analysis PDF." } }, 502);
  }

  const upstream = await pdf(out.result.document_id);
  if (!upstream.ok || !upstream.body) {
    return json({ error: { code: "NOT_FOUND", message: "analysis PDF not found" } }, upstream.status || 502);
  }
  const buf = new Uint8Array(await upstream.arrayBuffer());
  return new Response(buf as BlobPart, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="aptora-fit-analysis.pdf"`,
      "cache-control": "no-store",
    },
  });
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
