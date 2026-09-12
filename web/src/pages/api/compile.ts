// POST /api/compile — the browser's entry point to compilation.
// Astro validates minimally, then proxies to the Python engine server-to-server.
// The browser never talks to the engine directly and never receives PDF bytes here.
import type { APIRoute } from "astro";
import { compile } from "@/lib/compiler";
import type { ResumeJSON, TemplateId } from "@/lib/types";

export const prerender = false;

const TEMPLATES = new Set<TemplateId>(["T01", "T02", "T03"]);

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: { code: "BAD_REQUEST", message: "invalid JSON body" } }, 400);
  }

  const { template_id, resume, revision_id } = (body ?? {}) as {
    template_id?: string;
    resume?: ResumeJSON;
    revision_id?: string;
  };

  if (!template_id || !TEMPLATES.has(template_id as TemplateId)) {
    return json({ error: { code: "INVALID_TEMPLATE", message: "template_id must be T01, T02, or T03" } }, 400);
  }
  if (!resume || typeof resume.name !== "string" || resume.name.trim() === "") {
    return json({ error: { code: "INVALID_RESUME", message: "resume.name is required" } }, 400);
  }

  const out = await compile({ template_id: template_id as TemplateId, resume, revision_id });
  if (!out.ok) {
    return json({ error: out.error }, out.status);
  }
  // Return compile metadata only. Preview images are fetched via /api/preview/:id/pages/:n.
  return json(out.result, 200);
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
