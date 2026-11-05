import unittest

from tabs.comments.client import TromboneError
from tabs.comments.serve import make_handler
from tabs.comments.service import NeedLogin
from tests.support import request, send_json, serve_handler


class FakeService:
    def __init__(self, fail=None):
        self.fail = fail
        self.overrides = []

    def describe(self):
        return {"loggedIn": False, "name": None, "base": "http://x", "exportEnabled": False}

    def report(self):
        if self.fail:
            raise self.fail
        return {"pages": []}

    def set_override(self, cid, priority, resolved):
        self.overrides.append((cid, priority, resolved))
        return {"priority": {}, "resolved": {}}


class ServeTest(unittest.TestCase):
    def serve(self, service):
        return serve_handler(self, make_handler(service))

    def test_page_and_session(self):
        port = self.serve(FakeService())
        self.assertEqual(request(self, port, "GET", "/")[0], 200)
        self.assertEqual(send_json(self, port, "GET", "/api/session")[1]["loggedIn"], False)

    def test_report_without_login_is_401(self):
        port = self.serve(FakeService(NeedLogin("로그인이 필요하다")))
        self.assertEqual(send_json(self, port, "GET", "/api/report"), (401, {"error": "로그인이 필요하다"}))

    def test_report_upstream_failure_is_502_with_message(self):
        port = self.serve(FakeService(TromboneError("기획서 연결 실패: timed out · 사내망(VPN) 연결을 확인한다")))
        status, body = send_json(self, port, "GET", "/api/report")
        self.assertEqual(status, 502)
        self.assertIn("VPN", body["error"])

    def test_overrides_validate_level_and_id(self):
        service = FakeService()
        port = self.serve(service)
        self.assertEqual(send_json(self, port, "PUT", "/api/overrides", {"id": "CM1", "priority": {"level": "최상", "reason": ""}})[0], 400)
        self.assertEqual(send_json(self, port, "PUT", "/api/overrides", {"id": "../x", "resolved": "a"})[0], 400)
        self.assertEqual(send_json(self, port, "PUT", "/api/overrides", {"id": "CM1"})[0], 400)
        self.assertEqual(send_json(self, port, "PUT", "/api/overrides", {"id": "CM1", "resolved": "메일 회신"})[0], 200)
        self.assertEqual(service.overrides, [("CM1", None, "메일 회신")])

    def test_writes_require_json_and_local_host(self):
        port = self.serve(FakeService())
        self.assertEqual(request(self, port, "POST", "/api/login", body=b"a", headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(request(self, port, "GET", "/api/session", headers={"Host": "evil.example.com"})[0], 403)
