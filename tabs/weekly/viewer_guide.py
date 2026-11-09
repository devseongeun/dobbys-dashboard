"""AI 브리핑 '표준 섹션 구성' 안내 창과 초안 템플릿.

generate_viewer.py가 `guide_dialog()`를 페이지에 한 번 심고, `open_button()`을 상단바·브리핑 안내에 넣는다.
안내 표는 report_parser.py가 실제로 읽는 규칙을 옮긴 것이다. 규칙을 바꾸면 여기도 고친다.
템플릿은 탭 설정의 내려받기(tabs/weekly/__init__.py)와 같은 파일이다.
`JS`는 코어 IIFE 스코프에 그대로 이어 붙으므로 f-string이 아닌 일반 문자열이다.
"""
from __future__ import annotations

from pathlib import Path
from urllib.parse import quote

from .markdown_renderer import inline
from .viewer_html import esc

TEMPLATE = Path(__file__).parent / 'templates' / 'YYYY-MM-DD 주간 보고.md'

# (섹션, 적는 법, AI 브리핑에서). 적는 법·보이는 곳은 인라인 마크다운(`코드`)을 쓴다.
SECTIONS = (
    ('# 제목', '문서 맨 위 한 줄. `제목: …` 줄도 된다.',
     '핵심 업무가 없을 때 회차 제목이 된다.'),
    ('## 보고 기간', '`조회 기간: 시작일 ~ 종료일`, `차주 범위`, `버전`, `실제 확인 범위`(아래에 불릿) 불릿.',
     '맨 위 기간·버전 칸. 조회 기간 날짜로 회차 기간을 정하고 같은 주 초안을 묶는다. '
     '없으면 첫 섹션 제목의 날짜를 쓴다.'),
    ('## 이번 주 핵심 업무', '번호 목록. 앞 5개까지 읽는다.',
     '1번·2번이 왼쪽 회차 목록의 제목·부제가 된다. N번을 누르면 업무별 상세 N번 카드로 간다. '
     '이 섹션이 없으면 `금주 주요 사항` → `금주 작업 정리` → `이번 주 작업 요약` 순으로 찾는다.'),
    ('## 업무별 상세 내용', '업무마다 `### 1. 업무명`, 그 아래 `수행 내용:` `확인 결과:` `의사결정/원인:` `다음 단계:` 불릿.',
     '업무 카드. 이 섹션이 있으면 표준 형식 초안으로 보고, 같은 주 초안이 여럿이면 이 초안을 고른다.'),
    ('## 정량 지표', '지표 불릿. 첫 `###` 아래에 `전체 N건`과 그 아래 `분류 N건` 불릿, 기준 한 줄.',
     '지표 목록과 건수·막대 그래프.'),
    ('## 금주 주요 사항 · ## 차주 주요 사항', '불릿 또는 `###` 묶음. 제목 뒤 `(기간)` 괄호는 무시한다.',
     '나란히 놓인 두 목록.'),
    ('## 이슈 및 기타 사항', '불릿.', '이슈 목록.'),
    ('## PPT 붙여넣기용', 'PPT에 붙일 글을 그대로.', '원문 그대로 복사 버튼이 붙은 블록.'),
    ('## 출처 및 검증', '근거 자료 불릿.', '접힌 목록.'),
    ('## PPT 처리', '상태 한 줄. `## 승인 상태`도 된다.', '회차 제목 위 태그.'),
)

RULES = (
    '파일명은 `YYYY-MM-DD 주간 보고.md`처럼 날짜로 시작하고 `주간`이 들어가거나, '
    '`YYYY-MM-DD~ YYYY-MM-DD-weekly-report.md` 형식이다. 앞 날짜가 회차 날짜다.',
    '섹션은 `##`, 그 아래 묶음은 `###`로 쓴다. 섹션 이름은 띄어쓰기·굵게 표시를 무시하고 맞춘다.',
    '없는 섹션은 건너뛴다. 핵심 업무(대체 섹션 포함)도 업무별 상세 내용도 없으면 AI 브리핑이 비고 초안 원문 탭에서 본다.',
    '업무별 상세 내용·이슈 및 기타 사항·정량 지표에 `확인 필요`, `N/A`, `미검증`, `미확인`을 쓰면 미해결 항목으로 모은다.',
    'AI 브리핑은 문장을 고쳐 쓰지 않고 섹션별로 옮겨 담기만 한다.',
)


def open_button(text: str = '표준 섹션 안내') -> str:
    return f'<button class="guide-open" type="button" data-guide-open>{esc(text)}</button>'


def guide_dialog() -> str:
    template = TEMPLATE.read_text(encoding='utf-8')
    rows = ''.join(
        f'<tr><th scope="row"><code>{esc(name)}</code></th><td>{inline(how)}</td><td>{inline(shown)}</td></tr>'
        for name, how, shown in SECTIONS
    )
    rules = ''.join(f'<li>{inline(rule)}</li>' for rule in RULES)
    href = 'data:text/markdown;charset=utf-8,' + quote(template)
    return (
        '<dialog class="guide" id="guide" aria-labelledby="guide-title">'
        '<div class="guide-head"><h2 id="guide-title">표준 섹션 구성</h2>'
        '<button class="guide-close" type="button" data-guide-close aria-label="닫기">×</button></div>'
        '<p class="guide-lead">AI 브리핑은 초안 Markdown에서 아래 이름의 섹션을 찾아 화면에 배치합니다. '
        '표준 섹션 구성은 이 섹션들을 갖춘 초안입니다.</p>'
        f'<table class="guide-table"><thead><tr><th>섹션</th><th>적는 법</th><th>AI 브리핑에서</th></tr></thead>'
        f'<tbody>{rows}</tbody></table>'
        f'<ul class="guide-rules">{rules}</ul>'
        '<div class="guide-actions">'
        f'<a class="guide-btn primary" download="{esc(TEMPLATE.name)}" href="{esc(href)}">템플릿 내려받기</a>'
        '<button class="guide-btn" type="button" data-guide-copy>템플릿 복사</button>'
        '<span class="guide-hint">내려받은 뒤 파일명의 YYYY-MM-DD를 회차 날짜로 바꿔 주간 보고 폴더에 넣으세요.</span>'
        '</div>'
        '<p class="guide-skill">Claude Code를 쓰면 팀 공용 스킬로 이 형식의 초안을 바로 쓸 수 있습니다. '
        '<code>/plugin marketplace add devseongeun/dobbys-dashboard</code> → '
        '<code>/plugin install dobbys-dashboard@dobbys-dashboard</code> 뒤 "이번 주 주간 보고 초안 써줘".</p>'
        f'<details class="guide-preview"><summary>템플릿 미리 보기</summary><pre id="guide-template">{esc(template)}</pre></details>'
        '</dialog>'
    )


CSS = '''
/* 표준 섹션 안내 창 */
.guide-open{border:0;background:none;padding:0;margin-left:auto;color:var(--accent);font:inherit;font-size:14px;
letter-spacing:-.016em;cursor:pointer;white-space:nowrap;text-decoration:underline;text-underline-offset:3px}
.top .guide-open{margin-left:0;text-decoration:none;border:1px solid var(--border);background:var(--raised);
color:var(--muted);border-radius:var(--r-pill);padding:7px 13px}
.guide{width:min(880px,calc(100vw - 32px));max-height:calc(100vh - 48px);padding:28px 32px;border:1px solid var(--border);
border-radius:var(--r-lg);background:var(--surface);color:var(--text);font-size:14px;letter-spacing:-.016em}
.guide::backdrop{background:rgba(0,0,0,.4)}
.guide-head{display:flex;justify-content:space-between;align-items:center;gap:12px}
.guide-head h2{margin:0;font-family:var(--font-display);font-size:24px;font-weight:600;letter-spacing:-.011em}
.guide-close{border:0;background:none;color:var(--faint);font-size:24px;line-height:1;cursor:pointer;padding:4px 8px}
.guide-lead{margin:10px 0 18px;color:var(--muted)}
.guide-table{width:100%;border-collapse:collapse;font-size:13px;line-height:1.5}
.guide-table th,.guide-table td{text-align:left;vertical-align:top;padding:10px 12px;border-top:1px solid var(--border-soft)}
.guide-table thead th{font-size:12px;font-weight:400;color:var(--faint);border-top:0}
.guide-table tbody th{white-space:nowrap;font-weight:400}
.guide-table code{font-size:12px}
.guide-rules{margin:18px 0 0;padding-left:18px;color:var(--muted);line-height:1.6}
.guide-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:20px}
.guide-btn{border:1px solid var(--accent);background:transparent;color:var(--accent);border-radius:var(--r-pill);
padding:8px 18px;font:inherit;font-size:14px;cursor:pointer;text-decoration:none}
.guide-btn.primary{background:var(--accent);color:var(--on-accent)}
.guide-btn:active{transform:scale(.95)}
.guide-hint{font-size:12px;color:var(--faint)}
.guide-preview{margin-top:16px}
.guide-preview summary{cursor:pointer;color:var(--accent)}
.guide-preview pre{margin:10px 0 0;padding:16px;background:var(--surface-2);border:1px solid var(--border);
border-radius:var(--r-md);font-family:var(--mono);font-size:12px;line-height:1.6;white-space:pre-wrap;color:var(--muted)}
.panel.guide-empty{display:flex;flex-wrap:wrap;align-items:baseline;gap:12px;padding:18px 24px}
.guide-skill{margin:14px 0 0;font-size:13px;color:var(--muted);line-height:1.6}
@media print{.guide-open{display:none}}
'''

JS = '''
  function guideInit(){
    var dialog = document.getElementById('guide');
    if (!dialog) return;
    document.addEventListener('click', function(event){
      if (event.target.closest('[data-guide-open]')) { dialog.showModal(); return; }
      // 창 바깥(backdrop)을 누르면 dialog 자신이 target 이다.
      if (event.target === dialog || event.target.closest('[data-guide-close]')) { dialog.close(); return; }
      var copy = event.target.closest('[data-guide-copy]');
      if (!copy) return;
      var flash = function(text){
        copy.textContent = text;
        setTimeout(function(){ copy.textContent = '템플릿 복사'; }, 1600);
      };
      if (!navigator.clipboard || !navigator.clipboard.writeText) { flash('복사 실패'); return; }
      navigator.clipboard.writeText(document.getElementById('guide-template').textContent)
        .then(function(){ flash('복사됨'); }, function(){ flash('복사 실패'); });
    });
  }
'''
