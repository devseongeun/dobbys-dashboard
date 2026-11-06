"""온보딩·설정의 경로 입력란을 Finder 선택 창으로 채운다(POST /_dashboard/pick).

브라우저 파일 선택은 절대 경로를 주지 않으므로, 같은 Mac 의 사용자 세션에서 도는 서버가 osascript 로 창을 띄운다.
창은 한 번에 하나만 띄운다. 창이 떠 있는 동안 요청 스레드는 기다린다.
"""
from __future__ import annotations

import subprocess
import threading
from pathlib import Path
from typing import Callable

SCRIPT = Path(__file__).with_name("pick.applescript")
KINDS = frozenset({"dir", "file", "dirs"})
TIMEOUT_S = 600
CANCELLED = "-128"  # AppleScript "User canceled."

Runner = Callable[[list[str]], subprocess.CompletedProcess]


def _run(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, timeout=TIMEOUT_S)


def _start_dir(kind: str, current) -> str | None:
    """지금 적힌 경로가 있으면 그 폴더(파일이면 그 파일의 폴더)에서 창을 연다. 없으면 기본 위치."""
    text = current[0] if isinstance(current, list) and current else current
    if not isinstance(text, str) or not text.strip() or "\x00" in text:
        return None
    path = Path(text.strip()).expanduser()
    if kind == "file" or not path.is_dir():
        path = path.parent
    return str(path) if path.is_absolute() and path.is_dir() else None


class Picker:
    def __init__(self, run: Runner = _run):
        self._run = run
        self._lock = threading.Lock()

    def pick(self, submitted) -> tuple[int, dict]:
        """{"kind": dir|file|dirs, "current": 지금 값} → 200 {"paths": [...]} | 200 {"cancelled": true} | 4xx·5xx {"error"}."""
        kind = submitted.get("kind") if isinstance(submitted, dict) else None
        if kind not in KINDS:
            return 400, {"error": "kind 는 dir·file·dirs 중 하나다"}
        if not self._lock.acquire(blocking=False):
            return 409, {"error": "선택 창이 이미 열려 있습니다. 그 창을 먼저 닫으세요."}
        try:
            start = _start_dir(kind, submitted.get("current"))
            try:
                done = self._run(["osascript", str(SCRIPT), kind, *([start] if start else [])])
            except FileNotFoundError:
                return 501, {"error": "Finder 선택 창은 macOS 에서만 열립니다"}
            except subprocess.TimeoutExpired:
                return 504, {"error": "선택 창이 너무 오래 열려 있어 닫았습니다"}
        finally:
            self._lock.release()
        if done.returncode != 0:
            if CANCELLED in done.stderr:
                return 200, {"cancelled": True}
            return 500, {"error": f"선택 창을 열지 못했습니다: {done.stderr.strip() or done.returncode}"}
        paths = [line.rstrip("/") or "/" for line in done.stdout.splitlines() if line.strip()]
        return 200, {"paths": paths}
