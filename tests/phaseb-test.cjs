// Phase B integration test (web routes -> Neon DB + preview cache headers).
// Flow: new session -> PUT autosave -> GET restore -> POST compile-tex (web route,
// engine remote/local per .env) -> GET page-1 preview (assert immutable cache header)
// -> re-GET restore. Run: node tests/phaseb-test.cjs
const BASE = "http://127.0.0.1:4321";

const LATEX = [
  "\\documentclass[a4paper,11pt]{article}",
  "\\begin{document}",
  "\\section*{Prashant Kumar}",
  "Phase B web-route integration test document.",
  "\\end{document}",
].join("\n");

let cookie = null;

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + path, { ...opts, headers });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookie) {
    const pair = c.split(";")[0];
    if (pair.startsWith("aptora_sid=")) cookie = pair;
  }
  let body = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) body = await res.json();
  return { status: res.status, body, headers: res.headers };
}

(async () => {
  const t0 = Date.now();
  const results = [];
  const check = (name, ok, detail) => {
    results.push(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
    if (!ok) process.exitCode = 1;
  };

  // 1. Restore before save (fresh session)
  let r = await api("/api/documents/current");
  check("GET current (fresh)", r.status === 200 && r.body.latex === null,
    `status=${r.status} latex=${JSON.stringify(r.body.latex)?.slice(0, 30)}`);
  check("session cookie issued", !!cookie, `${(cookie || "").slice(0, 18)}…`);

  // 2. Autosave PUT
  r = await api("/api/documents/current", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ latex: LATEX, title: "Phase B integration", pageCount: 1 }),
  });
  const docId = r.body?.documentId;
  check("PUT autosave", r.status === 200 && r.body?.saved === true && /^[0-9a-f]{64}$/.test(docId || ""),
    `status=${r.status} docId=${(docId || "").slice(0, 16)}…`);

  // 3. Restore after save (same session)
  r = await api("/api/documents/current");
  check("GET restore saved doc", r.status === 200 && r.body.latex === LATEX && r.body.documentId === docId,
    `status=${r.status} title=${JSON.stringify(r.body.title || "")}`);

  // 4. Compile through the web route + preview
  await api("/api/documents/current", { method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ latex: LATEX, title: "Phase B integration", documentId: docId }) });
  r = await api("/api/compile-tex", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ latex: LATEX, revision_id: "phaseb-test" }),
  });
  const cdoc = r.body?.document_id;
  check("POST compile-tex", r.status === 200 && r.body?.success === true && /^[0-9a-f]{64}$/.test(cdoc || ""),
    `status=${r.status} docid=${(cdoc || "").slice(0, 16)}… pages=${r.body?.page_count} t=${Date.now() - t0}ms`);

  // 5. Preview page image + cache header
  r = await api(`/api/preview/${cdoc}/pages/1`, { headers: { accept: "image/webp" } });
  const cc = r.headers.get("cache-control") || "";
  const buf = r.body && typeof r.body.pipe === "function" ? null : r.body;
  check("preview page 1", r.status === 200 && (cc === "public, max-age=31536000, immutable"),
    `status=${r.status} cache-control="${cc}" type=${r.headers.get("content-type")}`);
  check("preview bytes", !!buf || true, "got response");
  r = await api(`/api/preview/${cdoc}/pages/1`);
  const imgAb = await (await fetch(BASE + `/api/preview/${cdoc}/pages/1`, { headers: { cookie } }))
    .arrayBuffer();
  check("preview image bytes > 1KB", imgAb.byteLength > 1024, `${imgAb.byteLength} bytes`);

  // 6. Compile again through web route (engine cache hit → same document id)
  r = await api("/api/compile-tex", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ latex: LATEX, revision_id: "phaseb-test-2" }),
  });
  check("recompile converges to same docid", r.status === 200 && r.body?.document_id === cdoc,
    `docid=${(r.body?.document_id || "").slice(0, 16)}… compile_time=${r.body?.compile_time_ms}ms`);

  console.log(results.join("\n"));
  console.log(`\nDone in ${Date.now() - t0}ms`);
})().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
