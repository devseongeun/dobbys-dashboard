"""초안(회차) 단위 `확인 완료` 표시 기능.

- review_button(): 탭 줄 오른쪽에 놓이는 `초안 확인 완료` 토글 버튼 마크업.
- flags_section(): 체크박스 없는 평범한 `미해결 표시` 섹션 HTML.
- CSS / JS: 뷰어에 합쳐지는 스타일과 스크립트 조각.

확인 상태의 진실은 두 갈래다.

- 서버 모드: 대시보드(serve.py)의 /weekly/ 로 열었으면 `GET/PUT /api/reviewed`
  로 개인 상태 폴더의 `reviewed.json`을 읽고 쓴다. 기기·브라우저를 옮겨도 남는다.
  이 모드에서는 localStorage를 읽지도 쓰지도 않는다(진실이 둘로 갈리는 것을 막는다).
- 로컬 모드: `file://`로 직접 열었거나 대시보드가 꺼져 있으면
  localStorage['weekly-viewer:reviewed']로 낮춰 동작한다.

어느 쪽이든 자료 모양은 `{ "<slug>": "<ISO8601>" }` 로 같다.
처음 서버에 붙을 때 서버 기록이 비어 있고 localStorage에만 기록이 있으면
한 번만 서버로 옮기고 브라우저 쪽 키는 지운다.
확인 단위는 개별 표시 항목이 아니라 초안 한 회차 전체다.
"""
from __future__ import annotations

from .report_parser import Report
from .viewer_html import esc, mark_inline

# 집계 칩 순서와 라벨. report_parser의 flag kind와 같은 키를 쓴다.
KINDS = ('need', 'na', 'unver')
LABELS = {'need': '확인 필요', 'na': 'N/A', 'unver': '미검증'}


CSS = '''
/* 초안 확인 완료 — 탭 줄 오른쪽의 토글 버튼.
   탭은 accent 테두리 pill CTA 이므로 이 버튼은 중립색 테두리 + 왼쪽 구분선으로 갈라 둔다.
   `.tabs button+button{border-left:...}` 가 이 버튼에도 걸리므로 명시적으로 되돌린다. */
.tabs{flex-wrap:wrap}
.tabs .review{position:relative;display:inline-flex;align-items:center;gap:7px;margin-left:12px;
padding:9px 18px;border:1px solid var(--border);border-left:1px solid var(--border);
background:var(--raised);color:var(--muted);
cursor:pointer;font:inherit;font-size:14px;font-weight:400;letter-spacing:-.016em;
border-radius:var(--r-pill)}
.tabs .review::before{content:"";position:absolute;left:-10px;top:5px;bottom:5px;width:1px;
background:var(--border)}
.tabs .review:hover{color:var(--text);border-color:var(--faint)}
.tabs .review:active{transform:scale(.95)}
.tabs .review .review-mark{font-size:12px;line-height:1;color:var(--faint)}
.tabs .review .review-text{white-space:nowrap}
.tabs .review[data-done="true"]{background:var(--accent);border-color:var(--accent);
color:var(--on-accent)}
.tabs .review[data-done="true"] .review-mark,
.tabs .review[data-done="true"]:hover{color:var(--on-accent)}
.tabs .review[data-done="true"]:hover{border-color:var(--accent)}

/* 사이드 패널 배지 — 확인 완료 회차 */
.wk .badges .ok{background:var(--accent);color:var(--on-accent);border-color:transparent}

/* 좁은 화면: 탭 줄이 가로로 넘치지 않게 줄바꿈시키고 구분선은 접는다. */
@media(max-width:820px){
.tabs{gap:6px;margin:20px 0 18px}
.tabs button{padding:8px 14px;font-size:13px}
.tabs .review{margin-left:0;padding:8px 14px}
.tabs .review::before{display:none}
.flags li{grid-template-columns:minmax(0,1fr);row-gap:3px}
.flags .from{white-space:normal}
}
'''


# f-string이 아닌 일반 문자열. 중괄호를 그대로 쓴다.
JS = '''
  var REVIEW_KEY = 'weekly-viewer:reviewed';
  var REVIEW_API = 'api/reviewed';
  var REVIEW_FAIL = '저장 실패 — 헬퍼 서버를 확인하세요.';

  // 'unknown' = 아직 판정 전, 'server' = reviewed.json, 'local' = localStorage.
  // 한 번 'local'로 낮추면 이 화면이 살아 있는 동안은 그대로 둔다.
  var reviewMode = 'unknown';
  var reviewServer = {};
  var reviewCache = { raw: null, map: null };
  var reviewBooted = false;

  function reviewHttp(){
    return location.protocol === 'http:' || location.protocol === 'https:';
  }

  function reviewRemote(){
    return reviewMode === 'server';
  }

  function reviewLocal(){
    // localStorage 원본을 읽어 맵으로. 판정 전 http 화면에서는 부르지 않는다.
    try {
      var raw = localStorage.getItem(REVIEW_KEY) || '';
      if (raw === reviewCache.raw && reviewCache.map) return reviewCache.map;
      var map = raw ? JSON.parse(raw) : {};
      if (!map || typeof map !== 'object') map = {};
      reviewCache.raw = raw;
      reviewCache.map = map;
      return map;
    } catch (error) { return {}; }
  }

  function reviewStore(){
    if (reviewMode === 'server') return reviewServer;
    if (reviewMode === 'local') return reviewLocal();
    // 판정 전: http 라면 서버 응답을 기다린다. localStorage 를 미리 비추지 않는다.
    return reviewHttp() ? reviewServer : reviewLocal();
  }

  function reviewSave(map){
    var data = map || {};
    if (reviewRemote()) return;  // 서버 모드에서는 브라우저에 쓰지 않는다.
    try {
      // 확인한 회차가 하나도 없으면 빈 `{}`를 남기지 않고 키째 지운다.
      if (!Object.keys(data).length) {
        localStorage.removeItem(REVIEW_KEY);
        reviewCache.raw = '';
        reviewCache.map = data;
        return;
      }
      var raw = JSON.stringify(data);
      localStorage.setItem(REVIEW_KEY, raw);
      reviewCache.raw = raw;
      reviewCache.map = data;
    } catch (error) {}
  }

  function reviewClone(map){
    var copy = {};
    for (var slug in map) {
      if (Object.prototype.hasOwnProperty.call(map, slug)) copy[slug] = map[slug];
    }
    return copy;
  }

  function reviewDone(slug){
    if (!slug) return '';
    var at = reviewStore()[slug];
    return typeof at === 'string' && at ? at : '';
  }

  function reviewDay(iso){
    // ISO 문자열을 로컬 날짜(YYYY-MM-DD)로 줄인다. 파싱이 안 되면 앞 10자를 쓴다.
    var date = new Date(iso);
    if (!date || isNaN(date.getTime())) return String(iso).slice(0, 10);
    var month = date.getMonth() + 1;
    var day = date.getDate();
    return date.getFullYear()
      + '-' + (month < 10 ? '0' : '') + month
      + '-' + (day < 10 ? '0' : '') + day;
  }

  function reviewApply(pane, item){
    var root = pane || document;
    if (!root || !root.querySelector) return;
    var button = root.querySelector('#reviewBtn');
    if (!button) return;
    var text = button.querySelector('.review-text');
    var at = item ? reviewDone(item.slug) : '';
    if (at) {
      button.setAttribute('aria-pressed', 'true');
      button.setAttribute('data-done', 'true');
      button.setAttribute('title', '확인 완료 · ' + reviewDay(at) + ' — 다시 누르면 해제됩니다.');
      if (text) text.textContent = '확인 완료 · ' + reviewDay(at);
    } else {
      button.setAttribute('aria-pressed', 'false');
      button.removeAttribute('data-done');
      button.setAttribute('title', '이 초안을 전부 확인했으면 누르세요.');
      if (text) text.textContent = '초안 확인 완료';
    }
  }

  // ---- 헬퍼 서버 왕복 -----------------------------------------------------

  function reviewRead(response){
    return response.text().then(function(text){
      var body = null;
      try { body = JSON.parse(text); } catch (error) { body = null; }
      return { ok: response.ok, body: body };
    });
  }

  function reviewPick(result){
    // 규격에 맞는 응답에서 reviewed 맵만 꺼낸다. 아니면 null(=실패).
    if (!result || !result.ok || !result.body || result.body.ok !== true) return null;
    var map = result.body.reviewed;
    if (!map || typeof map !== 'object') return null;
    return map;
  }

  function reviewPut(slug, done){
    return fetch(REVIEW_API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Weekly-Viewer': '1' },
      body: JSON.stringify({ slug: slug, done: !!done })
    }).then(reviewRead).then(reviewPick);
  }

  function reviewDrop(){
    // 이관이 끝난 브라우저 사본을 지워 진실을 하나로 남긴다.
    try { localStorage.removeItem(REVIEW_KEY); } catch (error) {}
    reviewCache.raw = '';
    reviewCache.map = {};
  }

  function reviewMigrate(){
    // 서버가 빈 상태로 처음 붙었을 때만: 브라우저에 남은 기록을 서버로 옮긴다.
    var stale = reviewLocal();
    var slugs = Object.keys(stale);
    if (!slugs.length) { render(); return; }
    var failed = false;
    var chain = Promise.resolve(null);
    slugs.forEach(function(slug){
      chain = chain.then(function(){
        return reviewPut(slug, true).then(function(map){
          if (map) reviewServer = map;
          else failed = true;
        }, function(){ failed = true; });
      });
    });
    chain.then(function(){
      // 한 건도 못 옮겼으면 서버 쓰기가 막힌 것이니 로컬 모드로 되돌린다.
      if (failed && !Object.keys(reviewServer).length) reviewMode = 'local';
      else if (!failed) reviewDrop();
      render();
    });
  }

  function reviewInit(){
    if (reviewBooted) return;
    reviewBooted = true;
    if (!reviewHttp()) { reviewMode = 'local'; return; }
    fetch(REVIEW_API, { headers: { 'X-Weekly-Viewer': '1' } })
      .then(reviewRead)
      .then(function(result){
        var map = reviewPick(result);
        if (!map) { reviewMode = 'local'; render(); return; }
        reviewMode = 'server';
        reviewServer = map;
        if (!Object.keys(map).length) { reviewMigrate(); return; }
        render();
      })
      .catch(function(){
        // 헬퍼 서버가 없거나 죽었다. 조용히 localStorage 로 낮춘다.
        reviewMode = 'local';
        render();
      });
  }

  function reviewRevert(previous, item){
    // 서버 저장이 실패했으면 화면을 원래대로 돌리고 실패를 알린다.
    reviewServer = previous;
    reviewApply(pane, item);
    renderRail();
    var button = pane && pane.querySelector ? pane.querySelector('#reviewBtn') : null;
    if (button) button.setAttribute('title', REVIEW_FAIL);
  }

  function reviewClick(event){
    var target = event ? event.target : null;
    if (!target || !target.closest) return false;
    if (!target.closest('#reviewBtn')) return false;
    var item = current();
    if (!item) return true;
    var previous = reviewStore();
    var done = !reviewDone(item.slug);
    var next = reviewClone(previous);
    if (done) next[item.slug] = new Date().toISOString();
    else delete next[item.slug];
    if (reviewRemote()) {
      // 화면부터 바꾸고 저장은 뒤따르게 한다. 왕복을 기다리면 클릭이 굼떠 보인다.
      reviewServer = next;
      reviewApply(pane, item);
      reviewPut(item.slug, done).then(function(map){
        if (!map) { reviewRevert(previous, item); return; }
        reviewServer = map;
        reviewApply(pane, item);
        renderRail();
      }, function(){ reviewRevert(previous, item); });
      return true;
    }
    reviewSave(next);
    reviewApply(pane, item);
    return true;
  }
'''


def review_button() -> str:
    """탭 줄에 들어갈 `초안 확인 완료` 버튼. 상태와 title은 reviewApply()가 채운다."""
    return ('<button type="button" class="review" id="reviewBtn" aria-pressed="false">'
            '<span class="review-mark" aria-hidden="true">✓</span>'
            '<span class="review-text">초안 확인 완료</span></button>')


def flags_section(report: Report, cite: str = '') -> str:
    """`미해결 표시` 섹션 HTML. cite는 이미 렌더된 HTML이라 그대로 붙인다."""
    if not report.flags:
        return ''

    counts: dict[str, int] = {}
    rows = []
    for flag in report.flags:
        counts[flag.get('kind', 'need')] = counts.get(flag.get('kind', 'need'), 0) + 1
        rows.append(f'<li><span class="from">{esc(flag["origin"])}</span>'
                    f'<span class="txt">{mark_inline(flag["text"])}</span></li>')

    chips = ''.join(f'<span>{LABELS[kind]} {counts[kind]}</span>'
                    for kind in KINDS if counts.get(kind))
    return (f'<section class="blk"><h2>미해결 표시{cite}</h2>'
            f'<div class="flags"><div class="cnt">{chips}</div>'
            f'<ul>{"".join(rows)}</ul></div></section>')
