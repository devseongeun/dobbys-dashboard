"""웹 comments 탭 비교 테스트·목업 서버용 TROMBONE 응답 예제와 로컬판 결과.

예제 응답은 로컬판 tests/test_comments_model.py 의 INBOX·BUNDLE(같은 모양)에 판정이 갈릴 만한 경우를 더한 것이다:
기획 메타 없는 화면(autoScrnId·changeType·author null), 보조 평면 글자(😀)가 걸린 머리말 자르기, NBSP 공백, 타인의 👀,
내 본문 👀, 자기 종결 답글, 답변 순서 뒤집힘, 우선순위·보류 덮어쓰기(잘못된 등급 포함), 답변이 온 건의 손 보류(참고 줄).

사용: python3 tests/js/web/comments_fixture.py  → 표준 출력에 {inputs, scenarios, service} JSON
  inputs    : {inbox, bundles: {path: bundle}, base, me}   (웹 JS 에 그대로 넣는다)
  scenarios : 작성자·overrides 별 로컬판 model.collect·page_payload·category_counts·target_of·already_eyed·locked·build_markdown
  service   : 로컬판 CommentService.report()·export() (날짜 2026-11-12, 수집 09:05 고정)
tests/web_check/trombone_mock_serve.py 도 이 inputs 로 답한다.
"""
from __future__ import annotations

import copy
import json
import sys
import tempfile
from datetime import date, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))

from tabs.comments import model  # noqa: E402
from tabs.comments.markdown import build_markdown  # noqa: E402
from tabs.comments.overrides import OverrideStore  # noqa: E402
from tabs.comments.service import CommentService  # noqa: E402
from tests.support import MemoryKeychain  # noqa: E402
from tests.test_comments_model import BUNDLE, INBOX, ME, comment  # noqa: E402

BASE = "http://trombone.mock:8088"
TODAY = date(2026, 11, 12)
NOW = datetime(2026, 11, 12, 9, 5)
LONG_HEAD = "[웹기획서 버그] 저장 버튼 " + "가" * 62 + "😀😀😀 끝"


def _bundles() -> dict[str, dict]:
    other = {"page": {"autoScrnId": "TCK-0200-01", "title": "상세", "changeType": "신규", "author": "기획"},
             "comments": [comment("CM9", "남", "남의 질문", "2026-11-01T10:00"),
                          comment("CM9R", ME, "제가 답합니다", "2026-11-01T12:00", parent="CM9")]}
    bare = {"page": {"autoScrnId": None, "title": "공지 등록", "changeType": None, "author": None},
            "comments": [
                comment("CM10", ME, LONG_HEAD + "\n둘째 줄  \n\n  셋째 줄 ", "2026-11-06T09:00"),
                comment("CM11", "기획A", "  확인했습니다\n수정할게요  ", "2026-11-06T10:00", parent="CM10", eyes=["남"]),
                comment("CM12", "기획B", "제가 먼저 봤어요", "2026-11-06T09:30", parent="CM10", eyes=[ME]),
                comment("CM13", ME, "메시지 코드 추가 요청  공백 많음", "2026-11-05T09:00", eyes=["남", ME]),
                comment("CM14", ME, "회신은 메일로 받아서　답변 주시지 않아도 됩니다", "2026-11-05T11:00", parent="CM13"),
                comment("CM15", ME, "[설명란 업데이트] 설명 필요", "2026-11-05T08:00"),
                comment("CM16", "남", "남의 다른 코멘트", "2026-11-05T08:30"),
            ]}
    first = {"page": {"autoScrnId": "AAA-0001", "title": "로그인", "changeType": "수정", "author": "기획A"},
             "comments": [
                 comment("CM20", ME, "기능 확인 요청: 잠금 횟수는?", "2026-11-07T08:00"),
                 comment("CM21", "기획A", "5회입니다", "2026-11-07T09:00", parent="CM20"),
                 comment("CM22", ME, "답글 안 주셔도 돼요 (취소)", "2026-11-07T10:00", parent="CM21"),
                 comment("CM23", ME, "예외 처리 확인 부탁", "2026-11-07T07:00", eyes=["남"]),
             ]}
    return {"/spec/a": copy.deepcopy(BUNDLE), "/spec/b": other, "/spec/c": bare, "/spec/d": first}


BUNDLES = _bundles()
INBOX_ALL = copy.deepcopy(INBOX) + [
    {"commentId": "CM23", "author": ME, "pageId": "P4", "path": "/spec/d", "at": "2026-11-07T07:00"},
    {"commentId": "CM15", "author": ME, "pageId": "P3", "path": "/spec/c", "at": "2026-11-05T08:00"},
    {"commentId": "CM10", "author": ME, "pageId": "P3", "path": "/spec/c", "at": "2026-11-06T09:00"},
    {"commentId": "CM20", "author": ME, "pageId": "P4", "path": "/spec/d", "at": "2026-11-07T08:00"},
]
OVERRIDES = {
    "priority": {"CM5": {"level": "상", "reason": "먼저"}, "CM15": {"level": "중", "reason": "다음"},
                 "CM20": {"level": "상", "reason": "출시 전"}, "CM1": {"level": "최상", "reason": "무시"}},
    "resolved": {"CM15": "회의에서 정리", "CM20": "전화로 확인"},
}
SCENARIOS = [
    {"name": "내 코멘트 + 덮어쓰기", "author": ME, "overrides": OVERRIDES},
    {"name": "내 코멘트, 덮어쓰기 없음", "author": ME, "overrides": {"priority": {}, "resolved": {}}},
    {"name": "남의 코멘트", "author": "남", "overrides": {}},
    {"name": "코멘트 없는 사람", "author": "없는 사람", "overrides": {}},
]


def fetch(path: str) -> dict:
    return copy.deepcopy(BUNDLES[path])


def scenario(case: dict) -> dict:
    rows, pages, answered = model.collect(copy.deepcopy(INBOX_ALL), fetch, case["author"], copy.deepcopy(case["overrides"]))
    out = {
        **case,
        "rows": rows, "pages": list(pages.values()), "answered": answered,
        "payload": model.page_payload(pages), "cats": model.category_counts(rows),
        "perRow": {r["commentId"]: [model.target_of(r), model.already_eyed(r, case["author"]), model.locked(r)] for r in rows},
        "markdown": None,
    }
    if rows:
        out["markdown"] = build_markdown(rows, pages, answered, base=BASE, author=case["author"], date=TODAY.isoformat(),
                                         collected=NOW.strftime("%Y-%m-%d %H:%M"))
    return out


class FixtureClient:
    base = BASE

    def inbox(self):
        return copy.deepcopy(INBOX_ALL)

    def bundle(self, path):
        return fetch(path)


def service() -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        store = OverrideStore(Path(tmp) / "overrides.json")
        for cid, pri in OVERRIDES["priority"].items():
            if pri["level"] in model.PRIORITY_ORDER:
                store.update(cid, pri, None)
        for cid, why in OVERRIDES["resolved"].items():
            store.update(cid, None, why)
        keychain = MemoryKeychain({"trombone": {"base": BASE, "token": "T", "name": ME}})
        svc = CommentService(FixtureClient(), keychain, store, Path(tmp), today=lambda: TODAY, now=lambda: NOW)
        report = svc.report()
        path = svc.export()
        return {"report": report, "exportName": path.name, "exportText": path.read_text(encoding="utf-8"),
                "overrides": store.load()}


def main() -> int:
    data = {
        "inputs": {"inbox": INBOX_ALL, "bundles": BUNDLES, "base": BASE, "me": ME,
                   "today": TODAY.isoformat(), "now": NOW.strftime("%Y-%m-%d %H:%M")},
        "scenarios": [scenario(case) for case in SCENARIOS],
        "service": service(),
    }
    print(json.dumps(data, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
