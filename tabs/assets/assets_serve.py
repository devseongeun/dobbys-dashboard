#!/usr/bin/env python3
"""90-assets 의사결정 현황 로컬 서버. 127.0.0.1 에만 바인딩한다.

- `/`는 `00_90-assets_목록.html`을 준다. 목록의 문서 링크(같은 폴더 HTML)도 그대로 열린다.
- `GET /api/assets?refresh=1`은 `assets_index.sync(folder)`로 목록 md·HTML을 다시 만들고 결과를 JSON으로 준다.
  `refresh` 없이 부르면 마지막 동기화 결과만 준다. 화면의 `⟳ 새로고침` 버튼이 쓴다.
- 기동할 때 한 번 동기화한다.
- 설정에서 고른 의사결정 폴더 바로 아래 파일만 준다(하위 폴더·숨김 파일·상위 경로 거절). `Host`가 localhost가 아니면 403(DNS 리바인딩 방어).

사용:
  대시보드(저장소 루트 serve.py, http://127.0.0.1:8787/#assets)가 tabs/assets/ 의 make_handler 를 /assets/ 아래에 올린다.

상주: 업무 대시보드 launchd `com.dobbys-dashboard`.
  스크립트(템플릿 포함)를 고친 뒤에는 `launchctl kickstart -k gui/$(id -u)/com.dobbys-dashboard` 로 재시작한다. 상주 프로세스는 옛 코드를 메모리에 들고 있다.
"""
import json
import sys
import threading
import urllib.parse
from datetime import datetime
from http.server import BaseHTTPRequestHandler
from pathlib import Path

ALLOWED_HOSTS = {"127.0.0.1", "localhost", "::1"}
MIME = {
    ".html": "text/html; charset=utf-8",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
}


class Syncer:
    """동기화는 파일을 쓰므로 한 번에 하나만 돈다."""

    def __init__(self, sync):
        self._sync = sync
        self._lock = threading.Lock()
        self.last = None

    def run(self) -> dict:
        with self._lock:
            try:
                result = {"ok": True, "error": None, **self._sync()}
            except Exception as exc:  # 생성기 오류(md 형식 불일치 등)를 화면 배너로 돌려준다.
                result = {"ok": False, "error": f"{type(exc).__name__}: {exc}", "counts": None, "warnings": [], "stale": []}
            result["syncedAt"] = datetime.now().astimezone().isoformat(timespec="seconds")
            self.last = result
            return result


def make_handler(syncer: Syncer, root: Path, index: str):
    root = root.resolve()

    class Handler(BaseHTTPRequestHandler):
        server_version = "assets-serve"

        def log_message(self, fmt, *args):
            sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

        def _send(self, status, body: bytes, content_type: str):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _send_json(self, status, payload):
            self._send(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"), MIME[".json"])

        def _resolve(self, path: str) -> Path | None:
            name = index if path in ("", "/") else path.lstrip("/")
            if not name or name.startswith(".") or "/" in name or "\\" in name:
                return None
            try:
                candidate = (root / name).resolve()
            except (ValueError, OSError):
                return None
            if candidate.parent != root or not candidate.is_file() or candidate.suffix not in MIME:
                return None
            return candidate

        def do_GET(self):
            host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
            if host not in ALLOWED_HOSTS:
                self._send_json(403, {"error": "forbidden host"})
                return

            parsed = urllib.parse.urlparse(self.path)
            path = urllib.parse.unquote(parsed.path)

            if path == "/api/assets":
                refresh = urllib.parse.parse_qs(parsed.query).get("refresh", ["0"])[0] == "1"
                self._send_json(200, syncer.run() if refresh or syncer.last is None else syncer.last)
                return

            target = self._resolve(path)
            if target is None:
                self._send_json(404, {"error": "not found"})
                return
            self._send(200, target.read_bytes(), MIME[target.suffix])

        def _reject(self):
            self._send_json(405, {"error": "method not allowed"})

        do_POST = do_PUT = do_DELETE = do_PATCH = _reject

    return Handler
