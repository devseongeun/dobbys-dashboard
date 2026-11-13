"""api/trombone.py 중계: 대상(환경변수만)·경로·메서드·쿼리·본문 허용 규칙과 Authorization·비밀번호 무저장·무로그·오류 미포함."""
import contextlib
import http.client
import io
import json
import logging
import os
import subprocess
import sys
import threading
import unittest
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

import api.trombone as proxy
from api._http import Request

REPO = Path(__file__).resolve().parents[1]
BASE = "http://trombone.internal:8088"
TOKEN = "eyJhbGciOi.SECRET-TOKEN.sig"
SECRET = "SECRET-TOKEN"
PASSWORD = "PASS-W0RD-SECRET"
JSON = {"Content-Type": "application/json"}


def req(path, method="GET", query=None, body=None, headers=None, proxy_header=True):
    base = {"X-Dobbys-Proxy": "1"} if proxy_header else {}
    if body is not None:
        base.update(JSON)
    raw = body if isinstance(body, bytes) else (json.dumps(body).encode() if body is not None else b"")
    return Request(method, "/api/trombone" + path,
                   {k: v if isinstance(v, list) else [v] for k, v in (query or {}).items()}, {**base, **(headers or {})}, raw)


def login_body(**extra):
    return {"loginId": "kim@example.com", "password": PASSWORD, **extra}


def react(cid="CM1", body=None, token=TOKEN, headers=None, **kwargs):
    auth = {"Authorization": "Bearer " + token} if token is not None else {}
    return req(f"/spec/comments/{cid}/reactions", "POST", body=body if body is not None else {"emoji": "EMO005"},
               headers={**auth, **(headers or {})}, **kwargs)


class FakeResponse:
    def __init__(self, status=200, body=b'[{"commentId": "CM1"}]'):
        self.status, self._body = status, body

    def read(self, limit=-1):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class Opener:
    """_OPENER.open 대역. 받은 요청을 기록하고 정해 둔 응답(또는 예외)을 돌려준다."""

    def __init__(self, result=None):
        self.result = result if result is not None else FakeResponse()
        self.calls = []

    def open(self, request, timeout=None):
        self.calls.append((request.get_method(), request.full_url, dict(request.header_items()), request.data, timeout))
        if isinstance(self.result, BaseException):
            raise self.result
        return self.result


class ProxyCase(unittest.TestCase):
    def setUp(self):
        self.opener = Opener()
        self.enterContext(mock.patch.object(proxy, "_OPENER", self.opener))
        self.enterContext(mock.patch.dict(os.environ, {"TROMBONE_BASE": BASE}))
        self.out = io.StringIO()
        self.enterContext(contextlib.redirect_stderr(self.out))
        self.enterContext(contextlib.redirect_stdout(self.out))
        self.enterContext(self.assertNoLogs(level=logging.DEBUG))

    def call(self, request):
        response = proxy.handle(request)
        body = json.loads(response.body) if response.body else None
        return response.status, body, response

    def assertRefused(self, request, status=400):
        got, body, response = self.call(request)
        self.assertEqual(got, status, body)
        self.assertIn("error", body)
        self.assertEqual(self.opener.calls, [], "거절한 요청을 TROMBONE 으로 보냈다")
        text = response.body.decode("utf-8")
        for secret in (SECRET, PASSWORD):
            self.assertNotIn(secret, text)
        return body


class AllowTest(ProxyCase):
    def test_comments_inbox_passes_body_through_without_authorization(self):
        status, body, response = self.call(req("/comments", headers={"Authorization": "Bearer " + TOKEN}))
        self.assertEqual((status, body), (200, [{"commentId": "CM1"}]))
        [(method, url, headers, data, timeout)] = self.opener.calls
        self.assertEqual((method, url, data, timeout), ("GET", BASE + "/trbw/api/comments", None, proxy.TIMEOUT_SECONDS))
        self.assertNotIn("Authorization", headers, "조회에 Bearer 를 넘겼다(로컬판처럼 인증 없이 부른다)")
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_spec_bundle_quotes_page_path(self):
        status, _, _ = self.call(req("/spec", query={"path": "/spec/TCK 목록?x=1&y=/../admin"}))
        self.assertEqual(status, 200)
        self.assertEqual(self.opener.calls[0][1],
                         BASE + "/trbw/api/spec?path=%2Fspec%2FTCK%20%EB%AA%A9%EB%A1%9D%3Fx%3D1%26y%3D%2F..%2Fadmin")

    def test_login_body_is_rebuilt_from_the_two_fields(self):
        self.opener.result = FakeResponse(200, b'{"token": "T", "name": "kim"}')
        status, body, _ = self.call(req("/auth/login", "POST", body=login_body()))
        self.assertEqual((status, body), (200, {"token": "T", "name": "kim"}))
        [(method, url, headers, data, _)] = self.opener.calls
        self.assertEqual((method, url), ("POST", BASE + "/trbw/api/auth/login"))
        self.assertEqual(json.loads(data), login_body())
        self.assertEqual(headers["Content-type"], "application/json")
        self.assertNotIn("Authorization", headers)

    def test_reaction_forwards_bearer_once(self):
        self.opener.result = FakeResponse(200, b'[{"emoji": "EMO005", "actors": ["kim"]}]')
        status, body, _ = self.call(react("CM_1-a"))
        self.assertEqual((status, body), (200, [{"emoji": "EMO005", "actors": ["kim"]}]))
        [(method, url, headers, data, _)] = self.opener.calls
        self.assertEqual((method, url), ("POST", BASE + "/trbw/api/spec/comments/CM_1-a/reactions"))
        self.assertEqual(headers["Authorization"], "Bearer " + TOKEN)
        self.assertEqual(json.loads(data), {"emoji": "EMO005"})

    def test_empty_success_body_and_2xx_become_200(self):
        self.opener.result = FakeResponse(204, b"")
        status, body, response = self.call(react())
        self.assertEqual((status, body, response.body), (200, None, b""))

    def test_config_returns_base_without_calling_trombone(self):
        os.environ["TROMBONE_BASE"] = BASE + "/"
        self.assertEqual(self.call(req("/config"))[:2], (200, {"base": BASE}))
        self.assertEqual(self.opener.calls, [])

    def test_target_comes_only_from_environment(self):
        os.environ["TROMBONE_BASE"] = "https://spec.example.org"
        self.call(req("/comments", query={}, headers={"Host": "evil.example.com", "X-Forwarded-Host": "evil.example.com"}))
        self.assertEqual(self.opener.calls[0][1], "https://spec.example.org/trbw/api/comments")
        self.opener.calls.clear()
        for query in ({"base": "http://evil"}, {"url": "http://evil"}, {"host": "evil"}):
            with self.subTest(query=query):
                self.assertRefused(req("/comments", query=query))

    def test_base_may_have_a_plain_sub_path(self):
        os.environ["TROMBONE_BASE"] = "https://spec.example.org/trombone/v4/"
        self.assertEqual(self.call(req("/config"))[:2], (200, {"base": "https://spec.example.org/trombone/v4"}))
        self.call(req("/comments"))
        self.assertEqual(self.opener.calls[0][1], "https://spec.example.org/trombone/v4/trbw/api/comments")

    def test_constants_match_local_client(self):
        from tabs.comments import client, model, serve
        self.assertEqual((proxy.API_PREFIX, proxy.TIMEOUT_SECONDS, proxy.DECIDED_EMOJI, proxy.COMMENT_ID.pattern),
                         (client.API_PREFIX, client.TIMEOUT, model.DECIDED_EMOJI, serve.COMMENT_ID.pattern))


class NotConfiguredTest(ProxyCase):
    def test_missing_or_bad_base_is_503_with_plain_message(self):
        for value in (None, "", "  ", "trombone:8088", "ftp://x", "http://", "http://u:p@host", "http://host?x=1",
                      "http://host#a", "http://host:port", "http://ho st", "http://ho\nst", "http://[::1", "http://host:99999",
                      "http://host/sub/../x", "http://host/./x", "http://host//x", "http://host/a%2e%2e", "http://host/a\\b",
                      "http://host/sub/..", "http://host?", "http://host#"):
            with self.subTest(value=value):
                if value is None:
                    os.environ.pop("TROMBONE_BASE", None)
                else:
                    os.environ["TROMBONE_BASE"] = value
                body = self.assertRefused(req("/comments"), 503)
                self.assertIn("TROMBONE_BASE", body["error"])
                self.assertEqual(self.call(req("/config"))[0], 503)
        os.environ.pop("TROMBONE_BASE")
        self.assertIn("설정되지 않았다", self.call(req("/config"))[1]["error"])


class RefuseTest(ProxyCase):
    def test_missing_or_wrong_proxy_header_is_403(self):
        self.assertRefused(req("/comments", proxy_header=False), 403)
        self.assertRefused(req("/comments", proxy_header=False, headers={"X-Dobbys-Proxy": "0"}), 403)
        self.assertEqual(self.call(req("/comments", proxy_header=False, headers={"x-dobbys-proxy": "1"}))[0], 200)

    def test_only_four_paths(self):
        for path in ("", "/", "/comment", "/comments/", "/comments/1", "/spec/", "/spec/comments", "/auth", "/auth/logout",
                     "/auth/login/x", "/spec/comments/CM1", "/spec/comments/CM1/reactions/x", "/spec/pages/P1/reactions",
                     "/../comments", "/trbw/api/comments", "//evil.com/comments", "/admin", "/comments\n",
                     "/spec/comments/CM1/reactions\n", "/auth/login\n"):
            with self.subTest(path=path):
                got, body, _ = self.call(req(path, "POST" if "reactions" in path or "auth" in path else "GET",
                                             body={} if "reactions" in path or "auth" in path else None))
                self.assertIn(got, (400, 404), (path, body))
        self.assertEqual(self.opener.calls, [])

    def test_methods_are_fixed_per_path(self):
        cases = [("/comments", "GET"), ("/spec", "GET"), ("/auth/login", "POST"), ("/spec/comments/CM1/reactions", "POST"),
                 ("/config", "GET")]
        for path, allowed in cases:
            for method in ("GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"):
                if method == allowed:
                    continue
                with self.subTest(path=path, method=method):
                    got, _, response = self.call(req(path, method, query={"path": "/a"} if path == "/spec" else None))
                    self.assertEqual((got, response.headers.get("Allow")), (405, allowed))
        self.assertEqual(self.opener.calls, [])

    def test_queries_are_fixed(self):
        self.assertRefused(req("/comments", query={"author": "x"}))
        self.assertRefused(req("/spec"))
        self.assertRefused(req("/spec", query={"path": ["/a", "/b"]}))
        self.assertRefused(req("/spec", query={"path": "/a", "expand": "all"}))
        for bad in ("a", "", "//evil.com/x", "\\x", "/a\nb", "/a\x00", "/" + "a" * proxy.PAGE_PATH_MAX):
            with self.subTest(path=bad):
                self.assertRefused(req("/spec", query={"path": bad}))
        self.assertRefused(req("/auth/login", "POST", query={"next": "/"}, body=login_body()))
        self.assertRefused(react(query={"emoji": "EMO001"}))

    def test_login_body_shape(self):
        for body in ({}, {"loginId": "a"}, login_body(remember=True), {"loginId": "", "password": "x"},
                     {"loginId": "  ", "password": "x"}, {"loginId": "a", "password": ""}, {"loginId": 1, "password": "x"},
                     {"loginId": "a", "password": "x" * 257}, [1], "x"):
            with self.subTest(body=body):
                self.assertRefused(req("/auth/login", "POST", body=body))
        self.assertRefused(req("/auth/login", "POST", body=b"{bad", headers=JSON))
        self.assertRefused(req("/auth/login", "POST", body=json.dumps(login_body()).encode(),
                               headers={"Content-Type": "text/plain"}), 415)

    def test_reaction_shape_and_bearer(self):
        for cid in ("CM.1", "a" * 41, "%2e%2e", "CM 1", "CM1\n", "CM1\r\n"):
            with self.subTest(cid=cid):
                self.assertRefused(react(cid))
        for body in ({"emoji": "EMO001"}, {"emoji": "👀"}, {"emoji": "EMO005", "extra": 1}, {}):
            with self.subTest(body=body):
                self.assertRefused(react(body=body))
        for token in (None, "", "two words", "a\r\nX-Injected: 1", "x" * (proxy.TOKEN_MAX + 1), "abc\n"):
            with self.subTest(token=token):
                self.assertRefused(react(token=token), 401)
        self.assertRefused(react(token=None, headers={"Authorization": "Basic " + TOKEN}), 401)


class SecretTest(ProxyCase):
    """Bearer·비밀번호는 전달만 한다: 응답·로그·모듈 상태 어디에도 남지 않는다."""

    def assertNoSecret(self, response):
        text = response.body.decode("utf-8")
        for secret in (SECRET, PASSWORD):
            self.assertNotIn(secret, text)
            self.assertNotIn(secret, self.out.getvalue())
            for value in vars(proxy).values():
                self.assertNotIn(secret, repr(value)[:10000])

    def http_error(self, code, body):
        return urllib.error.HTTPError(BASE + "/trbw/api/x", code, "x", {}, io.BytesIO(body))

    def test_trombone_http_error_keeps_status_and_safe_message(self):
        for code in (400, 401, 403, 404, 500):
            self.opener.result = self.http_error(code, '{"message": "아이디 또는 비밀번호가 올바르지 않습니다"}'.encode())
            status, body, response = self.call(req("/auth/login", "POST", body=login_body()))
            self.assertEqual((status, body), (code, {"tromboneStatus": code, "message": "아이디 또는 비밀번호가 올바르지 않습니다"}))
            self.assertNoSecret(response)

    def test_message_echoing_password_or_token_is_dropped(self):
        self.opener.result = self.http_error(401, json.dumps({"message": f"bad password {PASSWORD}"}).encode())
        status, body, response = self.call(req("/auth/login", "POST", body=login_body()))
        self.assertEqual((status, body), (401, {"tromboneStatus": 401}))
        self.assertNoSecret(response)
        self.opener.result = self.http_error(401, json.dumps({"message": f"expired {TOKEN}"}).encode())
        status, body, response = self.call(react())
        self.assertEqual((status, body), (401, {"tromboneStatus": 401}))
        self.assertNoSecret(response)

    def test_non_json_or_long_error_body(self):
        self.opener.result = self.http_error(500, b"<html>" + PASSWORD.encode())
        self.assertEqual(self.call(req("/comments"))[:2], (500, {"tromboneStatus": 500}))
        self.opener.result = self.http_error(500, json.dumps({"message": "가" * 500}).encode())
        message = self.call(req("/comments"))[1]["message"]
        self.assertEqual(len(message), proxy.MESSAGE_MAX + 1)

    def test_connection_failure_and_timeout_messages(self):
        self.opener.result = urllib.error.URLError(ConnectionRefusedError(61, "Connection refused"))
        status, body, response = self.call(react())
        self.assertEqual((status, body), (502, {"error": "기획서 연결 실패: Connection refused"}))
        self.assertNoSecret(response)
        self.opener.result = urllib.error.URLError(TimeoutError("timed out"))
        self.assertEqual(self.call(react())[:2], (504, {"error": "기획서 응답 시간 초과 (20s)"}))
        self.opener.result = TimeoutError()
        status, body, response = self.call(req("/auth/login", "POST", body=login_body()))
        self.assertEqual((status, body), (504, {"error": "기획서 응답 시간 초과 (20s)"}))
        self.assertNoSecret(response)

    def test_success_leaves_nothing_behind(self):
        for request in (req("/auth/login", "POST", body=login_body()), react()):
            status, _, response = self.call(request)
            self.assertEqual(status, 200)
            self.assertNoSecret(response)
        self.assertEqual(self.out.getvalue(), "")

    def test_oversized_response_is_502(self):
        self.opener.result = FakeResponse(200, b"x" * (proxy.RESPONSE_MAX_BYTES + 1))
        self.assertEqual(self.call(req("/comments"))[:2], (502, {"error": "기획서 응답이 너무 크다"}))


class _Redirector(BaseHTTPRequestHandler):
    hits: list[str] = []

    def do_GET(self):
        _Redirector.hits.append(self.path)
        if self.path == "/trbw/api/comments":
            self.send_response(302)
            self.send_header("Location", "/stolen")
            self.end_headers()
        else:
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"{}")

    def log_message(self, *args):
        pass


class RedirectTest(unittest.TestCase):
    def test_redirect_is_not_followed(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), _Redirector)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        _Redirector.hits.clear()
        url = f"http://127.0.0.1:{server.server_address[1]}/trbw/api/comments"
        self.assertEqual(proxy.fetch("GET", url, None, {}, []), (302, b"", None))
        self.assertEqual(_Redirector.hits, ["/trbw/api/comments"])

    def test_redirect_status_becomes_502(self):
        with mock.patch.object(proxy, "fetch", return_value=(302, b"", None)), \
                mock.patch.dict(os.environ, {"TROMBONE_BASE": BASE}):
            response = proxy.handle(req("/comments"))
        self.assertEqual((response.status, json.loads(response.body)), (502, {"tromboneStatus": 302}))


class ThroughWebServeTest(unittest.TestCase):
    """web_serve.py 공통 계층(Host·Origin·X-Dobbys-Proxy)을 거친 /api/trombone. TROMBONE 으로 나가는 곳(_OPENER)만 대역이다."""
    ORIGIN = "http://127.0.0.1:8788"

    def setUp(self):
        import web_serve
        self.opener = Opener(FakeResponse(200, b'{"token": "T", "name": "kim"}'))
        self.enterContext(mock.patch.object(proxy, "_OPENER", self.opener))
        self.enterContext(mock.patch.dict(os.environ, {"TROMBONE_BASE": BASE}))
        self.log = io.StringIO()
        handler = web_serve.make_handler(web_serve.WEB_ROOT, [self.ORIGIN], log=self.log)  # routes = API_ROUTES 그대로
        self.server = web_serve.V4Server(("127.0.0.1", 0), handler)
        threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def send(self, method, path, headers, body=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        self.addCleanup(conn.close)
        conn.request(method, path, body=body, headers={"Host": "127.0.0.1:8788", **headers})
        res = conn.getresponse()
        return res.status, json.loads(res.read() or b"null")

    def test_trombone_is_registered(self):
        import web_serve
        self.assertIs(web_serve.API_ROUTES["trombone"], proxy)

    def test_login_passes_and_log_has_path_only(self):
        body = json.dumps(login_body()).encode()
        status, got = self.send("POST", "/api/trombone/auth/login",
                                {"Origin": self.ORIGIN, "X-Dobbys-Proxy": "1", **JSON}, body)
        self.assertEqual((status, got), (200, {"token": "T", "name": "kim"}))
        self.assertEqual(json.loads(self.opener.calls[0][3]), login_body())
        self.assertEqual(self.log.getvalue(), "POST /api/trombone/auth/login 200\n")
        self.assertNotIn(PASSWORD, self.log.getvalue())

    def test_reaction_log_has_no_token_and_spec_log_has_no_query(self):
        self.send("POST", "/api/trombone/spec/comments/CM1/reactions",
                  {"Origin": self.ORIGIN, "X-Dobbys-Proxy": "1", "Authorization": "Bearer " + TOKEN, **JSON}, b'{"emoji": "EMO005"}')
        self.send("GET", "/api/trombone/spec?path=%2Fspec%2Fsecret-page", {"Origin": self.ORIGIN, "X-Dobbys-Proxy": "1"})
        self.assertEqual(self.log.getvalue(),
                         "POST /api/trombone/spec/comments/CM1/reactions 200\nGET /api/trombone/spec 200\n")

    def test_encoded_newline_in_comment_id_is_400_not_500(self):
        status, got = self.send("POST", "/api/trombone/spec/comments/CM1%0A/reactions",
                                {"Origin": self.ORIGIN, "X-Dobbys-Proxy": "1", "Authorization": "Bearer " + TOKEN, **JSON},
                                b'{"emoji": "EMO005"}')
        self.assertEqual(status, 400, got)
        self.assertEqual(self.opener.calls, [])

    def test_other_origin_or_missing_header_never_reaches_trombone(self):
        body = json.dumps(login_body()).encode()
        for headers in ({"Origin": "https://evil.example.com", "X-Dobbys-Proxy": "1", **JSON}, {"Origin": self.ORIGIN, **JSON}):
            status, got = self.send("POST", "/api/trombone/auth/login", headers, body)
            self.assertEqual(status, 403, headers)
            self.assertNotIn(PASSWORD, json.dumps(got))
        self.assertEqual(self.opener.calls, [])
        self.assertNotIn(PASSWORD, self.log.getvalue())


class PurityTest(unittest.TestCase):
    def test_proxy_does_not_pull_tabs_or_dashboard(self):
        code = ("import sys, api.trombone; "
                "bad = sorted(m for m in sys.modules if m.split('.')[0] in ('tabs', 'dashboard')); "
                "print(','.join(bad))")
        out = subprocess.run([sys.executable, "-c", code], cwd=REPO, capture_output=True, text=True, check=True)
        self.assertEqual(out.stdout.strip(), "")


if __name__ == "__main__":
    unittest.main()
