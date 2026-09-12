"""LaTeX escaping for content fields. Content is data-only; never trusted as LaTeX."""
from __future__ import annotations

_REPLACERS = [
    ("\\", r"\textbackslash{}"),
    ("&", r"\&"), ("%", r"\%"), ("$", r"\$"), ("#", r"\#"),
    ("_", r"\_"), ("{", r"\{"), ("}", r"\}"),
    ("~", r"\textasciitilde{}"), ("^", r"\textasciicircum{}"),
]


def esc(s: str | None) -> str:
    if not s:
        return ""
    out = s
    for a, b in _REPLACERS:
        out = out.replace(a, b)
    return out


def href(url: str, label: str) -> str:
    return f"\\href{{{url}}}{{{esc(label)}}}"


BULLET = r"\textbullet\ "
