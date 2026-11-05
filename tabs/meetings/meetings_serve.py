"""70-meetings 회의 자료(Canvas) 로컬 서버. 127.0.0.1 에만 바인딩한다.

- `/`는 회의 자료 화면(`meetings.html`), `/meetings.js`·`/meetings_lib.js`·`/meetings.css`는 화면 파일,
  `/marked.umd.js`는 md 렌더러(`tabs/_common/vendor/`)다.
- 읽기(GET): `/api/meetings` 목록, `/api/meetings/<id>` 블록(없으면 404, 깨진 JSON이면 422),
  `/api/tree?path=` Vault 폴더 한 단계, `/api/search?q=` 파일 검색,
  `/file?p=<vault 경로>` Vault 안 미리보기 형식 파일(회의에 담겼는지와 무관, Vault 트리 미리보기도 쓴다).
- 쓰기(POST, `X-Meetings-Editor: 1` 헤더·로컬 Origin·본문 version 필요): 새 회의, 회의·블록 이름, 새 블록,
  카드 추가·이동·삭제. 응답은 바뀐 뒤의 상세. 규칙은 meetings_edit.py.
- 요청마다 Canvas를 다시 읽는다. `Host`가 localhost가 아니면 403(DNS 리바인딩 방어), GET·POST 외에는 405.

대시보드가 make_handler 를 /meetings/ 아래에 올린다.
설계: projects/work/work-dashboard/docs/superpowers/specs/2026-11-04-meetings-canvas-design.md
"""
import json
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler
from pathlib import Path

from . import meetings_canvas, meetings_edit, vault_tree

ALLOWED_HOSTS = {"127.0.0.1", "localhost", "::1"}

HERE = Path(__file__).resolve().parent
SCRIPT = "text/javascript; charset=utf-8"
STATIC = {
    "/": (HERE / "meetings.html", "text/html; charset=utf-8"),
    "/meetings.js": (HERE / "meetings.js", SCRIPT),
    "/meetings_lib.js": (HERE / "meetings_lib.js", SCRIPT),
    "/meetings.css": (HERE / "meetings.css", "text/css; charset=utf-8"),
    "/marked.umd.js": (HERE.parent / "_common" / "vendor" / "marked.umd.js", SCRIPT),
}
JSON = "application/json; charset=utf-8"
API = "/api/meetings"
EDITOR_HEADER = "X-Meetings-Editor"
MAX_BODY = 64 * 1024
EditError = meetings_edit.EditError


def make_handler(root: Path, vault: Path):
    root = root.resolve()
    vault = vault.resolve()

    class Handler(BaseHTTPRequestHandler):
        server_version = "meetings-serve"

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
            self._send(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"), JSON)

        def _host_ok(self) -> bool:
            host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
            if host in ALLOWED_HOSTS:
                return True
            self._send_json(403, {"error": "forbidden host"})
            return False

        def do_GET(self):
            if not self._host_ok():
                return
            parsed = urllib.parse.urlparse(self.path)
            path = urllib.parse.unquote(parsed.path) or "/"
            query = urllib.parse.parse_qs(parsed.query)

            if path == API:
                self._send_json(200, {"meetings": meetings_canvas.list_meetings(root)})
                return
            if path.startswith(API + "/"):
                self._detail(path.removeprefix(API + "/"))
                return
            if path == "/api/tree":
                rel = query.get("path", [""])[0]
                entries = vault_tree.list_dir(vault, rel)
                if entries is None:
                    self._send_json(404, {"error": "폴더가 없다"})
                else:
                    self._send_json(200, {"path": rel, "entries": entries})
                return
            if path == "/api/search":
                results, truncated = vault_tree.search(vault, query.get("q", [""])[0])
                self._send_json(200, {"results": results, "truncated": truncated})
                return
            if path == "/file":
                self._file(query)
                return
            if path in STATIC:
                target, content_type = STATIC[path]
                self._send(200, target.read_bytes(), content_type)
                return
            self._send_json(404, {"error": "not found"})

        def _detail(self, meeting_id: str):
            try:
                meeting = meetings_canvas.read_meeting(root, vault, meeting_id)
            except meetings_canvas.CanvasError as exc:
                self._send_json(422, {"error": str(exc)})
                return
            if meeting is None:
                self._send_json(404, {"error": "회의 Canvas가 없다"})
                return
            self._send_json(200, meeting)

        def _file(self, query: dict):
            target = meetings_canvas.resolve_vault_file(vault, query.get("p", [""])[0])
            content_type = meetings_canvas.PREVIEW_MIME.get(target.suffix.lower()) if target else None
            if content_type is None:
                self._send_json(404, {"error": "not found"})
                return
            self._send(200, target.read_bytes(), content_type)

        def do_POST(self):
            if not self._host_ok():
                return
            if self.headers.get(EDITOR_HEADER) != "1":
                self._send_json(403, {"error": f"{EDITOR_HEADER} 헤더가 없다"})
                return
            origin = self.headers.get("Origin")
            if origin is not None and urllib.parse.urlsplit(origin).hostname not in ALLOWED_HOSTS:
                self._send_json(403, {"error": "forbidden origin"})
                return
            try:
                meeting_id = self._write(urllib.parse.urlparse(self.path).path, self._read_json())
            except EditError as exc:
                payload = {"error": str(exc)}
                if exc.version is not None:
                    payload["version"] = exc.version
                self._send_json(exc.status, payload)
                return
            if meeting_id is None:
                self._send_json(404, {"error": "not found"})
                return
            self._detail(meeting_id)

        def _read_json(self) -> dict:
            try:
                length = int(self.headers.get("Content-Length", ""))
            except ValueError:
                raise EditError(400, "Content-Length 가 필요하다") from None
            if length < 0:
                raise EditError(400, "Content-Length 가 잘못됐다")
            if length > MAX_BODY:
                raise EditError(413, "본문이 너무 크다")
            try:
                body = json.loads(self.rfile.read(length) or b"null")
            except (UnicodeDecodeError, json.JSONDecodeError):
                raise EditError(400, "본문이 JSON이 아니다") from None
            if not isinstance(body, dict):
                raise EditError(400, "본문은 JSON 객체다")
            return body

        def _write(self, raw_path: str, body: dict) -> str | None:
            parts = [urllib.parse.unquote(part) for part in raw_path.split("/")]
            if parts[:3] != ["", "api", "meetings"]:
                return None
            version = body.get("version")
            edit = meetings_edit
            match parts[3:]:
                case []:
                    return edit.create_meeting(root, body.get("date"), body.get("title"))
                case [meeting_id, "rename"]:
                    return edit.rename_meeting(root, meeting_id, body.get("date"), body.get("title"), version)
                case [meeting_id, "blocks"]:
                    return edit.add_block(root, meeting_id, body.get("label"), version)
                case [meeting_id, "blocks", block_id, "rename"]:
                    return edit.rename_block(root, meeting_id, block_id, body.get("label"), version)
                case [meeting_id, "blocks", block_id, "items"]:
                    return edit.add_item(root, vault, meeting_id, block_id, body, version)
                case [meeting_id, "items", item_id, "move"]:
                    return edit.move_item(root, vault, meeting_id, item_id, body.get("block"), body.get("index"), version)
                case [meeting_id, "items", item_id, "delete"]:
                    return edit.delete_item(root, meeting_id, item_id, version)
            return None

        def _reject(self):
            self._send_json(405, {"error": "method not allowed"})

        do_PUT = do_DELETE = do_PATCH = _reject

    return Handler

