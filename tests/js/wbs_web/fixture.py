"""bun 비교 테스트용 기대값. 같은 예제 엑셀·Jira 응답을 로컬판 Python 코드에 넣은 결과를 JSON 으로 낸다.

사용: python3 tests/js/wbs_web/fixture.py <출력 폴더>  → <출력 폴더>/*.xlsx 와 expected.json
엑셀은 tests/support_xlsx.py 로 만든다(저장 방식 그대로 + 실제 엑셀처럼 deflate 로 다시 압축한 것 둘 다).
"""
from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))

from jira_client import FIELDS, LOOKUP_FIELDS, adf_to_text, build_jql, build_key_jql  # noqa: E402
from tabs.wbs.board import normalize_issue, normalize_worklog  # noqa: E402
from tabs.wbs.matching import match_keys  # noqa: E402
from tabs.wbs.xlsx import XlsxError, read_wbs  # noqa: E402
from tests.support_xlsx import SHEET, make_xlsx, wbs_book  # noqa: E402
from tests.test_wbs_board import RAW_ISSUE  # noqa: E402
from tests.test_wbs_xlsx import ROW  # noqa: E402


def deflated(src: Path, out: Path) -> Path:
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            zout.writestr(info.filename, zin.read(info), compress_type=zipfile.ZIP_DEFLATED)
    return out


def truncated(src: Path, out: Path, member: str) -> Path:
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(out, "w") as zout:
        for info in zin.infolist():
            data = zin.read(info)
            zout.writestr(info, data[: len(data) // 2] if info.filename == member else data)
    return out


def books(out: Path) -> list[tuple[str, str, str]]:
    """(파일 이름, 시트, 담당자)."""
    rows = [
        ROW,
        {**ROW, "id": "A-1", "owner": "홍길동 외 4명", "name": "그룹 행", "d3": "세부", "start": "2026-10-01",
         "end": 46400, "weight": 2.5, "people": 3, "md": 0.5},
        {**ROW, "id": "A-2", "owner": "홍길동  외4명", "name": "붙여 쓴 그룹", "detail": None, "screen": None},
        {**ROW, "id": "A-3", "owner": "이영희"},
        {**ROW, "id": "A-4", "owner": "홍길동2"},
        {**ROW, "id": "A-5", "owner": "홍길동", "start": 99999999, "end": "엉터리", "md": "1_0", "weight": "abc"},
        {**ROW, "id": "  A-6  ", "owner": " 홍길동 ", "name": "공백 & <특수> \"문자\"", "q": "26Q4"},
        {**ROW, "id": None, "owner": "홍길동", "name": "ID 없는 행"},
    ]
    cases = []
    wbs_book(out / "basic.xlsx", rows)
    deflated(out / "basic.xlsx", out / "basic-deflate.xlsx")
    wbs_book(out / "shifted.xlsx", [ROW], shift=2)
    deflated(out / "shifted.xlsx", out / "shifted-deflate.xlsx")
    wbs_book(out / "noholiday.xlsx", [ROW], holidays=False)
    for name in ("basic.xlsx", "basic-deflate.xlsx", "shifted.xlsx", "shifted-deflate.xlsx", "noholiday.xlsx"):
        cases += [(name, SHEET, "홍길동"), (name, SHEET, " 홍길동 ")]
    cases += [("basic.xlsx", SHEET, "홍길"), ("basic.xlsx", "없는 시트", "홍길동"), ("basic.xlsx", SHEET, "이영희")]
    make_xlsx(out / "noheader.xlsx", {SHEET: {9: {"E": "요구사항ID", "P": "담당자"}}})
    make_xlsx(out / "nohead.xlsx", {SHEET: {1: {"A": "제목"}}})
    (out / "notzip.xlsx").write_bytes(b"not a zip")
    truncated(out / "basic.xlsx", out / "cut-sheet.xlsx", "xl/worksheets/sheet1.xml")
    truncated(out / "basic.xlsx", out / "cut-strings.xlsx", "xl/sharedStrings.xml")
    deflated(out / "cut-sheet.xlsx", out / "cut-sheet-deflate.xlsx")
    cases += [(n, SHEET, "홍길동") for n in ("noheader.xlsx", "nohead.xlsx", "notzip.xlsx", "cut-sheet.xlsx",
                                           "cut-strings.xlsx", "cut-sheet-deflate.xlsx")]
    return cases


def wbs_results(out: Path) -> list[dict]:
    results = []
    for name, sheet, owner in books(out):
        try:
            result = {"ok": read_wbs(out / name, sheet, owner)}
        except XlsxError as exc:
            result = {"error": {"field": exc.field, "message": str(exc)}}
        results.append({"file": name, "sheet": sheet, "owner": owner, **result})
    return results


def task(task_id, d1, d2, name, d3=None):
    return {"id": task_id, "d1": d1, "d2": d2, "d3": d3, "name": name}


def issue(key, summary):
    return {"key": key, "summary": summary}


MATCH_CASES = [
    ([task("A", "테스트", "테스트 의뢰 관리", "테스트 의뢰 목록"), task("B", "티켓", "워크플로우 템플릿 관리", "워크플로우 템플릿 관리 목록")],
     [issue("PROJ-1", "테스트 - 테스트 의뢰 관리 - 테스트 의뢰 목록"), issue("PROJ-2", "티켓 - 워크플로우 템플릿 관리 목록")], {}),
    ([task("A", "공통", "헤더 영역", "알림 목록", d3="알림")], [issue("PROJ-3", "공통 -  헤더영역 - 알림 - 알림 목록")], {}),
    ([task("A", "공통", "대시보드", "대시보드"), task("B", "공통", "대시보드", "대시보드")],
     [issue("PROJ-9", "공통 - 대시보드 - 대시보드")], {"A": "PROJ-100"}),
    ([task("A", "공통", "대시보드", "대시보드"), task("B", "공통", "대시보드", "대시보드")],
     [issue("PROJ-9", "공통 - 대시보드 - 대시보드")], {"A": "PROJ-9"}),
    ([task("A", "공통", "대시보드", "대시보드")], [issue("PROJ-1", "공통 - 대시보드 - 대시보드"), issue("PROJ-2", "공통 - 대시보드")], {}),
    ([task("A", "공통", "대시보드", "대시보드"), task("B", "공통", "대시보드", "대시보드")], [issue("PROJ-9", "공통 - 대시보드 - 대시보드")], {}),
    ([task("A", "Common", "Dash Board", "LIST"), task("C", None, None, None), task("D", "x", None, "y")],
     [issue("PROJ-5", "common-dashboard-list"), issue("PROJ-6", "X - Y"), issue("PROJ-7", None)], {"Z": "PROJ-1"}),
]

JQL_CASES = [
    ("PROJ", "acc-1", []), ("PROJ", "acc-1", ["PROJ-10", "PROJ-2", "ABC-3", "PROJ-2"]), ("proj", "acc", []),
    ("PROJ", "", []), ("PROJ", 'a"b', []), ("PROJ", "acc", ["PROJ-1", "bad key\""]), ("PROJ", "acc", ["it's-1"]),
]
KEY_JQL_CASES = [["PROJ-10", "PROJ-9", "ABC-1", "PROJ-9"], [], [f"P-{i}" for i in range(51)], ["P-1", "p-2"]]
ADF_CASES = [
    None, "평문", {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": " 첫 줄 "}]},
                                            {"type": "bulletList", "content": [{"type": "listItem", "content": [
                                                {"type": "paragraph", "content": [{"type": "text", "text": "항목"}]}]}]},
                                            {"type": "paragraph", "content": [{"type": "text", "text": "a"},
                                                                              {"type": "hardBreak"}, {"type": "text", "text": "b"}]}]},
    {"type": "paragraph"}, [1, 2], {"type": "text"},
]


def outcome(fn, *args):
    try:
        return {"ok": fn(*args)}
    except ValueError as exc:
        return {"error": str(exc)}


def raw_issues():
    unassigned = json.loads(json.dumps(RAW_ISSUE))
    unassigned["key"] = "PROJ-2"
    unassigned["fields"].update({"assignee": None, "priority": None, "timespent": None, "status": None})
    bare = {"key": "PROJ-3"}
    return [RAW_ISSUE, unassigned, bare, {"key": "PROJ-4", "fields": {"status": {"name": "x"}, "issuetype": "문자열"}}]


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    worklogs = [RAW_ISSUE["fields"]["worklog"]["worklogs"][0], {"id": "9", "author": None, "started": None, "comment": "평문"}, {}]
    expected = {
        "sheet": SHEET,
        "wbs": wbs_results(out),
        "match": [{"tasks": t, "issues": i, "links": l, "ok": match_keys(t, i, l)} for t, i, l in MATCH_CASES],
        "jql": [{"args": list(a), **outcome(build_jql, *a)} for a in JQL_CASES],
        "keyJql": [{"keys": k, **outcome(build_key_jql, k)} for k in KEY_JQL_CASES],
        "adf": [{"node": n, "text": adf_to_text(n)} for n in ADF_CASES],
        "issues": [{"raw": r, "ok": normalize_issue(r)} for r in raw_issues()],
        "worklogs": [{"raw": w, "ok": normalize_worklog("PROJ-1", w)} for w in worklogs],
        "fields": FIELDS, "lookupFields": LOOKUP_FIELDS,
    }
    (out / "expected.json").write_text(json.dumps(expected, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
