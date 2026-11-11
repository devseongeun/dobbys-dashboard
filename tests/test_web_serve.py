"""웹 버전 서버(web_serve.py): 정적 루트·Host/Origin·X-Dobbys-Proxy·본문 한도·보안 헤더·로그."""
import http.client
import io
import json
import tempfile
import threading
import unittest
from pathlib import Path

import api.version
import web_serve
from api._http import Response, json_response

ORIGIN = "http://127.0.0.1:8788"


class Boom:
    @staticmethod
    def handle(request):
        raise RuntimeError("token=secret-value")


class Echo:
    @staticmethod
    def handle(request):
        return json_response(200, {"method": request.method, "path": request.path, "query": request.query,
                                   "body": request.body.decode("utf-8"), "auth": request.headers.get("Authorization")})


class Headed:
    @staticmethod
    def handle(request):
        # 모듈이 보안 헤더를 덮어써도 서버 값이 이긴다.
        return Response(201, {"Content-Type": "text/plain", "Content-Security-Policy": "default-src *", "X-Extra": "1"}, b"ok")


class WebServeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        self.web = self.tmp / "web"
        (self.web / "tabs" / "plans").mkdir(parents=True)
        (self.web / "index.html").write_text("<!doctype html>셸", encoding="utf-8")
        (self.web / "app.js").write_text("export {};", encoding="utf-8")
        (self.web / "tabs" / "plans" / "index.html").write_text("plans", encoding="utf-8")
        (self.web / ".hidden.js").write_text("x", encoding="utf-8")
        (self.tmp / "secret.py").write_text("SECRET", encoding="utf-8")
        shared_src = self.tmp / "local" / "route.js"
        shared_src.parent.mkdir()
        shared_src.write_text("export const route = 1;", encoding="utf-8")
        (self.tmp / "local" / "other.js").write_text("nope", encoding="utf-8")
        self.log = io.StringIO()
        handler = web_serve.make_handler(
            self.web, [ORIGIN, "http://localhost:8788", "https://dash.example.com"],
            routes={"version": api.version, "boom": Boom, "echo": Echo, "headed": Headed},
            shared={"shared/route.js": shared_src, "tabs/plans/한글 템플릿.md": shared_src}, log=self.log)
        self.server = web_serve.V4Server(("127.0.0.1", 0), handler)
        threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def request(self, method, path, headers=None, body=None, host="127.0.0.1:8788"):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        self.addCleanup(conn.close)
        conn.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
        conn.putheader("Host", host)
        for name, value in (headers or {}).items():
            conn.putheader(name, value)
        if body is not None:
            conn.putheader("Content-Length", str(len(body)))
        conn.endheaders(body)
        res = conn.getresponse()
        return res, res.read()

    def api(self, path, **kwargs):
        headers = {"X-Dobbys-Proxy": "1", **kwargs.pop("headers", {})}
        return self.request(kwargs.pop("method", "GET"), path, headers=headers, **kwargs)

    def assert_security_headers(self, res):
        self.assertEqual(res.getheader("Content-Security-Policy"), web_serve.CSP)
        self.assertEqual(res.getheader("X-Content-Type-Options"), "nosniff")
        self.assertEqual(res.getheader("Referrer-Policy"), "no-referrer")

    def test_serves_index_and_static_files_with_security_headers(self):
        res, body = self.request("GET", "/")
        self.assertEqual((res.status, body.decode("utf-8")), (200, "<!doctype html>셸"))
        self.assertEqual(res.getheader("Content-Type"), "text/html; charset=utf-8")
        self.assert_security_headers(res)
        res, body = self.request("GET", "/app.js")
        self.assertEqual((res.status, res.getheader("Content-Type")), (200, "text/javascript; charset=utf-8"))
        res, body = self.request("HEAD", "/app.js")
        self.assertEqual((res.status, body), (200, b""))
        self.assertEqual(res.getheader("Content-Length"), "10")

    def test_csp_matches_the_contract(self):
        for directive in ("default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
                          "img-src 'self' blob: data:", "frame-src 'self' blob:", "connect-src 'self'",
                          "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'"):
            self.assertIn(directive, web_serve.CSP)

    def test_folder_without_slash_redirects_relatively_and_with_slash_gives_index(self):
        res, _ = self.request("GET", "/tabs/plans")
        self.assertEqual((res.status, res.getheader("Location")), (301, "plans/"))
        res, body = self.request("GET", "/tabs/plans/")
        self.assertEqual((res.status, body), (200, b"plans"))
        res, _ = self.request("GET", "/tabs/")  # index.html 이 없는 폴더
        self.assertEqual(res.status, 404)

    def test_rejects_paths_outside_web_root_and_hidden_files(self):
        for path in ("/../secret.py", "/%2e%2e/secret.py", "/tabs/../../secret.py", "/.hidden.js", "/%2Ehidden.js",
                     "/..%5Csecret.py", "/app.js%00", "/local/route.js", "/shared/other.js", "/nope.js"):
            res, body = self.request("GET", path)
            self.assertEqual(res.status, 404, path)
            self.assertNotIn(b"SECRET", body)
            self.assert_security_headers(res)

    def test_shared_files_are_served_only_from_the_explicit_list(self):
        res, body = self.request("GET", "/shared/route.js")
        self.assertEqual((res.status, body), (200, b"export const route = 1;"))
        res, _ = self.request("GET", "/tabs/plans/%ED%95%9C%EA%B8%80%20%ED%85%9C%ED%94%8C%EB%A6%BF.md")
        self.assertEqual((res.status, res.getheader("Content-Type")), (200, "text/markdown; charset=utf-8"))

    def test_real_shared_files_exist(self):
        for rel, path in web_serve.SHARED_FILES.items():
            self.assertTrue(path.is_file(), rel)
            self.assertTrue(path.is_relative_to(web_serve.REPO_ROOT), rel)

    def test_writes_to_static_paths_are_405(self):
        res, _ = self.request("POST", "/", body=b"{}")
        self.assertEqual(res.status, 405)
        self.assert_security_headers(res)

    def test_foreign_host_is_421_for_static_and_api(self):
        for host in ("evil.example.com", "127.0.0.1:9999", "", "dash.example.com:8443"):
            res, _ = self.request("GET", "/", host=host)
            self.assertEqual(res.status, 421, host)
            self.assert_security_headers(res)
            res, _ = self.api("/api/version", host=host)
            self.assertEqual(res.status, 421, host)
        for host in ("localhost:8788", "dash.example.com", "DASH.example.com"):
            res, _ = self.request("GET", "/", host=host)
            self.assertEqual(res.status, 200, host)

    def test_api_requires_proxy_header_and_matching_origin(self):
        res, _ = self.request("GET", "/api/version")
        self.assertEqual(res.status, 403)
        res, _ = self.request("GET", "/api/version", headers={"X-Dobbys-Proxy": "yes"})
        self.assertEqual(res.status, 403)
        for origin in ("https://evil.example.com", "null", "http://127.0.0.1:9999"):
            res, _ = self.api("/api/version", headers={"Origin": origin})
            self.assertEqual(res.status, 403, origin)
        for origin in (ORIGIN, "https://dash.example.com/", "HTTPS://DASH.EXAMPLE.COM"):
            res, _ = self.api("/api/version", headers={"Origin": origin})
            self.assertEqual(res.status, 200, origin)
        res, body = self.api("/api/version")  # Origin 이 없는 같은 출처 GET
        self.assertEqual(res.status, 200)
        self.assertEqual(set(json.loads(body)), {"commit", "date"})
        self.assert_security_headers(res)

    def test_unknown_api_is_404(self):
        for path in ("/api/nope", "/api", "/api/"):
            res, _ = self.api(path)
            self.assertEqual(res.status, 404, path)

    def test_api_passes_request_and_keeps_security_headers(self):
        res, body = self.api("/api/echo/rest/x?a=1&a=2&b=", method="POST", body="한글".encode("utf-8"),
                             headers={"Authorization": "Basic abc", "Content-Type": "application/json"})
        self.assertEqual(res.status, 200)
        self.assertEqual(json.loads(body), {"method": "POST", "path": "/api/echo/rest/x", "query": {"a": ["1", "2"], "b": [""]},
                                            "body": "한글", "auth": "Basic abc"})
        res, body = self.api("/api/headed")
        self.assertEqual((res.status, body, res.getheader("X-Extra")), (201, b"ok", "1"))
        self.assert_security_headers(res)

    def test_body_limit_is_64_kib(self):
        res, _ = self.api("/api/echo", method="POST", body=b"x" * (64 * 1024))
        self.assertEqual(res.status, 200)
        res, _ = self.api("/api/echo", method="POST", body=b"x" * (64 * 1024 + 1))
        self.assertEqual(res.status, 413)

    def test_module_error_is_500_without_details(self):
        res, body = self.api("/api/boom")
        self.assertEqual(res.status, 500)
        self.assertNotIn(b"secret", body)
        self.assertNotIn("secret", self.log.getvalue())

    def test_log_keeps_only_method_path_and_status(self):
        self.api("/api/version?token=secret-q", headers={"Authorization": "Bearer secret-h"})
        self.request("GET", "/app.js?x=secret-s")
        log = self.log.getvalue()
        self.assertIn("GET /api/version 200", log)
        self.assertIn("GET /app.js 200", log)
        self.assertNotIn("secret", log)


class SettingsTest(unittest.TestCase):
    def test_origins_default_to_loopback_port_and_hosts_come_from_origins(self):
        self.assertEqual(web_serve.parse_origins(None, 8788), ["http://127.0.0.1:8788", "http://localhost:8788"])
        self.assertEqual(web_serve.parse_origins(" https://Dash.example.com/ , http://127.0.0.1:9000", 1),
                         ["https://dash.example.com", "http://127.0.0.1:9000"])
        self.assertEqual(web_serve.allowed_hosts(["https://dash.example.com", "http://127.0.0.1:9000"]),
                         {"dash.example.com", "127.0.0.1:9000"})

    def test_web_server_does_not_import_local_only_modules(self):
        source = Path(web_serve.__file__).read_text(encoding="utf-8")
        for name in ("dashboard", "tabs.", "keychain", "picker"):
            self.assertNotIn(f"import {name}", source)
            self.assertNotIn(f"from {name}", source)

    def test_version_is_null_outside_git(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(api.version.read(Path(tmp)), {"commit": None, "date": None})
        found = api.version.read()
        self.assertRegex(found["commit"] or "", r"^[0-9a-f]{4,}$")
        self.assertRegex(found["date"] or "", r"^\d{4}-\d{2}-\d{2}$")


if __name__ == "__main__":
    unittest.main()
