import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from dashboard.keychain import KeychainError
from tabs.wbs.board import BoardService
from tabs.wbs.jira import JiraError
from tabs.wbs.serve import make_handler
from tabs.wbs.store import LinkStore
from tests.support import request, send_json, serve_handler

TASKS = [{"id": "A-1", "d1": "공통", "d2": "대시보드", "d3": None, "name": "대시보드", "jira": None}]


class FakeSource:
    def __init__(self, error=None):
        self.error = error

    def load(self):
        if self.error:
            raise self.error
        return {"tasks": TASKS, "holidays": {}}


class FakeService:
    def __init__(self):
        self.refresh_flags, self.invalidated = [], 0
        self.issues = [{"key": "PROJ-9", "summary": "공통 - 대시보드 - 대시보드"}]

    def payload(self, refresh=False):
        self.refresh_flags.append(refresh)
        return {"connected": True, "authError": False, "issues": self.issues, "worklogs": []}

    def lookup(self, keys):
        return {"issues": [{"key": k} for k in keys], "error": None}

    def invalidate(self):
        self.invalidated += 1


class FakeSession:
    def __init__(self):
        self.logged_in, self.logged_out = [], 0

    def login(self, email, token):
        if token != "good":
            raise JiraError("인증 실패 (401)", status=401)
        self.logged_in.append(email)
        return {"accountId": "acc-1", "displayName": "팀원"}

    def logout(self):
        self.logged_out += 1


class WbsServeTest(unittest.TestCase):
    def setUp(self, source=None):
        self.dir = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.service, self.session = FakeService(), FakeSession()
        self.links = LinkStore(self.dir / "links.json")
        handler = make_handler(self.service, source or FakeSource(), self.links, self.session,
                               self.dir / "plan-drafts.json", "team.atlassian.net")
        self.port = serve_handler(self, handler)

    def get(self, path):
        status, _, body = request(self, self.port, "GET", path)
        return status, json.loads(body)

    def test_drafts_round_trip(self):
        drafts = {"PROJ-1": {"start": "2026-11-03", "end": "2026-11-05"}}
        self.assertEqual(send_json(self, self.port, "PUT", "/api/drafts", drafts)[0], 200)
        self.assertEqual(self.get("/api/drafts"), (200, drafts))

    def test_static_and_hidden_sources(self):
        self.assertEqual(request(self, self.port, "GET", "/")[0], 200)
        self.assertEqual(request(self, self.port, "GET", "/js/app.js")[0], 200)
        for path in ("/serve.py", "/xlsx.py", "/%2e%2e/serve.py", "/..%2F..%2Fx.md"):
            self.assertEqual(request(self, self.port, "GET", path)[0], 404, path)

    def test_wbs_api_returns_tasks(self):
        status, body = self.get("/api/wbs")
        self.assertEqual((status, body["tasks"][0]["id"], body["error"]), (200, "A-1", None))

    def test_board_adds_domain_and_matched_links(self):
        status, body = self.get("/api/board?refresh=1")
        self.assertEqual((status, body["domain"], body["links"]), (200, "team.atlassian.net", {"A-1": "PROJ-9"}))
        self.assertEqual(self.service.refresh_flags, [True])

    def test_links_validate_and_invalidate_board(self):
        self.assertEqual(send_json(self, self.port, "PUT", "/api/links", {"task": "없음", "key": "PROJ-1"})[0], 400)
        self.assertEqual(send_json(self, self.port, "PUT", "/api/links", {"task": "A-1", "key": "proj 1"})[0], 400)
        status, body = send_json(self, self.port, "PUT", "/api/links", {"task": "A-1", "key": "PROJ-100"})
        self.assertEqual((status, body["links"], self.service.invalidated), (200, {"A-1": "PROJ-100"}, 1))
        self.assertEqual(self.get("/api/board")[1]["links"], {"A-1": "PROJ-100"})
        self.assertEqual(send_json(self, self.port, "PUT", "/api/links", {"task": "A-1", "key": None})[1]["links"], {})

    def test_corrupt_links_file_is_500_and_left_untouched(self):
        self.links.path.write_text("{broken", encoding="utf-8")
        status, body = send_json(self, self.port, "PUT", "/api/links", {"task": "A-1", "key": "PROJ-100"})
        self.assertEqual(status, 500)
        self.assertIn("links.json", body["error"])
        self.assertEqual(self.links.path.read_text(encoding="utf-8"), "{broken")

    def test_login_maps_auth_failure_to_401_and_success_invalidates(self):
        status, body = send_json(self, self.port, "POST", "/api/login", {"email": "a@b.c", "token": "bad"})
        self.assertEqual(status, 401)
        self.assertIn("API token", body["error"])
        status, body = send_json(self, self.port, "POST", "/api/login", {"email": "a@b.c", "token": "good"})
        self.assertEqual((status, body["displayName"], self.service.invalidated), (200, "팀원", 1))

    def test_logout_clears_session(self):
        self.assertEqual(send_json(self, self.port, "POST", "/api/logout", {})[0], 200)
        self.assertEqual((self.session.logged_out, self.service.invalidated), (1, 1))

    def test_writes_require_json(self):
        status, _, _ = request(self, self.port, "POST", "/api/login", body=b"email=a", headers={"Content-Type": "text/plain"})
        self.assertEqual(status, 415)


class BrokenWorkbookTest(WbsServeTest):
    """Review Focus 2: 저장 중이거나 깨진 엑셀은 500 이 아니라 error 를 담은 200."""

    def setUp(self):
        super().setUp(FakeSource(zipfile.BadZipFile("File is not a zip file")))

    def test_broken_workbook_returns_error_payload(self):
        status, body = self.get("/api/wbs")
        self.assertEqual((status, body["tasks"]), (200, []))
        self.assertIn("WBS 엑셀을 읽지 못했다", body["error"])

    def test_wbs_api_returns_tasks(self):
        self.skipTest("깨진 엑셀에서는 해당 없음")

    def test_board_adds_domain_and_matched_links(self):
        self.skipTest("깨진 엑셀에서는 해당 없음")

    def test_links_validate_and_invalidate_board(self):
        self.skipTest("깨진 엑셀에서는 해당 없음")

    def test_corrupt_links_file_is_500_and_left_untouched(self):
        self.skipTest("깨진 엑셀에서는 해당 없음")


class BrokenKeychainSession:
    def client(self):
        raise KeychainError("키체인 값이 JSON 이 아니다")

    def logout(self):
        raise KeychainError("키체인 삭제 실패")


class BrokenKeychainServeTest(unittest.TestCase):
    """키체인 항목이 깨져도 탭은 200 으로 로그인 화면을 보여야 한다."""

    def setUp(self):
        self.dir = Path(self.enterContext(tempfile.TemporaryDirectory()))
        session = BrokenKeychainSession()
        service = BoardService(session, "PROJ", lambda: [], cache_path=self.dir / "jira.json")
        handler = make_handler(service, FakeSource(), LinkStore(self.dir / "links.json"), session,
                               self.dir / "plan-drafts.json", "team.atlassian.net")
        self.port = serve_handler(self, handler)

    def test_board_is_disconnected_with_auth_error(self):
        status, _, body = request(self, self.port, "GET", "/api/board")
        payload = json.loads(body)
        self.assertEqual((status, payload["connected"], payload["authError"]), (200, False, True))
        self.assertIn("키체인", payload["error"])

    def test_logout_keychain_error_is_json_500(self):
        status, body = send_json(self, self.port, "POST", "/api/logout", {})
        self.assertEqual((status, body), (500, {"error": "키체인 삭제 실패"}))
