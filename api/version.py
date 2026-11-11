"""`GET api/version` → {"commit": "<짧은 sha>", "date": "YYYY-MM-DD"}. 셸 사이드바의 버전 줄이 쓴다.

서버 기동 때 한 번 git 으로 읽는다(web_serve.py main 이 `load()` 를 부른다). git 저장소가 아니거나 git 이 없으면 둘 다 null.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from api._http import Request, Response, json_response

REPO_ROOT = Path(__file__).resolve().parent.parent
_cached: dict | None = None


def read(repo: Path = REPO_ROOT) -> dict:
    try:
        out = subprocess.run(
            ["git", "-C", str(repo), "log", "-1", "--format=%h%n%cs"],
            capture_output=True, text=True, timeout=5, check=True,
        ).stdout.split()
    except (OSError, subprocess.SubprocessError):
        return {"commit": None, "date": None}
    if len(out) != 2:
        return {"commit": None, "date": None}
    return {"commit": out[0], "date": out[1]}


def load(repo: Path = REPO_ROOT) -> dict:
    global _cached
    _cached = read(repo)
    return _cached


def handle(request: Request) -> Response:
    if request.method not in ("GET", "HEAD"):
        return json_response(405, {"error": "method not allowed"})
    return json_response(200, _cached if _cached is not None else load())
