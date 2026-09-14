// Shared content contract. Mirrors the Python engine's Pydantic ResumeJSON
// (server/app/compiler/models.py). Keep the two in sync.

export type TemplateId = "T01" | "T02" | "T03" | "T04" | "T05" | "T06";

export interface Contact {
  phone?: string;
  email?: string;
  linkedin?: string;
  github?: string;
  location?: string;
}

export interface Experience {
  title: string;
  org?: string;
  dates?: string;
  bullets?: string[];
}

export interface Group {
  heading: string;
  bullets?: string[];
}

export interface Project {
  name: string;
  description?: string;
}

export interface Education {
  text: string;
  dates?: string;
}

export interface Skill {
  label: string;
  items: string;
}

export interface ResumeJSON {
  name: string;
  headline?: string;
  contact?: Contact;
  summary?: string;
  experience?: Experience[];
  extra_groups?: Group[];
  projects?: Project[];
  skills?: Skill[];
  education?: Education[];
  certifications?: string;
  soft_skills?: string;
  portfolio_line?: string;
}

export interface PreviewPageMeta {
  page: number;
  width: number;
  height: number;
  fmt: string;
}

export interface CompileResult {
  success: boolean;
  compile_time_ms: number;
  compiler_version: string;
  document_id?: string;
  sha256?: string;
  page_count?: number;
  rasterize_time_ms?: number;
  pages: PreviewPageMeta[];
  error_code?: string;
  detail?: string;
}
