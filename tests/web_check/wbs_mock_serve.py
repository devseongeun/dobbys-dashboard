"""웹 wbs 탭 Chrome 확인용 서버(테스트 전용, 웹 번들 아님). web_serve.py 와 같지만 Jira 로 나가는 한 곳만 목업이다.

- api/jira 의 검사(Origin·X-Dobbys-Proxy·대상·경로·쿼리·JQL 모양)는 실제 코드 그대로 거친다.
- 검사를 통과한 요청만 api.jira.fetch 대신 <sandbox>/demo-jira.json(scripts/demo/mock_data.py 가 만든다)으로 답한다.
  token 이 'bad' 면 Jira 401, 그 밖은 아무 이메일·token 이나 통과. 네트워크에는 나가지 않는다.
- 목업이 받은 Jira 경로는 표준 오류로 한 줄씩 남긴다(경로만. Authorization·token 은 남기지 않는다).
- 확인 전용 경로 `/api/check-file` 이 예제 엑셀(<sandbox>/DemoVault/DEMO_100/DEMO_WBS.xlsx)을 준다. 페이지가 받아
  opfs_picker.js 로 OPFS 에 넣는다(실제 web_serve.py 에는 없는 경로다).

사용:
  python3 scripts/demo/mock_data.py <sandbox>
  PORT=<빈 포트> python3 tests/web_check/wbs_mock_serve.py <sandbox>      # web_serve.main() 그대로 띄운다
  python3 tests/web_check/wbs_mock_serve.py <sandbox> --self-check          # 서버 없이 handle 만 불러 본다
"""
from __future__ import annotations

import base64
import binascii
import json
import re
import sys
import urllib.parse
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

import api.jira  # noqa: E402
from api._http import Request, Response  # noqa: E402

USAGE = "사용: python3 tests/web_check/wbs_mock_serve.py <sandbox> [--self-check]"
# 담당 이슈 JQL 안의 'OR key in (…)' 과 헷갈리지 않게 맨 앞만 본다(scripts/demo/serve_demo.py 와 같은 규칙).
KEYS_IN = re.compile(r"key in \(([^)]*)\)")
JIRA: dict = {}
WORKBOOK: list[Path] = []


def load(sandbox: Path) -> None:
    mock = sandbox / "demo-jira.json"
    if not mock.is_file():
        sys.exit(f"{mock} 가 없다. 먼저 python3 scripts/demo/mock_data.py {sandbox} 를 돌린다.")
    JIRA.update(json.loads(mock.read_text(encoding="utf-8")))
    WORKBOOK.append(sandbox / "DemoVault" / "DEMO_100" / "DEMO_WBS.xlsx")


def _token(authorization: str) -> str:
    try:
        return base64.b64decode(authorization.removeprefix("Basic "), validate=True).decode("utf-8").partition(":")[2]
    except (binascii.Error, UnicodeDecodeError):
        return ""


def mock_fetch(url: str, authorization: str) -> tuple[int, bytes]:
    parsed = urllib.parse.urlparse(url)
    print(f"[mock-jira] GET {parsed.path}", file=sys.stderr, flush=True)
    token = _token(authorization)
    if token in ("", "bad"):
        return 401, b""
    query = urllib.parse.parse_qs(parsed.query)
    if parsed.path == "/rest/api/3/myself":
        body = JIRA["myself"]
    elif parsed.path == "/rest/api/3/search/jql":
        found = KEYS_IN.match(query["jql"][0])
        keys = {k.strip() for k in found.group(1).split(",")} if found else None
        body = {"issues": [i for i in JIRA["issues"] if keys is None or i["key"] in keys], "isLast": True}
    elif parsed.path.endswith("/worklog"):
        key = parsed.path.split("/")[5]
        issue = next((i for i in JIRA["issues"] if i["key"] == key), None)
        if issue is None:
            return 404, b""
        logs = issue["fields"]["worklog"]["worklogs"]
        body = {"worklogs": logs, "startAt": 0, "maxResults": len(logs), "total": len(logs)}
    else:  # api.jira 가 이미 막는 경로. 목업이 잘못 불린 것이다.
        return 404, b""
    return 200, json.dumps(body, ensure_ascii=False).encode("utf-8")


class CheckFile:
    @staticmethod
    def handle(request: Request) -> Response:
        return Response(200, {"Content-Type": "application/octet-stream", "Cache-Control": "no-store"}, WORKBOOK[0].read_bytes())


def self_check() -> int:
    auth = "Basic " + base64.b64encode(b"dobby@example.com:demo-token").decode()
    bad = "Basic " + base64.b64encode(b"dobby@example.com:bad").decode()
    base = {"domain": ["demo.atlassian.net"]}
    me = JIRA["myself"]["accountId"]
    cases = [
        ("myself", {"path": ["/rest/api/3/myself"]}, auth, 200),
        ("bad token", {"path": ["/rest/api/3/myself"]}, bad, 401),
        ("search", {"path": ["/rest/api/3/search/jql"], "jql": [f'project = DEMO AND assignee = "{me}" ORDER BY duedate ASC'],
                    "maxResults": ["100"], "fields": [api.jira.FIELDS]}, auth, 200),
        ("worklog", {"path": ["/rest/api/3/issue/DEMO-103/worklog"], "startAt": ["0"], "maxResults": ["100"]}, auth, 200),
        ("other host", {"path": ["/rest/api/3/myself"], "domain": ["evil.example.com"]}, auth, 400),
    ]
    failed = 0
    for name, query, authorization, want in cases:
        headers = {"X-Dobbys-Proxy": "1", "Authorization": authorization}
        response = api.jira.handle(Request("GET", "/api/jira", {**base, **query}, headers, b""))
        ok = response.status == want and "demo-token" not in response.body.decode("utf-8", "replace")
        failed += not ok
        print(f"{'ok ' if ok else 'BAD'} {name}: {response.status} (기대 {want}) {len(response.body)}B")
    return 1 if failed else 0


def main(argv: list[str]) -> int:
    if len(argv) not in (1, 2) or (len(argv) == 2 and argv[1] != "--self-check"):
        sys.exit(USAGE)
    load(Path(argv[0]).resolve())
    api.jira.fetch = mock_fetch  # handle 은 모듈 전역 fetch 를 부른다.
    if len(argv) == 2:
        return self_check()
    import web_serve  # web_serve 가 api.jira 를 import 해도 같은 모듈 객체라 목업이 그대로 쓰인다.
    web_serve.API_ROUTES["check-file"] = CheckFile
    return web_serve.main()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
