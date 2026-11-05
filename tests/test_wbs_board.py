import json
import tempfile
import unittest
from pathlib import Path

from dashboard.keychain import KeychainError
from tabs.wbs.board import BoardService, normalize_issue, normalize_worklog
from tabs.wbs.jira import JiraError, build_jql

ACCOUNT = "acc-1"

RAW_ISSUE = {
    "key": "PROJ-1156",
    "fields": {
        "summary": "티켓 - 워크플로우 템플릿 관리 등록",
        "status": {"name": "진행", "statusCategory": {"name": "진행 중"}},
        "issuetype": {"name": "할 일"},
        "priority": {"name": "Medium"},
        "assignee": {"displayName": "홍길동"},
        "duedate": "2026-10-01",
        "timespent": 14400,
        "customfield_11481": "2026-09-18",
        "customfield_11484": "2026-09-22",
        "customfield_11485": None,
        "worklog": {
            "total": 1,
            "maxResults": 20,
            "worklogs": [
                {
                    "id": "23809",
                    "author": {
                        "displayName": "홍길동",
                        "accountId": ACCOUNT,
                    },
                    "started": "2026-09-28T23:30:00.000+0900",
                    "timeSpentSeconds": 7200,
                    "comment": {
                        "type": "doc",
                        "content": [
                            {"type": "paragraph", "content": [{"type": "text", "text": "매핑 갱신"}]}
                        ],
                    },
                }
            ],
        },
    },
}


class FakeSession:
    def __init__(self, client):
        self._client = client

    def client(self):
        return self._client


class BrokenKeychainSession:
    def client(self):
        raise KeychainError("키체인 값이 JSON 이 아니다")


class FailingClient:
    def __init__(self, error):
        self.error = error

    def myself(self):
        raise self.error


class FakeClient:
    def __init__(self, issues, extra=None, error=None, auth_error=None):
        self.issues = issues
        self.extra = extra or {}
        self.error = error
        self.auth_error = auth_error
        self.worklog_calls = []
        self.myself_calls = 0

    def myself(self):
        self.myself_calls += 1
        if self.auth_error:
            raise self.auth_error
        return {"accountId": ACCOUNT, "displayName": "홍길동"}

    def search_all(self, jql, fields=None):
        self.jqls = getattr(self, "jqls", []) + [jql]
        if self.error:
            raise self.error
        return self.issues

    def issue_worklogs(self, key, start_at=0):
        self.worklog_calls.append(key)
        return self.extra[key]


class NormalizeTest(unittest.TestCase):
    def test_issue_fields_are_flattened(self):
        row = normalize_issue(RAW_ISSUE)
        self.assertEqual(row["key"], "PROJ-1156")
        self.assertEqual(row["status"], "진행")
        self.assertEqual(row["statusCategory"], "진행 중")
        self.assertEqual(row["assignee"], "홍길동")
        self.assertEqual(row["planStart"], "2026-09-18")
        self.assertEqual(row["actualStart"], "2026-09-22")
        self.assertIsNone(row["actualEnd"])
        self.assertEqual(row["timeSpentSeconds"], 14400)

    def test_unassigned_issue_does_not_crash(self):
        raw = json.loads(json.dumps(RAW_ISSUE))
        raw["fields"]["assignee"] = None
        raw["fields"]["priority"] = None
        raw["fields"]["timespent"] = None
        row = normalize_issue(raw)
        self.assertIsNone(row["assignee"])
        self.assertEqual(row["timeSpentSeconds"], 0)

    def test_worklog_started_uses_local_date_prefix(self):
        raw = RAW_ISSUE["fields"]["worklog"]["worklogs"][0]
        log = normalize_worklog("PROJ-1156", raw)
        self.assertEqual(log["started"], "2026-09-28")
        self.assertEqual(log["seconds"], 7200)
        self.assertEqual(log["comment"], "매핑 갱신")
        self.assertEqual(log["issueKey"], "PROJ-1156")


class BoardServiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.cache = self.tmp / "jira.json"
        self.client = FakeClient([RAW_ISSUE])

    def test_payload_contains_issues_and_worklogs(self):
        service = BoardService(FakeSession(FakeClient([RAW_ISSUE])), "PROJ", lambda: ["PROJ-1156"], cache_path=self.cache)
        payload = service.payload()
        self.assertEqual(service._session.client().jqls, [build_jql("PROJ", ACCOUNT, ["PROJ-1156"])])
        self.assertFalse(payload["stale"])
        self.assertIsNone(payload["error"])
        self.assertEqual(len(payload["issues"]), 1)
        self.assertEqual(len(payload["worklogs"]), 1)

    def test_hand_edited_invalid_link_keys_are_ignored(self):
        service = BoardService(FakeSession(FakeClient([RAW_ISSUE])), "PROJ", lambda: ["PROJ-1156", "bad key\"", "x-1"],
                               cache_path=self.cache)
        payload = service.payload()
        self.assertEqual(service._session.client().jqls, [build_jql("PROJ", ACCOUNT, ["PROJ-1156"])])
        self.assertIsNone(payload["error"])

    def test_truncated_worklog_triggers_extra_fetch(self):
        raw = json.loads(json.dumps(RAW_ISSUE))
        raw["fields"]["worklog"]["total"] = 25
        raw["fields"]["worklog"]["maxResults"] = 20
        extra = [
            {
                "id": str(i),
                "author": {"displayName": "홍길동"},
                "started": "2026-09-20T09:00:00.000+0900",
                "timeSpentSeconds": 1800,
                "comment": None,
            }
            for i in range(25)
        ]
        client = FakeClient([raw], extra={"PROJ-1156": extra})
        payload = BoardService(FakeSession(client), "PROJ", lambda: ["PROJ-1156"], cache_path=self.cache).payload()
        self.assertEqual(client.worklog_calls, ["PROJ-1156"])
        self.assertEqual(len(payload["worklogs"]), 25)

    def test_cache_hit_within_ttl_skips_client(self):
        client = FakeClient([RAW_ISSUE])
        ticks = iter([1000.0, 1050.0, 1050.0])
        service = BoardService(FakeSession(client), "PROJ", lambda: ["PROJ-1156"], cache_path=self.cache, ttl=120,
                               clock=lambda: next(ticks))
        service.payload()
        client.error = JiraError("호출되면 안 된다")
        second = service.payload()
        self.assertFalse(second["stale"])

    def test_failure_falls_back_to_cache_and_marks_stale(self):
        good = BoardService(FakeSession(FakeClient([RAW_ISSUE])), "PROJ", lambda: ["PROJ-1156"], cache_path=self.cache)
        good.payload()
        broken = BoardService(FakeSession(FakeClient([], error=JiraError("Jira 오류 (502)", status=502))), "PROJ",
                              lambda: ["PROJ-1156"], cache_path=self.cache)
        payload = broken.payload(refresh=True)
        self.assertTrue(payload["stale"])
        self.assertEqual(payload["error"], "Jira 오류 (502)")
        self.assertEqual(len(payload["issues"]), 1)

    def test_failure_without_cache_returns_empty_payload(self):
        broken = BoardService(FakeSession(FakeClient([], error=JiraError("Jira 연결 실패: timed out"))), "PROJ", lambda: ["PROJ-1156"], cache_path=self.cache)
        payload = broken.payload()
        self.assertEqual(payload["issues"], [])
        self.assertEqual(payload["worklogs"], [])
        self.assertIn("연결 실패", payload["error"])

    def test_payload_carries_my_identity_for_worklog_attribution(self):
        """워크로그 탭이 타인 기록을 내 실적으로 합산하지 않으려면 내 accountId 가 필요하다."""
        payload = BoardService(FakeSession(FakeClient([RAW_ISSUE])), "PROJ", lambda: ["PROJ-1156"], cache_path=self.cache).payload()
        self.assertEqual(payload["me"]["accountId"], ACCOUNT)
        self.assertEqual(payload["worklogs"][0]["authorId"], ACCOUNT)

    def test_anonymous_auth_does_not_overwrite_cache_with_empty_result(self):
        """Jira는 잘못된 토큰을 401이 아니라 익명 처리해 200 + issues:[] 를 준다.

        신원 확인 없이 그 응답을 믿으면 '할 일 0건'이 최신 데이터로 표시되고
        캐시까지 덮어써 진짜 목록이 사라진다.
        """
        BoardService(FakeSession(FakeClient([RAW_ISSUE])), "PROJ", lambda: ["PROJ-1156"], cache_path=self.cache).payload()

        anonymous = FakeClient([], auth_error=JiraError("Jira 신원 확인 응답에 accountId 가 없다"))
        payload = BoardService(FakeSession(anonymous), "PROJ", lambda: ["PROJ-1156"], cache_path=self.cache).payload(refresh=True)

        self.assertEqual(anonymous.myself_calls, 1)
        self.assertTrue(payload["stale"])
        self.assertEqual(payload["error"], "Jira 신원 확인 응답에 accountId 가 없다")
        self.assertEqual(len(payload["issues"]), 1)
        self.assertEqual(
            len(json.loads(self.cache.read_text(encoding="utf-8"))["issues"]), 1
        )

    def test_lookup_reads_other_assignees_issue_without_touching_cache(self):
        raw = json.loads(json.dumps(RAW_ISSUE))
        raw["key"] = "PROJ-1131"
        raw["fields"]["assignee"] = {"displayName": "이영희"}
        client = FakeClient([raw])
        result = BoardService(FakeSession(client), "PROJ", lambda: [], cache_path=self.cache).lookup(["PROJ-1131"])
        self.assertIsNone(result["error"])
        self.assertEqual(result["issues"][0]["assignee"], "이영희")
        self.assertEqual(result["issues"][0]["duedate"], "2026-10-01")
        self.assertEqual(client.jqls, ["key in (PROJ-1131) ORDER BY duedate ASC"])
        self.assertFalse(self.cache.exists())

    def test_lookup_reports_jira_error(self):
        client = FakeClient([], error=JiraError("권한 없음 (403)", 403))
        result = BoardService(FakeSession(client), "PROJ", lambda: [], cache_path=self.cache).lookup(["PROJ-1131"])
        self.assertEqual(result, {"issues": [], "error": "권한 없음 (403)"})

    def test_without_credentials_board_is_disconnected_and_empty(self):
        service = BoardService(FakeSession(None), "PROJ", lambda: [], cache_path=self.cache)
        payload = service.payload()
        self.assertEqual((payload["connected"], payload["authError"], payload["issues"]), (False, False, []))

    def test_auth_failure_is_disconnected_without_stale_cache(self):
        good = BoardService(FakeSession(self.client), "PROJ", lambda: [], cache_path=self.cache)
        good.payload()
        failing = BoardService(FakeSession(FailingClient(JiraError("인증 실패 (401)", status=401))), "PROJ", lambda: [],
                               cache_path=self.cache)
        payload = failing.payload()
        self.assertEqual((payload["connected"], payload["authError"], payload["issues"]), (False, True, []))

    def test_keychain_error_shows_login_instead_of_crashing(self):
        service = BoardService(BrokenKeychainSession(), "PROJ", lambda: [], cache_path=self.cache)
        payload = service.payload()
        self.assertEqual((payload["connected"], payload["authError"], payload["issues"]), (False, True, []))
        self.assertIn("키체인 값이 JSON 이 아니다", payload["error"])
        self.assertEqual(service.lookup(["PROJ-1"]), {"issues": [], "error": "키체인 값이 JSON 이 아니다"})

    def test_other_jira_error_falls_back_to_cache_as_stale(self):
        BoardService(FakeSession(self.client), "PROJ", lambda: [], cache_path=self.cache).payload()
        failing = BoardService(FakeSession(FailingClient(JiraError("Jira 연결 실패: x"))), "PROJ", lambda: [], cache_path=self.cache)
        payload = failing.payload()
        self.assertEqual((payload["connected"], payload["stale"]), (True, True))
        self.assertTrue(payload["issues"])


if __name__ == "__main__":
    unittest.main()
