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

export const OVERLEAF_BASE_TEX = `%-------------------------
% Resume in LaTeX
% Author: Sushant Kumar
%-------------------------

\\documentclass[letterpaper,11pt]{article}

\\usepackage{latexsym}
\\usepackage[empty]{fullpage}
\\usepackage{titlesec}
\\usepackage{marvosym}
\\usepackage[usenames,dvipsnames]{color}
\\usepackage{verbatim}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\usepackage{fancyhdr}
\\usepackage[english]{babel}
\\usepackage{tabularx}
\\usepackage{fontawesome5}
\\ifdefined\\pdfgentounicode
  \\input{glyphtounicode}
  \\pdfgentounicode=1
\\fi

\\pagestyle{fancy}
\\fancyhf{}
\\fancyfoot{}
\\renewcommand{\\headrulewidth}{0pt}
\\renewcommand{\\footrulewidth}{0pt}

% Adjust margins
\\addtolength{\\oddsidemargin}{-0.5in}
\\addtolength{\\evensidemargin}{-0.5in}
\\addtolength{\\textwidth}{1in}
\\addtolength{\\topmargin}{-.5in}
\\addtolength{\\textheight}{1.0in}
\\definecolor{darkblue}{RGB}{0,0,139}

\\urlstyle{same}

\\raggedbottom
\\raggedright
\\setlength{\\tabcolsep}{0in}

% Sections formatting
\\titleformat{\\section}{
  \\vspace{-4pt}\\scshape\\raggedright\\large
}{}{0em}{}[\\color{black}\\titlerule \\vspace{-5pt}]

% Custom commands
\\newcommand{\\resumeItem}[1]{
  \\item\\small{
    {#1 \\vspace{-2pt}}
  }
}

\\newcommand{\\resumeSubheading}[4]{
  \\vspace{-2pt}\\item
    \\begin{tabular*}{0.97\\textwidth}[t]{l@{\\extracolsep{\\fill}}r}
      \\textbf{#1} & #2 \\\\
      \\small #3 & \\small #4 \\\\
    \\end{tabular*}\\vspace{-7pt}
}

\\newcommand{\\resumeProjectHeading}[2]{
    \\item
    \\begin{tabular*}{0.97\\textwidth}{l@{\\extracolsep{\\fill}}r}
      \\small#1 & #2 \\\\
    \\end{tabular*}\\vspace{-7pt}
}

\\newcommand{\\resumeSubItem}[1]{\\resumeItem{#1}\\vspace{-4pt}}
\\renewcommand\\labelitemii{$\\vcenter{\\hbox{\\tiny$\\bullet$}}$}

\\newcommand{\\resumeSubHeadingListStart}{\\begin{itemize}[leftmargin=0.15in, label={}]}
\\newcommand{\\resumeSubHeadingListEnd}{\\end{itemize}}
\\newcommand{\\resumeItemListStart}{\\begin{itemize}}
\\newcommand{\\resumeItemListEnd}{\\end{itemize}\\vspace{-5pt}}

\\begin{document}

%----------HEADING----------
\\begin{center}
    \\textbf{\\Huge \\scshape Sushant Kumar} \\\\ \\vspace{2pt}
    {\\large\\textbf{DATA ENGINEER \\& AI SPECIALIST}} \\\\ \\vspace{2pt}
    \\small +1 (555) 010-2020 $|$
    \\href{mailto:alex.carter@example.com}{\\underline{alex.carter@example.com}} $|$
    \\href{https://www.linkedin.com/in/alexcarter/}{\\underline{LinkedIn}} $|$
    \\href{https://example.com/portfolio}{\\underline{Portfolio}} $|$
    \\href{https://github.com/alexcarter}{\\underline{GitHub}}
\\end{center}

%-----------EXPERIENCE-----------
\\section{Experience}
  \\resumeSubHeadingListStart

\\resumeSubheading
{Northwind Data Systems}{Nov 2025 -- Present}
{Data Engineer Intern}{Remote}
\\resumeItemListStart
\\resumeItem{Built and maintained \\textbf{ETL/ELT data pipelines} using \\textbf{Python and SQL}, managing large-scale data flowing across multiple systems, APIs, and AWS infrastructure.}
\\resumeItem{Managed and monitored scheduled \\textbf{cron jobs} and recurring data workflows, optimizing \\textbf{15+ Apache Flink and Spark jobs} to process over 100K events/sec.}
\\resumeItem{Designed and implemented scalable data warehouse infrastructure using \\textbf{Apache Druid, ClickHouse, and Amazon S3} for data extraction, transformation, and reporting.}
\\resumeItem{Built operational dashboards and observability pipelines using \\textbf{Grafana and Prometheus} to identify pipeline failures, data discrepancies, and schema inconsistencies.}
\\resumeItem{Worked with \\textbf{AWS Lambda, API integrations, and JSON payloads} to build automated alerting workflows and move data efficiently between different internal applications.}
\\resumeItem{Created data validation and reconciliation checks using \\textbf{Spark-based compaction jobs} to resolve small-file issues and ensure downstream dashboard accuracy.}
\\resumeItemListEnd
\\resumeSubHeadingListEnd

%-----------PROJECTS-----------
\\section{Projects}
    \\resumeSubHeadingListStart
\\resumeProjectHeading
{\\textbf{Quest.io} $|$ Next-Generation Multi-Agent Search Engine}
{\\href{https://example.com/questio}{\\textcolor{darkblue}{\\faYoutube}}}
\\resumeItemListStart
\\resumeItem{Developed a multi-agent AI platform integrating \\textbf{conversational AI, image understanding, image generation, speech synthesis, and natural-language-based image editing} through agent.}
\\resumeItem{Designed agent-routing and orchestration workflows for contextual query handling, task delegation, and parallel execution using REST-based AI services and multimodal processing pipelines.}
\\resumeItem{Integrated \\textbf{Google-grounded web search} and Retrieval-Augmented workflows to fetch real-time internet information whenever agent knowledge was outdated or insufficient, improving contextual accuracy and response reliability.}
\\resumeItem{Engineered scalable AI orchestration pipelines with WebSocket-based communication, modular API workflows, and fallback reliability mechanisms for cost-optimized multi-agent execution.}
\\resumeItemListEnd

\\resumeProjectHeading
        {\\textbf{FinCorp} $|$ CFPB Complaint Intelligence Case Study}
        {\\href{https://example.com/fincorp-case-study}{\\textcolor{darkblue}{\\faGlobe}}}
          \\resumeItemListStart
            \\resumeItem{Analyzed \\textbf{196K+ CFPB consumer complaints} across 9 major card issuers to benchmark a target issuer and identify operational and customer-risk patterns.}
            \\resumeItem{Performed data profiling and exploratory analysis across \\textbf{product, issue, company response, timely response, and complaint-date} fields to identify meaningful complaint trends and drivers.}
            \\resumeItem{Identified prepaid/gift-card complaints as a major risk area, with \\textbf{61.3\\% of industry prepaid-card complaints} attributed to the target issuer in the analyzed dataset.}
            \\resumeItem{Identified advertising and promotional terms as \\textbf{9.3\\% of credit-card complaints}, the highest rate among the major issuers analyzed, and translated findings into business recommendations.}
            \\resumeItem{\\textbf{Shortlisted for the L1 interview} based on the analysis.}
          \\resumeItemListEnd

      \\resumeProjectHeading
          {\\textbf{HerbaAI} $|$ Python, Flask/FastAPI, LangChain, FAISS, Chroma, LLM APIs, Pandas, NumPy} {\\href{https://github.com/alexcarter/herba-ai}{\\textcolor{darkblue}{\\faGithub}}}
          \\resumeItemListStart
            \\resumeItem{Developed a Generative AI system with \\textbf {RAG pipeline} and \\textbf {LangChain} chains to identify medicinal plants and deliver grounded Ayurvedic insights with Large Language Models.}
            \\resumeItem{Designed retrieval workflows (chunking, embeddings, vector stores) to improve answer faithfulness.}
            \\resumeItem{Integrated AI Agent with search, property lookup, and contraindication tools; deployed as a \\textbf {Flask/FastAPI} microservice with conversation memory and Retrieval-Augmented Generation.}
            \\resumeItem{Built user-friendly AI flows with safety guardrails to deliver accurate and trustworthy outputs.}
          \\resumeItemListEnd
    \\resumeSubHeadingListEnd

%-----------TECHNICAL SKILLS-----------
\\section{Technical Skills}
 \\begin{itemize}[leftmargin=0.15in, label={}]
    \\small{\\item{
     \\textbf{Languages \\& Databases}{: Python, SQL (CTEs, Joins, Aggregations), PostgreSQL, MySQL, AWS RDS, Amazon Redshift} \\\\
     \\textbf{Data Engineering \\& ETL}{: ETL/ELT Pipelines, Cron Jobs, Apache Spark, Flink, Kafka, Data Validation} \\\\
     \\textbf{APIs \\& Integrations}{: REST APIs, JSON, Postman, Webhooks, Data Reconciliation} \\\\
     \\textbf{Dashboarding \\& Tools}{: Grafana, Tableau, Excel/Google Sheets, Frappe Framework / ERPNext, Git/GitHub} \\\\
     \\textbf{Cloud \\& Operations}{: AWS (Lambda, S3, Athena, Glue, EMR), Linux/Server Environments} \\\\
     \\textbf{AI Productivity Tools}{: ChatGPT, Claude, Cursor (for coding assistance, debugging, and workflow automation)}
    }}
 \\end{itemize}

%-----------ACHIEVEMENTS \\& CERTIFICATIONS-----------
\\section{Achievements \\& Certifications}
  \\resumeSubHeadingListStart
    \\resumeSubItem{\\textbf{Oracle Cloud Infrastructure (OCI): Generative AI Certified Professional} (July 2024) -- Validated skills in deploying and managing generative AI solutions on Oracle Cloud.}
    \\resumeSubItem{\\textbf{Google Cloud Arcade (Diamond Level): Cloud Skills Challenge by Google} (Dec. 2024) -- Completed 40+ hands-on labs on GCP including BigQuery, App Engine, Cloud Storage, Vertex AI, and CI/CD. Earned Diamond tier recognition for consistent performance.}
    \\resumeSubItem{\\textbf{NPTEL (IIT Kharagpur): Cloud Computing (NOC Certified)} (Nov. 2024) -- Gained knowledge of cloud service models, virtualization, and distributed computing.}
    \\resumeSubItem{\\textbf{IIRS (Distance Learning): Geo Computation and Geo-Web Services} (Jan. 2024) -- Learned spatial data analysis and satellite imagery handling for geo-web systems.}
  \\resumeSubHeadingListEnd

%-----------EDUCATION-----------
\\section{Education}
  \\resumeSubHeadingListStart
    \\resumeSubheading
      {Northwood State University}{Remote}
      {B.Tech in Computer Science and Engineering $|$ CGPA: 8.14}{Sept. 2022 -- May 2026}
  \\resumeSubHeadingListEnd

\\end{document}
`;

export const TEMPLATES: TemplateOption[] = [
  { id: "T04", name: "Overleaf_base", description: "Standard Jake's Overleaf layout with subheadings and icons.", typeface: "Overleaf" },
  { id: "T02", name: "Classic", description: "Traditional serif, formal tone.", typeface: "Serif" },
  { id: "T01", name: "Modern", description: "Clean sans-serif, generous spacing.", typeface: "Sans" },
  { id: "T03", name: "Compact", description: "Dense serif, fits more on one page.", typeface: "Serif" },
  { id: "T05", name: "Elegant", description: "Warm editorial serif with a refined feel.", typeface: "Charter" },
  { id: "T06", name: "Minimal", description: "Airy sans-serif, understated and clean.", typeface: "Sans" },
];

const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

export function templateName(id: TemplateId): string {
  return BY_ID.get(id)?.name ?? "Overleaf_base";
}

export function templateLabel(id: TemplateId): string {
  const t = BY_ID.get(id);
  return t ? `${t.name} · ${t.typeface}` : "Overleaf_base · Overleaf";
}

export const DEFAULT_TEMPLATE: TemplateId = "T04";

const TEMPLATE_FONT_BLOCKS: Record<TemplateId, string> = {
  T01: `\\usepackage{fontspec}\n\\setmainfont{Lato-Regular.ttf}[\n  BoldFont=Lato-Bold.ttf,\n  ItalicFont=Lato-Italic.ttf,\n  BoldItalicFont=Lato-BoldItalic.ttf ]`,
  T02: `\\usepackage{newtxtext,newtxmath}`,
  T03: `\\usepackage{XCharter}`,
  T04: `\\usepackage{latexsym}`,
  // Elegant: the base Charter font (cached offline) — a warmer serif than XCharter/newtx.
  T05: `\\usepackage{charter}`,
  // Minimal: Lato again but paired with airy spacing (applied via the style hook below).
  T06: `\\usepackage{fontspec}\n\\setmainfont{Lato-Regular.ttf}[\n  BoldFont=Lato-Bold.ttf,\n  ItalicFont=Lato-Italic.ttf,\n  BoldItalicFont=Lato-BoldItalic.ttf ]`,
};

// All font packages we might swap in (used to find-and-replace the current one).
const FONT_PATTERN = /(?:\\usepackage\{fontspec\}\s*\\setmainfont\{[^}]+\}\[[^\]]*\]|\\usepackage\{newtxtext\s*,\s*newtxmath\}|\\usepackage\{XCharter\}|\\usepackage\{charter\}|\\usepackage\{lmodern\}|\\usepackage\{times\})/i;

export function detectTemplate(latex: string): TemplateId {
  if (/resumeSubheading|resumeProjectHeading|fullpage/i.test(latex)) return "T04";
  // charter must be checked before generic fontspec/Lato since Elegant uses charter.
  if (/\\usepackage\{charter\}/i.test(latex)) return "T05";
  if (/Lato-Regular|fontspec/i.test(latex)) return "T01";
  if (/XCharter/i.test(latex)) return "T03";
  if (/newtx/i.test(latex)) return "T02";
  return "T04";
}

export function applyTemplateToLatex(latex: string, tid: TemplateId): string {
  if (tid === "T04" && !/resumeSubheading/i.test(latex)) {
    return OVERLEAF_BASE_TEX;
  }
  const newBlock = TEMPLATE_FONT_BLOCKS[tid] ?? TEMPLATE_FONT_BLOCKS.T02;
  if (FONT_PATTERN.test(latex)) {
    return latex.replace(FONT_PATTERN, newBlock);
  }
  if (/\\pagenumbering/i.test(latex)) {
    return latex.replace(/\\pagenumbering/i, `${newBlock}\n\\pagenumbering`);
  }
  if (/\\begin\{document\}/i.test(latex)) {
    return latex.replace(/\\begin\{document\}/i, `${newBlock}\n\\begin{document}`);
  }
  return `${latex}\n${newBlock}`;
}
