"""시연용 대시보드 서버. serve.py 와 같지만 바깥과 닿는 두 곳만 목업으로 바꾼다.

- 키체인: 메모리 사전. 실제 로그인 키체인을 읽지도 쓰지도 않는다(탭 안에서 로그인해도 실제 값이 그대로다).
- Jira HTTP: JiraClient._http_get 을 <HOME>/demo-jira.json(scripts/demo/mock_data.py 가 만든다) 응답으로 바꾼다.
  이메일·token 은 아무 값이나 통과하고, 네트워크에는 나가지 않는다. 보드·연결·워크로그 계산은 실제 코드 그대로다.

사용: HOME=<mock_data.py 로 만든 임시 HOME> PORT=… python3 scripts/demo/serve_demo.py
"""
from __future__ import annotations

import json
import re
import sys
import urllib.parse
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

import dashboard.keychain  # noqa: E402
from dashboard.paths import HOME  # noqa: E402
from jira_client import JiraClient, JiraError  # noqa: E402

MOCK = HOME / "demo-jira.json"
if not MOCK.is_file():
    sys.exit(f"{MOCK} 가 없다. HOME 을 scripts/demo/mock_data.py 로 만든 임시 폴더로 지정한다.")
JIRA = json.loads(MOCK.read_text(encoding="utf-8"))
# 일정 조정 탭의 키 조회 JQL 은 'key in (…)' 으로 시작한다(jira_client.py build_key_jql).
# 담당 이슈 조회 JQL 안의 'OR key in (…)'(수동 연결 이슈)과 헷갈리지 않게 맨 앞만 본다.
KEYS_IN = re.compile(r"key in \(([^)]*)\)")


class MemoryKeychain:
    """dashboard.keychain.Keychain 과 같은 get·set·delete. 서버가 꺼지면 사라진다."""
    _store: dict[str, dict] = {}

    def __init__(self, *args, **kwargs):
        pass

    def get(self, name: str) -> dict | None:
        return self._store.get(name)

    def set(self, name: str, value: dict) -> None:
        self._store[name] = value

    def delete(self, name: str) -> None:
        self._store.pop(name, None)


def mock_get(self, path: str) -> dict:
    route, _, query = path.partition("?")
    if route == "/rest/api/3/myself":
        return JIRA["myself"]
    if route == "/rest/api/3/search/jql":
        found = KEYS_IN.match(urllib.parse.parse_qs(query).get("jql", [""])[0])
        keys = {k.strip() for k in found.group(1).split(",")} if found else None
        return {"issues": [i for i in JIRA["issues"] if keys is None or i["key"] in keys], "isLast": True}
    if route.startswith("/rest/api/3/issue/") and route.endswith("/worklog"):
        key = route.split("/")[5]
        logs = next((i["fields"]["worklog"]["worklogs"] for i in JIRA["issues"] if i["key"] == key), [])
        return {"worklogs": logs, "total": len(logs)}
    raise JiraError(f"목업에 없는 Jira 요청: {route}", status=404)


# tabs/wbs·comments 는 탭을 띄울 때 dashboard.keychain.Keychain 을 import 하므로 모듈 속성을 바꾸면 된다.
dashboard.keychain.Keychain = MemoryKeychain
JiraClient._http_get = mock_get

import serve  # noqa: E402

if __name__ == "__main__":
    sys.exit(serve.main())
