"""웹 기획서 코멘트 판정 규칙(분류·결정 완료·자기 종결·우선순위). 옛 spec_comment_report.py 에서 옮겼다.

우선순위·보류(답변 불필요)는 코드 상수가 아니라 탭에서 지정한 overrides 로 정한다.
"""
from __future__ import annotations

import collections
import re
from typing import Callable

CATEGORY_RULES = [
    ("담당자·일정 지정", ("담당자 지정",)),
    ("기획서 자체 오류·수정", ("웹기획서 버그", "웹 기획서 수정", "웹기획서 수정")),
    ("설명란 보완", ("설명란 업데이트", "설명 업데이트")),
    ("메시지 코드 등록", ("메시지 코드",)),
    ("기능·예외 정의 확인", ("기능 확인 요청", "예외 처리 확인")),
]
FALLBACK_CATEGORY = "내용 확인·제안"

# 리뷰 우선순위 = 화면 조치 시급도 순. 필터 칩 노출 순서에도 쓴다.
CATEGORY_ORDER = [
    "담당자·일정 지정",
    "기획서 자체 오류·수정",
    "메시지 코드 등록",
    "설명란 보완",
    "기능·예외 정의 확인",
    "내용 확인·제안",
]

CATEGORY_COLOR = {
    "담당자·일정 지정": "#b45309",
    "기획서 자체 오류·수정": "#b91c1c",
    "메시지 코드 등록": "#7c3aed",
    "설명란 보완": "#0f766e",
    "기능·예외 정의 확인": "#1d4ed8",
    "내용 확인·제안": "#475569",
}

HEAD_LIMIT_MD = 70
HEAD_LIMIT_HTML = 80

# 내가 스스로 "답변 안 하셔도 된다" 고 단 답글. 이 답글과 그 원 코멘트를 함께 잠근다.
# 기획이 삭제·변경되어 문의 자체가 없어진 경우가 여기 해당한다.
# 어미가 제각각이라("답변해 주시지 않아도", "답변해 주지 않아도", "답변 안 하셔도")
# 접두 명사와 종결 표현 사이를 느슨하게 열어 둔다.
SELF_CLOSE_RE = re.compile(r"(?:답변|회신|답글)[^\n]{0,14}(?:않아도|않으셔도|안\s*하셔도|안\s*주셔도|불필요)")

# 결정 완료 판정 — **내가(작성자가) 직접 붙인 👀 반응**. 기획서 반응 코드는 SPA 번들
# (`/assets/index-*.js`) 의 이모지 표에 있다: EMO001 👍 · EMO002 ❤️ · EMO003 😄 ·
# EMO004 🎉 · EMO005 👀.
# 내가 👀 를 붙이는 대상은 둘이다 — ① 내 코멘트 본문(스스로 종결) ② 내 코멘트에 달린
# 기획 답글(답변을 읽고 수용). 둘 중 하나면 결정 완료다.
# 타인이 내 코멘트에 붙인 👀 는 "봤다" 는 표시일 뿐 내 결정이 아니므로 세지 않는다.
# 조회 API 는 인증이 없어 `mine` 플래그가 항상 false 다. 판정은 `actors` 이름으로 한다.
DECIDED_EMOJI = "EMO005"
DECIDED_EMOJI_CHAR = "👀"


def eye_actors(comment: dict) -> list[str]:
    """코멘트에 붙은 👀 반응의 작성자 목록."""
    return [
        a
        for rx in comment.get("reactions") or []
        if rx.get("emoji") == DECIDED_EMOJI
        for a in rx.get("actors") or []
    ]

def classify(text: str) -> str:
    head = text[:60]
    for name, keys in CATEGORY_RULES:
        if any(k in head for k in keys):
            return name
    return FALLBACK_CATEGORY


def clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + "…"

PRIORITY_ORDER = ("상", "중")


def priority_of(comment_id: str, overrides: dict) -> tuple[str, str]:
    entry = (overrides.get("priority") or {}).get(comment_id) or {}
    level = entry.get("level")
    return (level, entry.get("reason") or "") if level in PRIORITY_ORDER else ("", "")


def collect(inbox: list[dict], fetch_bundle: Callable[[str], dict], author: str, overrides: dict):
    """작성자 기준 코멘트를 화면별로 묶는다. 코멘트가 없으면 ([], {}, 0)."""
    resolved_by_hand = overrides.get("resolved") or {}
    mine = [c for c in inbox if c.get("author") == author]
    if not mine:
        return [], collections.OrderedDict(), 0
    page_paths: dict[str, str] = {}
    for c in sorted(mine, key=lambda x: x["at"]):
        page_paths.setdefault(c["pageId"], c["path"])
    bundles = {page_id: fetch_bundle(path) for page_id, path in page_paths.items()}

    rows: list[dict] = []
    for page_id, bundle in bundles.items():
        for c in bundle.get("comments") or []:
            if c["author"] != author:
                continue
            pri_level, pri_why = priority_of(c["commentId"], overrides)
            rows.append({
                **c,
                "pageId": page_id,
                "path": page_paths[page_id],
                # 기획서 메타 미입력 화면은 autoScrnId 가 null 로 온다. 정렬 키라서 문자열로 고정한다.
                "scrnId": bundle["page"].get("autoScrnId") or "-",
                "pageTitle": bundle["page"]["title"],
                "category": classify(c["text"]),
                "isReply": bool(c["parentCommentId"]),
                "resolved": resolved_by_hand.get(c["commentId"], ""),
                "resolvedOwn": c["commentId"] in resolved_by_hand,
                "priorityLevel": pri_level,
                "priority": pri_why,
                "answers": [],
            })

    # 내 코멘트에 달린 타인의 답글 = 받은 답변. 코멘트ID로 원 코멘트에 되붙인다.
    by_id = {r["commentId"]: r for r in rows}
    for bundle in bundles.values():
        for c in bundle.get("comments") or []:
            if c["author"] == author:
                continue
            parent = by_id.get(c.get("parentCommentId") or "")
            if parent is None:
                continue
            parent["answers"].append({"commentId": c["commentId"], "author": c["author"], "at": c["at"],
                                      "text": c["text"].strip(), "eyed": author in eye_actors(c)})
    for r in rows:
        r["answers"].sort(key=lambda a: a["at"])
        r["answered"] = bool(r["answers"])
        marks = ["코멘트 본문"] if author in eye_actors(r) else []
        marks += [f"답글 `{a['commentId']}`" for a in r["answers"] if a["eyed"]]
        r["decidedOn"] = marks
        r["decided"] = bool(marks)

    # 자기 답글로 종결한 문의: 답글과 원 코멘트를 함께 잠근다.
    for r in rows:
        if not r["isReply"] or not SELF_CLOSE_RE.search(r["text"]):
            continue
        head = clip(" ".join(r["text"].split()), 90)
        parent = by_id.get(r["parentCommentId"])
        if not r["resolved"]:
            r["resolved"] = f"작성자 본인이 종결한 답글이다 — {head}"
        if parent and not parent["resolved"]:
            parent["resolved"] = f"작성자 본인이 `{r['commentId']}` 답글로 종결했다 — {head}"

    rows.sort(key=lambda r: (r["scrnId"], r["at"]))
    pages: collections.OrderedDict[str, dict] = collections.OrderedDict()
    for r in rows:
        page = bundles[r["pageId"]]["page"]
        pages.setdefault(r["pageId"], {
            "pageId": r["pageId"], "scrnId": r["scrnId"], "title": r["pageTitle"], "path": r["path"],
            "changeType": page.get("changeType") or "-", "author": page.get("author") or "-", "rows": [],
        })["rows"].append(r)
    pages = collections.OrderedDict(sorted(pages.items(), key=lambda kv: kv[1]["scrnId"]))
    # 답변 완료 = 기획(타인)이 답글을 단 내 코멘트 수
    answered = sum(1 for r in rows if r["answered"])
    return rows, pages, answered


def target_of(row: dict) -> str:
    """👀 를 붙일 대상: 기획 답글이 있으면 마지막 답글, 없으면 내 코멘트 본문."""
    return row["answers"][-1]["commentId"] if row["answers"] else row["commentId"]


def already_eyed(row: dict, author: str) -> bool:
    return row["answers"][-1]["eyed"] if row["answers"] else author in eye_actors(row)


def locked(row: dict) -> bool:
    return bool(row["resolved"]) and not row["answered"] and not row["decided"]


def category_counts(rows: list[dict]) -> list[list]:
    counts = collections.Counter(r["category"] for r in rows)
    return [[c, counts[c]] for c in CATEGORY_ORDER if counts[c]]


def page_payload(pages) -> list[dict]:
    """화면에 내려줄 모양. 옛 build_html payload 와 같고 resOwn(탭에서 직접 보류했는지)을 더했다."""
    return [
        {
            "pageId": p["pageId"], "scrnId": p["scrnId"], "title": p["title"], "path": p["path"],
            "changeType": p["changeType"], "author": p["author"],
            "comments": [
                {
                    "id": r["commentId"],
                    "at": r["at"][:16].replace("T", " "),
                    "cat": r["category"],
                    "reply": r["isReply"],
                    "text": r["text"].strip(),
                    "head": clip(r["text"].strip().split("\n")[0].strip(), HEAD_LIMIT_HTML),
                    # 답변을 받았거나 👀 결정이 난 건은 '답변 불필요' 잠금보다 우선한다.
                    "lock": "" if (r["answered"] or r["decided"]) else r["resolved"],
                    "st": "ans" if r["answered"] else ("lock" if r["resolved"] and not r["decided"] else "open"),
                    # 진행률 분모 계산용 — 잠금 표시(lock)와 달리 '보류 근거가 있었는지' 자체를 남긴다.
                    "res": bool(r["resolved"]),
                    "resOwn": r["resolvedOwn"],
                    "dec": r["decided"],
                    "decOn": [m.replace("`", "") for m in r["decidedOn"]],
                    "priLv": r["priorityLevel"],
                    "pri": r["priority"],
                    "ans": [{"id": a["commentId"], "author": a["author"], "at": a["at"][:16].replace("T", " "),
                             "text": a["text"], "eyed": a["eyed"]} for a in r["answers"]],
                }
                for r in p["rows"]
            ],
        }
        for p in pages.values()
    ]
