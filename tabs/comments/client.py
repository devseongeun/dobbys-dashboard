"""TROMBONE 웹 기획서 API. 조회(GET)는 인증이 없고, 반응(POST)은 로그인 token(Bearer)이 필요하다."""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

API_PREFIX = "/trbw/api"  # 기획서 SPA 번들 index-*.js 의 apiBase 값
TIMEOUT = 20


class TromboneError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class TromboneClient:
    def __init__(self, base: str, opener=urllib.request.urlopen):
        self.base = base.rstrip("/")
        self._open = opener

    def call(self, method: str, path: str, body=None, token: str | None = None):
        headers = {"Accept": "application/json"}
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode("utf-8")
        if token:
            headers["Authorization"] = "Bearer " + token
        req = urllib.request.Request(self.base + API_PREFIX + path, data=data, method=method, headers=headers)
        try:
            with self._open(req, timeout=TIMEOUT) as res:
                raw = res.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            message = f"HTTP {exc.code}"
            try:
                detail = json.loads(exc.read().decode("utf-8") or "{}").get("message")
                if detail:
                    message += " " + detail
            except (ValueError, AttributeError):
                pass
            raise TromboneError(f"{path.split('?')[0]} → {message}", status=exc.code) from None
        except urllib.error.URLError as exc:
            raise TromboneError(f"기획서 연결 실패: {exc.reason} · 사내망(VPN) 연결을 확인한다") from None
        except TimeoutError:
            raise TromboneError(f"기획서 응답 시간 초과 ({TIMEOUT}s) · 사내망(VPN) 연결을 확인한다") from None
        return json.loads(raw) if raw else None

    def inbox(self) -> list[dict]:
        return self.call("GET", "/comments") or []

    def bundle(self, page_path: str) -> dict:
        return self.call("GET", "/spec?path=" + urllib.parse.quote(page_path, safe=""))

    def login(self, login_id: str, password: str) -> dict:
        return self.call("POST", "/auth/login", {"loginId": login_id, "password": password})

    def react(self, comment_id: str, emoji: str, token: str):
        """토글 API 다. 이미 붙은 반응에 다시 보내면 떼어진다(호출 전에 확인할 것)."""
        return self.call("POST", f"/spec/comments/{urllib.parse.quote(comment_id, safe='')}/reactions", {"emoji": emoji}, token)
