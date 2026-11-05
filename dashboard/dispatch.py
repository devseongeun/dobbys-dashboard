"""경로 prefix 로 기존 앱 handler 에 요청을 넘기는 디스패처.

- `/{id}/...` 는 prefix 를 떼고 해당 앱 handler 로 넘긴다. 보안 검사는 각 앱 handler 가 원래 하던 대로 한다.
- `/{id}` 는 `/{id}/` 로 301. 앱 안의 상대 경로가 맞게 풀리게 한다.
- 그 밖의 경로는 셸(정적 파일·상태 API)이다. Host 가 로컬이 아니면 403(DNS 리바인딩 방어).
"""
from __future__ import annotations

import json
import sys
import traceback
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit

ALLOWED_HOSTNAMES = frozenset({"127.0.0.1", "localhost", "::1"})
SHELL_FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/shell.css": "shell.css",
    "/shell.js": "shell.js",
    "/route.js": "route.js",
}
MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
}
# BaseHTTPRequestHandler.__init__/handle_one_request 가 채우는 요청 상태. inner handler 로 그대로 옮긴다.
COPIED = (
    "request", "client_address", "server", "rfile", "wfile", "raw_requestline",
    "requestline", "command", "request_version", "headers", "close_connection",
)


@dataclass(frozen=True)
class Mount:
    id: str
    handler: type[BaseHTTPRequestHandler] | None
    error: str | None = None


def host_allowed(raw: str) -> bool:
    """포트는 무시하고 호스트명만 본다. 빈 값·깨진 값은 거절."""
    try:
        return urlsplit(f"//{raw.strip()}").hostname in ALLOWED_HOSTNAMES
    except ValueError:
        return False


def make_dispatcher(mounts: list[Mount], shell_root: Path):
    table = {mount.id: mount for mount in mounts}
    shell_root = shell_root.resolve()

    class DispatchHandler(BaseHTTPRequestHandler):
        server_version = "work-dashboard"
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):
            sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

        def _send(self, status, body: bytes, content_type: str, extra=()):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for name, value in extra:
                self.send_header(name, value)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _json(self, status, payload):
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self._send(status, body, "application/json; charset=utf-8")

        def _host_ok(self) -> bool:
            if host_allowed(self.headers.get("Host") or ""):
                return True
            self._json(403, {"error": "forbidden host"})
            return False

        def _dispatch(self):
            parts = urlsplit(self.path)
            path = parts.path or "/"
            query = f"?{parts.query}" if parts.query else ""
            segments = path.split("/", 2)  # "/wbs/x" → ["", "wbs", "x"], "/wbs" → ["", "wbs"]
            mount = table.get(segments[1]) if len(segments) > 1 else None
            delegated = mount is not None and len(segments) == 3 and mount.handler is not None
            if not delegated:
                # 셸이 직접 답하는 요청은 본문을 읽지 않으므로, 쓰기 요청이면 연결을 닫아 다음 요청과 섞이지 않게 한다.
                if self.command not in ("GET", "HEAD"):
                    self.close_connection = True
                if not self._host_ok():
                    return
            if mount is None:
                self._shell(path)
            elif len(segments) == 2:
                self._send(301, b"", "text/plain; charset=utf-8", (("Location", f"{path}/{query}"),))
            elif mount.handler is None:
                self._json(503, {"error": f"{mount.id} 초기화 실패: {mount.error}"})
            else:
                self._delegate(mount, "/" + segments[2] + query)

        def _delegate(self, mount: Mount, inner_path: str):
            # 생성자는 소켓 처리 루프를 돌리므로 부르지 않는다. 요청 상태만 옮긴다.
            inner = mount.handler.__new__(mount.handler)
            for name in COPIED:
                setattr(inner, name, getattr(self, name))
            inner.path = inner_path
            method = getattr(inner, "do_" + self.command, None)
            if method is None:
                self.close_connection = True
                self._json(501, {"error": f"{self.command} 은 지원하지 않는다"})
                return
            try:
                method()
                inner.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                self.close_connection = True
                return
            except Exception:
                traceback.print_exc()
                self.close_connection = True
                # send_response 가 한 번이라도 불렸으면 응답이 이미 나가는 중이다. 연결만 닫는다.
                if not hasattr(inner, "_headers_buffer"):
                    self._json(500, {"error": f"{mount.id} 처리 중 오류"})
                return
            # HTTP/1.0 handler(wbs·assets)는 keep-alive 를 알리지 않는다. 연결을 닫아야 클라이언트와 상태가 맞는다.
            self.close_connection = inner.close_connection or inner.protocol_version != "HTTP/1.1"

        def _shell(self, path: str):
            if self.command not in ("GET", "HEAD"):
                self._json(405, {"error": "method not allowed"})
                return
            if path == "/_dashboard/status":
                self._json(200, {"mounts": [
                    {"id": m.id, "ok": m.handler is not None, "error": m.error} for m in mounts
                ]})
                return
            name = SHELL_FILES.get(path)
            target = shell_root / name if name else None
            if target is None or not target.is_file():
                self._json(404, {"error": "not found"})
                return
            self._send(200, target.read_bytes(), MIME[target.suffix])

        do_GET = do_HEAD = do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _dispatch

    return DispatchHandler
