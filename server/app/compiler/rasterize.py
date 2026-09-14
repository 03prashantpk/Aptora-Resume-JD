"""PDF -> page images (WebP), via PyMuPDF. Stateless: bytes in, bytes out.

Used on the free/preview path so the browser receives page images, never the PDF
(project rule 7 / 11). The SAME validated PDF is rasterized here and stored for
export elsewhere — never a second compile."""
from __future__ import annotations
import io
import fitz  # PyMuPDF
from PIL import Image  # WebP encoding (PyMuPDF pixmaps don't emit WebP)

# 150 DPI ~= crisp on-screen preview at a modest size. PDF default is 72 DPI,
# so zoom = target/72.
_DEFAULT_DPI = 150


class PageImage:
    __slots__ = ("page", "width", "height", "fmt", "data")

    def __init__(self, page: int, width: int, height: int, fmt: str, data: bytes):
        self.page = page
        self.width = width
        self.height = height
        self.fmt = fmt
        self.data = data


# Cap how many pages we rasterize for the preview. Résumés are 1-2 pages; a
# pathological multi-page .tex could otherwise hold many large pixmaps at once and
# OOM a small instance. Overridable via env.
import os as _os
_MAX_PREVIEW_PAGES = int(_os.environ.get("MAX_PREVIEW_PAGES", "6"))


def rasterize(pdf: bytes, dpi: int = _DEFAULT_DPI, fmt: str = "webp") -> list[PageImage]:
    """Render each page of `pdf` (up to a page cap) to an image. Returns one
    PageImage per page (1-indexed). `fmt` is 'webp' (default) or 'png'.

    Memory-conscious: each PyMuPDF pixmap is released before the next page is
    rendered, so peak memory is one page's pixmap — not all pages at once. This
    matters on small (512MB) hosts."""
    fmt = fmt.lower()
    if fmt not in ("webp", "png"):
        raise ValueError(f"unsupported preview format: {fmt}")
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    out: list[PageImage] = []
    with fitz.open(stream=pdf, filetype="pdf") as doc:
        for i, page in enumerate(doc, start=1):
            if i > _MAX_PREVIEW_PAGES:
                break
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            w, h = pix.width, pix.height
            if fmt == "png":
                data = pix.tobytes(output="png")
            else:
                # PyMuPDF can't emit WebP; transcode the raw RGB pixmap via Pillow.
                # method=2 uses less memory/CPU than 4 with near-identical size.
                img = Image.frombytes("RGB", (w, h), pix.samples)
                buf = io.BytesIO()
                img.save(buf, format="WEBP", quality=80, method=2)
                data = buf.getvalue()
                img.close()
            # Release the pixmap immediately so the next page doesn't stack memory.
            pix = None
            out.append(PageImage(page=i, width=w, height=h, fmt=fmt, data=data))
    return out
