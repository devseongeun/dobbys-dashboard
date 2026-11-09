"""README 시연용 목업 데이터를 임시 HOME 에 만든다. 실제 설정·상태·Vault 는 건드리지 않는다.

사용: python3 scripts/demo/mock_data.py <임시 HOME>

<임시 HOME>/DemoVault 에 가짜 Vault(WBS 엑셀·의사결정 HTML·계획 md·회의 Canvas·주간 보고 md)를 만들고,
<임시 HOME>/.config/dobbys-dashboard/config.json 을 온보딩과 같은 정규화(normalize)로 저장한다.
날짜는 오늘 기준으로 잡아 언제 다시 찍어도 화면이 '이번 주'로 보인다.
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import date, timedelta
from pathlib import Path

if len(sys.argv) != 2:
    sys.exit("사용: python3 scripts/demo/mock_data.py <임시 HOME>")
SANDBOX = Path(sys.argv[1]).resolve()
if SANDBOX == Path.home().resolve():
    sys.exit("실제 HOME 에는 만들지 않는다. 임시 폴더를 지정한다.")
# dashboard.paths 는 import 할 때 Path.home() 을 읽는다. 그 전에 HOME 을 바꿔 설정 위치를 임시 폴더로 보낸다.
os.environ["HOME"] = str(SANDBOX)
REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from dashboard.config import ConfigStore, normalize  # noqa: E402
from dashboard.paths import CONFIG_PATH, STATE_ROOT  # noqa: E402
from tabs import ALL_TABS  # noqa: E402
from tabs.wbs.store import write_json  # noqa: E402
from tests.support_xlsx import FIELDS, HEADER, SUB, make_xlsx  # noqa: E402

PROJECT = "DEMO 1.0.0"
ME = "김도비"
SHEET = "DEMO_v1.0.0_WBS(작업)"
TODAY = date.today()
MONDAY = TODAY - timedelta(days=TODAY.weekday())
EXCEL_EPOCH = date(1899, 12, 30)


def day(offset: int) -> date:
    return TODAY + timedelta(days=offset)


def iso(offset: int) -> str:
    return day(offset).isoformat()


def serial(offset: int) -> int:
    return (day(offset) - EXCEL_EPOCH).days


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


# ── WBS 엑셀 ─────────────────────────────────────────────────────────────
WBS_ROWS = [
    # (id, 1 Depth, 2 Depth, 화면 이름, 담당자, 시작 offset, 끝 offset, 우선순위)
    ("DEMO-ORD-001", "주문", "주문 관리", "주문 목록 조회", ME, -24, -14, "P1"),
    ("DEMO-ORD-002", "주문", "주문 관리", "주문 상세 화면", ME, -16, -4, "P1"),
    ("DEMO-ORD-003", "주문", "주문 관리", "주문 취소·환불 처리", f"{ME} 외 2명", -6, 6, "P1"),
    ("DEMO-PAY-001", "결제", "결제 연동", "PG사 결제창 연동", ME, -3, 9, "P1"),
    ("DEMO-PAY-002", "결제", "결제 연동", "결제 실패 재시도", ME, 2, 12, "P2"),
    ("DEMO-PAY-003", "결제", "정산", "일별 정산 리포트", ME, 8, 20, "P2"),
    ("DEMO-NTF-001", "알림", "알림 발송", "주문 상태 알림톡", ME, 10, 22, "P3"),
    ("DEMO-NTF-002", "알림", "알림 발송", "알림 수신 설정", f"{ME} 외 1명", 15, 27, "P3"),
    ("DEMO-MEM-001", "회원", "회원 관리", "회원 등급 관리", "이해리", -10, 4, "P2"),
    ("DEMO-MEM-002", "회원", "회원 관리", "휴면 회원 전환", "박하늘", 3, 14, "P3"),
]
# 요구사항ID → 보드 칸(tabs/wbs/js/state.js STATUSES). 지난달에 끝난 DEMO-ORD-001 은 '이번 달만' 필터에 걸려 보드에 없다.
BOARD = {"DEMO-ORD-002": "완료", "DEMO-ORD-003": "진행", "DEMO-PAY-001": "진행", "DEMO-PAY-002": "할 일",
         "DEMO-PAY-003": "할 일", "DEMO-NTF-001": "할 일", "DEMO-NTF-002": "할 일"}


def make_wbs(path: Path) -> None:
    """머리글 9행·보조 라벨 10행·데이터 11행부터. 형식은 tests/support_xlsx.py 와 같고 시트 이름·휴일만 데모용이다."""
    column = {field: col for col, field in FIELDS.items()}
    sheet = {9: dict(HEADER), 10: {**SUB, "R": serial(-30)}}
    for i, (rid, d1, d2, name, owner, start, end, pri) in enumerate(WBS_ROWS):
        row = {"pri": pri, "weight": 3, "stage": "개발", "id": rid, "d1": d1, "d2": d2, "d3": name, "name": name,
               "detail": "신규", "gubun": "신규", "screen": rid.replace("DEMO-", "SCR-"), "mgr": "이해리",
               "owner": owner, "people": 1, "start": serial(start), "end": serial(end),
               "md": max(1, (end - start) * 5 // 7)}
        sheet[11 + i] = {column[key]: value for key, value in row.items()}
    holiday = MONDAY + timedelta(days=16)
    make_xlsx(path, {SHEET: sheet, "휴일": {1: {"A": "휴일"}, 2: {"A": (holiday - EXCEL_EPOCH).days, "B": "창립기념일"}}})


# ── 의사결정 문서 ────────────────────────────────────────────────────────
ASSETS_TEMPLATE = (REPO / "tabs/assets/templates/의사결정_문서_제목.html").read_text(encoding="utf-8")
DOCST_STYLE = re.search(r'(<section class="docst"[^>]*>\s*<style>.*?</style>)', ASSETS_TEMPLATE, re.S).group(1)
ROW_LABEL = {"open": "미결", "done": "완료", "cancel": "취소됨"}

ASSETS = [
    # (파일명 제목, 기능 구분, 작성 offset, 회신 대상, [(문의, 상태, 답변)])
    ("PG사_결제창_연동_방식_문의", "결제", -9, "결제팀 정민수", [
        ("결제창을 팝업으로 띄울지, 리다이렉트로 보낼지", "done", "리다이렉트로 결정 (모바일 대응)"),
        ("결제 승인 콜백 URL 을 환경별로 나눌지", "open", "—"),
        ("부분 취소를 1차 범위에 넣을지", "open", "—"),
    ]),
    ("주문_취소_정책_확인_요청", "주문", -6, "기획 이해리", [
        ("배송 시작 후 취소 요청 처리 방법", "done", "반품 접수로 전환"),
        ("취소 사유 선택지를 고정할지", "done", "고정 5종 + 기타"),
    ]),
    ("알림톡_템플릿_검수_일정", "알림", -3, "운영 박하늘", [
        ("템플릿 검수 소요 기간", "open", "—"),
        ("검수 반려 시 대체 문자 발송 여부", "cancel", "요구사항 철회"),
    ]),
    ("회원_등급_산정_기준", "회원", -15, "기획 이해리", [
        ("등급 산정 주기(월·분기)", "done", "월 1회"),
        ("등급 하락 유예 기간", "done", "1개월"),
    ]),
]


def asset_html(title: str, feature: str, created: str, who: str, rows: list[tuple[str, str, str]]) -> str:
    counts = {s: sum(1 for _, st, _ in rows if st == s) for s in ROW_LABEL}
    doc = "open" if counts["open"] else "closed"
    body_rows = "\n".join(
        f'<tr data-docst="{st}"><td>{i}</td><td>{q}</td><td class="docst-s"><i></i><b></b></td><td>{a}</td></tr>'
        for i, (q, st, a) in enumerate(rows, start=1))
    sections = "\n".join(f"<h2>{i}. {q}</h2>\n<p>배경과 선택지를 정리했습니다. 회신을 받으면 표를 갱신합니다.</p>"
                         for i, (q, _, _) in enumerate(rows, start=1))
    style = DOCST_STYLE.replace('data-doc="open"', f'data-doc="{doc}"', 1)
    name = title.replace("_", " ")
    return f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8"><meta name="feature" content="{feature}"><meta name="created" content="{created}">
<title>{name}</title>
<style>body{{max-width:1100px;margin:0 auto;padding:32px 24px;color:#1c1f26;font:15px/1.7 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif}}h1{{font-size:24px;margin:0 0 4px}}h2{{font-size:18px;margin:32px 0 8px}}.sub{{color:#8a90a0;margin:0}}</style>
</head>
<body>
<h1>{name}</h1>
<p class="sub">{ME} · {created}</p>
<!-- docst:begin -->
{style}
<div class="docst-hd"><b>문의 현황</b><span class="docst-doc"></span></div>
<p class="docst-meta"><span>회신 대상<b>{who}</b></span><span>집계<b>미결 {counts['open']} · 완료 {counts['done']} · 취소됨 {counts['cancel']}</b></span><span>최종 갱신<b>{iso(-1) if doc == 'open' else created}</b></span></p>
<table>
<thead><tr><th>No</th><th>문의 사항</th><th>상태</th><th>답변·결정</th></tr></thead>
<tbody>
{body_rows}
</tbody>
</table>
</section>
<!-- docst:end -->
{sections}
</body>
</html>
"""


# ── 구현 계획 ────────────────────────────────────────────────────────────
PLANS = [
    # (제목, 상태, 진행률, 기능 구분, 작성 offset, [(할 일, 완료 여부)])
    ("주문 목록 조회 API 연동", "완료", 100, "주문", -24, [("목록 API 모델 정의", True), ("페이지네이션", True), ("상세 검색 필터", True)]),
    ("주문 취소·환불 처리", "진행 중", 60, "주문", -6, [("취소 사유 선택 모달", True), ("환불 금액 계산", True), ("부분 환불", False), ("취소 이력 표시", False)]),
    ("PG사 결제창 연동", "진행 중", 35, "결제", -3, [("결제 요청 파라미터 정리", True), ("리다이렉트 콜백 처리", False), ("결제 실패 화면", False)]),
    ("결제 실패 재시도", "할 일", 0, "결제", 0, [("재시도 정책 확정", False), ("재시도 버튼·안내 문구", False)]),
    ("주문 상태 알림톡", "할 일", 0, "알림", 1, [("템플릿 검수 요청", False), ("발송 이력 화면", False)]),
    ("회원 등급 관리 화면", "진행 중", 80, "회원", -10, [("등급 목록", True), ("등급 기준 편집", True), ("변경 이력", True), ("권한 체크", False)]),
]


def plan_md(title: str, status: str, progress: int, feature: str, created: str, todos: list[tuple[str, bool]]) -> str:
    checks = "\n".join(f"- [{'x' if done else ' '}] {text}" for text, done in todos)
    return f"""---
status: {status}
progress: {progress}
feature: {feature}
created: {created}
updated: {iso(-1) if status != '할 일' else created}
---
# {title}

## 목표

{title} 화면과 API 연동을 마친다.

## 할 일

{checks}
"""


# ── 회의 자료(Obsidian Canvas) ──────────────────────────────────────────
def node(kind: str, x: int, y: int, w: int, h: int, **extra) -> dict:
    return {"id": f"{kind}-{x}-{y}", "type": kind, "x": x, "y": y, "width": w, "height": h, **extra}


def meeting_canvas(meetings: list[tuple[str, list[dict]]]) -> str:
    """meetings: (회의 이름, 카드들). 회의마다 세로로 그룹을 쌓고 카드를 그룹 안에 한 줄씩 놓는다."""
    nodes, y = [], 0
    for label, cards in meetings:
        height = 80 + 120 * len(cards)
        nodes.append(node("group", 0, y, 600, height, label=label))
        for i, card in enumerate(cards):
            nodes.append(node(card.pop("type"), 20, y + 60 + 120 * i, 560, 100, **card))
        y += height + 80
    return json.dumps({"nodes": nodes, "edges": []}, ensure_ascii=False, indent=1)


VAULT_DOCS = {
    "docs/결제 흐름 정리.md": "# 결제 흐름 정리\n\n1. 주문서 작성\n2. PG 결제창 리다이렉트\n3. 승인 콜백 → 주문 확정\n\n> 실패 시 주문은 `결제 대기`로 남는다.\n",
    "docs/PG사 비교표.md": "# PG사 비교표\n\n| 항목 | A사 | B사 |\n|---|---|---|\n| 수수료 | 2.9% | 3.1% |\n| 부분 취소 | 지원 | 지원 |\n| 테스트 환경 | 있음 | 있음 |\n",
    "docs/알림톡 템플릿 초안.md": "# 알림톡 템플릿 초안\n\n- 주문 접수\n- 결제 완료\n- 배송 시작\n- 주문 취소\n",
    "docs/회의록 주문 취소 정책.md": "# 회의록: 주문 취소 정책\n\n- 배송 시작 후 취소는 반품 접수로 전환한다.\n- 취소 사유는 고정 5종 + 기타.\n",
}


def make_meetings(vault: Path, folder: Path) -> None:
    for rel, text in VAULT_DOCS.items():
        write(vault / "DEMO_100" / rel, text)
    doc = lambda name: {"type": "file", "file": f"DEMO_100/docs/{name}.md"}  # noqa: E731
    write(folder / "결제 연동.canvas", meeting_canvas([
        (f"{iso(-4)} PG사 연동 방식 협의", [doc("결제 흐름 정리"), doc("PG사 비교표"),
                                       {"type": "link", "url": "https://example.com/pg/docs"}]),
        (f"{iso(-11)} 결제 범위 킥오프", [{"type": "text", "text": "부분 취소는 2차 범위로 미룬다."}, doc("결제 흐름 정리")]),
    ]))
    write(folder / "주문 취소 정책.canvas", meeting_canvas([
        (f"{iso(-6)} 취소 정책 리뷰", [doc("회의록 주문 취소 정책")]),
    ]))
    write(folder / "주문 알림.canvas", meeting_canvas([
        (f"{iso(-2)} 알림톡 템플릿 검토", [doc("알림톡 템플릿 초안"),
                                     {"type": "text", "text": "검수 기간 문의 회신 대기 중"}]),
    ]))


# ── 주간 보고 ────────────────────────────────────────────────────────────
def weekly_md(monday: date, done: list[str], next_: list[str], counts: tuple[int, int]) -> str:
    sunday = monday + timedelta(days=6)
    nxt = monday + timedelta(days=7)
    finished, doing = counts
    details = "\n\n".join(f"""### {i}. {task}
- 수행 내용:
  - {task} 화면과 API 연동
- 확인 결과:
  - 개발 서버에서 정상 동작 확인
- 의사결정/원인:
  - 회의에서 정한 범위대로 진행
- 다음 단계:
  - QA 요청""" for i, task in enumerate(done, start=1))
    return f"""# 주간 업무 보고

## 보고 기간
- 조회 기간: {monday} ~ {sunday}
- 차주 범위: {nxt} ~ {nxt + timedelta(days=6)}
- 버전: {PROJECT}
- 실제 확인 범위:
  - Jira 이슈, 커밋, 회의록

## 이번 주 핵심 업무
{chr(10).join(f"{i}. {t}" for i, t in enumerate(done, start=1))}

## 업무별 상세 내용

{details}

## 정량 지표
- 커밋: {finished * 7 + doing * 3}건

### 이슈 처리 현황
- 전체 {finished + doing}건
  - 완료 {finished}건
  - 진행 {doing}건
Jira 담당 이슈 기준

## 금주 주요 사항
{chr(10).join(f"- {t}" for t in done)}

## 차주 주요 사항
{chr(10).join(f"- {t}" for t in next_)}

## 이슈 및 기타 사항
- 알림톡 템플릿 검수 일정 회신 대기

## PPT 붙여넣기용
금주
{chr(10).join(done)}

차주
{chr(10).join(next_)}

## 출처 및 검증
- Jira 담당 이슈와 이번 주 커밋으로 확인

## PPT 처리
미처리
"""


# ── Jira(목업) ───────────────────────────────────────────────────────────
# scripts/demo/serve_demo.py 가 실제 Jira 대신 이 파일로 REST 응답을 만든다. 요약은 화면 이름 그대로라 자동 연결 규칙
# ('1 Depth-…-이름', tabs/wbs/matching.py)에 맞지 않는다. 대신 links(요구사항ID → 이슈키)를 record.mjs 가 탭의
# 수동 연결 API 로 넣는다. DEMO-110 은 WBS 에 없는 Jira 전용 이슈다.
JIRA_MOCK = "demo-jira.json"
ME_ID = "demo-account-1"
# 한국어 Jira 의 상태 분류 이름. 보드는 '완료' 분류를 완료로 보고 기한 초과에서 뺀다(tabs/wbs/js/model.js).
CATEGORY = {"할 일": "할 일", "진행": "진행 중", "개발완료": "진행 중", "완료": "완료", "취소": "완료"}
JIRA_ISSUES = [
    # (키, WBS 요구사항ID 또는 None, 요약(Jira 전용일 때), 상태, 유형, 우선순위, 기한 offset, 실제 시작 offset, 실제 종료 offset, [(작업일 offset, 시간)])
    ("DEMO-101", "DEMO-ORD-001", None, "완료", "작업", "High", -14, -24, -15, [(-20, 6), (-17, 5)]),
    ("DEMO-102", "DEMO-ORD-002", None, "완료", "작업", "High", -4, -16, -5, [(-12, 4), (-8, 6), (-6, 3)]),
    ("DEMO-103", "DEMO-ORD-003", None, "진행", "작업", "High", 6, -6, None, [(-5, 5), (-3, 6), (-1, 4)]),
    ("DEMO-104", "DEMO-PAY-001", None, "개발완료", "작업", "Highest", 9, -3, None, [(-2, 7), (0, 3)]),
    ("DEMO-105", "DEMO-PAY-002", None, "할 일", "작업", "Medium", 12, None, None, []),
    ("DEMO-106", "DEMO-PAY-003", None, "할 일", "작업", "Medium", 20, None, None, []),
    ("DEMO-107", "DEMO-NTF-001", None, "할 일", "작업", "Low", 22, None, None, []),
    ("DEMO-108", "DEMO-NTF-002", None, "취소", "작업", "Low", 27, None, None, []),
    ("DEMO-110", None, "결제 로그 개인정보 마스킹 점검", "진행", "버그", "High", 3, -2, None, [(-1, 2)]),
]


def jira_mock() -> dict:
    me = {"accountId": ME_ID, "displayName": ME, "emailAddress": "dobby@example.com"}
    rows = {row[0]: row for row in WBS_ROWS}
    issues = []
    for key, rid, summary, status, kind, priority, due, started, ended, logs in JIRA_ISSUES:
        if rid:
            _, _, _, name, _, start, _, _ = rows[rid]
            summary, plan_start = name, iso(start)
        else:
            plan_start = iso(started)
        worklogs = [{
            "id": f"{key}-{i}", "author": me, "started": f"{iso(offset)}T10:00:00.000+0900",
            "timeSpentSeconds": hours * 3600, "comment": None,
        } for i, (offset, hours) in enumerate(logs, start=1)]
        issues.append({"key": key, "fields": {
            "summary": summary,
            "status": {"name": status, "statusCategory": {"name": CATEGORY[status]}},
            "issuetype": {"name": kind}, "priority": {"name": priority}, "assignee": me,
            "duedate": iso(due), "timespent": sum(log["timeSpentSeconds"] for log in worklogs) or None,
            "customfield_11481": plan_start,
            "customfield_11484": iso(started) if started is not None else None,
            "customfield_11485": iso(ended) if ended is not None else None,
            "worklog": {"worklogs": worklogs, "total": len(worklogs), "maxResults": 20},
        }})
    links = {rid: key for key, rid, *_ in JIRA_ISSUES if rid}
    return {"myself": me, "issues": issues, "links": links}


def main() -> None:
    vault = SANDBOX / "DemoVault"
    root = vault / "DEMO_100"
    (vault / ".obsidian").mkdir(parents=True, exist_ok=True)
    folders = {name: root / name for name in ("10-plans", "70-meetings", "80-weekly", "90-assets")}
    for folder in folders.values():
        folder.mkdir(parents=True, exist_ok=True)

    workbook = root / "DEMO_WBS.xlsx"
    make_wbs(workbook)
    for title, feature, created, who, rows in ASSETS:
        write(folders["90-assets"] / f"DEMO_1.0.0_{title}.html", asset_html(title, feature, iso(created), who, rows))
    for title, status, progress, feature, created, todos in PLANS:
        write(folders["10-plans"] / f"{iso(created)} {title}.md", plan_md(title, status, progress, feature, iso(created), todos))
    make_meetings(vault, folders["70-meetings"])
    last = MONDAY - timedelta(days=7)
    write(folders["80-weekly"] / f"{MONDAY + timedelta(days=4)} 주간 보고.md",
          weekly_md(MONDAY, ["주문 취소·환불 처리", "PG사 결제창 연동", "회원 등급 관리 화면"],
                    ["결제 실패 재시도", "주문 상태 알림톡"], (3, 2)))
    write(folders["80-weekly"] / f"{last + timedelta(days=4)} 주간 보고.md",
          weekly_md(last, ["주문 상세 화면", "주문 목록 조회 API 연동"], ["주문 취소·환불 처리", "PG사 결제창 연동"], (2, 1)))

    tabs = {tab.id: tab for tab in ALL_TABS}
    config, errors = normalize(tabs, {"project": PROJECT, "tabs": {
        "wbs": {"mode": "wbs", "workbook": str(workbook), "owner": ME, "sheet": SHEET,
                "jira_domain": "demo.atlassian.net", "jira_project": "DEMO"},
        "assets": {"folder": str(folders["90-assets"])},
        "plans": {"folder": str(folders["10-plans"])},
        "meetings": {"folder": str(folders["70-meetings"])},
        "weekly": {"folders": [str(folders["80-weekly"])]},
    }})
    if errors:
        sys.exit(f"목업 설정이 온보딩 검사를 통과하지 못했다: {errors}")
    ConfigStore(CONFIG_PATH).save(config)
    # Jira 없이도 보드 칸이 채워지게, 카드 아래 칸 선택으로 지정한 것과 같은 개인 상태를 미리 둔다.
    write_json(STATE_ROOT / PROJECT / "wbs" / "status-assign.json", BOARD)
    write_json(SANDBOX / JIRA_MOCK, jira_mock())
    print(f"목업 데이터: {vault}\n설정: {CONFIG_PATH}")


if __name__ == "__main__":
    main()
