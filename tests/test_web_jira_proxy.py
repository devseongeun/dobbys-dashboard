"""api/jira.py 프록시: 대상·경로·쿼리·메서드·X-Dobbys-Proxy 허용 규칙과 Authorization 무저장·무로그·오류 미포함."""
import contextlib
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

import api.jira as proxy
from api._http import Request
from jira_client import FIELDS, LOOKUP_FIELDS, build_jql, build_key_jql

REPO = Path(__file__).resolve().parents[1]
TOKEN = "Basic YUBiLmM6U0VDUkVULVRPS0VO"  # a@b.c:SECRET-TOKEN
SECRET = "SECRET-TOKEN"
OK_HEADERS = {"X-Dobbys-Proxy": "1", "Authorization": TOKEN}


def req(query, method="GET", headers=None):
    return Request(method, "/api/jira", {k: v if isinstance(v, list) else [v] for k, v in query.items()},
                   OK_HEADERS if headers is None else headers, b"")


class FakeResponse:
    def __init__(self, status=200, body=b'{"ok": true}'):
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
        self.calls.append((request.full_url, dict(request.header_items()), timeout))
        if isinstance(self.result, BaseException):
            raise self.result
        return self.result


class ProxyCase(unittest.TestCase):
    def setUp(self):
        self.opener = Opener()
        self.enterContext(mock.patch.object(proxy, "_OPENER", self.opener))
        self.enterContext(mock.patch.dict(os.environ, {}, clear=False))
        os.environ.pop("JIRA_HOST_SUFFIX", None)
        self.out = io.StringIO()
        self.enterContext(contextlib.redirect_stderr(self.out))
        self.enterContext(contextlib.redirect_stdout(self.out))
        self.enterContext(self.assertNoLogs(level=logging.DEBUG))

    def call(self, query, **kwargs):
        response = proxy.handle(req(query, **kwargs))
        body = json.loads(response.body) if response.body else None
        return response.status, body, response

    def assertRefused(self, query, status=400, **kwargs):
        got, body, response = self.call(query, **kwargs)
        self.assertEqual(got, status, body)
        self.assertIn("error", body)
        self.assertEqual(self.opener.calls, [], "거절한 요청을 Jira 로 보냈다")
        self.assertNotIn(SECRET, response.body.decode("utf-8"))


MINE = build_jql("PROJ", "acc-1", [])
LINKED = build_jql("PROJ", "acc-1", ["PROJ-10", "PROJ-2"])
KEYS = build_key_jql(["PROJ-3", "OTHER-1"])


def search(jql=MINE, fields=FIELDS, **extra):
    return {"domain": "team.atlassian.net", "path": "/rest/api/3/search/jql", "jql": jql,
            "maxResults": "100", "fields": fields, **extra}


class AllowTest(ProxyCase):
    def test_myself_forwards_authorization_as_is_and_passes_body_through(self):
        self.opener.result = FakeResponse(200, b'{"accountId": "acc-1", "displayName": "Kim"}')
        status, body, response = self.call({"domain": "team.atlassian.net", "path": "/rest/api/3/myself"})
        self.assertEqual((status, body), (200, {"accountId": "acc-1", "displayName": "Kim"}))
        url, headers, timeout = self.opener.calls[0]
        self.assertEqual(url, "https://team.atlassian.net/rest/api/3/myself")
        self.assertEqual(headers["Authorization"], TOKEN)
        self.assertEqual(timeout, proxy.TIMEOUT_SECONDS)
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_search_shapes_built_by_jira_client_pass_with_page_token(self):
        for jql, fields in ((MINE, FIELDS), (LINKED, FIELDS), (KEYS, LOOKUP_FIELDS)):
            self.opener.calls.clear()
            status, _, _ = self.call(search(jql, fields, nextPageToken="T2"))
            self.assertEqual(status, 200, jql)
            url = self.opener.calls[0][0]
            self.assertTrue(url.startswith("https://team.atlassian.net/rest/api/3/search/jql?jql="), url)
            self.assertIn("nextPageToken=T2", url)
            self.assertIn("maxResults=100", url)

    def test_worklog_path_with_valid_key(self):
        status, _, _ = self.call({"domain": "team.atlassian.net", "path": "/rest/api/3/issue/PROJ-9/worklog",
                                  "startAt": "20", "maxResults": "100"})
        self.assertEqual(status, 200)
        self.assertEqual(self.opener.calls[0][0],
                         "https://team.atlassian.net/rest/api/3/issue/PROJ-9/worklog?startAt=20&maxResults=100")

    def test_host_suffix_comes_from_environment(self):
        os.environ["JIRA_HOST_SUFFIX"] = ".jira.example.com"
        status, _, _ = self.call({"domain": "team.jira.example.com", "path": "/rest/api/3/myself"})
        self.assertEqual(status, 200)
        self.opener.calls.clear()
        self.assertRefused({"domain": "team.atlassian.net", "path": "/rest/api/3/myself"})


class RefuseTest(ProxyCase):
    def test_missing_or_wrong_proxy_header_is_403(self):
        query = {"domain": "team.atlassian.net", "path": "/rest/api/3/myself"}
        self.assertRefused(query, 403, headers={"Authorization": TOKEN})
        self.assertRefused(query, 403, headers={"X-Dobbys-Proxy": "0", "Authorization": TOKEN})

    def test_header_names_are_case_insensitive(self):
        status, _, _ = self.call({"domain": "team.atlassian.net", "path": "/rest/api/3/myself"},
                                 headers={"x-dobbys-proxy": "1", "authorization": TOKEN})
        self.assertEqual(status, 200)

    def test_only_get(self):
        for method in ("POST", "PUT", "DELETE", "PATCH"):
            got, body, response = self.call({"domain": "team.atlassian.net", "path": "/rest/api/3/myself"},
                                            method=method)
            self.assertEqual((got, response.headers.get("Allow")), (405, "GET"))
        self.assertEqual(self.opener.calls, [])

    def test_target_must_be_a_single_site_under_the_suffix(self):
        for domain in ("evil.com", "atlassian.net", "team.atlassian.net.evil.com", "a.b.atlassian.net",
                       "team.atlassian.net@evil.com", "Team.atlassian.net", "team.atlassian.net:8443",
                       "evilatlassian.net", "-x.atlassian.net", ""):
            with self.subTest(domain=domain):
                self.assertRefused({"domain": domain, "path": "/rest/api/3/myself"})
        self.assertRefused({"path": "/rest/api/3/myself"})
        self.assertRefused({"domain": ["team.atlassian.net", "evil.atlassian.net"], "path": "/rest/api/3/myself"})

    def test_only_three_paths(self):
        for path in ("/rest/api/3/issue/PROJ-1", "/rest/api/2/myself", "/rest/api/3/myself/../search",
                     "/rest/api/3/issue/proj-1/worklog", "/rest/api/3/issue/PROJ-1/worklog/1",
                     "/rest/api/3/issue/PROJ-1/../../../admin/worklog", "https://evil.com/rest/api/3/myself",
                     "//evil.com/rest/api/3/myself", "/rest/api/3/search", ""):
            with self.subTest(path=path):
                self.assertRefused({"domain": "team.atlassian.net", "path": path})

    def test_search_jql_must_be_a_jira_client_shape(self):
        for jql in ("project = PROJ", "project = PROJ ORDER BY duedate ASC",
                    'project = proj AND assignee = "acc-1" ORDER BY duedate ASC',
                    'project = PROJ AND assignee = "acc" OR 1=1" ORDER BY duedate ASC',
                    'project = PROJ AND (assignee = "acc-1" OR key in (PROJ-2,PROJ-1)) ORDER BY duedate ASC',
                    "key in (PROJ-1) OR project = SECRET ORDER BY duedate ASC",
                    "key in (" + ",".join(f"PROJ-{i}" for i in range(51)) + ") ORDER BY duedate ASC"):
            with self.subTest(jql=jql):
                self.assertRefused(search(jql))

    def test_search_query_names_and_values_are_fixed(self):
        self.assertRefused(search(fields="summary,description"))
        self.assertRefused(search(maxResults="101"))
        self.assertRefused(search(maxResults="0"))
        self.assertRefused(search(maxResults="1e2"))
        self.assertRefused(search(expand="renderedFields"))
        self.assertRefused({k: v for k, v in search().items() if k != "jql"})
        self.assertRefused({"domain": "team.atlassian.net", "path": "/rest/api/3/myself", "jql": MINE})
        self.assertRefused({"domain": "team.atlassian.net", "path": "/rest/api/3/issue/PROJ-9/worklog",
                            "startAt": "-1", "maxResults": "100"})

    def test_authorization_must_be_basic(self):
        query = {"domain": "team.atlassian.net", "path": "/rest/api/3/myself"}
        self.assertRefused(query, headers={"X-Dobbys-Proxy": "1"})
        self.assertRefused(query, headers={"X-Dobbys-Proxy": "1", "Authorization": "Bearer abc"})


class SecretTest(ProxyCase):
    """Authorization 은 전달만 한다: 응답·로그·모듈 상태 어디에도 남지 않는다."""

    def assertNoSecret(self, response):
        self.assertNotIn(SECRET, response.body.decode("utf-8"))
        self.assertNotIn("YUBiLmM6", response.body.decode("utf-8"))
        self.assertNotIn(SECRET, self.out.getvalue())
        for value in vars(proxy).values():
            self.assertNotIn(SECRET, repr(value)[:10000])
            self.assertNotIn("YUBiLmM6", repr(value)[:10000])

    def test_jira_http_error_keeps_status_without_body_or_credentials(self):
        for code in (401, 403, 404, 500):
            self.opener.result = urllib.error.HTTPError(
                "https://team.atlassian.net/rest/api/3/myself", code, "x", {}, io.BytesIO(b'{"echo": "' + SECRET.encode() + b'"}'))
            status, body, response = self.call({"domain": "team.atlassian.net", "path": "/rest/api/3/myself"})
            self.assertEqual((status, body), (code, {"jiraStatus": code}))
            self.assertNoSecret(response)

    def test_connection_failure_and_timeout_messages(self):
        query = {"domain": "team.atlassian.net", "path": "/rest/api/3/myself"}
        self.opener.result = urllib.error.URLError("nodename nor servname provided")
        status, body, response = self.call(query)
        self.assertEqual((status, body), (502, {"error": "Jira 연결 실패: nodename nor servname provided"}))
        self.assertNoSecret(response)
        self.opener.result = urllib.error.URLError(TimeoutError("timed out"))
        status, body, response = self.call(query)
        self.assertEqual((status, body), (504, {"error": "Jira 응답 시간 초과 (30s)"}))
        self.opener.result = TimeoutError()
        self.assertEqual(self.call(query)[:2], (504, {"error": "Jira 응답 시간 초과 (30s)"}))
        self.assertNoSecret(response)

    def test_success_leaves_nothing_behind(self):
        status, _, response = self.call({"domain": "team.atlassian.net", "path": "/rest/api/3/myself"})
        self.assertEqual(status, 200)
        self.assertNoSecret(response)
        self.assertEqual(self.out.getvalue(), "")


class _Redirector(BaseHTTPRequestHandler):
    hits: list[str] = []

    def do_GET(self):
        _Redirector.hits.append(self.path)
        if self.path == "/rest/api/3/myself":
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
        status, body = proxy.fetch(f"http://127.0.0.1:{server.server_address[1]}/rest/api/3/myself", TOKEN)
        self.assertEqual((status, body), (302, b""))
        self.assertEqual(_Redirector.hits, ["/rest/api/3/myself"])

    def test_redirect_status_becomes_502(self):
        with mock.patch.object(proxy, "fetch", return_value=(302, b"")):
            response = proxy.handle(req({"domain": "team.atlassian.net", "path": "/rest/api/3/myself"}))
        self.assertEqual((response.status, json.loads(response.body)), (502, {"jiraStatus": 302}))


class ThroughWebServeTest(unittest.TestCase):
    """web_serve.py 공통 계층(Host·Origin·X-Dobbys-Proxy)을 거친 /api/jira. Jira 로 나가는 곳(_OPENER)만 대역이다."""
    ORIGIN = "http://127.0.0.1:8788"
    MYSELF = "/api/jira?domain=team.atlassian.net&path=%2Frest%2Fapi%2F3%2Fmyself"

    def setUp(self):
        import web_serve
        self.opener = Opener()
        self.enterContext(mock.patch.object(proxy, "_OPENER", self.opener))
        self.log = io.StringIO()
        handler = web_serve.make_handler(web_serve.WEB_ROOT, [self.ORIGIN], log=self.log)  # routes = API_ROUTES 그대로
        self.server = web_serve.V4Server(("127.0.0.1", 0), handler)
        threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def get(self, path, headers, method="GET"):
        import http.client
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        self.addCleanup(conn.close)
        conn.request(method, path, headers={"Host": "127.0.0.1:8788", **headers})
        res = conn.getresponse()
        return res.status, json.loads(res.read() or b"null")

    def test_jira_is_registered(self):
        import web_serve
        self.assertIs(web_serve.API_ROUTES["jira"], proxy)

    def test_allowed_request_reaches_jira_with_the_same_authorization(self):
        status, body = self.get(self.MYSELF, {"Origin": self.ORIGIN, **OK_HEADERS})
        self.assertEqual((status, body), (200, {"ok": True}))
        [(url, headers, timeout)] = self.opener.calls
        self.assertEqual((url, headers["Authorization"], timeout),
                         ("https://team.atlassian.net/rest/api/3/myself", TOKEN, proxy.TIMEOUT_SECONDS))
        self.assertEqual(self.log.getvalue(), "GET /api/jira 200\n")  # 쿼리·헤더·token 은 로그에 없다

    def test_other_origin_or_missing_header_never_reaches_jira(self):
        for headers in ({"Origin": "https://evil.example.com", **OK_HEADERS},
                        {"Origin": self.ORIGIN, "Authorization": TOKEN},
                        {"Origin": self.ORIGIN, "X-Dobbys-Proxy": "yes", "Authorization": TOKEN}):
            status, body = self.get(self.MYSELF, headers)
            self.assertEqual(status, 403, headers)
            self.assertNotIn(SECRET, json.dumps(body))
        self.assertEqual(self.opener.calls, [])
        self.assertNotIn(SECRET, self.log.getvalue())
        self.assertNotIn("YUBiLmM6", self.log.getvalue())

    def test_non_get_is_refused_by_the_proxy(self):
        status, body = self.get(self.MYSELF, {"Origin": self.ORIGIN, **OK_HEADERS}, method="POST")
        self.assertEqual((status, body), (405, {"error": "GET 만 받는다"}))
        self.assertEqual(self.opener.calls, [])


class PurityTest(unittest.TestCase):
    def test_proxy_and_client_do_not_pull_tabs_or_dashboard(self):
        code = ("import sys, api.jira, jira_client; "
                "bad = sorted(m for m in sys.modules if m.split('.')[0] in ('tabs', 'dashboard')); "
                "print(','.join(bad))")
        out = subprocess.run([sys.executable, "-c", code], cwd=REPO, capture_output=True, text=True, check=True)
        self.assertEqual(out.stdout.strip(), "")

    def test_local_wbs_tab_uses_the_moved_client(self):
        import jira_client
        from tabs.wbs import board, serve, session
        self.assertIs(board.build_jql, jira_client.build_jql)
        self.assertIs(session.JiraClient, jira_client.JiraClient)
        self.assertIs(serve.JiraError, jira_client.JiraError)


if __name__ == "__main__":
    unittest.main()
