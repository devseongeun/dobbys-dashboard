"""주간 보고 초안을 읽어 단일 파일 뷰어를 다시 만든다.

    python3 -m tabs.weekly.generate_viewer --out <html> --source <dir> [--source <dir> ...]

- --source 로 받은 초안 폴더(여러 개)를 함께 읽어 --out HTML 하나로 굽는다.
  파일을 고르거나 붙여넣는 단계는 없다.
- 왼쪽 사이드 패널에 회차가 쌓이고, 오른쪽은 'AI 브리핑'과 '초안 원문' 탭으로 나뉜다.
- AI 브리핑은 초안 문장을 그대로 뽑아 배치만 한다. 새로 쓴 문장은 넣지 않는다.
- 사이드 패널 제목은 초안 '이번 주 핵심 업무' 1번과 2번을 그대로 쓴다.
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path

from .markdown_renderer import inline, outline, render_markdown
from .report_parser import Node, Report, load_reports, norm
from .viewer_cite import CSS as CITE_CSS, JS as CITE_JS, cite_button
from .viewer_guide import CSS as GUIDE_CSS, JS as GUIDE_JS, guide_dialog, open_button as guide_button
from .viewer_html import esc, mark_inline, nodes_html
from .viewer_refresh import CSS as REFRESH_CSS, JS as REFRESH_JS, button_html as refresh_button_html
from .viewer_review import CSS as REVIEW_CSS, JS as REVIEW_JS, flags_section, review_button


BASE_CSS = '''
/* Apple 디자인 가이드 토큰 — 흰 캔버스/파치먼트, 단일 Action Blue, 크롬에 그림자 없음 */
:root{
  color-scheme:light;
  --bg:#FFFFFF; --surface:#FFFFFF; --surface-2:#F5F5F7; --raised:#FAFAFC;
  --text:#1D1D1F; --muted:#333333; --faint:#7A7A7A;
  --border:#E0E0E0; --border-soft:#F0F0F0; --ink:#1D1D1F;
  --accent:#0066CC; --accent-soft:rgba(0,102,204,.08); --accent-ink:#0066CC;
  --focus:#0071E3; --on-accent:#FFFFFF;
  --need:#0066CC; --need-bg:#F5F5F7;
  --na:#7A7A7A; --na-bg:#FAFAFC;
  --unver:#0066CC;
  --nav-bg:rgba(245,245,247,.8);
  --font-display:-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,"Inter","Apple SD Gothic Neo","Noto Sans KR",sans-serif;
  --font-text:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,"Inter","Apple SD Gothic Neo","Noto Sans KR",sans-serif;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,monospace;
  --r-sm:8px; --r-md:11px; --r-lg:18px; --r-pill:9999px;
}
:root[data-theme="dark"]{
  color-scheme:dark;
  --bg:#000000; --surface:#1D1D1F; --surface-2:#272729; --raised:#2A2A2C;
  --text:#F5F5F7; --muted:#CCCCCC; --faint:#86868B;
  --border:#3A3A3C; --border-soft:#2A2A2C; --ink:#F5F5F7;
  --accent:#2997FF; --accent-soft:rgba(41,151,255,.14); --accent-ink:#2997FF;
  --focus:#2997FF; --on-accent:#FFFFFF;
  --need:#2997FF; --need-bg:#252527;
  --na:#86868B; --na-bg:#252527;
  --unver:#2997FF;
  --nav-bg:rgba(29,29,31,.8);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);line-height:1.47;letter-spacing:-.022em;
font-family:var(--font-text);font-size:17px;font-weight:400;-webkit-font-smoothing:antialiased}
a{color:inherit}
code,.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
a:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--focus);outline-offset:2px}

/* 상단바 — frosted sub-nav */
.top{height:52px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 22px;
border-bottom:1px solid var(--border);background:var(--nav-bg);
-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);
position:sticky;top:0;z-index:9}
.brand{font-family:var(--font-display);font-weight:600;text-decoration:none;font-size:21px;letter-spacing:-.011em;
display:inline-flex;align-items:center;gap:10px;color:var(--text)}
.brand::before{content:"";width:10px;height:10px;border-radius:var(--r-pill);background:var(--accent)}
.top-note{font-size:12px;color:var(--faint);letter-spacing:-.01em}

/* 제목 */
.page{max-width:980px;margin:auto;padding:56px 24px 96px}
.eyebrow{font-size:14px;color:var(--faint);letter-spacing:-.016em;text-transform:none;font-weight:400;
display:flex;align-items:center;gap:8px;flex-wrap:wrap}
h1{font-family:var(--font-display);font-size:40px;line-height:1.1;letter-spacing:-.015em;margin:12px 0 0;
font-weight:600;text-wrap:balance}
.lead{font-size:21px;font-weight:400;line-height:1.38;letter-spacing:-.011em;color:var(--muted);
margin:12px 0 0;max-width:60ch}
.tag{font-size:12px;padding:4px 11px;border-radius:var(--r-pill);background:var(--raised);color:var(--muted);
white-space:nowrap;letter-spacing:-.01em;text-transform:none;font-weight:400;border:1px solid var(--border)}
.tag.warn{background:var(--accent-soft);color:var(--accent);border-color:transparent}

/* 탭 — pill CTA 문법 */
.tabs{display:inline-flex;gap:8px;margin:28px 0 24px}
.tabs button{border:1px solid var(--accent);background:transparent;padding:9px 20px;color:var(--accent);
cursor:pointer;font:inherit;font-size:14px;font-weight:400;letter-spacing:-.016em;border-radius:var(--r-pill)}
.tabs button+button{border-left:1px solid var(--accent)}
.tabs button.active{background:var(--accent);color:var(--on-accent)}
.tabs button:active{transform:scale(.95)}
.view{display:none}.view.active{display:block}

/* 안내 배너 */
.notice{display:flex;gap:12px;align-items:baseline;padding:16px 20px;background:var(--surface-2);
border:1px solid var(--border);border-radius:var(--r-lg);color:var(--muted);
font-size:14px;letter-spacing:-.016em;margin-bottom:24px}
.label{font-size:12px;font-weight:400;background:var(--ink);color:var(--surface);border-radius:var(--r-sm);
padding:5px 10px;white-space:nowrap;letter-spacing:-.01em}

/* 메타 */
.meta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0;
border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden;margin-bottom:32px;background:var(--surface)}
.meta-grid div{padding:16px 20px;border-left:1px solid var(--border)}
.meta-grid div:first-child{border-left:0}
.meta-grid dt{font-size:12px;letter-spacing:-.01em;text-transform:none;color:var(--faint);
margin-bottom:6px;font-weight:400}
.meta-grid dd{margin:0;font-size:17px;letter-spacing:-.022em;overflow-wrap:anywhere}

/* 섹션 제목 */
.blk{margin:0 0 40px;scroll-margin-top:72px}
.blk>h2{font-family:var(--font-display);font-size:21px;letter-spacing:-.011em;text-transform:none;
color:var(--text);font-weight:600;margin:0 0 14px;display:flex;align-items:center;gap:12px}
.blk>h2::before{content:none}
.blk>h2::after{content:"";flex:1;height:1px;background:var(--border-soft)}

/* 핵심 업무 */
.panel{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:4px 24px}
.core{display:grid;grid-template-columns:32px minmax(0,1fr);gap:16px;padding:18px 0;
border-top:1px solid var(--border-soft);text-decoration:none;align-items:start}
.core:first-of-type{border-top:0}
a.core[href]{cursor:pointer}
a.core[href]:hover b{color:var(--accent)}
a.core[href]:hover .num{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
.num{width:30px;height:24px;display:grid;place-items:center;border-radius:var(--r-pill);background:var(--surface-2);
border:1px solid var(--border);font-size:12px;font-weight:400;font-family:var(--mono);color:var(--muted)}
.core b{font-size:17px;font-weight:600;line-height:1.47;letter-spacing:-.022em}
.insight{font-size:14px;color:var(--muted);letter-spacing:-.016em}

/* 미해결 */
.flags{border:1px solid var(--border);background:var(--surface-2);border-radius:var(--r-lg);padding:20px 22px}
.flags .cnt{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.flags .cnt span{font-size:12px;font-weight:400;background:var(--ink);color:var(--surface);
padding:5px 11px;border-radius:var(--r-sm);letter-spacing:-.01em}
.flags ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px}
.flags li{display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;font-size:17px;letter-spacing:-.022em;
align-items:baseline;overflow-wrap:anywhere}
.flags .from{font-size:12px;color:var(--faint);white-space:nowrap;font-weight:400;text-transform:none;
letter-spacing:-.01em}

/* 업무별 상세 */
.task{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:24px;
margin-bottom:16px;scroll-margin-top:72px}
.task:target{border-color:var(--focus);border-width:2px;padding:23px}
.task h3{margin:0 0 14px;font-family:var(--font-display);font-size:21px;font-weight:600;letter-spacing:-.011em;
display:grid;grid-template-columns:30px minmax(0,1fr);gap:14px;align-items:start;line-height:1.28}
.task h3 .n{width:28px;height:24px;display:grid;place-items:center;border-radius:var(--r-pill);
background:var(--accent);color:var(--on-accent);font-size:12px;font-weight:400;font-family:var(--mono)}
.row{display:grid;grid-template-columns:96px minmax(0,1fr);gap:16px;padding:12px 0;border-top:1px solid var(--border-soft)}
.row dt{font-size:12px;color:var(--faint);padding-top:5px;font-weight:400;letter-spacing:-.01em;text-transform:none}
.row.next dt{color:var(--accent)}
.row dd{margin:0}

/* 목록 */
ul.notes{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px}
ul.notes li{display:grid;grid-template-columns:8px minmax(0,1fr);gap:12px;font-size:17px;line-height:1.47;
letter-spacing:-.022em;overflow-wrap:anywhere}
ul.notes li::before{content:"";width:5px;height:5px;border-radius:var(--r-pill);background:var(--faint);margin-top:10px}
ul.notes ul{grid-column:2;margin-top:8px}
ul.notes.accent li::before{background:var(--accent)}
ul.notes.warn li::before{background:var(--na)}
.row ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}
.row li{display:grid;grid-template-columns:8px minmax(0,1fr);gap:12px;font-size:17px;line-height:1.47;
letter-spacing:-.022em;overflow-wrap:anywhere}
.row li::before{content:"";width:5px;height:5px;border-radius:var(--r-pill);background:var(--faint);margin-top:10px}
.row.next li::before{background:var(--accent)}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:32px}
h4.subh{margin:20px 0 8px;font-size:17px;font-weight:600;letter-spacing:-.022em;color:var(--text)}
p.para{margin:0 0 10px;font-size:17px;line-height:1.47;letter-spacing:-.022em}

/* 지표 */
.stat{border:1px solid var(--border);background:var(--surface);border-radius:var(--r-lg);padding:24px;
margin-top:16px}
.stat .big{font-family:var(--font-display);font-size:56px;font-weight:600;line-height:1.07;letter-spacing:-.005em;
font-variant-numeric:tabular-nums}
.stat .cap{font-size:14px;color:var(--faint);margin-left:10px;text-transform:none;letter-spacing:-.016em;font-weight:400}
.bar{display:flex;height:10px;border:0;border-radius:var(--r-pill);overflow:hidden;
background:var(--surface-2);margin:20px 0}
.bar i{display:block;background:var(--accent);border-right:1px solid var(--surface)}
.bar i:last-child{border-right:0}
.legend{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px 24px}
.legend div{display:flex;justify-content:space-between;gap:10px;font-size:14px;color:var(--faint);
border-bottom:1px solid var(--border-soft);padding-bottom:6px;letter-spacing:-.016em}
.legend div.on{color:var(--text)}
.legend .v{font-variant-numeric:tabular-nums}
.note{font-size:14px;color:var(--muted);margin:16px 0 0;line-height:1.47;letter-spacing:-.016em}

/* 원문 블록 */
pre.raw{margin:0;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--r-lg);padding:20px;
overflow-x:auto;white-space:pre-wrap;font-family:var(--mono);font-size:13px;
line-height:1.7;color:var(--muted)}
.copy{border:0;background:var(--accent);color:var(--on-accent);border-radius:var(--r-pill);
padding:9px 20px;font:inherit;font-size:14px;font-weight:400;letter-spacing:-.016em;cursor:pointer;margin-bottom:14px}
.copy:active{transform:scale(.95)}
details.src{border:1px solid var(--border);background:var(--surface);border-radius:var(--r-lg);padding:16px 20px}
details.src summary{cursor:pointer;font-size:17px;color:var(--accent);font-weight:400;letter-spacing:-.022em}
details.src .body{margin-top:16px;border-top:1px solid var(--border-soft);padding-top:16px}

/* 마커 */
.mk{font-size:12px;padding:3px 10px;border-radius:var(--r-pill);font-weight:400;white-space:nowrap;
letter-spacing:-.01em}
.mk.need{background:var(--accent);color:var(--on-accent)}
.mk.na{background:var(--na-bg);color:var(--na);border:1px solid var(--border)}
.mk.unver{background:transparent;color:var(--unver);border:1px solid var(--unver)}
code{background:var(--surface-2);border-radius:5px;padding:2px 6px;font-size:13px;color:var(--muted)}
mark{background:var(--accent-soft);color:var(--text);border-radius:5px;padding:0 3px}

/* 원문 탭 */
.document-shell{display:grid;grid-template-columns:200px minmax(0,760px);gap:48px;justify-content:center}
.toc{position:sticky;top:76px;align-self:start;border-left:1px solid var(--border);padding-left:16px}
.toc b{display:block;font-size:12px;letter-spacing:-.01em;text-transform:none;color:var(--faint);
margin-bottom:10px;font-weight:400}
.toc a{display:block;text-decoration:none;color:var(--muted);font-size:14px;padding:6px 0;cursor:pointer;
letter-spacing:-.016em}
.toc a:hover{color:var(--accent)}
.doc{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:56px 64px}
.doc h1,.doc h2,.doc h3,.doc h4{scroll-margin-top:72px;font-family:var(--font-display);font-weight:600;
letter-spacing:-.015em;word-break:keep-all;text-wrap:pretty}
.doc h1{font-size:40px;line-height:1.1;margin:0 0 28px}
.doc h2{font-size:28px;line-height:1.2;margin:44px 0 14px;padding-bottom:10px;border-bottom:1px solid var(--border-soft)}
.doc h3{font-size:21px;line-height:1.28;margin:30px 0 10px}
.doc p,.md-list{font-size:17px;letter-spacing:-.022em}
.doc p{margin:8px 0;line-height:1.47}
.blank{height:8px}
.md-list{display:grid;grid-template-columns:24px minmax(0,1fr);gap:6px;margin:6px 0;line-height:1.47}
.marker{text-align:right;color:var(--accent)}
.depth-1{margin-left:20px}.depth-2{margin-left:40px}.depth-3{margin-left:60px}.depth-4{margin-left:80px}
.doc hr{border:0;border-top:1px solid var(--border);margin:32px 0}

@media(max-width:820px){.page{padding:32px 16px 72px}
.cols,.document-shell{grid-template-columns:1fr}
.toc{display:none}.doc{padding:28px 22px}.top-note{display:none}
h1,.doc h1{font-size:34px}.stat .big{font-size:40px}
.row{grid-template-columns:1fr;gap:6px}}
@media print{.top,.tabs,.copy,.toc{display:none}.view{display:block!important}
body{background:#fff}.page{padding:0;max-width:none}.document-shell{grid-template-columns:1fr}}
'''


def briefing_html(report: Report) -> str:
    parts: list[str] = []

    def cite(section: str, extra: str = '') -> str:
        """제목 옆 근거 아이콘. 이 블록을 어느 초안 파일 어느 섹션에서 뽑았는지 밝힌다."""
        return cite_button(report.source.name, section, extra)

    parts.append(
        '<div class="notice"><span class="label">AI 브리핑</span>'
        '<span>초안에서 항목을 그대로 뽑아 배치한 화면입니다. 새로 지어낸 문장은 없습니다. '
        '문장 전체와 맥락은 <b>초안 원문</b> 탭에서 확인하세요.</span>'
        f'{guide_button()}</div>'
    )

    meta = []
    if report.period_range:
        meta.append(f'<div><dt>조회 기간</dt><dd>{esc(report.period_range)}</dd></div>')
    if report.period_next:
        meta.append(f'<div><dt>차주 범위</dt><dd>{esc(report.period_next)}</dd></div>')
    if report.period_version:
        meta.append(f'<div><dt>버전</dt><dd>{esc(report.period_version)}</dd></div>')
    if report.period_scope:
        meta.append(f'<div><dt>실제 확인 범위</dt><dd>{len(report.period_scope)}개 소스</dd></div>')
    if meta:
        parts.append(f'<dl class="meta-grid">{"".join(meta)}</dl>')
    if report.period_scope:
        scope = nodes_html([Node(item) for item in report.period_scope])
        parts.append(f'<section class="blk"><details class="src"><summary>실제 확인 범위 '
                     f'{len(report.period_scope)}건</summary>'
                     f'<div class="body">{cite("보고 기간")}{scope}</div></details></section>')

    if report.core:
        rows = ''
        for index, item in enumerate(report.core, 1):
            # 대응하는 업무별 상세 카드가 있으면 눌러서 이동할 수 있게 한다.
            href = f' href="#task-{index}"' if index <= len(report.tasks) else ''
            rows += (f'<a class="core"{href}><span class="num">{index}</span>'
                     f'<b>{mark_inline(item)}</b></a>')
        parts.append(f'<section class="blk"><h2>{esc(report.core_origin)} · 초안 문장 그대로'
                     f'{cite(report.core_origin)}</h2>'
                     f'<div class="panel">{rows}</div></section>')

    if report.flags:
        parts.append(flags_section(report, cite('업무별 상세 내용 · 이슈 및 기타 사항 · 정량 지표')))

    if report.tasks:
        cards = []
        for index, task in enumerate(report.tasks, 1):
            rows = ''
            for row in task['rows']:
                is_next = norm(row['label']) == norm('다음 단계')
                body = nodes_html([Node(item) for item in row['items']], 'accent' if is_next else '')
                rows += (f'<div class="row{" next" if is_next else ""}">'
                         f'<dt>{esc(row["label"] or "내용")}</dt><dd>{body}</dd></div>')
            cards.append(f'<article class="task" id="task-{index}">'
                         f'<h3><span class="n">{index}</span><span>{mark_inline(task["title"])}'
                         f'{cite("업무별 상세 내용", task["title"])}</span></h3>{rows}</article>')
        parts.append(f'<section class="blk"><h2>업무별 상세 내용{cite("업무별 상세 내용")}</h2>'
                     f'{"".join(cards)}</section>')

    if report.metrics or report.tally:
        block = nodes_html(report.metrics)
        if report.tally:
            tally = report.tally
            bars = ''.join(
                f'<i style="flex:{part["value"]}" title="{esc(part["label"])} {part["value"]}건"></i>'
                for part in tally['parts'] if part['value']
            ) or '<i style="flex:1;background:var(--border)"></i>'
            legend = ''.join(
                f'<div class="{"on" if part["value"] else ""}"><span>{esc(part["label"])}</span>'
                f'<span>{part["value"]}건</span></div>' for part in tally['parts']
            )
            note = f'<p class="note">{inline(tally["note"])}</p>' if tally['note'] else ''
            block += (f'<div class="stat"><span class="big">{tally["total"]}</span>'
                      f'<span class="cap">건 · {esc(tally["name"])}</span>'
                      f'<div class="bar">{bars}</div><div class="legend">{legend}</div>{note}</div>')
        parts.append(f'<section class="blk"><h2>정량 지표{cite("정량 지표")}</h2>{block}</section>')

    columns = ''
    if report.this_week:
        columns += (f'<section class="blk"><h2>금주 주요 사항{cite("금주 주요 사항")}</h2>'
                    f'{nodes_html(report.this_week)}</section>')
    if report.next_week:
        columns += (f'<section class="blk"><h2>차주 주요 사항{cite("차주 주요 사항")}</h2>'
                    f'{nodes_html(report.next_week, "accent")}</section>')
    if columns:
        parts.append(f'<div class="cols">{columns}</div>')
    if report.issues:
        parts.append(f'<section class="blk"><h2>이슈 및 기타 사항{cite("이슈 및 기타 사항")}</h2>'
                     f'{nodes_html(report.issues, "warn")}</section>')

    if report.ppt:
        parts.append(f'<section class="blk"><h2>PPT 붙여넣기용{cite("PPT 붙여넣기용")}</h2>'
                     '<button class="copy" data-copy="ppt">원문 그대로 복사</button>'
                     f'<pre class="raw" id="ppt-block">{esc(report.ppt)}</pre></section>')

    if report.sources:
        parts.append('<section class="blk"><details class="src"><summary>출처 및 검증</summary>'
                     f'<div class="body">{cite("출처 및 검증")}{nodes_html(report.sources)}</div>'
                     '</details></section>')

    if report.body:
        parts.append(f'<section class="blk"><h2>초안 본문{cite("초안 본문")}</h2>'
                     f'{nodes_html(report.body)}</section>')

    if not report.core and not report.tasks and not report.body:
        parts.append('<section class="blk"><div class="panel guide-empty">이 초안은 표준 섹션 구성이 아닙니다. '
                     '초안 원문 탭에서 전체 내용을 확인하세요.'
                     f'{guide_button("표준 섹션 구성 보기")}</div></section>')
    return ''.join(parts)


# ---------------------------------------------------------------- 단일 파일 뷰어

VIEWER_CSS = '''
html{overflow-y:scroll}
.app{display:grid;grid-template-columns:320px minmax(0,1fr);align-items:start}
.rail{position:sticky;top:52px;height:calc(100vh - 52px);overflow-y:auto;
border-right:1px solid var(--border);background:var(--surface-2);padding:8px 0 48px}
:root[data-theme="dark"] .rail{background:var(--surface)}
.rail-head{display:flex;justify-content:space-between;padding:12px 20px;color:var(--faint);
font-size:12px;letter-spacing:-.01em;text-transform:none;font-weight:400}
.rail .month{padding:18px 20px 8px;margin:0;border-top:1px solid var(--border);color:var(--faint);
font-size:12px;font-weight:600;letter-spacing:-.01em}
.rail .month:first-of-type{border-top:0}
.wk{position:relative;display:block;width:100%;text-align:left;border:0;background:none;
padding:14px 18px 16px 22px;cursor:pointer;font:inherit;color:inherit;
border-left:3px solid transparent}
.wk:hover{background:var(--accent-soft)}
.wk[aria-current="true"]{background:var(--bg);border-left-color:var(--accent)}
.wk .date{font-size:12px;color:var(--faint);font-family:var(--mono);letter-spacing:-.01em}
.wk[aria-current="true"] .date{color:var(--accent-ink)}
.wk .name{display:block;font-size:14px;line-height:1.29;margin-top:5px;font-weight:600;
letter-spacing:-.016em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.wk .sub{display:block;font-size:12px;color:var(--muted);line-height:1.35;margin-top:4px;
display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
.wk .badges{display:flex;gap:6px;margin-top:10px;font-size:11px;flex-wrap:wrap;
text-transform:none;letter-spacing:-.01em;font-weight:400}
.wk .badges span{background:var(--raised);color:var(--muted);padding:3px 9px;border-radius:var(--r-pill);
border:1px solid var(--border)}
.wk .badges .warn{background:var(--accent-soft);color:var(--accent);border-color:transparent}
.rail .empty{padding:20px;color:var(--faint);font-size:14px}
.viewer-pane{padding:40px 40px 96px;max-width:980px}
.search{position:relative;width:min(260px,32vw)}
.search input{width:100%;padding:8px 30px 8px 16px;font:inherit;font-size:14px;letter-spacing:-.016em;
color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:var(--r-pill)}
.search input:focus{outline:2px solid var(--focus);outline-offset:0;border-color:transparent}
.search .clear{position:absolute;right:6px;top:50%;transform:translateY(-50%);border:0;background:none;
color:var(--faint);font-size:15px;padding:4px 6px;cursor:pointer;line-height:1}
.top .tools{display:flex;align-items:center;gap:12px}
.iconbtn{border:1px solid var(--border);background:var(--raised);color:var(--muted);border-radius:var(--r-pill);
padding:7px 13px;font:inherit;font-size:14px;font-weight:400;letter-spacing:-.016em;cursor:pointer}
.iconbtn:active{transform:scale(.95)}
.hint{font-size:12px;color:var(--faint);letter-spacing:-.01em}
@media(max-width:820px){.app{grid-template-columns:1fr}
.rail{position:static;height:auto;max-height:220px;border-right:0;border-bottom:1px solid var(--border)}
.viewer-pane{padding:24px 18px 72px}.search{width:150px}.hint{display:none}}
'''


def viewer_payload(reports: list[Report]) -> list[dict]:
    payload = []
    for report in reports:
        payload.append({
            'slug': report.slug,
            'date': report.date,
            'month': report.month,
            'period': report.period,
            'title': report.title,
            'subtitle': report.subtitle,
            'origin': report.core_origin or '원문',
            'approval': report.approval,
            'file': report.source.name,
            'flags': len(report.flags),
            'tasks': len(report.tasks),
            'search': f'{report.title} {report.subtitle} {report.raw}'.lower(),
            'briefing': briefing_html(report),
            'document': (f'<div class="document-shell"><nav class="toc"><b>초안 목차</b>'
                         + ''.join(f'<a href="#{item["anchor"]}">{esc(item["title"])}</a>'
                                   for item in outline(report.raw))
                         + f'</nav><article class="doc">{render_markdown(report.raw)}</article></div>'),
            'raw': report.raw,
        })
    return payload


def viewer_page(reports: list[Report]) -> str:
    data = json.dumps(viewer_payload(reports), ensure_ascii=False).replace('</', '<\\/')
    stamp = datetime.now().strftime('%Y-%m-%d %H:%M')
    review_markup = json.dumps(review_button(), ensure_ascii=False).replace('</', '<\\/')
    return f'''<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>주간 보고 뷰어</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&family=Noto+Sans+KR:wght@400;500;700&display=swap">
<style>{BASE_CSS}{VIEWER_CSS}{REVIEW_CSS}{CITE_CSS}{REFRESH_CSS}{GUIDE_CSS}</style></head><body>
<header class="top">
  <a class="brand" href="#">주간 보고 뷰어</a>
  <div class="tools">
    <span class="hint">초안 {len(reports)}건 · {stamp} 생성</span>
    <div class="search"><input id="q" type="search" placeholder="전체 회차 검색" autocomplete="off">
    <button class="clear" id="qclear" hidden aria-label="검색 지우기">×</button></div>
    {refresh_button_html()}
    {guide_button()}
    <button class="iconbtn" id="themeBtn" title="테마 전환">◐</button>
  </div>
</header>
<div class="app">
  <nav class="rail" id="rail" aria-label="회차 목록"></nav>
  <main class="viewer-pane" id="pane"></main>
</div>
{guide_dialog()}
<script type="application/json" id="report-data">{data}</script>
<script>
(function(){{
  "use strict";
  var DATA = JSON.parse(document.getElementById('report-data').textContent);
  var rail = document.getElementById('rail');
  var pane = document.getElementById('pane');
  var state = {{ slug: null, view: 'briefing', q: '' }};
  var railSlug = null;
  var REVIEW_BUTTON = {review_markup};

  // 회차 선택은 세션 범위로만 살린다(오리진별 localStorage 혼선 방지).
  function storedSlug(){{
    try {{ return sessionStorage.getItem('weekly-viewer:slug'); }} catch (error) {{ return null; }}
  }}
  function initialSlug(){{
    var saved = storedSlug();
    if (saved && DATA.some(function(item){{ return item.slug === saved; }})) return saved;
    return DATA.length ? DATA[0].slug : null;
  }}
  function setSlug(slug){{
    state.slug = slug;
    if (!slug) return;
    try {{ sessionStorage.setItem('weekly-viewer:slug', slug); }} catch (error) {{}}
  }}
  setSlug(initialSlug());

  function esc(value){{
    return String(value == null ? '' : value)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }}
  function visible(){{
    if (!state.q) return DATA;
    var needle = state.q.toLowerCase();
    return DATA.filter(function(item){{ return item.search.indexOf(needle) > -1; }});
  }}
  function current(){{
    var rows = DATA.filter(function(item){{ return item.slug === state.slug; }});
    return rows[0] || null;
  }}

  function renderRail(){{
    var rows = visible();
    if (!rows.length) {{ rail.innerHTML = '<p class="empty">일치하는 회차가 없습니다.</p>'; return; }}
    var html = '<div class="rail-head"><span>회차</span><span>' + rows.length + '</span></div>';
    var month = null;
    rows.forEach(function(item){{
      if (item.month !== month) {{ month = item.month; html += '<div class="month">' + esc(month) + '</div>'; }}
      var done = reviewDone(item.slug);
      html += '<button class="wk" data-slug="' + esc(item.slug) + '" aria-current="' + (item.slug === state.slug) + '">'
        + '<span class="date">' + esc(item.date)
        + (item.period === item.date.replace(/-/g, '.') ? '' : ' · ' + esc(item.period)) + '</span>'
        + '<span class="name">' + esc(item.title) + '</span>'
        + (item.subtitle ? '<span class="sub">' + esc(item.subtitle) + '</span>' : '')
        + '<span class="badges"><span>' + esc(item.origin) + '</span>'
        + (done ? '<span class="ok">확인 완료</span>'
                : (item.flags ? '<span class="warn">미해결 ' + item.flags + '</span>' : ''))
        + '</span></button>';
    }});
    rail.innerHTML = html;
    // 회차가 실제로 바뀔 때만 스크롤한다. 모바일 폭에서 rail 이 static 이라
    // 확인 완료 토글마다 스크롤하면 화면이 맨 위로 끌려 올라간다.
    var active = rail.querySelector('[aria-current="true"]');
    if (active && railSlug !== state.slug) active.scrollIntoView({{ block: 'nearest' }});
    railSlug = state.slug;
  }}

  function renderPane(){{
    var item = current();
    if (!item) {{ pane.innerHTML = '<p class="lead">왼쪽에서 회차를 선택하세요.</p>'; return; }}
    pane.innerHTML =
      '<div class="detail-title"><div class="eyebrow">' + esc(item.period)
      + (item.approval ? ' <span class="tag">' + esc(item.approval) + '</span>' : '')
      + ' <span class="tag">' + esc(item.file) + '</span></div>'
      + '<h1>' + esc(item.title) + '</h1>'
      + (item.subtitle ? '<p class="lead">' + esc(item.subtitle) + '</p>' : '') + '</div>'
      + '<div class="tabs">'
      + '<button id="briefing-tab" data-view="briefing" class="' + (state.view === 'briefing' ? 'active' : '') + '">AI 브리핑</button>'
      + '<button id="document-tab" data-view="document" class="' + (state.view === 'document' ? 'active' : '') + '">초안 원문</button>'
      + REVIEW_BUTTON
      + '</div>'
      + '<section id="briefing-view" class="view' + (state.view === 'briefing' ? ' active' : '') + '">' + item.briefing + '</section>'
      + '<section id="document-view" class="view' + (state.view === 'document' ? ' active' : '') + '">' + item.document + '</section>';
    reviewApply(pane, item);
    citeReset();
    window.scrollTo({{ top: 0, behavior: 'smooth' }});
  }}

  function render(){{ renderRail(); renderPane(); }}

  rail.addEventListener('click', function(event){{
    var button = event.target.closest('[data-slug]');
    if (!button) return;
    setSlug(button.getAttribute('data-slug'));
    render();
  }});

  pane.addEventListener('click', function(event){{
    if (reviewClick(event)) {{ renderRail(); return; }}
    if (citeClick(event)) return;
    var tab = event.target.closest('[data-view]');
    if (tab) {{ state.view = tab.getAttribute('data-view'); renderPane(); return; }}
    var jump = event.target.closest('a[href^="#"]');
    if (jump) {{
      event.preventDefault();
      var id = decodeURIComponent(jump.getAttribute('href').slice(1));
      var target = document.getElementById(id);
      if (target) {{
        target.scrollIntoView({{ behavior: 'smooth', block: 'start' }});
        if (history.replaceState) history.replaceState(null, '', '#' + id);
      }}
      return;
    }}
    var copyButton = event.target.closest('[data-copy="ppt"]');
    if (copyButton) {{
      var block = document.getElementById('ppt-block');
      if (!block) return;
      var flash = function(text){{
        copyButton.textContent = text;
        setTimeout(function(){{ copyButton.textContent = '원문 그대로 복사'; }}, 1600);
      }};
      if (!navigator.clipboard || !navigator.clipboard.writeText) {{ flash('복사 실패'); return; }}
      navigator.clipboard.writeText(block.textContent).then(function(){{
        flash('복사됨');
      }}).catch(function(){{
        flash('복사 실패');
      }});
    }}
  }});

  var q = document.getElementById('q');
  var qclear = document.getElementById('qclear');
  q.addEventListener('input', function(){{
    state.q = q.value.trim();
    qclear.hidden = !state.q;
    var rows = visible();
    if (rows.length && !rows.some(function(item){{ return item.slug === state.slug; }})) setSlug(rows[0].slug);
    render();
  }});
  qclear.addEventListener('click', function(){{ q.value = ''; state.q = ''; qclear.hidden = true; q.focus(); render(); }});

  function step(direction){{
    var rows = visible();
    var index = rows.findIndex(function(item){{ return item.slug === state.slug; }});
    var next = direction === 'older' ? index + 1 : index - 1;
    if (next >= 0 && next < rows.length) {{ setSlug(rows[next].slug); render(); }}
  }}
  document.addEventListener('keydown', function(event){{
    if (event.target.matches('input, textarea')) return;
    if (event.key === 'ArrowDown' || event.key === 'j') {{ event.preventDefault(); step('older'); }}
    if (event.key === 'ArrowUp' || event.key === 'k') {{ event.preventDefault(); step('newer'); }}
    if (event.key === '/') {{ event.preventDefault(); q.focus(); }}
    if (event.key === 'Tab' && !event.shiftKey && event.altKey) {{
      event.preventDefault();
      state.view = state.view === 'briefing' ? 'document' : 'briefing';
      renderPane();
    }}
  }});

  var themeBtn = document.getElementById('themeBtn');
  try {{ var saved = localStorage.getItem('weekly-viewer:theme'); if (saved) document.documentElement.setAttribute('data-theme', saved); }} catch (error) {{}}
  themeBtn.addEventListener('click', function(){{
    var root = document.documentElement;
    var now = root.getAttribute('data-theme');
    var dark = now === 'dark';
    var next = dark ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try {{ localStorage.setItem('weekly-viewer:theme', next); }} catch (error) {{}}
  }});
{REVIEW_JS}
{CITE_JS}
{REFRESH_JS}
{GUIDE_JS}

  refreshInit();
  citeInit();
  guideInit();
  reviewInit();
  render();
}})();
</script></body></html>'''



def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description='주간 보고 초안 → 단일 HTML 뷰어')
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--source', action='append', required=True, type=Path)
    args = parser.parse_args(argv)
    reports = load_reports(args.source)
    if not reports:
        raise SystemExit('주간 보고 초안을 찾지 못했습니다.')
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(viewer_page(reports), encoding='utf-8')
    print(json.dumps({
        'viewer': str(args.out),
        'size_kb': round(args.out.stat().st_size / 1024),
        'reports': len(reports),
        'latest': reports[0].slug,
        'oldest': reports[-1].slug,
        'standard_format': sum(1 for report in reports if report.standard),
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
