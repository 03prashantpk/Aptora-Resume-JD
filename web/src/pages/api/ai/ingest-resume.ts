// POST /api/ai/ingest-resume — resume PDF -> parsed ResumeJSON -> trusted template LaTeX.
//
// The web client sends the uploaded file (base64) + the upload row id. This route:
//   1. extracts text via the engine (stateless, no storage),
//   2. parses it into ResumeJSON with AI (facts only — see ingest.ts),
//   3. renders the LaTeX through the engine's trusted template renderers,
//   4. persists parsed_text + latex on the uploads row (so the user's data OUTLIVES
//      the short-lived tmpfiles URL),
//   5. returns { latex, career fields } for the editor to load + compile.
//
// Uses the free/AI usage gate exactly like tailor: 402 when out of budget; a credit is
// consumed only on a successful parse.
import type { APIRoute } from "astro";
import { extractText, renderTex } from "@/lib/compiler";
import { parseResumeText } from "@/lib/ai/ingest";
import type { TemplateId } from "@/lib/types";
import { getOwnerId, peekBudget, settleSpend } from "@/lib/session";
import { getRawKey } from "@/lib/keys";
import { withOwnerKey } from "@/lib/ai/provider";
import { createUpload, attachIngest } from "@/lib/db/repo";
import { logRoute } from "@/lib/ai/log";

export const prerender = false;
export const maxDuration = 60;

const MAX_B64_BYTES = 14 * 1024 * 1024; // ~10 MB raw PDF

export const POST: APIRoute = async (ctx) => {
  const { request } = ctx;
  let body: unknown;
  try { body = await request.json(); } catch { return bad("invalid JSON body"); }
  const { uploadId, fileBase64, name, templateId } = (body ?? {}) as {
    uploadId?: string; fileBase64?: string; name?: string; templateId?: string;
  };
  if (typeof fileBase64 !== "string" || fileBase64.length < 100) return bad("fileBase64 (resume PDF) is required");
  if (fileBase64.length > MAX_B64_BYTES) return tooLarge();

  const ownerId = await getOwnerId(ctx);
  const budget = await peekBudget(ownerId);
  if (!budget.allowed) {
    return json(402, { error: { code: "BUDGET_EXHAUSTED", message: "Daily limit reached. Add credits, use your own free API key, or continue tomorrow." } });
  }
  const ownerKey = budget.ownKey ? await getRawKey(ownerId) : null;

  return withOwnerKey(ownerKey, async () => {
  const tpl: TemplateId = ["T01", "T02", "T03", "T04", "T05", "T06"].includes(templateId ?? "")
    ? (templateId as TemplateId) : "T02";
  const rlog = logRoute("ai/ingest-resume", { b64: `${fileBase64.length}c`, template: tpl });

  // 1. Engine text extraction. Resume-sized cap (18k chars) — no point pulling 60k of
  // text from a PDF we're only going to clip before the parse anyway.
  const ex = await extractText(fileBase64, 18_000);
  if (!ex.ok) {
    rlog.done(`extract failed: ${ex.code} (${ex.status})`);
    const message = ex.code === "NOT_A_PDF" || ex.code === "PDF_UNREADABLE"
      ? "That file isn't a readable resume PDF. Try again with the original file."
      : ex.code === "ENGINE_UNREACHABLE"
        ? "Parsing is warming up — try again in a few seconds."
        : "Couldn't read that PDF. Try again.";
    return json(422, { error: { code: ex.code, message } });
  }
  const text = ex.text.trim();
  if (text.length < 40) {
    rlog.done("extract: no selectable text");
    return json(422, {
      error: { code: "NO_TEXT", message: "This PDF has no selectable text (likely a scan/photo). Upload a text-based resume PDF." },
    });
  }

  // 2. AI parse into ResumeJSON.
  let resume;
  try {
    resume = await parseResumeText(text);
  } catch {
    rlog.done("502 parse failed");
    return json(502, { error: { code: "AI_UNAVAILABLE", message: "Resume parsing is unavailable right now. Try again in a moment." } });
  }

  // 3. Trusted template render.
  const rt = await renderTex(tpl, resume);
  if (!rt.ok) {
    rlog.done(`render failed: ${rt.code} (${rt.status})`);
    return json(502, { error: { code: "RENDER_FAILED", message: "Couldn't render the template. Try again." } });
  }
  if (!rt.latex.trim()) {
    rlog.done("render failed: empty latex");
    return json(502, { error: { code: "RENDER_FAILED", message: "Couldn't render the template. Try again." } });
  }

  // Persist on the uploads row (parsed text + latex survive the temp-file expiry).
  try {
    const id = uploadId && typeof uploadId === "string" && /^[0-9a-f-]{36}$/i.test(uploadId)
      ? uploadId
      : await createUpload(ownerId, { kind: "resume_pdf", name: name ?? "resume.pdf" });
    await attachIngest(ownerId, id, { parsed_text: text, latex: rt.latex });
  } catch { /* rows are best-effort; ingestion result still delivered */ }

  await settleSpend(ownerId, budget.source, "ai_calls");
  rlog.done(`200 ok (${text.length}c text -> ${rt.latex.length}c tex)`);
  return json(200, {
    uploadId: uploadId ?? null,
    resume,
    latex: rt.latex,
    templateId: tpl,
    chars: text.length,
  });
  });
};

function bad(message: string): Response {
  return json(400, { error: { code: "BAD_REQUEST", message } });
}
function tooLarge(): Response {
  return json(413, { error: { code: "TOO_LARGE", message: "Resume PDF must be under 5 MB." } });
}
function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
