#!/usr/bin/env python3
"""90-assets 목록 HTML 생성기.

`00_90-assets_목록.md`(원본)를 읽어 `00_90-assets_목록.html`을 다시 쓴다.
- md의 `## 진행 중 (n)` / `## 종결 (n)` / `## 참고 (n)` 구역과 표만 읽는다. HTML 문서를 직접 열지 않는다.
- 탭(진행 중·종결·참고), 기능 구분 필터, 검색은 파일 안 JS로 동작한다(외부 의존 없음).
- 생성 시각을 넣지 않는다. 같은 md면 같은 HTML이 나와야 `assets_index.py --check`가 안정적이다.

`assets_index.sync(folder)`가 md를 쓴 뒤 함께 호출한다.
"""
import html
import re
from pathlib import Path
from urllib.parse import quote

HTML_NAME = "00_90-assets_목록.html"

SECTIONS = {"진행 중": "open", "종결": "closed", "참고": "ref"}
SECTION = re.compile(r"^## (진행 중|종결|참고) \((\d+)\)$")
LINK = re.compile(r"^\[\[(?P<file>[^\]|\\]+)(?:\\?\|(?P<title>[^\]]+))?\]\]$")
COUNTS = re.compile(r"^(\d+) · (\d+) · (\d+)$")
PIPE = "\x00"


def parse(md: str) -> dict:
    """md → {key: {"label", "count", "note", "rows"}}. 표 머리·구분선과 인용문은 건너뛴다."""
    sections = {}
    current = None
    for line in md.splitlines():
        match = SECTION.match(line)
        if match:
            current = sections[SECTIONS[match.group(1)]] = {
                "label": match.group(1),
                "count": int(match.group(2)),
                "note": "",
                "rows": [],
            }
            continue
        if current is None or not line.strip():
            continue
        if not line.startswith("|"):
            if not line.startswith(">"):
                current["note"] = line.strip()
            continue
        cells = [c.strip().replace(PIPE, "|") for c in line.replace("\\|", PIPE).strip().strip("|").split("|")]
        if cells[0] == "기능 구분" or cells[0].startswith("---"):
            continue
        current["rows"].append(row(cells))
    for section in sections.values():
        if len(section["rows"]) != section["count"]:
            raise ValueError(f"{section['label']}: 제목 건수 {section['count']}와 표 행 {len(section['rows'])}이 다르다")
    return sections


def row(cells: list) -> dict:
    link = LINK.match(cells[1])
    if not link:
        raise ValueError(f"문서 링크를 읽을 수 없다: {cells[1]}")
    item = {
        "features": [] if cells[0] == "-" else [f.strip() for f in cells[0].split(",") if f.strip()],
        "file": link.group("file"),
        "title": link.group("title") or link.group("file"),
    }
    if len(cells) == 3:
        item["date"] = cells[2]
        return item
    counts = COUNTS.match(cells[3])
    item.update(
        who=cells[2],
        open=int(counts.group(1)) if counts else 0,
        done=int(counts.group(2)) if counts else 0,
        cancel=int(counts.group(3)) if counts else 0,
        updated=cells[4],
        date=cells[5],
    )
    return item


def esc(value: str) -> str:
    return html.escape(value, quote=True)


def groups(rows: list) -> list:
    """md 순서를 유지한 채 같은 기능 구분 행을 묶는다(md가 이미 기능 구분 순으로 정렬돼 있다)."""
    out = []
    for item in rows:
        name = ", ".join(item["features"]) or "기능 구분 없음"
        if not out or out[-1][0] != name:
            out.append((name, []))
        out[-1][1].append(item)
    return out


def doc_link(item: dict) -> str:
    return f'<a href="{esc(quote(item["file"]))}">{esc(item["title"])}</a>'


def row_attrs(item: dict) -> str:
    text = " ".join([item["title"], item.get("who", ""), *item["features"]]).lower()
    return f'data-features="{esc("|".join(item["features"]))}" data-text="{esc(text)}"'


def progress(item: dict) -> str:
    total = item["open"] + item["done"] + item["cancel"]
    bar = "".join(
        f'<i class="{kind}" style="flex:{item[kind]}"></i>' for kind in ("done", "cancel", "open") if item[kind]
    ) or '<i style="flex:1"></i>'
    label = f'미결 {item["open"]} · 완료 {item["done"]} · 취소 {item["cancel"]}'
    pending = f' <span class="dd">미결 {item["open"]}</span>' if item["open"] else ""
    return (
        f'<div class="prog" title="{label} (총 {total})"><div class="pbar">{bar}</div>'
        f'<span class="pn">{item["open"]} · {item["done"]} · {item["cancel"]}</span>{pending}</div>'
    )


def status_table(rows: list) -> str:
    body = "".join(
        f'<tr {row_attrs(item)}><td class="doc">{doc_link(item)}</td><td class="who">{esc(item["who"])}</td>'
        f'<td>{progress(item)}</td><td class="mono">{esc(item["updated"])}</td><td class="mono">{esc(item["date"])}</td></tr>'
        for item in rows
    )
    return (
        '<table class="st-t"><thead><tr><th>문서</th><th>회신 대상</th><th>미결 · 완료 · 취소</th>'
        f'<th class="mono">최종 갱신</th><th class="mono">작성일</th></tr></thead><tbody>{body}</tbody></table>'
    )


def ref_table(rows: list) -> str:
    body = "".join(
        f'<tr {row_attrs(item)}><td class="doc">{doc_link(item)}</td><td class="mono">{esc(item["date"])}</td></tr>'
        for item in rows
    )
    return f'<table class="ref-t"><thead><tr><th>문서</th><th class="mono">작성일</th></tr></thead><tbody>{body}</tbody></table>'


def section_html(key: str, section: dict) -> str:
    table = ref_table if key == "ref" else status_table
    note = f'<p class="dim note">{esc(section["note"])}</p>' if section["note"] else ""
    body = "".join(
        f'<section class="grp"><div class="mhd"><b>{esc(name)}</b><span class="sub">{len(rows)}건</span></div>{table(rows)}</section>'
        for name, rows in groups(section["rows"])
    )
    # 검색 중에는 세 구역을 함께 보여 주므로 구역 제목(.ph)이 필요하다. 탭 보기에서는 숨긴다.
    return (
        f'<div class="panel" data-key="{key}" role="tabpanel" hidden>'
        f'<h2 class="ph" hidden>{esc(section["label"])} <span class="cnt"></span></h2>{note}{body}'
        '<p class="empty" hidden>조건에 맞는 문서가 없다.</p></div>'
    )


def stat(title: str, value: str, sub: str, attr: str = "") -> str:
    return f'<div class="st"{attr}><span>{esc(title)}</span><b>{esc(value)}</b><span>{esc(sub)}</span></div>'


def render_html(md: str) -> str:
    sections = parse(md)
    empty = {"label": "", "count": 0, "note": "", "rows": []}
    opened = sections.get("open", {**empty, "label": "진행 중"})
    closed = sections.get("closed", {**empty, "label": "종결"})
    refs = sections.get("ref", {**empty, "label": "참고"})
    ordered = (("open", opened), ("closed", closed), ("ref", refs))

    pending = sum(r["open"] for r in opened["rows"])
    stats = "".join([
        stat("진행 중", f'{opened["count"]}건', f'완료 {sum(r["done"] for r in opened["rows"])}건 포함'),
        stat("미결 항목", f"{pending}건", "진행 중 문서 합"),
        stat("종결", f'{closed["count"]}건',
             f'완료 {sum(r["done"] for r in closed["rows"])} · 취소 {sum(r["cancel"] for r in closed["rows"])}'),
        stat("참고", f'{refs["count"]}건', "설명·분석·설계·점검표"),
        stat("동기화", "—", "정적 파일", ' id="syncstat"'),
    ])
    tabs = "".join(
        f'<button class="tab" role="tab" data-tab="{k}">{esc(s["label"])} <span class="cnt" data-total="{s["count"]}">{s["count"]}</span></button>'
        for k, s in ordered
    )
    features = sorted({f for _, s in ordered for r in s["rows"] for f in r["features"]})
    chips = '<button class="f" data-feature="">전체</button>' + "".join(
        f'<button class="f" data-feature="{esc(f)}">{esc(f)}</button>' for f in features
    )
    panels = "".join(section_html(k, s) for k, s in ordered)
    return fill(PAGE, {
        "TITLE": "TRB 4.0.0 · 90-assets 의사결정 현황",
        "SEARCH": "전체 검색 (진행 중·종결·참고)",
        "API": "api/assets",
        "SHELL": "assets",
        "NORES": "진행 중·종결·참고 어디에도 맞는 문서가 없다.",
        "SRC": "자동 생성 파일이다. 원본은 <code>00_90-assets_목록.md</code>이고, <code>assets_index.py</code> 실행 또는 서버(<code>assets_serve.py</code>)의 새로고침으로 갱신된다.",
        "STYLE": STYLE, "SCRIPT": SCRIPT,
        "STATS": stats, "TABS": tabs, "CHIPS": chips, "PANELS": panels,
    })


def fill(template: str, values: dict) -> str:
    """{{NAME}} 자리를 한 번에 채운다. 채워 넣은 값 안의 {{…}}는 다시 바꾸지 않는다."""
    return re.sub(r"\{\{([A-Z]+)\}\}", lambda m: values[m.group(1)], template)


# 스타일은 wbs-jira(`90-assets/wbs-jira/style.css`)의 색·카드·탭·칩을 따른다. 파일 하나로 열려야 하므로 안에 넣는다.
# STYLE·PAGE·SCRIPT는 구현 진행 현황(`plans_index_html.py`)도 함께 쓴다.
STYLE = """:root{
  --bg:#12141a;--card:#191c24;--card2:#1c2029;--line:#2a2f3a;--line2:#222733;
  --ink:#e7e9ee;--muted:#8b93a7;--dim:#646c80;--acc:#5eead4;
  --open:#fbbf24;--done:#4ade80;--cancel:#94a3b8;--hol:#fb7185;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Pretendard","Apple SD Gothic Neo",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:22px 20px 72px}
[hidden],.hidden{display:none!important}
.dim{color:var(--dim);font-size:12px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px}
.title{display:flex;align-items:center;gap:14px;flex:1;min-width:0}
.title h1{margin:0}
.sync{display:flex;align-items:center;gap:8px}
h1{font-size:19px;margin:0 0 4px;letter-spacing:-.3px}
.banner{background:#3a2530;border:1px solid #5b3040;color:#ffc9d4;border-radius:10px;padding:9px 13px;font-size:12.5px;margin:10px 0;white-space:pre-line}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}
.st{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px;min-width:104px}
.st b{display:block;font-size:19px;line-height:1.2;color:var(--acc)}
.st span{font-size:11px;color:var(--dim)}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--line);margin:8px 0 14px}
.tab{background:none;border:0;border-bottom:2px solid transparent;color:var(--muted);padding:9px 16px;font-size:13.5px;cursor:pointer}
.tab .cnt{font:11px ui-monospace,Menlo,monospace;color:var(--dim);margin-left:2px}
.tab[aria-selected="true"]{color:var(--ink);border-bottom-color:var(--acc);font-weight:600}
.tab:focus-visible{outline:2px solid var(--acc);outline-offset:-2px}
.ctl{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:14px}
.ctl .sep{width:1px;height:18px;background:var(--line);margin:0 6px}
button.f,a.f{background:#232833;border:1px solid var(--line);color:var(--muted);border-radius:99px;padding:5px 12px;font-size:12px;cursor:pointer;text-decoration:none;font-family:inherit}
button.f:hover,a.f:hover{color:var(--ink)}
button.f.on{background:var(--acc);border-color:var(--acc);color:#0b1210;font-weight:600}
button.f:disabled{opacity:.6;cursor:progress}
input[type=search]{background:#14171e;border:1px solid var(--line2);color:var(--ink);border-radius:8px;padding:6px 11px;font-family:inherit;font-size:13px;width:300px}
input[type=search]:focus{outline:none;border-color:var(--acc)}
.note{margin:0 2px 12px}
.grp{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px 8px;margin-bottom:14px}
.mhd{display:flex;align-items:baseline;gap:10px;margin:0 2px 8px}
.mhd b{font-size:14px}
.mhd .sub{font:11px ui-monospace,Menlo,monospace;color:var(--dim)}
table{width:100%;border-collapse:collapse;font-size:12.5px;table-layout:fixed}
th{text-align:left;color:var(--dim);font-weight:500;font-size:11px;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:7px 8px;border-bottom:1px solid var(--line2);vertical-align:middle}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover td{background:var(--card2)}
.st-t th:nth-child(2){width:20%}.st-t th:nth-child(3){width:210px}.st-t th:nth-child(4),.st-t th:nth-child(5),.ref-t th:nth-child(2){width:92px}
td.mono,th.mono{font:11px ui-monospace,Menlo,monospace;color:var(--muted);white-space:nowrap}
td.doc a{color:var(--ink);text-decoration:none}
td.doc a:hover{color:var(--acc);text-decoration:underline}
td.who{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prog{display:flex;align-items:center;gap:7px}
.pbar{display:flex;flex:1;gap:1px;height:7px;border-radius:99px;overflow:hidden;background:var(--line)}
.pbar i{display:block}
.pbar .open{background:var(--open)}.pbar .done{background:var(--done)}.pbar .cancel{background:var(--cancel)}
.pn{font:10.5px ui-monospace,Menlo,monospace;color:var(--muted);white-space:nowrap}
.dd{flex:none;padding:0 5px;border-radius:3px;font:600 9.5px/14px ui-monospace,Menlo,monospace;background:rgba(251,191,36,.18);color:#fcd34d;white-space:nowrap}
.empty{color:var(--dim);font-size:12px;padding:18px 4px}
.ph{display:flex;align-items:baseline;gap:6px;font-size:15px;margin:4px 2px 10px}
.searching .panel:not([hidden]) ~ .panel:not([hidden]) .ph{margin-top:22px;padding-top:14px;border-top:1px solid var(--line)}
.ph .cnt{font:12px ui-monospace,Menlo,monospace;color:var(--dim)}
.searching .panel .note{display:none}
.tab.zero{opacity:.45}
.src{margin-top:20px}
.src code{font:11px ui-monospace,Menlo,monospace}
@media (max-width:760px){.st-t th:nth-child(2),.st-t td:nth-child(2){display:none}.top,.title{flex-wrap:wrap}input[type=search]{width:100%}}
"""

# 목록 화면 뼈대. body의 data-api(동기화 API 상대 경로)·data-shell(대시보드 사이드바 id)을 SCRIPT가 읽는다.
PAGE = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{TITLE}}</title>
<style>
{{STYLE}}</style>
</head>
<body data-api="{{API}}" data-shell="{{SHELL}}">
<div class="wrap">
  <header class="top">
    <div class="title">
      <h1>{{TITLE}}</h1>
      <input type="search" id="q" placeholder="{{SEARCH}}">
    </div>
    <div class="sync">
      <span id="synced" class="dim"></span>
      <button id="refresh" class="f">⟳ 새로고침</button>
      <a id="serve" class="f hidden" href="http://127.0.0.1:8787/#{{SHELL}}" title="업무 대시보드(projects/work/work-dashboard/serve.py)에서 연다">서버에서 열기 ↗</a>
    </div>
  </header>

  <div id="banner" class="banner hidden"></div>
  <div class="stats">{{STATS}}</div>

  <nav class="tabs" role="tablist">{{TABS}}</nav>
  <div class="ctl" id="filters">{{CHIPS}}</div>

  <main id="main">{{PANELS}}<p class="empty" id="nores" hidden>{{NORES}}</p></main>
  <p class="dim src">{{SRC}}</p>
</div>
<script>
{{SCRIPT}}</script>
</body>
</html>
"""

# 탭 목록은 화면의 .tab에서 읽고, 첫 탭이 기본이다.
SCRIPT = """(() => {
  const TABS = [...document.querySelectorAll(".tab")].map((t) => t.dataset.tab);
  const { api: API, shell: SHELL } = document.body.dataset;
  const served = location.protocol === "http:" || location.protocol === "https:";
  const $ = (id) => document.getElementById(id);
  const panels = [...document.querySelectorAll(".panel")];
  const tabs = [...document.querySelectorAll(".tab")];
  const chips = [...document.querySelectorAll("#filters button.f")];
  const features = new Set(chips.map((c) => c.dataset.feature));

  // 해시 상태: #tab=open&f=외부%20결재&q=황균 (wbs-jira와 같은 방식). 새로고침 뒤에도 보던 화면을 유지한다.
  const parse = () => {
    const p = new URLSearchParams(location.hash.slice(1));
    const f = p.get("f") || "";
    return { tab: TABS.includes(p.get("tab")) ? p.get("tab") : TABS[0], f: features.has(f) ? f : "", q: p.get("q") || "" };
  };
  const state = parse();
  const toHash = () => {
    const p = new URLSearchParams({ tab: state.tab });
    if (state.f) p.set("f", state.f);
    if (state.q) p.set("q", state.q);
    return "#" + p.toString();
  };

  // 검색어가 있으면 탭과 상관없이 진행 중·종결·참고를 모두 뒤져 구역별로 함께 보여 준다.
  // 탭 숫자는 구역별 일치 건수로 바뀌고, 탭을 누르면 그 구역으로 스크롤한다. 검색어가 없으면 탭 하나만 보여 준다.
  const searching = () => state.q.trim() !== "";
  const render = () => {
    const words = state.q.trim().toLowerCase().split(/\\s+/).filter(Boolean);
    const all = words.length > 0;
    $("main").classList.toggle("searching", all);
    chips.forEach((c) => c.classList.toggle("on", c.dataset.feature === state.f));
    let total = 0;
    panels.forEach((panel) => {
      let shown = 0;
      panel.querySelectorAll(".grp").forEach((grp) => {
        let rows = 0;
        grp.querySelectorAll("tbody tr").forEach((tr) => {
          const ok = (!state.f || tr.dataset.features.split("|").includes(state.f))
            && words.every((w) => tr.dataset.text.includes(w));
          tr.hidden = !ok;
          rows += ok;
        });
        grp.hidden = rows === 0;
        grp.querySelector(".mhd .sub").textContent = rows + "건";
        shown += rows;
      });
      total += shown;
      const key = panel.dataset.key;
      panel.hidden = all ? shown === 0 : key !== state.tab;
      panel.querySelector(".ph").hidden = !all;
      panel.querySelector(".ph .cnt").textContent = shown + "건";
      panel.querySelector(".empty").hidden = all || shown > 0;
      const tab = tabs.find((t) => t.dataset.tab === key);
      const cnt = tab.querySelector(".cnt");
      cnt.textContent = all ? shown : cnt.dataset.total;
      tab.classList.toggle("zero", all && shown === 0);
      tab.setAttribute("aria-selected", String(!all && key === state.tab));
    });
    $("nores").hidden = !all || total > 0;
    $("serve").href = "http://127.0.0.1:8787/#" + SHELL + "/" + toHash().slice(1);
    history.replaceState(null, "", location.pathname + location.search + toHash());
  };

  const showSync = (res) => {
    const time = res.syncedAt ? res.syncedAt.slice(11, 16) : "—";
    $("synced").textContent = res.syncedAt ? "마지막 동기화 " + time : "";
    $("syncstat").innerHTML = "<span>동기화</span><b>" + time + "</b><span>" + (res.ok ? "최신" : "실패") + "</span>";
    const lines = [];
    if (res.error) lines.push("동기화 오류: " + res.error);
    (res.warnings || []).forEach((w) => lines.push("경고: " + w));
    $("banner").textContent = lines.join("\\n");
    $("banner").classList.toggle("hidden", lines.length === 0);
  };
  const fail = (err) => showSync({ ok: false, error: "서버 응답 실패: " + err.message });

  tabs.forEach((t) => t.addEventListener("click", () => {
    state.tab = t.dataset.tab;
    render();
    const panel = panels.find((p) => p.dataset.key === state.tab);
    if (searching() && !panel.hidden) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  chips.forEach((c) => c.addEventListener("click", () => { state.f = c.dataset.feature; render(); }));
  $("q").value = state.q;
  $("q").addEventListener("input", () => { state.q = $("q").value; render(); });
  window.addEventListener("hashchange", () => { Object.assign(state, parse()); $("q").value = state.q; render(); });

  if (served) {
    $("refresh").addEventListener("click", async () => {
      $("refresh").disabled = true;
      $("refresh").textContent = "동기화 중…";
      try {
        const res = await fetch(API + "?refresh=1").then((r) => r.json());
        if (res.ok) { location.reload(); return; }
        showSync(res);
      } catch (err) {
        fail(err);
      }
      $("refresh").disabled = false;
      $("refresh").textContent = "⟳ 새로고침";
    });
    fetch(API).then((r) => r.json()).then(showSync).catch(fail);
  } else {
    $("refresh").classList.add("hidden");
    $("serve").classList.remove("hidden");
    $("synced").textContent = "정적 파일 · 서버에서 열면 새로고침 가능";
  }
  render();
})();
"""


def sync(md: str, check: bool, folder: Path) -> bool:
    """HTML이 md와 일치하면 True. check가 아니면 다르면 다시 쓴다."""
    content = render_html(md)
    output = folder / HTML_NAME
    current = output.read_text(encoding="utf-8") if output.exists() else ""
    if current == content:
        return True
    if not check:
        output.write_text(content, encoding="utf-8")
    return False
