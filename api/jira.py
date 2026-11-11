"""GET api/jira — 브라우저의 Jira Cloud 조회를 대신 전달하는 프록시(웹 wbs 탭 전용).

Atlassian 은 API token 방식의 브라우저 직접 호출(CORS)을 받지 않아 서버가 전달만 한다. 열린 프록시가 되지 않게:
- 대상은 `https://<사이트>` + 환경변수 JIRA_HOST_SUFFIX(기본 `.atlassian.net`)뿐이다. 사이트 이름은 한 단어.
- 경로는 `/rest/api/3/myself`·`/rest/api/3/search/jql`·`/rest/api/3/issue/<KEY>/worklog` 셋, 메서드는 GET 뿐.
- 경로마다 받는 쿼리가 정해져 있다. 검색 JQL 은 로컬판(jira_client.build_jql·build_key_jql)이 만드는 모양만
  통과한다(프로젝트·accountId·이슈키 형식 검사 = PROJECT_RE·ACCOUNT_RE·KEY_RE).
- `Authorization` 은 받은 그대로 한 번 전달하고 저장·로그하지 않으며 오류 응답에도 싣지 않는다.
- 리다이렉트를 따라가지 않고, Jira 응답은 TIMEOUT_SECONDS 안에 와야 한다.

응답: Jira 200 은 본문을 그대로 넘긴다. Jira 의 HTTP 오류는 상태를 그대로 쓰고 본문은 `{"jiraStatus": n}` 만 둔다
(문구는 브라우저가 로컬판과 같게 만든다). 연결 실패 502·시간 초과 504·이 프록시가 거절한 요청은 `{"error": "..."}`.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

from api._http import Request, Response
from jira_client import (
    DOMAIN_RE, FIELDS, KEY_RE, LOOKUP_FIELDS, TIMEOUT_SECONDS, build_jql, build_key_jql,
)

DEFAULT_HOST_SUFFIX = ".atlassian.net"
SITE_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
MYSELF = "/rest/api/3/myself"
SEARCH = "/rest/api/3/search/jql"
WORKLOG_RE = re.compile(r"^/rest/api/3/issue/([A-Z][A-Z0-9]*-\d+)/worklog$")
PAGE_MAX = 100
RESPONSE_MAX_BYTES = 16 * 1024 * 1024

# 로컬판 jira_client 가 만드는 세 JQL 모양. 뽑은 값으로 다시 만들어 같을 때만 통과시킨다.
_KEYS = r"([A-Z0-9,\-]+)"
JQL_MINE = re.compile(r'^project = (\S+) AND assignee = "([^"]*)" ORDER BY duedate ASC$')
JQL_LINKED = re.compile(r'^project = (\S+) AND \(assignee = "([^"]*)" OR key in \(' + _KEYS + r"\)\) ORDER BY duedate ASC$")
JQL_KEYS = re.compile(r"^key in \(" + _KEYS + r"\) ORDER BY duedate ASC$")


class Reject(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # 3xx 를 HTTPError 로 남긴다(따라가지 않는다).


_OPENER = urllib.request.build_opener(_NoRedirect)


def host_suffix() -> str:
    return os.environ.get("JIRA_HOST_SUFFIX") or DEFAULT_HOST_SUFFIX


def _json(status: int, payload: dict) -> Response:
    return Response(status, {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"},
                    json.dumps(payload, ensure_ascii=False).encode("utf-8"))


def _header(headers, name: str) -> str | None:
    for key, value in headers.items():
        if key.lower() == name:
            return value
    return None


def _one(query: dict[str, list[str]], name: str, required: bool = True) -> str | None:
    values = query.get(name)
    if not values:
        if required:
            raise Reject(400, f"{name} 가 없다")
        return None
    if len(values) != 1:
        raise Reject(400, f"{name} 는 하나만 받는다")
    return values[0]


def _int(value: str | None, name: str, low: int, high: int) -> str | None:
    if value is None:
        return None
    if not value.isascii() or not value.isdigit() or not low <= int(value) <= high:
        raise Reject(400, f"{name} 는 {low}~{high} 사이 정수다")
    return str(int(value))


def target_host(domain: str | None) -> str:
    domain = domain or ""
    suffix = host_suffix()
    site = domain[: -len(suffix)] if domain.endswith(suffix) else ""
    if not DOMAIN_RE.match(domain) or not SITE_RE.match(site):
        raise Reject(400, f"Jira 도메인은 <사이트>{suffix} 만 받는다")
    return domain


def _keys(text: str) -> list[str]:
    return text.split(",")


def check_jql(jql: str) -> None:
    """로컬판이 만드는 모양 그대로인지 본다. 형식 검사는 build_jql·build_key_jql 이 한다."""
    try:
        if found := JQL_MINE.match(jql):
            rebuilt = build_jql(found[1], found[2], [])
        elif found := JQL_LINKED.match(jql):
            rebuilt = build_jql(found[1], found[2], _keys(found[3]))
        elif found := JQL_KEYS.match(jql):
            rebuilt = build_key_jql(_keys(found[1]))
        else:
            rebuilt = None
    except ValueError as exc:
        raise Reject(400, f"JQL 이 허용 모양이 아니다: {exc}") from None
    if rebuilt != jql:
        raise Reject(400, "JQL 이 허용 모양이 아니다")


def upstream_query(path: str | None, query: dict[str, list[str]]) -> str:
    """Jira 경로 + 쿼리 문자열. 허용 경로·쿼리 이름·값만 통과한다."""
    params = {k: v for k, v in query.items() if k not in ("domain", "path")}
    if path == MYSELF:
        allowed, out = set(), {}
    elif path == SEARCH:
        allowed = {"jql", "maxResults", "fields", "nextPageToken"}
        jql = _one(params, "jql")
        check_jql(jql)
        fields = _one(params, "fields")
        if fields not in (FIELDS, LOOKUP_FIELDS):
            raise Reject(400, "fields 가 허용 목록이 아니다")
        out = {"jql": jql, "maxResults": _int(_one(params, "maxResults"), "maxResults", 1, PAGE_MAX), "fields": fields}
        token = _one(params, "nextPageToken", required=False)
        if token is not None:
            out["nextPageToken"] = token
    elif path and (found := WORKLOG_RE.match(path)) and KEY_RE.match(found[1]):
        allowed = {"startAt", "maxResults"}
        out = {"startAt": _int(_one(params, "startAt"), "startAt", 0, 10**9),
               "maxResults": _int(_one(params, "maxResults"), "maxResults", 1, PAGE_MAX)}
    else:
        raise Reject(400, "허용하지 않는 Jira 경로다")
    unknown = sorted(set(params) - allowed)
    if unknown:
        raise Reject(400, "받지 않는 쿼리: " + ", ".join(unknown))
    return path + ("?" + urllib.parse.urlencode(out) if out else "")


def fetch(url: str, authorization: str) -> tuple[int, bytes]:
    """Jira 를 한 번 부른다. (상태, 본문). 실패는 Reject(오류 문구에 헤더·URL·token 을 싣지 않는다)."""
    request = urllib.request.Request(url, headers={"Authorization": authorization, "Accept": "application/json"})
    try:
        with _OPENER.open(request, timeout=TIMEOUT_SECONDS) as response:
            body = response.read(RESPONSE_MAX_BYTES + 1)
            if len(body) > RESPONSE_MAX_BYTES:
                raise Reject(502, "Jira 응답이 너무 크다")
            return response.status, body
    except urllib.error.HTTPError as exc:
        exc.close()
        return exc.code, b""
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, TimeoutError):
            raise Reject(504, f"Jira 응답 시간 초과 ({TIMEOUT_SECONDS}s)") from None
        raise Reject(502, f"Jira 연결 실패: {exc.reason}") from None
    except TimeoutError:
        raise Reject(504, f"Jira 응답 시간 초과 ({TIMEOUT_SECONDS}s)") from None
    except OSError as exc:
        raise Reject(502, f"Jira 연결 실패: {exc.strerror or type(exc).__name__}") from None


def handle(request: Request) -> Response:
    try:
        # web_serve.py 공통 계층도 막지만, 이 handle 만 따로 올려도 단순 요청 CSRF 를 못 하게 한 번 더 본다.
        if _header(request.headers, "x-dobbys-proxy") != "1":
            raise Reject(403, "X-Dobbys-Proxy 헤더가 필요하다")
        if request.method != "GET":
            refused = _json(405, {"error": "GET 만 받는다"})
            refused.headers["Allow"] = "GET"
            return refused
        host = target_host(_one(request.query, "domain"))
        tail = upstream_query(_one(request.query, "path"), request.query)
        authorization = _header(request.headers, "authorization") or ""
        if not authorization.startswith("Basic ") or len(authorization) > 4096:
            raise Reject(400, "Authorization(Basic) 이 필요하다")
        status, body = fetch(f"https://{host}{tail}", authorization)
    except Reject as exc:
        return _json(exc.status, {"error": exc.message})
    if status != 200:
        return _json(status if 400 <= status <= 599 else 502, {"jiraStatus": status})
    return Response(200, {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}, body)
