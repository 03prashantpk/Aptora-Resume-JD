"""Compiler regression gate for the server: T01/T02/T03 compile with correct fonts."""
from __future__ import annotations
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.compiler.models import CompileInput, ResumeJSON  # noqa: E402
from app.compiler.tectonic import TectonicCompiler, tectonic_version  # noqa: E402
from app.compiler.pdf_inspect import analyze  # noqa: E402

FIXTURE = {
    "name": "Alex Morgan", "headline": "Software Engineer",
    "contact": {"email": "alex@example.test", "phone": "+1 555 010 0000",
                "linkedin": "linkedin.example.test/in/alexmorgan"},
    "summary": "Engineer with experience in TypeScript, React, and Node.js.",
    "experience": [{"title": "Full-Stack Developer", "org": "Example Web Technologies",
                    "dates": "2024-Present", "bullets": ["Built apps with React & Node.", "Designed REST/GraphQL APIs."]}],
    "skills": [{"label": "Frontend", "items": "TypeScript, React, Next.js"}],
    "education": [{"text": "B.Tech CSE - Example University", "dates": "2020-24"}],
}
EXPECT = {"T01": "Lato", "T02": "Termes", "T03": "XCharter"}


def test_gate():
    if tectonic_version() is None:
        print("SKIP: tectonic not installed")
        return
    c = TectonicCompiler(only_cached=True)
    resume = ResumeJSON(**FIXTURE)
    for tid, font in EXPECT.items():
        res, pdf, imgs = c.compile(CompileInput(template_id=tid, resume=resume))
        assert res.success, f"{tid} failed: {res.error_code} {res.detail}"
        assert pdf and pdf.startswith(b"%PDF-")
        _, fonts = analyze(pdf)
        joined = " ".join(fonts)
        assert font.lower() in joined.lower() or (tid == "T02" and any(k in joined for k in ("Termes", "Times", "Nimbus"))), \
            f"{tid} wrong font, got {fonts}"
        # rasterization happened in the same pass: one image per page, valid WebP
        assert len(imgs) == res.page_count, f"{tid} expected {res.page_count} images, got {len(imgs)}"
        assert len(res.pages) == res.page_count
        assert all(im.fmt == "webp" and im.data[:4] == b"RIFF" for im in imgs), f"{tid} bad preview bytes"
        print(f"{tid} PASS font={fonts} {res.page_count}p {res.compile_time_ms}ms "
              f"raster={res.rasterize_time_ms}ms img={len(imgs[0].data)}B")


if __name__ == "__main__":
    test_gate()
    print("gate OK")
