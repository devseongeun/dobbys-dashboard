#!/usr/bin/env python3
"""90-assets 목록 노트 생성기.

`90-assets/` 바로 아래 HTML을 읽어 `00_90-assets_목록.md`를 다시 쓰고,
그 md를 원본으로 `00_90-assets_목록.html`(의사결정 현황 화면, `assets_index_html.py`)도 다시 쓴다.
- `00_`으로 시작하는 HTML(목록 화면 자신)은 산출물 목록에서 뺀다.
- 상단 문의 현황 표(`<section class="docst" data-doc=…>`)가 있으면 진행 중/종결로 나눈다.
- 없으면 참고로 둔다.
- 표시 이름은 HTML 제목이 아니라 파일명의 `{내용}`을 쓴다(파일명 규칙이 일정해 찾기 쉽다).
- 기능 구분·작성일은 `00_90-assets_기능구분.md`의 `| 파일 | 기능 구분 | 작성일 |` 표에서 읽는다. 기능 구분 값이 여럿이면 `, `로 나눈다.
  파일명에는 날짜가 없으므로 작성일은 이 표가 유일한 원본이다.
  각 구역 안에서는 기능 구분이 같은 문서끼리 모이도록 기능 구분 → 기존 순서(최종 갱신·작성일)로 정렬한다.

사용: 대시보드가 `sync(folder)`를 부른다. `check=True`면 파일을 쓰지 않고 갱신 필요 여부만 돌려준다.
"""
import re
import unicodedata
from pathlib import Path

from .assets_index_html import HTML_NAME, sync as sync_html

OUTPUT_NAME = "00_90-assets_목록.md"
FEATURES_NAME = "00_90-assets_기능구분.md"

DOCST = re.compile(r'<section class="docst" data-doc="(open|closed)"')
META = re.compile(
    r'회신 대상<b>(?P<who>[^<]*)</b>.*?'
    r'집계<b>미결 (?P<open>\d+) · 완료 (?P<done>\d+) · 취소됨 (?P<cancel>\d+)</b>.*?'
    r'최종 갱신<b>(?P<updated>[\d-]+)</b>',
    re.S,
)
# 파일명 규칙은 버전 없음이 기본이다. 사용자가 예외로 맨 끝에 `_v1.0` 같은 버전을 붙인 파일도 있다.
VERSION = re.compile(r"_(v\d+(?:\.\d+)*)$")
# 문서 정보 줄(AGENTS.md "산출물 문서 정보 줄")의 버전. 파일명 버전과 같아야 한다.
DOCINFO_VERSION = re.compile(r'<!-- docinfo:begin -->(?:(?!docinfo:end).)*?<span class="scope-label">버전</span><span class="scope-chip">(v[\d.]+)</span>', re.S)


def cell(value: str) -> str:
    return value.replace("|", "/")


def load_index(features: Path) -> dict:
    """파일명(NFC) → {"features": 기능 구분 목록, "date": 작성일}."""
    index = {}
    if not features.exists():
        return index
    for line in features.read_text(encoding="utf-8").splitlines():
        if not line.startswith("|") or line.startswith("| 파일 ") or line.startswith("| ---"):
            continue
        name, values, date = (part.strip() for part in line.strip().strip("|").split("|"))
        index[unicodedata.normalize("NFC", name)] = {
            "features": [v.strip() for v in values.split(",") if v.strip()],
            "date": date or "-",
        }
    return index


def display_name(name: str) -> str:
    stem = VERSION.sub("", name.removesuffix(".html"))
    stem = stem.removeprefix("TRB_4.0.0_")
    # 코드명(EXCN_TYPE_CD)의 밑줄은 남기고, 띄어쓰기를 대신한 밑줄만 공백으로 되돌린다.
    return re.sub(r"(?<![A-Z])_|_(?![A-Z])", " ", stem)


def read(path: Path, index: dict) -> dict:
    src = path.read_text(encoding="utf-8")
    name = unicodedata.normalize("NFC", path.name)
    entry = index.get(name, {})
    in_name = VERSION.search(name.removesuffix(".html"))
    in_doc = DOCINFO_VERSION.search(src)
    # 버전이 있는 문서는 화면 이름에 버전을 반드시 붙인다. 같은 제목 문서가 여럿일 때 구분하는 유일한 표시다.
    version = (in_doc or in_name).group(1) if (in_doc or in_name) else ""
    doc = {
        "file": path.name,
        "title": f"{display_name(name)} {version}".rstrip(),
        "version": version,
        "name_version": in_name.group(1) if in_name else "",
        "date": entry.get("date", "-"),
        "state": "reference",
        "features": entry.get("features", []),
    }
    state = DOCST.search(src)
    if state:
        doc["state"] = state.group(1)
        meta = META.search(src, state.start())
        if meta:
            doc.update(meta.groupdict())
    return doc


def link(doc: dict) -> str:
    return f"[[{doc['file']}\\|{cell(doc['title'])}]]"


def feature_cell(doc: dict) -> str:
    return cell(", ".join(doc["features"])) if doc["features"] else "-"


def grouped(items: list) -> list:
    # 정렬이 안정적이므로 같은 기능 구분 안에서는 기존 순서가 유지된다. 기능 구분이 없는 문서는 맨 뒤다.
    return sorted(items, key=lambda d: (not d["features"], d["features"]))


def render(docs: list) -> str:
    open_docs = grouped(sorted((d for d in docs if d["state"] == "open"), key=lambda d: (d.get("updated", ""), d["date"]), reverse=True))
    closed = grouped(sorted((d for d in docs if d["state"] == "closed"), key=lambda d: (d.get("updated", ""), d["date"]), reverse=True))
    refs = grouped(sorted((d for d in docs if d["state"] == "reference"), key=lambda d: d["date"], reverse=True))

    lines = [
        "# 90-assets 목록",
        "",
        "> 자동 생성 노트다. 직접 고치지 않는다.",
        "> HTML을 추가하거나 문의 현황 표를 고친 뒤 대시보드 화면의 ⟳ 새로고침으로 다시 만든다.",
        "> 같은 갱신에서 이 노트를 원본으로 [[00_90-assets_목록.html|의사결정 현황 HTML]]도 다시 만든다(대시보드 http://127.0.0.1:8787/#assets).",
        "> 상태는 각 HTML 상단 문의 현황 표(`data-doc`)에서 읽는다.",
        "> 기능 구분은 [[00_90-assets_기능구분]]에서 읽고, 구역마다 같은 기능 구분끼리 모아 보여 준다.",
        "",
    ]
    status_header = [
        "| 기능 구분 | 문서 | 회신 대상 | 미결 · 완료 · 취소됨 | 최종 갱신 | 작성일 |",
        "| --- | --- | --- | --- | --- | --- |",
    ]

    def status_rows(items):
        return [
            f"| {feature_cell(d)} | {link(d)} | {cell(d.get('who', '-'))} "
            f"| {d.get('open', '-')} · {d.get('done', '-')} · {d.get('cancel', '-')} "
            f"| {d.get('updated', '-')} | {d['date']} |"
            for d in items
        ]

    lines += [f"## 진행 중 ({len(open_docs)})", "", *status_header, *status_rows(open_docs), ""]
    lines += [f"## 종결 ({len(closed)})", "", *status_header, *status_rows(closed), ""]
    lines += [f"## 참고 ({len(refs)})", "", "답을 기다리지 않는 설명·분석·설계·점검표 문서다.", ""]
    lines += ["| 기능 구분 | 문서 | 작성일 |", "| --- | --- | --- |"]
    lines += [f"| {feature_cell(d)} | {link(d)} | {d['date']} |" for d in refs]
    return "\n".join(lines) + "\n"


def sync(folder: Path, check: bool = False) -> dict:
    """HTML 문서 → 목록 md → 목록 HTML. check면 쓰지 않고 갱신 필요 파일만 센다.

    반환: {"counts": {open, closed, reference}, "warnings": [...], "stale": [갱신이 필요했던 파일명]}.
    `assets_serve.py`의 새로고침도 이 함수를 부른다.
    """
    features, output = folder / FEATURES_NAME, folder / OUTPUT_NAME
    index = load_index(features)
    docs = [read(p, index) for p in sorted(folder.glob("*.html")) if not p.name.startswith("00_")]
    warnings = [f"기능 구분 없음: {d['file']} → {FEATURES_NAME}에 행을 추가한다" for d in docs if not d["features"]]
    warnings += [f"작성일 없음: {d['file']} → {FEATURES_NAME} 작성일 열을 채운다" for d in docs if d["date"] == "-"]
    warnings += [
        f"버전 불일치: {d['file']} 파일명 {d['name_version']} ≠ 문서 정보 줄 {d['version']}"
        for d in docs if d["name_version"] and d["name_version"] != d["version"]
    ]
    titles = {}
    for d in docs:
        titles.setdefault(d["title"], []).append(d["file"])
    warnings += [f"같은 화면 이름(버전까지 같음): {' / '.join(files)}" for files in titles.values() if len(files) > 1]
    names = {unicodedata.normalize("NFC", d["file"]) for d in docs}
    warnings += [f"{FEATURES_NAME}에 있지만 HTML이 없음: {name}" for name in sorted(set(index) - names)]

    content = render(docs)
    current = output.read_text(encoding="utf-8") if output.exists() else ""
    stale = [OUTPUT_NAME] if current != content else []
    if stale and not check:
        output.write_text(content, encoding="utf-8")
    if not sync_html(content, check, folder):
        stale.append(HTML_NAME)
    counts = {s: sum(d["state"] == s for d in docs) for s in ("open", "closed", "reference")}
    return {"counts": counts, "warnings": warnings, "stale": stale}
