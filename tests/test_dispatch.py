import contextlib
import http.client
import io
import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from dashboard.dispatch import Mount, make_dispatcher
from tests.support import raw_exchange


class EchoHandler(BaseHTTPRequestHandler):
    """HTTP/1.0 앱 대역. 받은 경로와 서버 포트를 돌려준다."""

    def do_GET(self):
        body = json.dumps({"path": self.path, "port": self.server.server_port}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class BoomHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        raise RuntimeError("boom")

    def log_message(self, *args):
        pass


class StubDashboard:
    def __init__(self, mounts):
        self.mounts = {m.id: m for m in mounts}
        self.applied = []
        self.reply = (200, {"configured": True})

    def mount(self, mount_id):
        return self.mounts.get(mount_id)

    def status(self):
        return [{"id": m.id, "ok": m.handler is not None, "error": m.error} for m in self.mounts.values()]

    def describe(self):
        return {"configured": True, "tabs": [], "enabled": list(self.mounts), "values": {}}

    def apply(self, payload):
        self.applied.append(payload)
        return self.reply

    def reorder(self, payload):
        self.applied.append(("order", payload))
        return 200, {"enabled": payload.get("order") if isinstance(payload, dict) else []}

    def template(self, tab_id, index):
        return ("YYYY-MM-DD 계획 제목.md", "---\nstatus: 할 일\n".encode()) if (tab_id, index) == ("plans", "0") else None


class StubUpdater:
    def __init__(self):
        self.checks = []
        self.applied = 0

    def check(self, refresh=False):
        self.checks.append(refresh)
        return {"ok": True, "behind": 1 if refresh else 0}

    def apply(self):
        self.applied += 1
        return 409, {"error": "로컬 변경"}


class DispatchTest(unittest.TestCase):
    def setUp(self):
        shell = Path(self.enterContext(tempfile.TemporaryDirectory()))
        (shell / "index.html").write_text("<h1>셸</h1>", encoding="utf-8")
        (shell / "shell.js").write_text("export {};", encoding="utf-8")
        (shell / "secret.txt").write_text("LEAK", encoding="utf-8")
        self.dashboard = StubDashboard([
            Mount("echo", EchoHandler),
            Mount("boom", BoomHandler),
            Mount("broken", None, "ConfigError: 설정 없음"),
        ])
        self.updater = StubUpdater()
        self.picked = []
        picker = type("StubPicker", (), {"pick": lambda _, payload: (self.picked.append(payload), (200, {"paths": ["/a"]}))[1]})()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_dispatcher(self.dashboard, shell, self.updater, picker))
        self.server.daemon_threads = True
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.enterContext(contextlib.redirect_stderr(io.StringIO()))

    def request(self, method, path, host=None, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        self.addCleanup(conn.close)
        all_headers = dict(headers or {})
        if host is not None:
            all_headers["Host"] = host
        conn.request(method, path, body=body, headers=all_headers)
        response = conn.getresponse()
        return response.status, dict(response.getheaders()), response.read()

    def test_strips_prefix_and_keeps_query(self):
        status, _, body = self.request("GET", "/echo/api/board?refresh=1")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["path"], "/api/board?refresh=1")

    def test_mount_root_becomes_slash(self):
        _, _, body = self.request("GET", "/echo/")
        self.assertEqual(json.loads(body)["path"], "/")

    def test_inner_handler_sees_dashboard_port(self):
        _, _, body = self.request("GET", "/echo/")
        self.assertEqual(json.loads(body)["port"], self.port)

    def test_bare_prefix_redirects_keeping_query(self):
        status, headers, _ = self.request("GET", "/echo?tab=plan")
        self.assertEqual((status, headers["Location"]), (301, "/echo/?tab=plan"))

    def test_failed_mount_is_503_while_others_serve(self):
        status, _, body = self.request("GET", "/broken/api/x")
        self.assertEqual(status, 503)
        self.assertIn("설정 없음", json.loads(body)["error"])
        self.assertEqual(self.request("GET", "/echo/")[0], 200)

    def test_method_missing_on_inner_is_501(self):
        self.assertEqual(self.request("DELETE", "/echo/x")[0], 501)

    def test_inner_exception_is_500_and_server_survives(self):
        self.assertEqual(self.request("GET", "/boom/")[0], 500)
        self.assertEqual(self.request("GET", "/echo/")[0], 200)

    def test_shell_paths_reject_foreign_host(self):
        for path in ("/", "/echo", "/broken/x", "/_dashboard/status"):
            self.assertEqual(self.request("GET", path, host="evil.example.com")[0], 403, path)
        self.assertEqual(self.request("GET", "/", host="localhost:8787")[0], 200)
        self.assertEqual(self.request("GET", "/", host="[::1]:8787")[0], 200)

    def test_shell_serves_only_listed_existing_files(self):
        status, headers, body = self.request("GET", "/")
        self.assertEqual((status, body.decode("utf-8")), (200, "<h1>셸</h1>"))
        self.assertTrue(headers["Content-Type"].startswith("text/html"))
        self.assertEqual(self.request("GET", "/shell.js")[0], 200)
        self.assertEqual(self.request("GET", "/shell.css")[0], 404)  # 목록엔 있지만 파일 없음
        self.assertEqual(self.request("GET", "/secret.txt")[0], 404)
        self.assertEqual(self.request("GET", "/nope/x")[0], 404)

    def test_shell_rejects_writes(self):
        self.assertEqual(self.request("POST", "/", body=b"x")[0], 405)

    def test_status_lists_mounts(self):
        status, _, body = self.request("GET", "/_dashboard/status")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["mounts"], [
            {"id": "echo", "ok": True, "error": None},
            {"id": "boom", "ok": True, "error": None},
            {"id": "broken", "ok": False, "error": "ConfigError: 설정 없음"},
        ])

    def test_http10_inner_response_closes_keepalive_connection(self):
        raw = raw_exchange(self.port, b"GET /echo/ HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
        self.assertTrue(raw.startswith(b"HTTP/1.0 200"))

    def test_config_get_returns_dashboard_description(self):
        status, _, body = self.request("GET", "/_dashboard/config")
        self.assertEqual((status, json.loads(body)["enabled"]), (200, ["echo", "boom", "broken"]))

    def test_config_post_requires_json_and_local_host(self):
        self.assertEqual(self.request("POST", "/_dashboard/config", body=b"{}", headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request("POST", "/_dashboard/config", host="evil.example.com", body=b"{}",
                                      headers={"Content-Type": "application/json"})[0], 403)
        self.assertEqual(self.dashboard.applied, [])

    def test_config_post_passes_payload_and_returns_dashboard_status(self):
        self.dashboard.reply = (422, {"errors": {"a": {"folder": "필수 항목이다"}}})
        status, _, body = self.request("POST", "/_dashboard/config", body=b'{"tabs": {"a": {}}}',
                                       headers={"Content-Type": "application/json"})
        self.assertEqual((status, json.loads(body)), (422, {"errors": {"a": {"folder": "필수 항목이다"}}}))
        self.assertEqual(self.dashboard.applied, [{"tabs": {"a": {}}}])

    def test_order_post_passes_payload(self):
        status, _, body = self.request("POST", "/_dashboard/order", body=b'{"order": ["boom", "echo"]}',
                                       headers={"Content-Type": "application/json"})
        self.assertEqual((status, json.loads(body)), (200, {"enabled": ["boom", "echo"]}))
        self.assertEqual(self.dashboard.applied, [("order", {"order": ["boom", "echo"]})])
        self.assertEqual(self.request("POST", "/_dashboard/order", body=b"{}", headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request("GET", "/_dashboard/order")[0], 404)

    def test_update_get_passes_refresh_flag_and_rejects_foreign_host(self):
        status, _, body = self.request("GET", "/_dashboard/update")
        self.assertEqual((status, json.loads(body)["behind"]), (200, 0))
        status, _, body = self.request("GET", "/_dashboard/update?refresh=1")
        self.assertEqual((status, json.loads(body)["behind"]), (200, 1))
        self.assertEqual(self.updater.checks, [False, True])
        self.assertEqual(self.request("GET", "/_dashboard/update", host="evil.example.com")[0], 403)

    def test_update_post_returns_updater_verdict_and_other_methods_405(self):
        status, _, body = self.request("POST", "/_dashboard/update")
        self.assertEqual((status, json.loads(body)), (409, {"error": "로컬 변경"}))
        self.assertEqual(self.updater.applied, 1)
        self.assertEqual(self.request("PUT", "/_dashboard/update")[0], 405)
        self.assertEqual(self.request("POST", "/_dashboard/update", host="evil.example.com")[0], 403)
        self.assertEqual(self.updater.applied, 1)

    def test_template_downloads_as_attachment_with_utf8_name(self):
        status, headers, body = self.request("GET", "/_dashboard/templates/plans/0")
        self.assertEqual((status, body.decode()), (200, "---\nstatus: 할 일\n"))
        self.assertEqual(headers["Content-Type"], "text/markdown; charset=utf-8")
        self.assertEqual(headers["Content-Disposition"],
                         "attachment; filename*=UTF-8''YYYY-MM-DD%20%EA%B3%84%ED%9A%8D%20%EC%A0%9C%EB%AA%A9.md")
        for path in ("/_dashboard/templates/plans/1", "/_dashboard/templates/nope/0", "/_dashboard/templates/"):
            self.assertEqual(self.request("GET", path)[0], 404, path)
        self.assertEqual(self.request("GET", "/_dashboard/templates/plans/0", host="evil.example.com")[0], 403)

    def test_pick_post_passes_payload_only_from_local_host(self):
        status, _, body = self.request("POST", "/_dashboard/pick", body=b'{"kind": "dir"}', headers={"Content-Type": "application/json"})
        self.assertEqual((status, json.loads(body)), (200, {"paths": ["/a"]}))
        self.assertEqual(self.request("POST", "/_dashboard/pick", host="evil.example.com", body=b'{"kind": "dir"}',
                                      headers={"Content-Type": "application/json"})[0], 403)
        self.assertEqual(self.request("GET", "/_dashboard/pick")[0], 404)
        self.assertEqual(self.picked, [{"kind": "dir"}])

    def test_update_api_is_404_without_updater(self):
        shell = Path(self.enterContext(tempfile.TemporaryDirectory()))
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_dispatcher(self.dashboard, shell))
        self.addCleanup(server.server_close)
        conn = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
        self.addCleanup(conn.close)
        threading.Thread(target=server.handle_request, daemon=True).start()
        conn.request("GET", "/_dashboard/update", headers={"Connection": "close"})
        self.assertEqual(conn.getresponse().status, 404)


if __name__ == "__main__":
    unittest.main()
