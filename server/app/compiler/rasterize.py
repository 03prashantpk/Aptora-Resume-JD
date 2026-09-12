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


def rasterize(pdf: bytes, dpi: int = _DEFAULT_DPI, fmt: str = "webp") -> list[PageImage]:
    """Render every page of `pdf` to an image. Returns one PageImage per page
    (1-indexed). `fmt` is 'webp' (default) or 'png'."""
    fmt = fmt.lower()
    if fmt not in ("webp", "png"):
        raise ValueError(f"unsupported preview format: {fmt}")
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    out: list[PageImage] = []
    with fitz.open(stream=pdf, filetype="pdf") as doc:
        for i, page in enumerate(doc, start=1):
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            if fmt == "png":
                data = pix.tobytes(output="png")
            else:
                # PyMuPDF can't emit WebP; transcode the raw RGB pixmap via Pillow.
                img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                buf = io.BytesIO()
                img.save(buf, format="WEBP", quality=82, method=4)
                data = buf.getvalue()
            out.append(PageImage(page=i, width=pix.width, height=pix.height, fmt=fmt, data=data))
    return out
