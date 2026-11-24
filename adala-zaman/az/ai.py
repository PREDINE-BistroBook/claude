"""Optional Claude API helper (Shorts selection + Egyptian-Arabic texts).

Credentials: ANTHROPIC_API_KEY in the environment or in a git-ignored `.env` file in the
project root. Without credentials every caller falls back to heuristics/templates.
"""
from __future__ import annotations

import base64
import io
import json
import os
from pathlib import Path

from .common import ROOT

_client = None


def _load_env():
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def available() -> bool:
    _load_env()
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        return False
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False
    return True


def client():
    global _client
    if _client is None:
        import anthropic
        _load_env()
        _client = anthropic.Anthropic()
    return _client


def image_block(path: Path, max_side=1568) -> dict:
    from PIL import Image, ImageOps
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    im.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                        "data": base64.standard_b64encode(buf.getvalue()).decode()}}


def ask_json(system: str, content: list, schema: dict, model: str, effort="high", max_tokens=16000) -> dict | None:
    """One structured-output request. Returns the parsed JSON, or None on any failure."""
    import anthropic
    try:
        resp = client().beta.messages.create(
            model=model, max_tokens=max_tokens, system=system,
            messages=[{"role": "user", "content": content}],
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
            betas=["server-side-fallback-2026-07-01"], fallbacks="default",
        )
    except anthropic.AuthenticationError:
        print("  ! Claude API: invalid credentials - using heuristic fallback")
        return None
    except anthropic.RateLimitError:
        print("  ! Claude API: rate limited - using heuristic fallback (re-run later for AI picks)")
        return None
    except anthropic.APIStatusError as e:
        print(f"  ! Claude API error {e.status_code}: {e.message} - using heuristic fallback")
        return None
    except anthropic.APIConnectionError:
        print("  ! Claude API unreachable - using heuristic fallback")
        return None
    if resp.stop_reason in ("refusal", "max_tokens"):
        print(f"  ! Claude API stopped early ({resp.stop_reason}) - using heuristic fallback")
        return None
    text = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None
