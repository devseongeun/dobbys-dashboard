"""AI 브리핑 섹션의 `근거` 배지 — 클릭하면 출처 초안 파일명을 보여 준다.

generate_viewer.py가 `cite_button()`으로 제목 옆 버튼을 심고,
`CSS` / `JS` 문자열을 뷰어 스타일·스크립트에 합쳐 쓴다.
`JS`는 코어 IIFE 스코프에 그대로 이어 붙으므로 f-string이 아닌 일반 문자열이다.
"""
from __future__ import annotations

from .viewer_html import esc

# 근거 배지 글리프 — 이미지·아이콘 폰트 없이 유니코드 참조 표시만 쓴다.
GLYPH = '※'


def cite_button(file_name: str, section: str, extra: str = '') -> str:
    """제목(`<h2>`/`<h3>`) 안에 그대로 이어 붙이는 인라인 근거 버튼."""
    attrs = f' data-file="{esc(file_name or "")}" data-section="{esc(section or "")}"'
    if extra:
        attrs += f' data-extra="{esc(extra)}"'
    return (
        '<span class="cite-wrap">'
        f'<button type="button" class="cite" aria-expanded="false" aria-label="근거 보기"{attrs}>'
        f'<i class="cite-gl" aria-hidden="true">{GLYPH}</i>근거'
        '</button>'
        '</span>'
    )


CSS = '''
/* 근거 배지 — 브리핑 섹션 제목 옆 고스트 버튼 */
.cite-wrap{position:relative;flex:0 0 auto;display:inline-flex;vertical-align:middle;
white-space:nowrap;margin-left:8px}
.cite{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;
border:1px solid var(--border);background:var(--raised);color:var(--faint);border-radius:var(--r-pill);
padding:3px 10px;font:inherit;font-family:var(--font-text);font-size:12px;font-weight:400;
line-height:1.4;letter-spacing:-.01em;cursor:pointer}
.cite:hover{color:var(--accent);border-color:var(--accent);background:var(--accent-soft)}
.cite:active{transform:scale(.95)}
.cite[aria-expanded="true"]{color:var(--on-accent);background:var(--accent);border-color:var(--accent)}
.cite-gl{font-style:normal;font-size:11px;line-height:1}
.task h3 .cite-wrap{margin-left:6px}

/* 근거 팝오버 — 버튼 기준 절대배치 */
.cite-pop{position:absolute;top:calc(100% + 8px);left:0;z-index:40;
width:max-content;min-width:200px;max-width:min(360px,68vw);
background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);
padding:14px 16px;text-align:left;white-space:normal;
font-family:var(--font-text);font-size:14px;font-weight:400;letter-spacing:-.016em;
line-height:1.47;color:var(--muted);text-transform:none}
/* 가로 위치는 citePlace()가 화면 안으로 clamp 하며 인라인 left로 보정한다 */
.cite-file{font-family:var(--mono);font-size:13px;color:var(--text);overflow-wrap:anywhere}
.cite-meta{margin-top:6px;font-size:12px;color:var(--faint);letter-spacing:-.01em;overflow-wrap:anywhere}
.cite-note{margin:10px 0 0;font-size:12px;color:var(--faint);letter-spacing:-.01em}
.cite-copy{margin-top:12px;border:1px solid var(--accent);background:transparent;color:var(--accent);
border-radius:var(--r-pill);padding:5px 13px;font:inherit;font-size:12px;font-weight:400;
letter-spacing:-.01em;cursor:pointer}
.cite-copy:active{transform:scale(.95)}

@media(max-width:820px){
.cite-pop{min-width:0;max-width:min(300px,calc(100vw - 32px))}
}
@media print{.cite-wrap{display:none}}
'''

JS = '''
  var citeOpenButton = null;
  var citeBound = false;

  function citeHide(){
    if (!citeOpenButton) return null;
    var button = citeOpenButton;
    var wrap = button.parentNode;
    var pop = wrap ? wrap.querySelector('.cite-pop') : null;
    if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
    button.setAttribute('aria-expanded', 'false');
    citeOpenButton = null;
    return button;
  }

  function citePopMarkup(button){
    var file = button.getAttribute('data-file') || '';
    var section = button.getAttribute('data-section') || '';
    var extra = button.getAttribute('data-extra') || '';
    var meta = section ? '초안 섹션 · ' + section : '초안 섹션 정보 없음';
    if (extra) meta += ' · ' + extra;
    return '<div class="cite-pop" role="dialog" aria-label="근거 출처">'
      + '<div class="cite-file">' + esc(file || '(파일명 미확인)') + '</div>'
      + '<div class="cite-meta">' + esc(meta) + '</div>'
      + '<p class="cite-note">초안 원문 탭에서 전체 문장을 확인하세요.</p>'
      + '<button type="button" class="cite-copy" data-cite-copy="1">파일명 복사</button>'
      + '</div>';
  }

  function citeCopy(trigger){
    var pop = trigger.closest('.cite-pop');
    var slot = pop ? pop.querySelector('.cite-file') : null;
    var name = slot ? slot.textContent : '';
    if (!name) return;
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) return;
      navigator.clipboard.writeText(name).then(function(){
        trigger.textContent = '복사됨';
        setTimeout(function(){ trigger.textContent = '파일명 복사'; }, 1600);
      }, function(){});
    } catch (error) {}
  }

  function citePlace(pop){
    if (!pop || !pop.getBoundingClientRect) return;
    pop.style.left = '0px';
    var box = pop.getBoundingClientRect();
    var room = document.documentElement.clientWidth;
    var gap = 12;
    var shift = 0;
    if (box.right > room - gap) shift = (room - gap) - box.right;
    if (box.left + shift < gap) shift = gap - box.left;
    if (shift) pop.style.left = Math.round(shift) + 'px';
  }

  function citeClick(event){
    var target = event.target;
    if (!target || !target.closest) return false;
    var copy = target.closest('[data-cite-copy]');
    if (copy) { citeCopy(copy); return true; }
    if (target.closest('.cite-pop')) return true;
    var button = target.closest('.cite');
    if (!button) return false;
    var same = citeOpenButton === button;
    citeHide();
    if (same) return true;
    button.insertAdjacentHTML('afterend', citePopMarkup(button));
    button.setAttribute('aria-expanded', 'true');
    citeOpenButton = button;
    citePlace(button.nextElementSibling);
    return true;
  }

  function citeInit(){
    if (citeBound) return;
    citeBound = true;
    document.addEventListener('click', function(event){
      if (!citeOpenButton) return;
      var target = event.target;
      if (target && target.closest && target.closest('.cite-wrap')) return;
      citeHide();
    });
    document.addEventListener('keydown', function(event){
      if (event.key !== 'Escape') return;
      if (!citeOpenButton) return;
      var button = citeHide();
      if (button && button.focus) button.focus();
    });
  }

  function citeReset(){
    citeOpenButton = null;
  }
'''
