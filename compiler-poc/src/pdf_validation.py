"""Pure-Python PDF inspection (stdlib only; no pdffonts, no WSL, no Docker).

Tectonic/XeTeX PDFs compress content + cross-reference/object streams with
FlateDecode, so a raw byte-scan can't see /BaseFont or /Type/Page. Here we
inflate every FlateDecode stream and scan the decompressed text for font names
and page objects. Good enough to (a) count pages and (b) verify the embedded
font family for the POC gate."""
from __future__ import annotations
import re
import zlib

_STREAM = re.compile(rb"stream\r?\n(.*?)\r?\nendstream", re.DOTALL)
_BASEFONT = re.compile(rb"/BaseFont\s*/([A-Za-z0-9+\-_.]+)")
_FONTNAME = re.compile(rb"/FontName\s*/([A-Za-z0-9+\-_.]+)")
_PAGE = re.compile(rb"/Type\s*/Page(?![a-zA-Z])")


def _inflated_blobs(pdf: bytes) -> list[bytes]:
    """Return the raw PDF plus every successfully inflated FlateDecode stream."""
    blobs = [pdf]
    for m in _STREAM.finditer(pdf):
        raw = m.group(1)
        for attempt in (raw, raw.lstrip(b"\r\n"), raw.strip()):
            try:
                blobs.append(zlib.decompress(attempt))
                break
            except Exception:
                continue
    return blobs


def analyze(pdf: bytes) -> tuple[int, list[str]]:
    """Return (page_count, sorted unique font names) from a (possibly compressed) PDF."""
    fonts: set[str] = set()
    pages = 0
    for blob in _inflated_blobs(pdf):
        for rx in (_BASEFONT, _FONTNAME):
            for fm in rx.finditer(blob):
                name = fm.group(1).decode("latin1", "ignore")
                # Strip the "ABCDEF+" subset prefix that PDF embeds.
                fonts.add(name.split("+", 1)[-1])
        pages += len(_PAGE.findall(blob))
    return pages, sorted(fonts)


def font_text(pdf: bytes) -> str:
    """A newline-joined font list for the font-verification/report evidence."""
    _, fonts = analyze(pdf)
    return "\n".join(fonts) if fonts else "(no font names found in PDF)"
