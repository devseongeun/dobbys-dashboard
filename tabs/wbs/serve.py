"""WBS·Jira 탭 handler. 정적 파일 + WBS 엑셀 API + Jira GET 프록시 + Jira 로그인.

Jira 로 쓰는 경로는 없다. 쓰기는 로컬 파일(일정 조정 초안·수동 연결·기타 상태 지정)과 키체인뿐이다.
"""
from __future__ import annotations

import json
import sys
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile
from http.server import BaseHTTPRequestHandler
from pathlib import Path

from dashboard.keychain import KeychainError

from jira_client import KEY_RE, JiraError
from .matching import match_keys
from .store import read_json, write_json

ROOT = Path(__file__).resolve().parent
DRAFTS_MAX_BYTES = 256 * 1024
BODY_MAX_BYTES = 16 * 1024
ALLOWED_HOSTS = {"127.0.0.1", "localhost", "::1"}
# 보드 칸(js/state.js STATUSES). Jira 상태가 이 다섯이 아닌 행(보드의 '기타')만 사용자가 칸을 지정한다.
BOARD_STATUSES = ("할 일", "진행", "개발완료", "완료", "취소")
MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
}
WORKBOOK_ERRORS = (OSError, ValueError, KeyError, zipfile.BadZipFile, ET.ParseError)


def make_handler(service, source, links, assigns, session, drafts_path: Path, domain: str, mode: str = "wbs",
                 root: Path = ROOT):
    """links: 요구사항ID → 이슈키 수동 연결. assigns: 행 키 → 보드 칸 지정.
    mode: 일정 기준(wbs|jira). 화면이 안내 문구·WBS 전용 지표를 고르는 데 쓴다."""
    root = root.resolve()
    js_dir = (root / "js").resolve()

    class Handler(BaseHTTPRequestHandler):
        server_version = "wbs-jira"

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
            if path in ("/", "/index.html"):
                path = "/index.html"
            try:
                candidate = (root / path.lstrip("/")).resolve()
            except (ValueError, OSError):
                return None
            if candidate.parent not in (root, js_dir) or not candidate.is_file() or candidate.suffix not in MIME:
                return None
            if candidate.suffix == ".json":
                return None
            return candidate

        def _host_ok(self) -> bool:
            # DNS 리바인딩 방어: 이 서버는 로컬 브라우저만 상대한다.
            host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
            if host in ALLOWED_HOSTS:
                return True
            self._send_json(403, {"error": "forbidden host"})
            return False

        def _wbs(self) -> tuple[dict, str | None]:
            try:
                return source.load(), None
            except WORKBOOK_ERRORS as exc:
                return {"tasks": [], "holidays": {}}, f"WBS 엑셀을 읽지 못했다: {exc}"

        def _body(self, limit: int):
            """JSON 본문. 문제가 있으면 응답을 보내고 None. 다른 출처의 JSON 요청은 preflight 에서 막힌다."""
            if not (self.headers.get("Content-Type") or "").startswith("application/json"):
                self._send_json(415, {"error": "application/json 만 받는다"})
                return None
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            if not 0 <= length <= limit:
                self._send_json(413 if length > limit else 400, {"error": "본문 길이가 잘못됐다"})
                return None
            try:
                return json.loads(self.rfile.read(length) or b"null")
            except ValueError:
                self._send_json(400, {"error": "JSON 이 아니다"})
                return None

        def do_GET(self):
            if not self._host_ok():
                return
            parsed = urllib.parse.urlparse(self.path)
            path = urllib.parse.unquote(parsed.path)
            query = urllib.parse.parse_qs(parsed.query)
            if path == "/api/wbs":
                wbs, error = self._wbs()
                self._send_json(200, {**wbs, "error": error})
                return
            if path == "/api/board":
                payload = service.payload(refresh=query.get("refresh", ["0"])[0] == "1")
                wbs, _ = self._wbs()
                self._send_json(200, {**payload, "domain": domain, "mode": mode,
                                      "links": match_keys(wbs["tasks"], payload.get("issues") or [], links.load()),
                                      "assigned": assigns.load()})
                return
            if path == "/api/issues":
                keys = [k for k in query.get("keys", [""])[0].split(",") if k]
                try:
                    self._send_json(200, service.lookup(keys))
                except ValueError as exc:
                    self._send_json(400, {"issues": [], "error": str(exc)})
                return
            if path == "/api/drafts":
                self._send_json(200, read_json(drafts_path))
                return
            target = self._resolve(path)
            if target is None:
                self._send_json(404, {"error": "not found"})
                return
            self._send(200, target.read_bytes(), MIME[target.suffix])

        def _reject(self):
            self._send_json(405, {"error": "method not allowed"})

        def do_PUT(self):
            if not self._host_ok():
                return
            path = urllib.parse.urlparse(self.path).path
            if path == "/api/drafts":
                drafts = self._body(DRAFTS_MAX_BYTES)
                if drafts is None:
                    return
                if not isinstance(drafts, dict) or not all(isinstance(v, dict) for v in drafts.values()):
                    self._send_json(400, {"error": "초안은 {이슈키: {...}} 객체여야 한다"})
                    return
                write_json(drafts_path, drafts)
                self._send_json(200, {"saved": len(drafts)})
                return
            if path == "/api/links":
                body = self._body(BODY_MAX_BYTES)
                if body is None:
                    return
                task = body.get("task") if isinstance(body, dict) else None
                key = body.get("key") if isinstance(body, dict) else None
                wbs, _ = self._wbs()
                if task not in {t["id"] for t in wbs["tasks"]}:
                    self._send_json(400, {"error": "WBS 에 없는 요구사항ID 다"})
                    return
                if key is not None and (not isinstance(key, str) or not KEY_RE.match(key)):
                    self._send_json(400, {"error": "이슈 키 형식이 아니다 (예: PROJ-1234)"})
                    return
                try:
                    saved = links.set(task, key)
                except ValueError as exc:
                    self._send_json(500, {"error": str(exc)})
                    return
                service.invalidate()
                self._send_json(200, {"links": saved})
                return
            if path == "/api/assign":
                body = self._body(BODY_MAX_BYTES)
                if body is None:
                    return
                key = body.get("key") if isinstance(body, dict) else None
                status = body.get("status") if isinstance(body, dict) else None
                # 행 키는 Jira 이슈키이거나, Jira 에 연결되지 않은 WBS 행의 요구사항ID 다(js/model.js joinRows).
                if not isinstance(key, str) or not (KEY_RE.match(key) or key in {t["id"] for t in self._wbs()[0]["tasks"]}):
                    self._send_json(400, {"error": "이슈키나 WBS 요구사항ID 가 아니다"})
                    return
                if status is not None and status not in BOARD_STATUSES:
                    self._send_json(400, {"error": "상태는 " + "·".join(BOARD_STATUSES) + " 중 하나다"})
                    return
                try:
                    saved = assigns.set(key, status)
                except ValueError as exc:
                    self._send_json(500, {"error": str(exc)})
                    return
                self._send_json(200, {"assigned": saved})
                return
            self._reject()

        def do_POST(self):
            if not self._host_ok():
                return
            path = urllib.parse.urlparse(self.path).path
            if path not in ("/api/login", "/api/logout"):
                self._reject()
                return
            body = self._body(BODY_MAX_BYTES)
            if body is None:
                return
            if path == "/api/logout":
                try:
                    session.logout()
                except KeychainError as exc:
                    self._send_json(500, {"error": str(exc)})
                    return
                service.invalidate()
                self._send_json(200, {})
                return
            email = (body.get("email") or "").strip() if isinstance(body, dict) else ""
            token = (body.get("token") or "").strip() if isinstance(body, dict) else ""
            if not email or not token:
                self._send_json(400, {"error": "이메일과 API token 을 입력한다"})
                return
            try:
                me = session.login(email, token)
            except JiraError as exc:
                if exc.status in (401, 403):
                    self._send_json(401, {"error": "Jira 인증 실패: 이메일·API token 을 확인한다"})
                else:
                    self._send_json(502, {"error": exc.message})
                return
            except KeychainError as exc:
                self._send_json(500, {"error": str(exc)})
                return
            service.invalidate()
            self._send_json(200, {"displayName": me.get("displayName")})

        do_DELETE = do_PATCH = _reject

    return Handler
