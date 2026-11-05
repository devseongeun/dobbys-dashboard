#!/usr/bin/env python3
"""구현 진행 현황 로컬 서버. 127.0.0.1 에만 바인딩한다.

- `/`는 설정한 폴더의 `00_<폴더명>_목록.html`(구현 진행 현황)을 준다.
- `/view.html#<파일명>`은 md 뷰어(`plans_view.html`), `/marked.umd.js`는 뷰어가 쓰는 렌더러(`tabs/_common/vendor/`)다.
- `/raw/<파일명>`은 설정한 폴더 바로 아래 `.md` 원문만 준다(하위 폴더·숨김 파일·상위 경로 거절).
- `GET /api/plans?refresh=1`은 `plans_index.sync(folder)`로 목록 md·HTML을 다시 만들고 결과를 JSON으로 준다.
  `refresh` 없이 부르면 마지막 동기화 결과만 준다. 화면의 `⟳ 새로고침` 버튼이 쓴다.
- `Host`가 localhost가 아니면 403(DNS 리바인딩 방어), GET 외에는 405.

사용:
  대시보드(저장소 루트 serve.py, `/#plans`)가 tabs/plans/ 의 make_handler 를 /plans/ 아래에 올린다. 폴더는 설정에서 고른다.
  스크립트·뷰어를 고친 뒤에는 `launchctl kickstart -k gui/$(id -u)/com.dobbys-dashboard` 로 대시보드를 재시작한다.
"""
import json
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler
from pathlib import Path

from ..assets.assets_serve import ALLOWED_HOSTS, Syncer

HERE = Path(__file__).resolve().parent
STATIC = {
    "/view.html": (HERE / "plans_view.html", "text/html; charset=utf-8"),
    "/marked.umd.js": (HERE.parent / "_common" / "vendor" / "marked.umd.js", "text/javascript; charset=utf-8"),
}
HTML = "text/html; charset=utf-8"
MARKDOWN = "text/markdown; charset=utf-8"
JSON = "application/json; charset=utf-8"


def resolve_plan(root: Path, name: str) -> Path | None:
    """root 바로 아래의 .md 파일만 돌려준다. 그 밖(하위 폴더·숨김·상위 경로·다른 확장자)은 None."""
    if not name or name.startswith(".") or "/" in name or "\\" in name or not name.endswith(".md"):
        return None
    try:
        candidate = (root / name).resolve()
    except (ValueError, OSError):
        return None
    if candidate.parent != root or not candidate.is_file():
        return None
    return candidate


def make_handler(syncer: Syncer, root: Path, index: str):
    root = root.resolve()

    class Handler(BaseHTTPRequestHandler):
        server_version = "plans-serve"

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

        def do_GET(self):
            host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
            if host not in ALLOWED_HOSTS:
                self._send_json(403, {"error": "forbidden host"})
                return

            parsed = urllib.parse.urlparse(self.path)
            path = urllib.parse.unquote(parsed.path)

            if path == "/api/plans":
                refresh = urllib.parse.parse_qs(parsed.query).get("refresh", ["0"])[0] == "1"
                self._send_json(200, syncer.run() if refresh or syncer.last is None else syncer.last)
                return
            if path in ("", "/"):
                target = root / index
                if target.is_file():
                    self._send(200, target.read_bytes(), HTML)
                else:
                    self._send_json(404, {"error": "목록 HTML이 아직 없다. 새로고침(api/plans?refresh=1)으로 만든다"})
                return
            if path in STATIC:
                target, content_type = STATIC[path]
                self._send(200, target.read_bytes(), content_type)
                return
            if path.startswith("/raw/"):
                target = resolve_plan(root, path.removeprefix("/raw/"))
                if target is not None:
                    self._send(200, target.read_bytes(), MARKDOWN)
                    return
            self._send_json(404, {"error": "not found"})

        def _reject(self):
            self._send_json(405, {"error": "method not allowed"})

        do_POST = do_PUT = do_DELETE = do_PATCH = _reject

    return Handler
