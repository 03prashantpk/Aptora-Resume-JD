"""Compiler I/O contracts + ResumeJSON (Pydantic). Content-only; templates own layout."""
from __future__ import annotations
from typing import Literal, Optional, Protocol
from pydantic import BaseModel

TemplateId = Literal["T01", "T02", "T03"]


class Contact(BaseModel):
    phone: Optional[str] = None
    email: Optional[str] = None
    linkedin: Optional[str] = None
    github: Optional[str] = None
    location: Optional[str] = None


class Experience(BaseModel):
    title: str
    org: str = ""
    dates: str = ""
    bullets: list[str] = []


class Group(BaseModel):
    heading: str
    bullets: list[str] = []


class Project(BaseModel):
    name: str
    description: str = ""


class Education(BaseModel):
    text: str
    dates: str = ""


class Skill(BaseModel):
    label: str
    items: str


class ResumeJSON(BaseModel):
    name: str
    headline: str = ""
    contact: Contact = Contact()
    summary: Optional[str] = None
    experience: list[Experience] = []
    extra_groups: list[Group] = []
    projects: list[Project] = []
    skills: list[Skill] = []
    education: list[Education] = []
    certifications: Optional[str] = None
    soft_skills: Optional[str] = None
    portfolio_line: Optional[str] = None


class CompileInput(BaseModel):
    template_id: TemplateId
    resume: ResumeJSON
    revision_id: Optional[str] = None
    rasterize: bool = True          # produce preview page images in the same pass
    preview_dpi: int = 150
    preview_format: Literal["webp", "png"] = "webp"


class PreviewPageMeta(BaseModel):
    page: int
    width: int
    height: int
    fmt: str


class CompileResult(BaseModel):
    success: bool
    compile_time_ms: int
    compiler_version: str
    document_id: Optional[str] = None
    sha256: Optional[str] = None
    page_count: Optional[int] = None
    rasterize_time_ms: Optional[int] = None
    pages: list[PreviewPageMeta] = []   # metadata only; image bytes travel out-of-band
    error_code: Optional[str] = None
    detail: Optional[str] = None
    # pdf bytes + page image bytes + log are handled out-of-band (never in this model)


class ResumeCompiler(Protocol):
    def compile(
        self, inp: CompileInput
    ) -> tuple[CompileResult, Optional[bytes], list["PageImageBytes"]]: ...


class PageImageBytes(BaseModel):
    page: int
    fmt: str
    data: bytes
