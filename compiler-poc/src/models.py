"""ResumeJSON + compiler I/O models. Content-only; templates own layout."""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional, Protocol


@dataclass
class Contact:
    phone: Optional[str] = None
    email: Optional[str] = None
    linkedin: Optional[str] = None
    github: Optional[str] = None
    location: Optional[str] = None


@dataclass
class Experience:
    title: str
    org: str
    dates: str
    bullets: list[str]


@dataclass
class Group:
    heading: str
    bullets: list[str]


@dataclass
class Project:
    name: str
    description: str


@dataclass
class Education:
    text: str
    dates: str


@dataclass
class Skill:
    label: str
    items: str


@dataclass
class ResumeJSON:
    name: str
    headline: str
    contact: Contact
    summary: Optional[str] = None
    experience: list[Experience] = field(default_factory=list)
    extra_groups: list[Group] = field(default_factory=list)
    projects: list[Project] = field(default_factory=list)
    skills: list[Skill] = field(default_factory=list)
    education: list[Education] = field(default_factory=list)
    certifications: Optional[str] = None
    soft_skills: Optional[str] = None
    portfolio_line: Optional[str] = None

    @staticmethod
    def from_dict(d: dict) -> "ResumeJSON":
        c = d.get("contact", {})
        return ResumeJSON(
            name=d["name"],
            headline=d["headline"],
            contact=Contact(**{k: c.get(k) for k in ("phone", "email", "linkedin", "github", "location")}),
            summary=d.get("summary"),
            experience=[Experience(**e) for e in d.get("experience", [])],
            extra_groups=[Group(**g) for g in d.get("extraExperienceGroups", [])],
            projects=[Project(**p) for p in d.get("projects", [])],
            skills=[Skill(**s) for s in d.get("skills", [])],
            education=[Education(**e) for e in d.get("education", [])],
            certifications=d.get("certifications"),
            soft_skills=d.get("softSkills"),
            portfolio_line=d.get("portfolioLine"),
        )


@dataclass
class CompileInput:
    template_id: str  # "T01" | "T02" | "T03"
    resume: ResumeJSON
    revision_id: Optional[str] = None


@dataclass
class CompileResult:
    success: bool
    compile_time_ms: int
    compiler_version: str
    pdf: Optional[bytes] = None
    sha256: Optional[str] = None
    page_count: Optional[int] = None
    error_code: Optional[str] = None
    detail: Optional[str] = None
    log: Optional[str] = None  # PRIVATE — never shown to end users


class ResumeCompiler(Protocol):
    def compile(self, inp: CompileInput) -> CompileResult: ...
