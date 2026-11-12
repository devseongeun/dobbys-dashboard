"""api/trombone — 웹 comments 탭의 TROMBONE 웹 기획서 API 호출을 대신 전달하는 중계.

브라우저는 사내망 TROMBONE 에 직접 닿지 않을 수 있어 서버가 전달만 한다(로컬판 tabs/comments/client.py 를 서버로 옮긴 것).
열린 프록시가 되지 않게:
- 대상 주소는 서버 환경변수 TROMBONE_BASE(`http(s)://호스트[:포트]`)로만 정한다. 브라우저가 보낸 주소는 받지 않는다.
  비어 있거나 형식이 틀리면 503.
- 경로·메서드는 넷뿐이다(앞에 `/trbw/api` 가 붙는다).
    GET  api/trombone/comments                        → GET  /trbw/api/comments            (쿼리 없음)
    GET  api/trombone/spec?path=<화면 경로>           → GET  /trbw/api/spec?path=<경로>      (path 하나만)
    POST api/trombone/auth/login {loginId, password}  → POST /trbw/api/auth/login          (두 칸만)
    POST api/trombone/spec/comments/<ID>/reactions {emoji: "EMO005"} + Authorization: Bearer
                                                      → POST /trbw/api/spec/comments/<ID>/reactions
  그 밖에 `GET api/trombone/config` 은 TROMBONE 에 나가지 않고 `{"base": TROMBONE_BASE}` 만 준다(화면 링크·md 머리말용).
- 경로마다 받는 쿼리·본문 모양이 정해져 있고, 본문은 검사한 값으로 다시 만들어 보낸다.
- `Authorization`(Bearer)과 로그인 본문(비밀번호)은 넘기기만 하고 저장·로그하지 않으며 오류 응답에도 싣지 않는다.
  Bearer 는 반응 경로에서만 넘긴다(조회는 로컬판처럼 인증 없이 부른다).
- 리다이렉트를 따라가지 않고, TIMEOUT_SECONDS 안에 답이 와야 하며, 응답은 RESPONSE_MAX_BYTES 까지다.

응답: TROMBONE 2xx 는 본문을 그대로 200 으로 넘긴다. TROMBONE 의 HTTP 오류는 상태를 그대로 쓰고 본문은
`{"tromboneStatus": n, "message": "<TROMBONE 이 준 message>"}`(message 는 200자까지, 보낸 비밀값이 섞였으면 뺀다).
문구는 브라우저가 로컬판과 같게 만든다. 연결 실패 502·시간 초과 504·이 중계가 거절한 요청은 `{"error": "..."}`.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

from api._http import Request, Response

ENV = "TROMBONE_BASE"
PREFIX = "/api/trombone"
API_PREFIX = "/trbw/api"  # 로컬판 tabs/comments/client.py API_PREFIX 와 같다(테스트가 비교한다)
TIMEOUT_SECONDS = 20  # 로컬판 client.TIMEOUT 과 같다
RESPONSE_MAX_BYTES = 16 * 1024 * 1024
ERROR_BODY_MAX_BYTES = 64 * 1024
MESSAGE_MAX = 200
PAGE_PATH_MAX = 1024
LOGIN_FIELD_MAX = 256
TOKEN_MAX = 4096
DECIDED_EMOJI = "EMO005"  # 대시보드는 👀 만 붙인다(로컬판 model.DECIDED_EMOJI)
COMMENT_ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")  # 로컬판 tabs/comments/serve.py 와 같다
REACTIONS = re.compile(r"^/spec/comments/([^/]+)/reactions$")
TOKEN_RE = re.compile(r"^[\x21-\x7e]{1,%d}$" % TOKEN_MAX)  # 공백·제어 문자 없는 ASCII(헤더 주입 방지)
NOT_CONFIGURED = "서버에 기획서(TROMBONE) 주소가 설정되지 않았다. 운영자가 서버 환경변수 TROMBONE_BASE 를 정한다"


class Reject(Exception):
    def __init__(self, status: int, message: str, allow: str | None = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.allow = allow


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # 3xx 를 HTTPError 로 남긴다(따라가지 않는다).


_OPENER = urllib.request.build_opener(_NoRedirect)


def _json(status: int, payload: dict) -> Response:
    return Response(status, {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"},
                    json.dumps(payload, ensure_ascii=False).encode("utf-8"))


def _header(headers, name: str) -> str | None:
    for key, value in headers.items():
        if key.lower() == name:
            return value
    return None


def base_url() -> str:
    """TROMBONE_BASE 를 검사해 끝 `/` 를 뗀 값. 없거나 형식이 틀리면 Reject(503)."""
    raw = (os.environ.get(ENV) or "").strip()
    if not raw:
        raise Reject(503, NOT_CONFIGURED)
    try:
        parts = urllib.parse.urlsplit(raw)
        port = parts.port  # 숫자가 아니면 ValueError
    except ValueError:
        port = -1
    if (parts.scheme not in ("http", "https") or not parts.hostname or parts.username is not None
            or parts.password is not None or parts.query or parts.fragment or port == -1
            or any(c.isspace() or ord(c) < 0x20 for c in raw)):
        raise Reject(503, "서버의 TROMBONE_BASE 가 http(s)://호스트[:포트] 형식이 아니다. 운영자가 고친다")
    return raw.rstrip("/")


def _no_query(query: dict[str, list[str]]) -> None:
    if query:
        raise Reject(400, "받지 않는 쿼리: " + ", ".join(sorted(query)))


def _body(request: Request) -> dict:
    content_type = (_header(request.headers, "content-type") or "").split(";")[0].strip().lower()
    if content_type != "application/json":
        raise Reject(415, "application/json 만 받는다")
    try:
        body = json.loads(request.body or b"null")
    except ValueError:
        body = None
    if not isinstance(body, dict):
        raise Reject(400, "JSON 객체여야 한다")
    return body


def _exact_keys(body: dict, keys: set[str]) -> None:
    if set(body) != keys:
        raise Reject(400, "본문 칸은 " + "·".join(sorted(keys)) + " 만 받는다")


def page_path(query: dict[str, list[str]]) -> str:
    unknown = sorted(set(query) - {"path"})
    if unknown:
        raise Reject(400, "받지 않는 쿼리: " + ", ".join(unknown))
    values = query.get("path") or []
    if len(values) != 1:
        raise Reject(400, "path 는 하나만 받는다")
    value = values[0]
    if (not value.startswith("/") or value.startswith("//") or len(value) > PAGE_PATH_MAX or "\\" in value
            or any(ord(c) < 0x20 or ord(c) == 0x7f for c in value)):
        raise Reject(400, "path 는 '/' 로 시작하는 기획서 화면 경로다")
    return value


def plan(request: Request) -> tuple[str, str, bytes | None, dict[str, str], list[str]]:
    """허용 경로면 (메서드, TROMBONE 경로+쿼리, 보낼 본문, 보낼 머리말, 숨길 값). 아니면 Reject."""
    if not request.path.startswith(PREFIX + "/"):
        raise Reject(404, "허용하지 않는 기획서 경로다")
    tail = request.path[len(PREFIX):]
    method = request.method
    headers = {"Accept": "application/json"}
    if tail == "/comments":
        if method != "GET":
            raise Reject(405, "GET 만 받는다", allow="GET")
        _no_query(request.query)
        return "GET", "/comments", None, headers, []
    if tail == "/spec":
        if method != "GET":
            raise Reject(405, "GET 만 받는다", allow="GET")
        path = page_path(request.query)
        return "GET", "/spec?path=" + urllib.parse.quote(path, safe=""), None, headers, []
    if tail == "/auth/login":
        if method != "POST":
            raise Reject(405, "POST 만 받는다", allow="POST")
        _no_query(request.query)
        body = _body(request)
        _exact_keys(body, {"loginId", "password"})
        login_id, password = body["loginId"], body["password"]
        if not all(isinstance(v, str) and 0 < len(v) <= LOGIN_FIELD_MAX for v in (login_id, password)) or not login_id.strip():
            raise Reject(400, "이메일과 비밀번호를 입력한다")
        data = json.dumps({"loginId": login_id, "password": password}).encode("utf-8")
        return "POST", "/auth/login", data, {**headers, "Content-Type": "application/json"}, [password]
    found = REACTIONS.match(tail)
    if found:
        if method != "POST":
            raise Reject(405, "POST 만 받는다", allow="POST")
        comment_id = found[1]
        if not COMMENT_ID.match(comment_id):
            raise Reject(400, "코멘트ID 형식이 아니다")
        _no_query(request.query)
        body = _body(request)
        _exact_keys(body, {"emoji"})
        if body["emoji"] != DECIDED_EMOJI:
            raise Reject(400, f"emoji 는 {DECIDED_EMOJI} 만 받는다")
        authorization = _header(request.headers, "authorization") or ""
        token = authorization[len("Bearer "):] if authorization.startswith("Bearer ") else ""
        if not TOKEN_RE.match(token):
            raise Reject(401, "기획서 로그인이 필요하다(Authorization: Bearer)")
        data = json.dumps({"emoji": DECIDED_EMOJI}).encode("utf-8")
        return ("POST", f"/spec/comments/{comment_id}/reactions", data,
                {**headers, "Content-Type": "application/json", "Authorization": "Bearer " + token}, [token])
    raise Reject(404, "허용하지 않는 기획서 경로다")


def _message(raw: bytes, secrets: list[str]) -> str | None:
    """TROMBONE 오류 본문의 message. 문자열이 아니거나 보낸 비밀값이 섞였으면 None."""
    try:
        detail = json.loads(raw.decode("utf-8") or "{}").get("message")
    except (ValueError, AttributeError, UnicodeDecodeError):
        return None
    if not isinstance(detail, str) or not detail.strip():
        return None
    if any(secret and secret in detail for secret in secrets):
        return None
    detail = " ".join(detail.split())
    return detail[:MESSAGE_MAX] + ("…" if len(detail) > MESSAGE_MAX else "")


def fetch(method: str, url: str, data: bytes | None, headers: dict[str, str], secrets: list[str]) -> tuple[int, bytes, str | None]:
    """TROMBONE 을 한 번 부른다. (상태, 본문, 오류 message). 실패는 Reject(문구에 머리말·본문·token 을 싣지 않는다)."""
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with _OPENER.open(request, timeout=TIMEOUT_SECONDS) as response:
            body = response.read(RESPONSE_MAX_BYTES + 1)
            if len(body) > RESPONSE_MAX_BYTES:
                raise Reject(502, "기획서 응답이 너무 크다")
            return response.status, body, None
    except urllib.error.HTTPError as exc:
        try:
            raw = exc.read(ERROR_BODY_MAX_BYTES) if exc.fp is not None else b""
        except OSError:
            raw = b""
        finally:
            exc.close()
        return exc.code, b"", _message(raw, secrets)
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, TimeoutError):
            raise Reject(504, f"기획서 응답 시간 초과 ({TIMEOUT_SECONDS}s)") from None
        reason = exc.reason.strerror if isinstance(exc.reason, OSError) and exc.reason.strerror else exc.reason
        raise Reject(502, f"기획서 연결 실패: {reason}") from None
    except TimeoutError:
        raise Reject(504, f"기획서 응답 시간 초과 ({TIMEOUT_SECONDS}s)") from None
    except OSError as exc:
        raise Reject(502, f"기획서 연결 실패: {exc.strerror or type(exc).__name__}") from None


def handle(request: Request) -> Response:
    try:
        # web_serve.py 공통 계층도 막지만, 이 handle 만 따로 올려도 단순 요청 CSRF 를 못 하게 한 번 더 본다.
        if _header(request.headers, "x-dobbys-proxy") != "1":
            raise Reject(403, "X-Dobbys-Proxy 헤더가 필요하다")
        if request.path == PREFIX + "/config":
            if request.method != "GET":
                raise Reject(405, "GET 만 받는다", allow="GET")
            _no_query(request.query)
            return _json(200, {"base": base_url()})
        method, tail, data, headers, secrets = plan(request)
        base = base_url()
        status, body, message = fetch(method, base + API_PREFIX + tail, data, headers, secrets)
    except Reject as exc:
        refused = _json(exc.status, {"error": exc.message})
        if exc.allow:
            refused.headers["Allow"] = exc.allow
        return refused
    if not 200 <= status <= 299:
        payload = {"tromboneStatus": status}
        if message:
            payload["message"] = message
        return _json(status if 400 <= status <= 599 else 502, payload)
    return Response(200, {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}, body)
