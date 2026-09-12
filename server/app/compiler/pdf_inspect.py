"""Stdlib-only PDF inspection: page count + embedded font names. Inflates
FlateDecode streams so it works on Tectonic's compressed PDFs. POC-grade; a
maintained PDF lib can replace this in hardening."""
from __future__ import annotations
import re
import zlib

_STREAM = re.compile(rb"stream\r?\n(.*?)\r?\nendstream", re.DOTALL)
_BASEFONT = re.compile(rb"/BaseFont\s*/([A-Za-z0-9+\-_.]+)")
_FONTNAME = re.compile(rb"/FontName\s*/([A-Za-z0-9+\-_.]+)")
_PAGE = re.compile(rb"/Type\s*/Page(?![a-zA-Z])")


def _blobs(pdf: bytes) -> list[bytes]:
    out = [pdf]
    for m in _STREAM.finditer(pdf):
        raw = m.group(1)
        for a in (raw, raw.lstrip(b"\r\n"), raw.strip()):
            try:
                out.append(zlib.decompress(a))
                break
            except Exception:
                continue
    return out


def analyze(pdf: bytes) -> tuple[int, list[str]]:
    fonts: set[str] = set()
    pages = 0
    for b in _blobs(pdf):
        for rx in (_BASEFONT, _FONTNAME):
            for m in rx.finditer(b):
                fonts.add(m.group(1).decode("latin1", "ignore").split("+", 1)[-1])
        pages += len(_PAGE.findall(b))
    return pages, sorted(fonts)
