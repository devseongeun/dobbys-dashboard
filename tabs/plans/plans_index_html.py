"""구현 계획 목록 HTML 생성기 (구현 진행 현황 화면).

`plans_index.py`가 모은 계획 데이터로 `00_<폴더명>_목록.html`을 다시 쓴다.
- 뼈대·스타일·탭/기능 구분/검색 스크립트는 의사결정 현황(`assets_index_html.py`)의 PAGE·STYLE·SCRIPT를 그대로 쓴다.
- 계획 링크는 `view.html#<파일명>`(md 뷰어, `plans_serve.py`가 준다)이다. 그래서 서버(대시보드 `/plans/`)에서 열어야 링크가 동작한다.
- 생성 시각을 넣지 않는다. 같은 데이터면 같은 HTML이 나와야 `plans_index.sync(folder, check=True)`가 안정적이다.
"""
from pathlib import Path
from urllib.parse import quote

from ..assets.assets_index_html import PAGE, SCRIPT, SERVE_URL, STYLE, copy_path_button, esc, fill, groups, stat


def html_name(folder: Path) -> str:
    return f"00_{folder.name}_목록.html"


TABS = (("todo", "할 일"), ("doing", "진행 중"), ("done", "완료"), ("ref", "참고"))

EXTRA_STYLE = """.pl-t th:nth-child(2){width:72px}.pl-t th:nth-child(3){width:180px}.pl-t th:nth-child(4){width:96px}.pl-t th:nth-child(5),.pl-t th:nth-child(6){width:92px}
.badge{display:inline-block;padding:0 8px;border-radius:99px;font-size:11px;line-height:19px;background:#232833;color:var(--muted);white-space:nowrap}
.badge.doing{background:rgba(94,234,212,.14);color:var(--acc)}.badge.todo{background:rgba(251,191,36,.14);color:#fcd34d}.badge.done{background:rgba(74,222,128,.14);color:var(--done)}
.pbar .pct{background:var(--done)}
td.ck{font:11px ui-monospace,Menlo,monospace;color:var(--muted);white-space:nowrap}
td.ck.warn{color:#fb923c}
@media (max-width:760px){.pl-t th:nth-child(4),.pl-t td:nth-child(4){display:none}}
"""


def plan_link(plan: dict, folder: Path) -> str:
    return (
        f'<span class="doc-entry"><a href="view.html#{esc(quote(plan["file"]))}">{esc(plan["title"])}</a>'
        f'{copy_path_button(folder, plan["file"])}</span>'
    )


def row_attrs(plan: dict) -> str:
    label = dict(TABS)[plan["state"]]
    text = " ".join([plan["title"], label, *plan["features"]]).lower()
    return f'data-features="{esc("|".join(plan["features"]))}" data-text="{esc(text)}"'


def progress(plan: dict) -> str:
    value = plan["progress"]
    bar = f'<i class="pct" style="flex:0 0 {value}%"></i>' if value else ""
    return f'<div class="prog"><div class="pbar">{bar}</div><span class="pn">{"-" if value is None else f"{value}%"}</span></div>'


def check(plan: dict) -> str:
    if not plan["total"]:
        return '<td class="ck">-</td>'
    text = f'{plan["checked"]}/{plan["total"]}'
    if plan["mismatch"]:
        left = plan["total"] - plan["checked"]
        return f'<td class="ck warn" title="상태는 완료인데 체크 안 된 항목 {left}개">{text} ⚠</td>'
    return f'<td class="ck">{text}</td>'


def plan_table(rows: list, folder: Path) -> str:
    body = "".join(
        f'<tr {row_attrs(p)}><td class="doc">{plan_link(p, folder)}</td>'
        f'<td><span class="badge {p["state"]}">{esc(dict(TABS)[p["state"]])}</span></td>'
        f'<td>{progress(p)}</td>{check(p)}<td class="mono">{esc(p["updated"])}</td><td class="mono">{esc(p["date"])}</td></tr>'
        for p in rows
    )
    return (
        '<table class="pl-t"><thead><tr><th>계획</th><th>상태</th><th>진행률</th><th>체크</th>'
        f'<th class="mono">최종 갱신</th><th class="mono">작성일</th></tr></thead><tbody>{body}</tbody></table>'
    )


def ref_table(rows: list, folder: Path) -> str:
    body = "".join(
        f'<tr {row_attrs(p)}><td class="doc">{plan_link(p, folder)}</td><td class="mono">{esc(p["date"])}</td></tr>'
        for p in rows
    )
    return f'<table class="ref-t"><thead><tr><th>계획</th><th class="mono">작성일</th></tr></thead><tbody>{body}</tbody></table>'


def panel(key: str, label: str, rows: list, folder: Path) -> str:
    table = ref_table if key == "ref" else plan_table
    note = '<p class="dim note">frontmatter <code>status</code>가 없는 인계·메모·매핑 문서다.</p>' if key == "ref" else ""
    body = "".join(
        f'<section class="grp"><div class="mhd"><b>{esc(name)}</b><span class="sub">{len(items)}건</span></div>{table(items, folder)}</section>'
        for name, items in groups(rows)
    )
    return (
        f'<div class="panel" data-key="{key}" role="tabpanel" hidden>'
        f'<h2 class="ph" hidden>{esc(label)} <span class="cnt"></span></h2>{note}{body}'
        '<p class="empty" hidden>조건에 맞는 계획이 없다.</p></div>'
    )


def render_html(sections: dict, folder: Path) -> str:
    doing = sections["doing"]
    known = [p["progress"] for p in doing if p["progress"] is not None]
    average = f"평균 진행률 {round(sum(known) / len(known))}%" if known else "진행률 없음"
    plans = [p for items in sections.values() for p in items]
    mismatch = sum(p["mismatch"] for p in plans)
    stats = "".join([
        stat("할 일", f'{len(sections["todo"])}건', "착수 전"),
        stat("진행 중", f"{len(doing)}건", average),
        stat("완료", f'{len(sections["done"])}건', f'참고 {len(sections["ref"])}건 별도'),
        stat("체크 어긋남", f"{mismatch}건", "완료인데 [ ] 남음"),
        stat("동기화", "—", "정적 파일", ' id="syncstat"'),
    ])
    tabs = "".join(
        f'<button class="tab" role="tab" data-tab="{key}">{esc(label)} <span class="cnt" data-total="{len(sections[key])}">{len(sections[key])}</span></button>'
        for key, label in TABS
    )
    features = sorted({f for p in plans for f in p["features"]})
    chips = '<button class="f" data-feature="">전체</button>' + "".join(
        f'<button class="f" data-feature="{esc(f)}">{esc(f)}</button>' for f in features
    )
    panels = "".join(panel(key, label, sections[key], folder) for key, label in TABS)
    return fill(PAGE, {
        "TITLE": f"구현 진행 현황 · {folder.name}",
        "SEARCH": "전체 검색 (할 일·진행 중·완료·참고)",
        "API": "api/plans",
        "SHELL": "plans",
        "SERVE": SERVE_URL,
        "NORES": "할 일·진행 중·완료·참고 어디에도 맞는 계획이 없다.",
        "SRC": f"자동 생성 파일이다. 원본은 <code>{esc(folder.name)}/*.md</code>의 frontmatter(<code>status</code>·<code>progress</code>·<code>feature</code>)와 체크박스이고, 대시보드 화면의 ⟳ 새로고침으로 다시 만든다. 계획을 누르면 md 뷰어가 열린다(서버에서 열었을 때).",
        "STYLE": STYLE + EXTRA_STYLE, "SCRIPT": SCRIPT,
        "STATS": stats, "TABS": tabs, "CHIPS": chips, "PANELS": panels,
    })


def sync(sections: dict, check: bool, folder: Path) -> bool:
    """HTML이 데이터와 일치하면 True. check가 아니면 다르면 다시 쓴다."""
    content = render_html(sections, folder)
    output = folder / html_name(folder)
    current = output.read_text(encoding="utf-8") if output.exists() else ""
    if current == content:
        return True
    if not check:
        output.write_text(content, encoding="utf-8")
    return False
