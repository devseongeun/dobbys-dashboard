"""Jira 응답을 프론트가 바로 쓰는 형태로 정규화하고 캐시한다."""

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from dashboard.keychain import KeychainError

from .jira import FIELDS, LOOKUP_FIELDS, JiraError, adf_to_text, build_jql, build_key_jql

TTL_SECONDS = 120


def _name(value, key="name"):
    return value.get(key) if isinstance(value, dict) else None


def normalize_issue(raw: dict) -> dict:
    fields = raw.get("fields") or {}
    status = fields.get("status") or {}
    return {
        "key": raw.get("key"),
        "summary": fields.get("summary"),
        "status": _name(status),
        "statusCategory": _name(status.get("statusCategory") or {}),
        "issuetype": _name(fields.get("issuetype")),
        "priority": _name(fields.get("priority")),
        "assignee": _name(fields.get("assignee"), "displayName"),
        "planStart": fields.get("customfield_11481"),
        "actualStart": fields.get("customfield_11484"),
        "actualEnd": fields.get("customfield_11485"),
        "duedate": fields.get("duedate"),
        "timeSpentSeconds": fields.get("timespent") or 0,
    }


def normalize_worklog(issue_key: str, raw: dict) -> dict:
    started = raw.get("started") or ""
    return {
        "id": raw.get("id"),
        "issueKey": issue_key,
        "author": _name(raw.get("author"), "displayName"),
        "authorId": _name(raw.get("author"), "accountId"),
        "started": started[:10],
        "startedAt": started,
        "seconds": raw.get("timeSpentSeconds") or 0,
        "comment": adf_to_text(raw.get("comment")),
    }


EMPTY = {
    "fetchedAt": None, "stale": False, "error": None,
    "me": {"accountId": None, "displayName": None}, "issues": [], "worklogs": [],
}


class BoardService:
    """Jira 연동은 선택이다. 로그인 전이면 connected=False 빈 보드, 인증 실패면 authError=True."""

    def __init__(self, session, project: str, linked_keys: Callable[[], list[str]], cache_path: Path,
                 ttl: int = TTL_SECONDS, clock: Callable[[], float] = time.time):
        self._session = session
        self._project = project
        self._linked_keys = linked_keys
        self._cache_path = Path(cache_path)
        self._ttl = ttl
        self._clock = clock
        self._memo: dict | None = None
        self._memo_at = 0.0

    def invalidate(self) -> None:
        self._memo = None
        try:
            self._cache_path.unlink()
        except FileNotFoundError:
            pass

    def payload(self, refresh: bool = False) -> dict:
        try:
            client = self._session.client()
        except KeychainError as exc:
            # 깨진 키체인 항목은 다시 로그인하면 덮어쓴다. 로그인 화면을 보여 준다.
            return {**EMPTY, "connected": False, "authError": True, "error": str(exc)}
        if client is None:
            return {**EMPTY, "connected": False, "authError": False}
        now = self._clock()
        if not refresh and self._memo and now - self._memo_at < self._ttl:
            return self._memo
        try:
            built = self._build(client)
        except JiraError as exc:
            if exc.status in (401, 403):
                self.invalidate()
                return {**EMPTY, "connected": False, "authError": True, "error": exc.message}
            return self._fallback(exc.message)
        self._memo, self._memo_at = built, now
        self._write_cache(built)
        return built

    def _build(self, client) -> dict:
        # 익명 폴백 방지: 신원 확인이 실패하면 조회 결과(200 + 0건)를 믿지 않는다.
        me = client.myself()
        if not me.get("accountId"):
            raise JiraError("Jira 신원 확인 응답에 accountId 가 없다")
        jql = build_jql(self._project, me["accountId"], self._linked_keys())
        issues, worklogs = [], []
        for raw in client.search_all(jql, FIELDS):
            issues.append(normalize_issue(raw))
            key = raw.get("key")
            block = (raw.get("fields") or {}).get("worklog") or {}
            entries = block.get("worklogs") or []
            if (block.get("total") or 0) > (block.get("maxResults") or 0):
                entries = client.issue_worklogs(key)
            worklogs.extend(normalize_worklog(key, entry) for entry in entries)
        return {
            "fetchedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
            "stale": False, "error": None, "connected": True, "authError": False,
            "me": {"accountId": me.get("accountId"), "displayName": me.get("displayName")},
            "issues": issues, "worklogs": worklogs,
        }

    def lookup(self, keys) -> dict:
        """지정 키의 이슈를 읽기 전용으로 조회한다(담당자 무관, 캐시 없음)."""
        try:
            client = self._session.client()
        except KeychainError as exc:
            return {"issues": [], "error": str(exc)}
        if client is None:
            return {"issues": [], "error": "Jira 로그인이 필요하다"}
        try:
            raw = client.search_all(build_key_jql(keys), LOOKUP_FIELDS)
        except JiraError as exc:
            return {"issues": [], "error": exc.message}
        return {"issues": [normalize_issue(item) for item in raw], "error": None}

    def _fallback(self, message: str) -> dict:
        cached = self._memo or self._read_cache()
        if cached:
            return {**cached, "stale": True, "error": message}
        return {**EMPTY, "connected": True, "authError": False, "stale": True, "error": message}

    def _read_cache(self) -> dict | None:
        try:
            return json.loads(self._cache_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def _write_cache(self, payload: dict) -> None:
        try:
            self._cache_path.parent.mkdir(parents=True, exist_ok=True)
            self._cache_path.write_text(
                json.dumps(payload, ensure_ascii=False), encoding="utf-8"
            )
        except OSError:
            pass
