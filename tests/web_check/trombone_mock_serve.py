"""웹 comments 탭 Chrome 확인용 서버(테스트 전용, 웹 번들 아님). web_serve.py 와 같지만 TROMBONE 으로 나가는 한 곳만 목업이다.

- api/trombone 의 검사(Origin·X-Dobbys-Proxy·경로·메서드·쿼리·본문·Bearer)는 실제 코드 그대로 거친다.
- 검사를 통과한 요청만 api.trombone.fetch 대신 예제 응답으로 답한다. 예제는 tests/js/web/comments_fixture.py
  (로컬판 tests/test_comments_model.py 의 INBOX·BUNDLE 에 경우를 더한 것)와 같다. 네트워크에는 나가지 않는다.
  - 로그인: 비밀번호가 'bad' 면 TROMBONE 401(message 있음), 그 밖은 아무 이메일·비밀번호나 통과해 이름 '팀원'.
  - 반응: Bearer 가 로그인 때 준 token 이 아니면 401. 토글 API 그대로(이미 내가 붙였으면 뗀다).
- TROMBONE_BASE 가 없으면 http://trombone.mock:8088 으로 둔다(목업이라 실제로 나가지 않는다). `--no-base` 면 비워 둬서
  '서버에 기획서 주소가 설정되지 않았다' 화면을 본다.
- 목업이 받은 TROMBONE 경로는 표준 오류로 한 줄씩 남긴다(경로만. 비밀번호·token 은 남기지 않는다).

사용:
  PORT=<빈 포트> python3 tests/web_check/trombone_mock_serve.py            # web_serve.main() 그대로 띄운다
  PORT=<빈 포트> python3 tests/web_check/trombone_mock_serve.py --no-base  # 주소 미설정 화면
  python3 tests/web_check/trombone_mock_serve.py --self-check              # 서버 없이 handle 만 불러 본다
"""
from __future__ import annotations

import copy
import json
import os
import secrets
import sys
import urllib.parse
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "tests" / "js" / "web"))

import api.trombone  # noqa: E402
import comments_fixture as fixture  # noqa: E402
from api._http import Request  # noqa: E402

USAGE = "사용: python3 tests/web_check/trombone_mock_serve.py [--no-base | --self-check]"
STATE = {"bundles": copy.deepcopy(fixture.BUNDLES), "tokens": set()}


def _json(status: int, payload) -> tuple[int, bytes, str | None]:
    return status, json.dumps(payload, ensure_ascii=False).encode("utf-8"), None


def mock_fetch(method: str, url: str, data: bytes | None, headers: dict[str, str], secret_values: list[str]):
    parsed = urllib.parse.urlparse(url)
    path = parsed.path.removeprefix("/trbw/api")
    print(f"[mock-trombone] {method} {path}", file=sys.stderr, flush=True)
    if method == "GET" and path == "/comments":
        return _json(200, fixture.INBOX_ALL)
    if method == "GET" and path == "/spec":
        page = urllib.parse.parse_qs(parsed.query).get("path", [""])[0]
        bundle = STATE["bundles"].get(page)
        return _json(200, bundle) if bundle else (404, b"", "화면을 찾을 수 없습니다")
    if method == "POST" and path == "/auth/login":
        body = json.loads(data)
        if body["password"] == "bad":
            return 401, b"", "아이디 또는 비밀번호가 올바르지 않습니다"
        token = "mock-" + secrets.token_hex(8)
        STATE["tokens"].add(token)
        return _json(200, {"token": token, "name": fixture.ME})
    if method == "POST" and path.endswith("/reactions"):
        token = headers.get("Authorization", "").removeprefix("Bearer ")
        if token not in STATE["tokens"]:
            return 401, b"", "로그인이 만료되었습니다"
        comment_id = path.split("/")[3]
        emoji = json.loads(data)["emoji"]
        for bundle in STATE["bundles"].values():
            for c in bundle["comments"]:
                if c["commentId"] != comment_id:
                    continue
                reactions = c.setdefault("reactions", [])
                rx = next((r for r in reactions if r["emoji"] == emoji), None)
                if rx is None:
                    reactions.append({"emoji": emoji, "actors": [fixture.ME]})
                elif fixture.ME in rx["actors"]:
                    rx["actors"].remove(fixture.ME)  # 토글: 다시 보내면 뗀다
                else:
                    rx["actors"].append(fixture.ME)
                c["reactions"] = [r for r in reactions if r["actors"]]
                return _json(200, c["reactions"])
        return 404, b"", "코멘트를 찾을 수 없습니다"
    return 404, b"", None  # api.trombone 이 이미 막는 경로. 목업이 잘못 불린 것이다.


def self_check() -> int:
    def call(method, tail, query=None, body=None, auth=None):
        headers = {"X-Dobbys-Proxy": "1"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if auth:
            headers["Authorization"] = "Bearer " + auth
        raw = json.dumps(body).encode() if body is not None else b""
        return api.trombone.handle(Request(method, "/api/trombone" + tail, query or {}, headers, raw))

    login = call("POST", "/auth/login", body={"loginId": "dobby@example.com", "password": "pw"})
    token = json.loads(login.body)["token"]
    cases = [
        ("config", call("GET", "/config"), 200),
        ("inbox", call("GET", "/comments"), 200),
        ("bundle", call("GET", "/spec", {"path": ["/spec/a"]}), 200),
        ("login", login, 200),
        ("bad password", call("POST", "/auth/login", body={"loginId": "a", "password": "bad"}), 401),
        ("react", call("POST", "/spec/comments/CM5/reactions", body={"emoji": "EMO005"}, auth=token), 200),
        ("react without token", call("POST", "/spec/comments/CM5/reactions", body={"emoji": "EMO005"}), 401),
        ("other path", call("GET", "/admin"), 404),
    ]
    failed = 0
    for name, response, want in cases:
        # 로그인 응답 말고는 token 이 실리면 안 된다.
        ok = response.status == want and (name == "login" or token not in response.body.decode("utf-8", "replace"))
        failed += not ok
        print(f"{'ok ' if ok else 'BAD'} {name}: {response.status} (기대 {want}) {len(response.body)}B")
    return 1 if failed else 0


def main(argv: list[str]) -> int:
    if len(argv) > 1 or (argv and argv[0] not in ("--no-base", "--self-check")):
        sys.exit(USAGE)
    if argv and argv[0] == "--no-base":
        os.environ.pop("TROMBONE_BASE", None)
    else:
        os.environ.setdefault("TROMBONE_BASE", fixture.BASE)
    api.trombone.fetch = mock_fetch  # handle 은 모듈 전역 fetch 를 부른다.
    if argv and argv[0] == "--self-check":
        return self_check()
    import web_serve  # web_serve 가 api.trombone 을 import 해도 같은 모듈 객체라 목업이 그대로 쓰인다.
    return web_serve.main()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
