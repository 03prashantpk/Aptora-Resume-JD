// Throwaway local test: engine extract-text -> Gemini ingest-parse -> validate JSON fields.
// (Phase A verification; NOT part of the app.)
const fs = require("fs");

const PDF = "C:\\Users\\Prash\\Downloads\\Prashant's\\RESUME\\Warner_Bros__Discovery_s_Software_Engineer_I.pdf";
const env = Object.fromEntries(
  fs.readFileSync("D:/Enally.in/JD-Resume/web/.env", "utf8")
    .split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

(async () => {
  const t0 = Date.now();
  // 1. engine extract
  const b64 = fs.readFileSync(PDF).toString("base64");
  const ex = await fetch("http://127.0.0.1:8000/api/extract-text", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_base64: b64 }),
  });
  const { text } = await ex.json();
  console.log(`[extract] ${Date.now() - t0}ms chars=${text.length}`);

  // 2. Gemini parse (mirrors gemini_ai.ts REST shape)
  const sys = `You are a resume parser. Parse the resume TEXT exactly as written into JSON. Facts verbatim, no invention. Omit unclear fields. No LaTeX in values. Links bare ('linkedin.com/in/x'). Output ONLY minified JSON: {"name","headline","contact":{"phone","email","linkedin","github","location"},"summary","experience":[{"title","org","dates","bullets":[]}],"extra_groups":[{"heading","bullets":[]}],"projects":[{"name","description"}],"skills":[{"label","items"}],"education":[{"text","dates"}],"certifications","soft_skills","portfolio_line"}`;
  const body = {
    system_instruction: { parts: [{ text: sys }] },
    contents: [{ role: "user", parts: [{ text: `<RESUME_TEXT>\n${text}\n</RESUME_TEXT>\n\nParse this resume into the JSON shape now.` }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
  };
  const t1 = Date.now();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${env["GOOGLE_FAST_MODAL"]}:generateContent?key=${env["GOOGLE_AI_API_KEY"]}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) { console.log("gemini HTTP", res.status, (await res.text()).slice(0, 300)); return; }
  const data = await res.json();
  const cand = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ?? "";
  console.log(`[gemini] ${Date.now() - t1}ms out=${cand.length}c finish=${data.candidates?.[0]?.finishReason}`);
  const m = cand.match(/\{[\s\S]*\}/);
  const o = m ? JSON.parse(m[0]) : null;
  if (!o) { console.log("NO JSON"); return; }
  // 3. assertions
  const contact = o.contact || {};
  const checks = {
    name: o.name, headline: o.headline,
    phone: contact.phone, email: contact.email, linkedin: contact.linkedin, github: contact.github,
    expCount: (o.experience || []).length, skillCount: (o.skills || []).length,
    eduCount: (o.education || []).length, projCount: (o.projects || []).length,
    firstBullet: (o.experience?.[0]?.bullets || [])[0]?.slice(0, 80),
    summary: (o.summary || "").slice(0, 80),
  };
  console.log(JSON.stringify(checks, null, 1));
  const ok = /prashant/i.test(o.name || "") && /91/.test(contact.phone || "") && /manwan/i.test(contact.email || "");
  console.log(ok ? "PARSE PASS" : "PARSE FAIL");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
