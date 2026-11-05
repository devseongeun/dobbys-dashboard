"""Jira Cloud REST v3 클라이언트. 검색은 /rest/api/3/search/jql 만 쓴다."""

import base64
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable, Sequence

FIELDS = (
    "summary,status,issuetype,priority,assignee,duedate,timespent,"
    "customfield_11481,customfield_11484,customfield_11485,worklog"
)
KEY_RE = re.compile(r"^[A-Z][A-Z0-9]*-\d+$")
# 일정 조정 탭에서 남의 이슈를 끌어올 때 쓴다. 워크로그는 필요 없다.
LOOKUP_FIELDS = (
    "summary,status,issuetype,priority,assignee,duedate,timespent,"
    "customfield_11481,customfield_11484,customfield_11485"
)
LOOKUP_LIMIT = 50


PROJECT_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")
ACCOUNT_RE = re.compile(r"^[A-Za-z0-9:_-]+$")


def build_jql(project: str, account_id: str, linked_keys: Sequence[str]) -> str:
    """내 담당 이슈 + 수동 연결 이슈. 프로젝트·accountId·키 형식을 검증해 JQL 주입을 막는다."""
    if not PROJECT_RE.match(project):
        raise ValueError(f"프로젝트 키 형식이 아니다: {project!r}")
    if not ACCOUNT_RE.match(account_id or ""):
        raise ValueError("accountId 형식이 아니다")
    for key in linked_keys:
        if not KEY_RE.match(key):
            raise ValueError(f"이슈 키 형식이 아니다: {key!r}")
    ordered = sorted(set(linked_keys), key=lambda k: (k.split("-")[0], int(k.split("-")[1])))
    tail = " ORDER BY duedate ASC"
    mine = f'assignee = "{account_id}"'
    if not ordered:
        return f"project = {project} AND {mine}{tail}"
    return f"project = {project} AND ({mine} OR key in ({','.join(ordered)})){tail}"


def build_key_jql(keys: Sequence[str]) -> str:
    """키 목록 조회 JQL. 키 형식을 검증해 JQL 주입을 막는다."""
    unique = set(keys)
    if not unique:
        raise ValueError("이슈 키가 없다")
    if len(unique) > LOOKUP_LIMIT:
        raise ValueError(f"한 번에 {LOOKUP_LIMIT}건까지 조회한다")
    for key in unique:
        if not KEY_RE.match(key):
            raise ValueError(f"이슈 키 형식이 아니다: {key!r}")
    ordered = sorted(unique, key=lambda k: (k.split("-")[0], int(k.split("-")[1])))
    return f"key in ({','.join(ordered)}) ORDER BY duedate ASC"


_BLOCK_TYPES = {"paragraph", "heading", "listItem", "blockquote", "codeBlock"}


def adf_to_text(node) -> str:
    """ADF 문서를 줄바꿈 구분 평문으로 접는다. 프론트에 ADF를 노출하지 않기 위함."""
    if node is None:
        return ""
    if isinstance(node, str):
        return node

    def walk(current) -> list[str]:
        if not isinstance(current, dict):
            return []
        kind = current.get("type")
        if kind == "text":
            return [current.get("text", "")]
        if kind == "hardBreak":
            return ["\n"]
        parts: list[str] = []
        for child in current.get("content") or []:
            parts.extend(walk(child))
        if kind in _BLOCK_TYPES:
            parts.append("\n")
        return parts

    text = "".join(walk(node))
    lines = [line.strip() for line in text.split("\n")]
    return "\n".join(line for line in lines if line)


TIMEOUT_SECONDS = 30


@dataclass(frozen=True)
class JiraConfig:
    base_url: str
    email: str
    token: str


class JiraError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status
        self.message = message


class JiraClient:
    def __init__(self, config, fetch: Callable[[str], dict] | None = None):
        self._config = config
        self._fetch = fetch or self._http_get

    def _http_get(self, path: str) -> dict:
        auth = base64.b64encode(
            f"{self._config.email}:{self._config.token}".encode()
        ).decode()
        request = urllib.request.Request(
            self._config.base_url + path,
            headers={"Authorization": "Basic " + auth, "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            reason = {401: "인증 실패", 403: "권한 없음", 404: "리소스 없음"}.get(
                exc.code, "요청 실패"
            )
            raise JiraError(f"{reason} ({exc.code})", status=exc.code) from None
        except urllib.error.URLError as exc:
            raise JiraError(f"Jira 연결 실패: {exc.reason}") from None
        except TimeoutError:
            raise JiraError(f"Jira 응답 시간 초과 ({TIMEOUT_SECONDS}s)") from None

    def myself(self) -> dict:
        """인증 신원을 확인한다.

        Jira Cloud 는 잘못된 토큰을 401 로 거절하지 않고 익명 사용자로 처리해
        search 에 200 + issues:[] 를 돌려준다. 이 엔드포인트만 401 을 주므로
        조회 전에 한 번 불러 '조용한 0건'을 걸러낸다.
        """
        return self._fetch("/rest/api/3/myself")

    def search_all(self, jql: str, fields: str = FIELDS) -> list[dict]:
        issues: list[dict] = []
        token: str | None = None
        while True:
            query = {"jql": jql, "maxResults": "100", "fields": fields}
            if token:
                query["nextPageToken"] = token
            payload = self._fetch(
                "/rest/api/3/search/jql?" + urllib.parse.urlencode(query)
            )
            issues.extend(payload.get("issues") or [])
            if payload.get("isLast", True):
                return issues
            token = payload.get("nextPageToken")
            if not token:
                return issues

    def issue_worklogs(self, key: str, start_at: int = 0) -> list[dict]:
        logs: list[dict] = []
        while True:
            payload = self._fetch(
                f"/rest/api/3/issue/{key}/worklog?"
                + urllib.parse.urlencode({"startAt": start_at, "maxResults": 100})
            )
            batch = payload.get("worklogs") or []
            logs.extend(batch)
            start_at += len(batch)
            if not batch or start_at >= (payload.get("total") or 0):
                return logs
