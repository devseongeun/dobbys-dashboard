"""기획서 코멘트 현황 탭 handler. 브라우저는 127.0.0.1 만 부르고, 서버가 기획서 API 를 대신 부른다."""
from __future__ import annotations

import json
import re
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler
from pathlib import Path

from dashboard.keychain import KeychainError

from .client import TromboneError
from .model import PRIORITY_ORDER
from .service import ExportDisabled, NeedLogin, NothingToExport

PAGE = Path(__file__).resolve().parent / "static" / "index.html"
ALLOWED_HOSTS = {"127.0.0.1", "localhost", "::1"}
JSON = "application/json; charset=utf-8"
MAX_BODY = 64 * 1024
MAX_TEXT = 500
MAX_IDS = 200
COMMENT_ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")


def make_handler(service):
    class Handler(BaseHTTPRequestHandler):
        server_version = "comments"

        def log_message(self, fmt, *args):
            sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

        def _send(self, status, body: bytes, content_type: str):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status, payload):
            self._send(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"), JSON)

        def _host_ok(self) -> bool:
            host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
            if host in ALLOWED_HOSTS:
                return True
            self._json(403, {"error": "forbidden host"})
            return False

        def _path(self) -> str:
            return urllib.parse.urlparse(self.path).path

        def _guard(self, fn):
            try:
                result = fn()
            except NeedLogin as exc:
                self._json(401, {"error": str(exc)})
            except TromboneError as exc:
                self._json(502, {"error": str(exc)})
            except (ExportDisabled, NothingToExport) as exc:
                self._json(409, {"error": str(exc)})
            except KeychainError as exc:
                self._json(500, {"error": str(exc)})
            else:
                self._json(200, result)

        def _body(self):
            if not (self.headers.get("Content-Type") or "").startswith("application/json"):
                self._json(415, {"error": "application/json 만 받는다"})
                return None
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            if not 0 <= length <= MAX_BODY:
                self._json(413 if length > MAX_BODY else 400, {"error": "본문 길이가 잘못됐다"})
                return None
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                body = None
            if not isinstance(body, dict):
                self._json(400, {"error": "JSON 객체여야 한다"})
                return None
            return body

        def do_GET(self):
            if not self._host_ok():
                return
            path = self._path()
            if path in ("/", "/index.html"):
                self._send(200, PAGE.read_bytes(), "text/html; charset=utf-8")
            elif path == "/api/session":
                self._guard(service.describe)
            elif path == "/api/report":
                self._guard(service.report)
            else:
                self._json(404, {"error": "not found"})

        def do_POST(self):
            if not self._host_ok():
                return
            path = self._path()
            if path not in ("/api/login", "/api/logout", "/api/reactions", "/api/export"):
                self._json(405, {"error": "method not allowed"})
                return
            body = self._body()
            if body is None:
                return
            if path == "/api/logout":
                self._guard(lambda: service.logout() or {})
            elif path == "/api/export":
                self._guard(lambda: {"path": str(service.export())})
            elif path == "/api/reactions":
                ids = body.get("ids")
                if not isinstance(ids, list) or not ids or len(ids) > MAX_IDS or not all(
                        isinstance(i, str) and COMMENT_ID.match(i) for i in ids):
                    self._json(400, {"error": "ids 는 코멘트ID 목록이어야 한다"})
                    return
                self._guard(lambda: service.react(ids))
            else:
                login_id, password = body.get("loginId"), body.get("password")
                if not isinstance(login_id, str) or not login_id.strip() or not isinstance(password, str) or not password:
                    self._json(400, {"error": "이메일과 비밀번호를 입력한다"})
                    return
                try:
                    name = service.login(login_id.strip(), password)
                except TromboneError as exc:
                    self._json(401 if exc.status in (400, 401, 403) else 502, {"error": f"로그인 실패: {exc}"})
                    return
                except KeychainError as exc:
                    self._json(500, {"error": str(exc)})
                    return
                self._json(200, {"name": name})

        def do_PUT(self):
            if not self._host_ok():
                return
            if self._path() != "/api/overrides":
                self._json(405, {"error": "method not allowed"})
                return
            body = self._body()
            if body is None:
                return
            comment_id, priority, resolved = body.get("id"), body.get("priority"), body.get("resolved")
            valid_priority = priority is None or (
                isinstance(priority, dict) and priority.get("level", "") in ("", *PRIORITY_ORDER)
                and isinstance(priority.get("reason", ""), str) and len(priority.get("reason", "")) <= MAX_TEXT)
            valid_resolved = resolved is None or (isinstance(resolved, str) and len(resolved) <= MAX_TEXT)
            if (not isinstance(comment_id, str) or not COMMENT_ID.match(comment_id) or not valid_priority
                    or not valid_resolved or (priority is None and resolved is None)):
                self._json(400, {"error": "id 와 priority{level: 상|중|'', reason} 또는 resolved 가 필요하다"})
                return
            self._json(200, service.set_override(comment_id, priority, resolved))

        def _reject(self):
            self._json(405, {"error": "method not allowed"})

        do_DELETE = do_PATCH = _reject

    return Handler
