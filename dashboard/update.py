"""git 으로 업데이트를 확인하고 적용한다. 체크아웃이 git 저장소이고 현재 브랜치에 upstream 이 있을 때만 동작한다.

- check(): `git fetch` 뒤 HEAD 와 upstream 을 비교한다. 결과는 TTL 동안 캐시하고 `refresh=True` 면 다시 fetch 한다.
- apply(): 뒤처진 커밋이 있고 로컬 변경·앞선 커밋이 없을 때만 `git pull --ff-only` 하고 프로세스를 다시 띄운다.
  재시작은 `os.execv` 로 같은 PID 에서 서버를 갈아끼운다. launchd 아래서도, 손으로 띄운 `python3 serve.py` 에서도 같다.
  응답이 소켓에 실린 뒤 exec 되도록 짧게 기다린다.
- 비밀값·토큰은 다루지 않는다. git 출력 외의 것은 싣지 않는다.
"""
from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from pathlib import Path

TTL = 10 * 60
GIT_TIMEOUT = 30
MAX_TITLES = 20
RESTART_DELAY = 0.5


class UpdateError(Exception):
    pass


def exec_self() -> None:
    """현재 프로세스를 같은 인터프리터·인자로 갈아끼운다. 서버 소켓은 non-inheritable 이라 exec 에서 닫힌다."""
    sys.stdout.flush()
    sys.stderr.flush()
    os.execv(sys.executable, [sys.executable, *sys.argv])


class Updater:
    def __init__(self, repo: Path, run=subprocess.run, restart=exec_self, now=time.monotonic):
        self.repo = Path(repo)
        self._run = run
        self._restart = restart
        self._now = now
        self._lock = threading.Lock()
        self.last: dict | None = None
        self._checked_at: float | None = None
        self.started_at = time.strftime("%Y-%m-%dT%H:%M:%S")

    def _git(self, *args: str) -> str:
        try:
            done = self._run(["git", *args], cwd=str(self.repo), capture_output=True, text=True, timeout=GIT_TIMEOUT)
        except FileNotFoundError:
            raise UpdateError("git 이 없다") from None
        except subprocess.TimeoutExpired:
            raise UpdateError(f"git {args[0]} 이 {GIT_TIMEOUT}초 안에 끝나지 않았다") from None
        if done.returncode != 0:
            detail = (done.stderr or done.stdout or "").strip().splitlines()
            raise UpdateError(f"git {args[0]} 실패: {detail[-1] if detail else done.returncode}")
        return done.stdout.strip()

    def _inspect(self, fetch: bool) -> dict:
        if not (self.repo / ".git").exists():
            raise UpdateError("git 저장소가 아니다. git clone 으로 설치했을 때만 업데이트할 수 있다")
        branch = self._git("rev-parse", "--abbrev-ref", "HEAD")
        if branch == "HEAD":
            raise UpdateError("detached HEAD 다. 브랜치로 돌아가야 업데이트할 수 있다")
        upstream = self._git("rev-parse", "--abbrev-ref", "@{u}")
        if fetch:
            self._git("fetch", "--quiet")
        titles = self._git("log", f"--max-count={MAX_TITLES}", "--format=%s", "HEAD..@{u}")
        return {
            "ok": True,
            "error": None,
            "branch": branch,
            "upstream": upstream,
            "current": self._git("rev-parse", "--short", "HEAD"),
            # 사이드바 버전 줄. 커밋 시각을 이 맥의 시간대로 분까지 보인다.
            "currentDate": self._git("log", "-1", "--date=format-local:%Y-%m-%d %H:%M", "--format=%cd"),
            "remote": self._git("rev-parse", "--short", "@{u}"),
            "behind": int(self._git("rev-list", "--count", "HEAD..@{u}")),
            "ahead": int(self._git("rev-list", "--count", "@{u}..HEAD")),
            "titles": titles.splitlines() if titles else [],
            "dirty": bool(self._git("status", "--porcelain", "--untracked-files=no")),
        }

    def _snapshot(self, fetch: bool) -> dict:
        try:
            state = self._inspect(fetch)
        except UpdateError as exc:
            state = {"ok": False, "error": str(exc), "behind": 0, "ahead": 0, "titles": [], "dirty": False,
                     "current": None, "currentDate": None, "remote": None, "branch": None, "upstream": None}
        state["startedAt"] = self.started_at
        state["checkedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        self.last = state
        self._checked_at = self._now()
        return state

    def check(self, refresh: bool = False) -> dict:
        with self._lock:
            fresh = self.last is not None and self._checked_at is not None and self._now() - self._checked_at < TTL
            if fresh and not refresh:
                return self.last
            return self._snapshot(fetch=True)

    def apply(self) -> tuple[int, dict]:
        with self._lock:
            state = self._snapshot(fetch=True)
            if not state["ok"]:
                return 500, {"error": state["error"]}
            if state["dirty"]:
                return 409, {"error": "로컬에 커밋하지 않은 변경이 있어 자동 업데이트를 하지 않는다. 정리한 뒤 다시 시도한다"}
            if state["ahead"]:
                return 409, {"error": f"로컬이 {state['upstream']} 보다 {state['ahead']}건 앞서 있어 fast-forward 할 수 없다"}
            if not state["behind"]:
                return 200, {"updated": False, "current": state["current"]}
            try:
                self._git("pull", "--ff-only", "--quiet")
            except UpdateError as exc:
                return 500, {"error": str(exc)}
            after = self._snapshot(fetch=False)
            threading.Thread(target=self._restart_later, daemon=True).start()
            return 200, {"updated": True, "from": state["current"], "to": after["current"], "restarting": True}

    def _restart_later(self) -> None:
        time.sleep(RESTART_DELAY)
        self._restart()
