#!/usr/bin/env python3
"""구현 계획 목록 노트 생성기 (구현 진행 현황).

설정한 폴더 바로 아래 계획 md를 읽어 `00_<폴더명>_목록.md`를 다시 쓰고,
같은 데이터로 `00_<폴더명>_목록.html`(구현 진행 현황 화면, `plans_index_html.py`)도 다시 쓴다.
- 하위 폴더(부속·검증 기록), `00_`으로 시작하는 파일(목록 노트), 숨김 파일은 뺀다.
- 상태는 frontmatter `status`를 할 일·진행 중·완료로 맞춘다. frontmatter나 `status`가 없으면 참고다.
- 진행률은 frontmatter `progress`(0–100). 체크는 펜스 코드 블록 밖의 `- [ ]`·`- [x]`를 센다.
  완료인데 `[ ]`가 남은 계획은 어긋남으로 센다(에이전트가 실행 뒤 체크를 안 한 경우가 많다).
- 작성일은 파일명 앞 `YYYY-MM-DD`, 최종 갱신은 frontmatter `updated` → `created` → 작성일.
  파일 수정 시각은 Vault 동기화로 한꺼번에 바뀌므로 쓰지 않는다.
- 기능 구분은 frontmatter `feature`(한 줄: `feature: A, B` 또는 `feature: [A, B]`)에서 읽는다. 없으면 `미분류`.

사용: 대시보드가 `sync(folder)`를 부른다. `check=True`면 파일을 쓰지 않고 갱신 필요 여부만 돌려준다.
"""
import re
import unicodedata
from pathlib import Path

from .plans_index_html import html_name, sync as sync_html

UNMAPPED = "미분류"

STATES = {"todo": "할 일", "doing": "진행 중", "done": "완료", "ref": "참고"}
STATUS = {
    "할 일": "todo", "할일": "todo", "todo": "todo",
    "진행 중": "doing", "진행중": "doing", "doing": "doing", "in progress": "doing", "in-progress": "doing",
    "완료": "done", "done": "done",
}
DATE = re.compile(r"^(\d{4}-\d{2}-\d{2})")
CHECKBOX = re.compile(r"^\s*[-*+] \[([ xX])\]")
FENCE = re.compile(r"^\s*(```|~~~)")


def cell(value: str) -> str:
    return value.replace("|", "/")


def nfc(name: str) -> str:
    return unicodedata.normalize("NFC", name)


def output_name(folder: Path) -> str:
    return f"00_{folder.name}_목록.md"


def features_of(raw: str) -> list:
    """frontmatter `feature` 값 → 목록. `A, B`·`[A, B]`·`["A", "B"]` 모두 받는다."""
    return [v.strip().strip("\"'") for v in raw.strip().strip("[]").split(",") if v.strip().strip("\"'")]


def frontmatter(src: str) -> dict:
    """맨 앞 `---` 블록의 `키: 값` 한 줄짜리 항목만 읽는다(목록·중첩 값은 쓰지 않는다)."""
    lines = src.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    meta = {}
    for line in lines[1:]:
        if line.strip() == "---":
            return meta
        key, sep, value = line.partition(":")
        if sep and key and not key.startswith((" ", "-")):
            meta[key.strip()] = value.strip().strip("\"'")
    return {}  # 닫는 줄이 없으면 frontmatter가 아니다


def checkboxes(src: str) -> tuple[int, int]:
    """(체크됨, 전체). 펜스 코드 블록 안의 예시 체크박스는 세지 않는다."""
    checked = total = 0
    fenced = False
    for line in src.splitlines():
        if FENCE.match(line):
            fenced = not fenced
            continue
        if fenced:
            continue
        match = CHECKBOX.match(line)
        if match:
            total += 1
            checked += match.group(1) != " "
    return checked, total


def read(path: Path, warnings: list) -> dict:
    src = path.read_text(encoding="utf-8")
    name = nfc(path.name)
    meta = frontmatter(src)
    date = DATE.match(name)
    checked, total = checkboxes(src)
    plan = {
        "file": path.name,
        "title": DATE.sub("", name.removesuffix(".md")).strip() or name,
        "date": date.group(1) if date else "-",
        "features": features_of(meta.get("feature", "")) or [UNMAPPED],
        "checked": checked,
        "total": total,
        "progress": None,
        "state": "ref",
    }
    status = meta.get("status", "")
    if status:
        state = STATUS.get(status.lower())
        if state:
            plan["state"] = state
        else:
            warnings.append(f"모르는 status '{status}': {path.name} → 할 일·진행중·완료 중 하나로 고친다")
    raw = meta.get("progress", "")
    if raw:
        try:
            plan["progress"] = max(0, min(100, round(float(raw.rstrip("%")))))
        except ValueError:
            warnings.append(f"progress 값을 읽을 수 없음 '{raw}': {path.name}")
    updated = next((meta[k] for k in ("updated", "created") if DATE.match(meta.get(k, ""))), plan["date"])
    plan["updated"] = DATE.match(updated).group(1) if DATE.match(updated) else updated
    plan["mismatch"] = plan["state"] == "done" and checked < total
    return plan


def plans_in(folder: Path) -> list:
    return sorted(p for p in folder.glob("*.md") if p.is_file() and not p.name.startswith(("00_", ".")))


def grouped(items: list) -> list:
    # 정렬이 안정적이므로 같은 기능 구분 안에서는 최종 갱신 순서가 유지된다. 미분류는 맨 뒤다.
    return sorted(items, key=lambda p: (p["features"] == [UNMAPPED], p["features"]))


def by_state(plans: list) -> dict:
    out = {}
    for key in STATES:
        items = [p for p in plans if p["state"] == key]
        items.sort(key=lambda p: (p["updated"], p["date"]), reverse=True)
        out[key] = grouped(items)
    return out


def progress_cell(plan: dict) -> str:
    return f"{plan['progress']}%" if plan["progress"] is not None else "-"


def check_cell(plan: dict) -> str:
    if not plan["total"]:
        return "-"
    return f"{plan['checked']}/{plan['total']}" + (" ⚠" if plan["mismatch"] else "")


def render(sections: dict, folder: Path) -> str:
    lines = [
        f"# {folder.name} 목록",
        "",
        "> 자동 생성 노트다. 직접 고치지 않는다.",
        "> 계획 md를 추가하거나 frontmatter `status`·`progress`·`feature`를 고친 뒤 대시보드 화면의 ⟳ 새로고침으로 다시 만든다.",
        f"> 같은 갱신에서 [[{html_name(folder)}|구현 진행 현황 HTML]]도 다시 만든다. 대시보드 구현 진행 현황 탭에서 열면 계획을 누를 때 md 뷰어가 열린다.",
        "> 기능 구분은 각 계획의 frontmatter `feature`에서 읽는다. 체크의 ⚠는 상태가 완료인데 `- [ ]`가 남은 계획이다.",
        "",
    ]
    header = [
        "| 기능 구분 | 계획 | 진행률 | 체크 | 최종 갱신 | 작성일 |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for key in ("doing", "todo", "done"):
        items = sections[key]
        lines += [f"## {STATES[key]} ({len(items)})", "", *header]
        lines += [
            f"| {cell(', '.join(p['features']))} | [[{p['file']}\\|{cell(p['title'])}]] | {progress_cell(p)} "
            f"| {check_cell(p)} | {p['updated']} | {p['date']} |"
            for p in items
        ]
        lines.append("")
    refs = sections["ref"]
    lines += [f"## 참고 ({len(refs)})", "", "frontmatter `status`가 없는 인계·메모·매핑 문서다.", ""]
    lines += ["| 기능 구분 | 계획 | 작성일 |", "| --- | --- | --- |"]
    lines += [f"| {cell(', '.join(p['features']))} | [[{p['file']}\\|{cell(p['title'])}]] | {p['date']} |" for p in refs]
    return "\n".join(lines) + "\n"


def sync(folder: Path, check: bool = False) -> dict:
    """계획 md → 목록 md·목록 HTML. check면 쓰지 않고 갱신 필요 파일만 센다.

    반환: {"counts": {todo, doing, done, ref, mismatch}, "warnings": [...], "stale": [갱신이 필요했던 파일명]}.
    `plans_serve.py`의 새로고침도 이 함수를 부른다.
    """
    output = folder / output_name(folder)
    warnings = []
    plans = [read(p, warnings) for p in plans_in(folder)]
    warnings += [f"기능 구분 없음: {p['file']} → frontmatter에 feature: 를 적는다" for p in plans if p["features"] == [UNMAPPED]]

    sections = by_state(plans)
    content = render(sections, folder)
    current = output.read_text(encoding="utf-8") if output.exists() else ""
    stale = [output.name] if current != content else []
    if stale and not check:
        output.write_text(content, encoding="utf-8")
    if not sync_html(sections, check, folder):
        stale.append(html_name(folder))
    counts = {key: len(items) for key, items in sections.items()}
    counts["mismatch"] = sum(p["mismatch"] for p in plans)
    return {"counts": counts, "warnings": warnings, "stale": stale}
