"""Remote LaTeX->PDF compile provider (default), with local Tectonic fallback.

Strategy (see tectonic.py._run_locked): compile on this REMOTE service FIRST so heavy
Tectonic runs stay OFF the host CPU (the win on a small/free Render instance). If the
remote is UNAVAILABLE (unreachable / timeout / 5xx), the caller automatically falls
back to the local Tectonic .exe. The remote service accepts JSON {"tex": "..."} and
returns raw application/pdf bytes; that PDF is fed into the SAME validate -> analyze ->
rasterize path as the local compiler, so the API contract to Astro is unchanged.

Uses only the Python stdlib (urllib) so it adds no runtime dependency.

Env overrides (all optional):
    REMOTE_COMPILE_URL=<url>            # the /compile endpoint
    REMOTE_COMPILE_TIMEOUT_S=120        # request timeout (seconds)
    COMPILER_PROVIDER=local             # escape hatch: skip remote, use .exe only
"""
from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.request

# Logs surface in the uvicorn console. We log only outcomes/sizes/timings — never the
# LaTeX source, the PDF bytes, or any secret.
log = logging.getLogger("aptora.compiler.remote")

# Default points at the compile service the founder provided. Override via env.
DEFAULT_REMOTE_URL = "https://isushant-compilerserved.hf.space/compile"


def remote_compile_url() -> str:
    return os.environ.get("REMOTE_COMPILE_URL", DEFAULT_REMOTE_URL)


def remote_timeout_s() -> int:
    try:
        return int(os.environ.get("REMOTE_COMPILE_TIMEOUT_S", "120"))
    except ValueError:
        return 120


class RemoteCompileError(Exception):
    """Raised when the remote service fails or returns a non-PDF response."""

    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


# Error codes that mean "the remote is UNAVAILABLE" (not "the document was bad"). Only
# these trigger the local Tectonic fallback in tectonic.py — a 4xx / bad-output means the
# request or document was the problem, so falling back would just burn CPU on a doc that
# will fail locally too.
TRANSPORT_ERROR_CODES = frozenset({
    "REMOTE_COMPILE_UNREACHABLE",   # DNS/connection failure, host down
    "REMOTE_COMPILE_TIMEOUT",       # exceeded REMOTE_COMPILE_TIMEOUT_S
    "REMOTE_COMPILE_SERVER_ERROR",  # 5xx (service crashed / overloaded / cold-starting)
    "REMOTE_COMPILE_ERROR",         # unexpected client-side transport error
})


def compile_tex_remote(latex: str) -> bytes:
    """POST {"tex": latex} to the remote service and return validated PDF bytes.

    Raises RemoteCompileError on failure. The `.code` distinguishes availability failures
    (see TRANSPORT_ERROR_CODES — these trigger local fallback) from request/document
    failures (returned to the caller as-is).
    """
    url = remote_compile_url()
    payload = json.dumps({"tex": latex}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/pdf"},
        method="POST",
    )
    log.info("HF compile -> POST %s (tex %d bytes)", url, len(payload))
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=remote_timeout_s()) as resp:
            status = getattr(resp, "status", resp.getcode())
            data = resp.read()
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", "replace")[:300]
        except Exception:
            pass
        ms = int((time.monotonic() - t0) * 1000)
        # 5xx = service problem (fall back); 4xx = request/document problem (don't).
        code = "REMOTE_COMPILE_SERVER_ERROR" if e.code >= 500 else "REMOTE_COMPILE_FAILED"
        log.warning("HF compile <- HTTP %s in %dms (%s): %s", e.code, ms, code, body[:120])
        raise RemoteCompileError(code, f"remote status {e.code}: {body}") from e
    except urllib.error.URLError as e:
        ms = int((time.monotonic() - t0) * 1000)
        # URLError wraps timeouts and connection failures.
        reason = getattr(e, "reason", e)
        if isinstance(reason, TimeoutError) or "timed out" in str(reason).lower():
            log.warning("HF compile <- TIMEOUT in %dms -> will fall back to local", ms)
            raise RemoteCompileError("REMOTE_COMPILE_TIMEOUT", f"remote timed out: {reason}") from e
        log.warning("HF compile <- UNREACHABLE in %dms (%s) -> will fall back to local", ms, reason)
        raise RemoteCompileError("REMOTE_COMPILE_UNREACHABLE", f"remote unreachable: {reason}") from e
    except TimeoutError as e:
        ms = int((time.monotonic() - t0) * 1000)
        log.warning("HF compile <- TIMEOUT in %dms -> will fall back to local", ms)
        raise RemoteCompileError("REMOTE_COMPILE_TIMEOUT", f"remote timed out: {e}") from e
    except Exception as e:  # connection reset, etc.
        ms = int((time.monotonic() - t0) * 1000)
        log.warning("HF compile <- ERROR in %dms -> will fall back to local: %s", ms, str(e)[:120])
        raise RemoteCompileError("REMOTE_COMPILE_ERROR", str(e)[:300]) from e

    ms = int((time.monotonic() - t0) * 1000)
    if status >= 500:
        log.warning("HF compile <- HTTP %s in %dms -> will fall back to local", status, ms)
        raise RemoteCompileError("REMOTE_COMPILE_SERVER_ERROR", f"remote status {status}")
    if status != 200:
        log.warning("HF compile <- HTTP %s in %dms (no fallback)", status, ms)
        raise RemoteCompileError("REMOTE_COMPILE_FAILED", f"remote status {status}")
    if not data or not data.startswith(b"%PDF-"):
        # Some services return a JSON error with 200; surface a readable snippet.
        snippet = data[:200].decode("utf-8", "replace") if data else "empty response"
        log.warning("HF compile <- 200 but NOT a PDF in %dms (no fallback): %s", ms, snippet[:120])
        raise RemoteCompileError("REMOTE_COMPILE_BAD_OUTPUT", f"remote did not return a PDF: {snippet}")
    log.info("HF compile <- 200 OK in %dms (pdf %d bytes)", ms, len(data))
    return data
