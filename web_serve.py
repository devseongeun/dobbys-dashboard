"""도비의 대시보드 웹 버전 서버(사내 공용 서버용). 표준 라이브러리만 쓴다.

로컬판(serve.py, launchd)과 따로 돈다. 파일은 브라우저가 File System Access API 로 직접 읽고, 설정·상태는 브라우저
IndexedDB 에 둔다. 이 서버는 정적 셸(`web/`)과 `/api/<이름>` 프록시만 준다. 파일 내용은 서버로 오지 않는다.

- 정적 파일: `web/` 아래만(경로 탈출·숨김 파일 거절). 웹 정적 루트 밖에서 함께 쓰는 파일은 `SHARED_FILES` 명시 목록만 준다.
  폴더의 index.html·공유 파일까지 실제로 열 파일의 경로를 resolve 해 루트(web/·저장소) 안일 때만 준다(심볼릭 링크로 밖을 가리키면 404).
- `/api/<이름>`: `API_ROUTES` 에 등록한 `api/<이름>.py` 의 `handle(Request) -> Response`. Origin 이 있으면 ALLOWED_ORIGINS 와
  같아야 하고 `X-Dobbys-Proxy: 1` 헤더가 있어야 한다(없으면 403). 본문은 64 KiB 까지.
- 모든 요청: Host 가 ALLOWED_ORIGINS 의 host[:port] 가 아니면 421. 모든 응답(표준 라이브러리의 400·501 오류 포함)에
  CSP·nosniff·Referrer-Policy.
- 로그: 메서드·경로(쿼리 없음)·상태만 남긴다. 쿼리·헤더(Authorization 등)는 남기지 않는다. api 모듈 오류는 예외 종류만,
  DOBBYS_DEBUG=1 이면 위치(파일:줄 함수)까지. 예외 문구는 요청 값이 섞일 수 있어 어느 쪽에서도 남기지 않는다.

사용:
  python3 web_serve.py                                   # http://127.0.0.1:8788/
  HOST=127.0.0.1 PORT=8788 ALLOWED_ORIGINS=https://dash.example.com python3 web_serve.py
사내 서버에서는 HTTPS 리버스 프록시 뒤에서 돈다(README '웹 버전(사내 서버용)').
"""
from __future__ import annotations

import sys

if sys.version_info < (3, 11):
    sys.exit("Python 3.11 이상이 필요하다. python3 --version 을 확인한다.")

import json  # noqa: E402
import os  # noqa: E402
import socket  # noqa: E402
import traceback  # noqa: E402
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer  # noqa: E402
from pathlib import Path  # noqa: E402
from urllib.parse import parse_qs, unquote, urlsplit  # noqa: E402

import api.jira  # noqa: E402
import api.version  # noqa: E402
from api._http import Request, Response  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent
WEB_ROOT = REPO_ROOT / "web"
MAX_BODY = 64 * 1024

# /api/<이름> → 모듈. 모르는 이름은 404.
API_ROUTES = {
    "version": api.version,
    "jira": api.jira,  # 웹 wbs 탭의 Jira Cloud 조회 전달(허용 규칙은 api/jira.py)
}

# 웹 정적 루트(web/) 밖이지만 웹이 함께 쓰는 파일. 로컬판과 같은 파일을 복사하지 않고 이 목록의 경로로만 연다.
# 키는 web/ 기준 URL 경로, 값은 저장소 안 실제 파일.
SHARED_FILES = {
    # 셸 순수 로직(해시 라우팅·사이드바 순서·온보딩 단계). 로컬판 tests/js 가 이미 검증한다.
    "shared/route.js": REPO_ROOT / "shell" / "route.js",
    "shared/order.js": REPO_ROOT / "shell" / "order.js",
    "shared/onboarding_flow.js": REPO_ROOT / "shell" / "onboarding_flow.js",
    "shared/shell.css": REPO_ROOT / "shell" / "shell.css",
    # plans 뷰어의 md 렌더러와 내려받기 템플릿.
    "tabs/plans/marked.umd.js": REPO_ROOT / "tabs" / "_common" / "vendor" / "marked.umd.js",
    "tabs/plans/templates/YYYY-MM-DD 계획 제목.md": REPO_ROOT / "tabs" / "plans" / "templates" / "YYYY-MM-DD 계획 제목.md",
    # meetings 화면: 로컬판 화면 HTML·CSS·순수 함수(tests/js/meetings_lib.test.js 가 검증)와 md 렌더러.
    # 화면 스크립트 meetings.js 와 Canvas 읽기·쓰기는 web/tabs/meetings/ 의 웹 것이다.
    "tabs/meetings/meetings.html": REPO_ROOT / "tabs" / "meetings" / "meetings.html",
    "tabs/meetings/meetings.css": REPO_ROOT / "tabs" / "meetings" / "meetings.css",
    "tabs/meetings/meetings_lib.js": REPO_ROOT / "tabs" / "meetings" / "meetings_lib.js",
    "tabs/meetings/marked.umd.js": REPO_ROOT / "tabs" / "_common" / "vendor" / "marked.umd.js",
    # assets 내려받기 템플릿.
    "tabs/assets/templates/의사결정_문서_제목.html": REPO_ROOT / "tabs" / "assets" / "templates" / "의사결정_문서_제목.html",
    # 주간 보고 내려받기 템플릿(뷰어의 표준 섹션 안내 창도 이 파일을 읽는다).
    "tabs/weekly/templates/YYYY-MM-DD 주간 보고.md": REPO_ROOT / "tabs" / "weekly" / "templates" / "YYYY-MM-DD 주간 보고.md",
}

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; "
    "frame-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
)
SECURITY_HEADERS = (
    ("Content-Security-Policy", CSP),
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "no-referrer"),
)
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


def default_origins(port: int) -> list[str]:
    return [f"http://127.0.0.1:{port}", f"http://localhost:{port}"]


def parse_origins(raw: str | None, port: int) -> list[str]:
    """쉼표 구분 → 끝 `/` 를 뗀 소문자 origin 목록. 비면 127.0.0.1·localhost 의 PORT."""
    origins = [o.strip().rstrip("/").lower() for o in (raw or "").split(",") if o.strip()]
    return origins or default_origins(port)


def allowed_hosts(origins: list[str]) -> frozenset[str]:
    """origin 의 host[:port](netloc). Host 헤더는 이 중 하나와 같아야 한다."""
    hosts = set()
    for origin in origins:
        netloc = urlsplit(origin).netloc
        if netloc:
            hosts.add(netloc.lower())
    return frozenset(hosts)


def inside(root: Path, path: Path) -> Path | None:
    """path 를 resolve(심볼릭 링크를 끝까지 따라감)한 결과가 root(resolve 된 것) 안이고 숨김 조각이 없으면 그 경로."""
    try:
        target = path.resolve()
    except (OSError, ValueError):
        return None
    if not target.is_relative_to(root) or any(p.startswith(".") for p in target.relative_to(root).parts):
        return None
    return target


def index_file(web_root: Path, folder: Path) -> Path | None:
    """폴더의 index.html. 링크라면 가리키는 실제 파일도 web_root 안이어야 한다."""
    target = inside(web_root, folder / "index.html")
    return target if target is not None and target.is_file() else None


def static_target(web_root: Path, shared: dict[str, Path], rel: str, shared_root: Path | None = None) -> Path | None:
    """URL 경로(앞 `/` 없음, 디코드됨) → 줄 파일(폴더면 폴더). web_root 밖·숨김 조각·NUL 은 None.
    공유 파일은 resolve 한 경로가 shared_root(기본 저장소 루트) 안일 때만."""
    if rel in shared:
        target = inside((shared_root or REPO_ROOT).resolve(), shared[rel])
        return target if target is not None and target.is_file() else None
    if "\x00" in rel or "\\" in rel:
        return None
    parts = [p for p in rel.split("/") if p]
    if any(p.startswith(".") for p in parts):
        return None
    target = inside(web_root, web_root / Path(*parts)) if parts else web_root
    if target is None:
        return None
    if target.is_dir():
        return target  # 부르는 쪽이 index_file()·슬래시 리다이렉트를 정한다
    return target if target.is_file() else None


def make_handler(web_root: Path = WEB_ROOT, origins: list[str] | None = None, routes: dict | None = None,
                 shared: dict[str, Path] | None = None, log=sys.stderr, shared_root: Path = REPO_ROOT):
    web_root = Path(web_root).resolve()
    shared_root = Path(shared_root).resolve()
    origins = list(origins if origins is not None else default_origins(8788))
    hosts = allowed_hosts(origins)
    routes = dict(API_ROUTES if routes is None else routes)
    shared = dict(SHARED_FILES if shared is None else shared)

    class Handler(BaseHTTPRequestHandler):
        server_version = "dobbys-dashboard-web"
        sys_version = ""
        protocol_version = "HTTP/1.1"

        # 요청 줄 전체(쿼리 포함)를 남기는 기본 로그 대신 메서드·경로·상태만.
        def log_request(self, code="-", size="-"):
            path = urlsplit(self.path).path if hasattr(self, "path") else "-"
            log.write(f"{self.command or '-'} {path} {code}\n")
            log.flush()

        def log_message(self, fmt, *args):  # send_error 등 내부 메시지. 요청 줄은 싣지 않는다.
            return

        def log_error(self, fmt, *args):
            return

        # 보안 헤더는 여기서 붙인다. _send 뿐 아니라 표준 라이브러리 send_error(400·414·501 등)도 이 길을 지난다.
        def end_headers(self):
            for name, value in SECURITY_HEADERS:
                self.send_header(name, value)
            super().end_headers()

        def _send(self, status: int, body: bytes = b"", headers: dict | None = None):
            self.send_response(status)
            sent = {k.lower() for k in (headers or {})}
            for name, value in (headers or {}).items():
                if name.lower() in ("content-length", "content-security-policy", "x-content-type-options", "referrer-policy"):
                    continue
                self.send_header(name, value)
            if "cache-control" not in sent:
                self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _json(self, status: int, payload):
            self._send(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                       {"Content-Type": "application/json; charset=utf-8"})

        def _host_ok(self) -> bool:
            host = (self.headers.get("Host") or "").strip().lower()
            if host in hosts:
                return True
            self.close_connection = True
            self._json(421, {"error": "허용하지 않은 Host"})
            return False

        def _route(self):
            if not self._host_ok():
                return
            parts = urlsplit(self.path)
            path = unquote(parts.path or "/")
            if path == "/api" or path.startswith("/api/"):
                self._api(path, parts.query)
                return
            if self.command not in ("GET", "HEAD"):
                self.close_connection = True
                self._json(405, {"error": "method not allowed"})
                return
            self._static(path)

        def _static(self, path: str):
            rel = path.lstrip("/")
            target = static_target(web_root, shared, rel, shared_root)
            if target is not None and target.is_dir():
                if rel and not rel.endswith("/"):
                    # 상대 Location 이라 하위 경로(/dashboard/…)에 올라가도 맞게 풀린다.
                    self._send(301, b"", {"Location": rel.rsplit("/", 1)[-1] + "/"})
                    return
                target = index_file(web_root, target)
            if target is None:
                self._json(404, {"error": "not found"})
                return
            # 공유 파일은 저장소 쪽 이름이 아니라 URL 이름의 확장자로 형식을 정한다.
            suffix = Path(rel).suffix if rel in shared else target.suffix
            self._send(200, target.read_bytes(), {"Content-Type": MIME.get(suffix.lower(), "application/octet-stream")})

        def _api(self, path: str, query: str):
            name = path.split("/")[2] if path.count("/") >= 2 else ""
            module = routes.get(name)
            origin = self.headers.get("Origin")
            if origin is not None and origin.strip().rstrip("/").lower() not in origins:
                self.close_connection = True
                self._json(403, {"error": "허용하지 않은 Origin"})
                return
            if self.headers.get("X-Dobbys-Proxy") != "1":
                self.close_connection = True
                self._json(403, {"error": "X-Dobbys-Proxy: 1 헤더가 필요하다"})
                return
            if "chunked" in (self.headers.get("Transfer-Encoding") or "").lower():
                self.close_connection = True
                self._json(411, {"error": "Content-Length 가 필요하다"})
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            if length < 0 or length > MAX_BODY:
                self.close_connection = True
                self._json(413 if length > MAX_BODY else 400, {"error": f"본문은 {MAX_BODY // 1024} KiB 까지다"})
                return
            body = self.rfile.read(length) if length else b""
            if module is None:
                self._json(404, {"error": "모르는 api"})
                return
            request = Request(self.command, path, parse_qs(query, keep_blank_values=True), self.headers, body)
            try:
                response: Response = module.handle(request)
            except Exception as exc:  # 모듈 오류의 문구(요청 값이 섞일 수 있다)는 응답·로그에 싣지 않는다.
                log.write(f"api {name} 오류: {type(exc).__name__}\n")
                if os.environ.get("DOBBYS_DEBUG") == "1":  # 디버그도 위치(파일:줄 함수)만. 소스 줄·예외 문구는 없다.
                    for frame in traceback.extract_tb(exc.__traceback__):
                        log.write(f"  {frame.filename}:{frame.lineno} {frame.name}\n")
                log.flush()
                self._json(500, {"error": "서버 오류"})
                return
            self._send(response.status, response.body, response.headers)

        do_GET = do_HEAD = do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _route

    return Handler


class V4Server(ThreadingHTTPServer):
    daemon_threads = True


class V6Server(V4Server):
    address_family = socket.AF_INET6


def main() -> int:
    host = os.environ.get("HOST", "127.0.0.1")
    try:
        port = int(os.environ.get("PORT", "8788"))
    except ValueError:
        print("PORT 는 숫자다", file=sys.stderr)
        return 2
    origins = parse_origins(os.environ.get("ALLOWED_ORIGINS"), port)
    api.version.load()
    cls = V6Server if ":" in host else V4Server
    try:
        server = cls((host, port), make_handler(WEB_ROOT, origins))
    except OSError as error:
        print(f"{host}:{port} 를 열지 못했다: {error}", file=sys.stderr)
        return 1
    shown = f"[{host}]" if ":" in host else host
    print(f"http://{shown}:{server.server_port}/  (도비의 대시보드 웹 버전, 허용 origin: {', '.join(origins)}, Ctrl+C 로 종료)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n종료")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
