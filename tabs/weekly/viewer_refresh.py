"""상단바 '최신화' 버튼 조각 — CSS / 마크업 / JS.

뷰어는 정적 HTML이라 스스로 generate_viewer.py를 실행할 수 없다.
serve.py(로컬 헬퍼 서버)의 POST /api/regenerate 를 눌러 재생성한다.
헬퍼 서버가 없으면 실행 방법을 알려 주는 안내 패널을 띄운다.
"""
from __future__ import annotations

import os
from pathlib import Path

from .viewer_html import esc

REPO_ROOT = Path(__file__).resolve().parents[2]
FALLBACK_PORT = 8787


def _env_port() -> int:
    """WEEKLY_VIEWER_PORT 를 읽어 뷰어가 가리킬 헬퍼 서버 포트를 정한다."""
    raw = (os.environ.get('WEEKLY_VIEWER_PORT') or '').strip()
    if not raw:
        return FALLBACK_PORT
    try:
        port = int(raw)
    except ValueError:
        return FALLBACK_PORT
    if not 1 <= port <= 65535:
        return FALLBACK_PORT
    return port


DEFAULT_PORT = _env_port()

CSS = '''
/* 최신화 버튼 — 로컬 헬퍼 서버 연동 */
#refreshBtn{white-space:nowrap}
.refresh-label{margin-left:1px}
#refreshBtn[data-state="busy"]{color:var(--faint);opacity:.72;cursor:progress}
#refreshBtn[data-state="busy"]::before{content:"";display:inline-block;width:11px;height:11px;margin-right:7px;
vertical-align:-1px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:var(--r-pill);
animation:refresh-spin .7s linear infinite}
#refreshBtn[data-state="done"]{color:var(--accent);border-color:var(--accent)}
#refreshBtn:disabled{cursor:progress}
@keyframes refresh-spin{to{transform:rotate(360deg)}}
.refresh-toast{font-size:12px;letter-spacing:-.01em;color:var(--faint);white-space:nowrap;
max-width:30ch;overflow:hidden;text-overflow:ellipsis}
.refresh-toast[data-tone="done"]{color:var(--accent)}
.refresh-toast[data-tone="fail"]{color:var(--na)}
.refresh-help{position:fixed;right:20px;bottom:20px;z-index:20;width:min(430px,92vw);
background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);
padding:18px 20px;color:var(--text);font-size:14px;letter-spacing:-.016em;line-height:1.5}
.refresh-help h4{margin:0 0 8px;font-family:var(--font-display);font-size:17px;font-weight:600;
letter-spacing:-.011em}
.refresh-help p{margin:0 0 10px;color:var(--muted)}
.refresh-help .cmd{display:block;font-family:var(--mono);font-size:12px;color:var(--muted);
background:var(--surface-2);border:1px solid var(--border-soft);border-radius:var(--r-sm);
padding:10px 12px;margin:0 0 12px;overflow-wrap:anywhere}
.refresh-help .acts{display:flex;align-items:center;gap:8px}
.refresh-help .act{border:1px solid var(--accent);background:transparent;color:var(--accent);
border-radius:var(--r-pill);padding:7px 16px;font:inherit;font-size:13px;letter-spacing:-.016em;cursor:pointer}
.refresh-help .act.primary{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
.refresh-help .act:active{transform:scale(.95)}
.refresh-help a.act{display:inline-block;text-decoration:none}
.refresh-help .close{margin-left:auto;border:0;background:none;color:var(--faint);
font-size:15px;line-height:1;padding:6px 8px;cursor:pointer}
@media(max-width:820px){.refresh-toast{display:none}
.refresh-label{display:none}
#refreshBtn{padding:7px 12px}
.refresh-help{right:12px;left:12px;bottom:12px;width:auto}}
@media(prefers-reduced-motion:reduce){#refreshBtn[data-state="busy"]::before{animation:none}}
@media print{.refresh-help{display:none}}
'''


def button_html(port: int = DEFAULT_PORT) -> str:
    """상단바 .tools 안에 넣을 최신화 버튼 + 상태 표시 마크업."""
    # 8787 은 업무 대시보드다. file:// 안내 패널의 '뷰어 열기'가 대시보드의 주간 보고 화면으로 가게 한다.
    target = f'http://localhost:{port}/#weekly' if port == FALLBACK_PORT else f'http://localhost:{port}'
    endpoint = esc(target)
    project_dir = esc(str(REPO_ROOT))
    title = esc('generate_viewer.py를 실행해 뷰어를 다시 만듭니다')
    return (
        f'<button class="iconbtn" id="refreshBtn" type="button" data-endpoint="{endpoint}"'
        f' data-projectdir="{project_dir}" title="{title}" aria-label="최신화">'
        '↻ <span class="refresh-label">최신화</span></button>'
        '<span class="refresh-toast" id="refreshStatus" hidden></span>'
    )


JS = '''
  // ---- 최신화: 로컬 헬퍼 서버에 재생성 요청 -------------------------------

  function refreshButton(){
    return document.getElementById('refreshBtn');
  }

  function refreshNote(text, tone){
    var box = document.getElementById('refreshStatus');
    if (!box) return;
    box.textContent = text || '';
    box.hidden = !text;
    if (text) box.setAttribute('title', text); else box.removeAttribute('title');
    if (tone) box.setAttribute('data-tone', tone); else box.removeAttribute('data-tone');
  }

  function refreshBaseUrl(button){
    var base = (button && button.getAttribute('data-endpoint')) || '';
    return base.replace(/\\/+$/, '');
  }

  function refreshIdle(button){
    if (!button) return;
    button.removeAttribute('data-state');
    button.disabled = false;
  }

  function refreshBusy(button){
    if (!button) return;
    button.setAttribute('data-state', 'busy');
    button.disabled = true;
  }

  function refreshDetail(result){
    var body = result.body;
    var text = '';
    if (body && body.error) text = String(body.error);
    if (!text && body && body.stderr) text = String(body.stderr);
    if (!text) text = String(result.text || '').trim();
    if (!text) text = 'HTTP ' + result.status;
    var lines = text.split('\\n').filter(function(line){ return line.trim(); });
    var last = lines.length ? lines[lines.length - 1].trim() : text;
    if (last.length > 140) last = last.slice(0, 140) + '…';
    return '재생성 실패 · ' + last;
  }

  function refreshHelpClose(){
    var panel = document.getElementById('refreshHelp');
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
  }

  function refreshHelpOpen(button, mode){
    if (document.getElementById('refreshHelp')) return;
    var dir = (button && button.getAttribute('data-projectdir')) || '.';
    var command = 'cd "' + dir + '" && python3 serve.py';
    var base = refreshBaseUrl(button);
    var address = base ? base + '/' : '';
    var fileMode = mode === 'file';
    var head = fileMode ? 'file:// 로 열면 최신화를 쓸 수 없습니다' : '헬퍼 서버가 꺼져 있습니다';
    var lead = fileMode
      ? '<p>이 뷰어가 파일로 직접 열려 있어 재생성 요청을 보낼 수 없습니다. '
        + '대시보드가 꺼져 있습니다. 터미널에서 아래 명령으로 대시보드를 띄운 뒤'
        + (address ? ' <b>' + esc(address) + '</b> 주소로' : ' 헬퍼 서버 주소로')
        + ' 다시 열어 주세요.</p>'
      : '<p>최신화는 로컬 헬퍼 서버를 통해 generate_viewer.py를 실행합니다. '
        + '대시보드가 꺼져 있습니다. 터미널에서 아래 명령으로 대시보드를 띄운 뒤 '
        + '다시 눌러 주세요.</p>';
    var acts = '<button class="act primary" type="button" id="refreshCopy">명령 복사</button>';
    if (fileMode) {
      if (address) {
        acts += '<a class="act" id="refreshOpen" href="' + esc(address) + '">뷰어 열기</a>';
      }
    } else {
      acts += '<button class="act" type="button" id="refreshRetry">다시 시도</button>';
    }
    var panel = document.createElement('div');
    panel.className = 'refresh-help';
    panel.id = 'refreshHelp';
    panel.innerHTML =
      '<h4>' + esc(head) + '</h4>'
      + lead
      + '<code class="cmd" id="refreshCmd">' + esc(command) + '</code>'
      + '<div class="acts">' + acts
      + '<button class="close" type="button" id="refreshHelpClose" aria-label="안내 닫기">×</button></div>';
    document.body.appendChild(panel);

    var copy = document.getElementById('refreshCopy');
    copy.addEventListener('click', function(){
      var done = function(){
        copy.textContent = '복사됨';
        setTimeout(function(){ copy.textContent = '명령 복사'; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(command).then(done, function(){ copy.textContent = '복사 실패'; });
      } else {
        copy.textContent = '복사 실패';
      }
    });
    var retry = document.getElementById('refreshRetry');
    if (retry) {
      retry.addEventListener('click', function(){
        refreshHelpClose();
        refreshRun();
      });
    }
    document.getElementById('refreshHelpClose').addEventListener('click', refreshHelpClose);
  }

  function refreshRun(){
    var button = refreshButton();
    if (!button || button.getAttribute('data-state') === 'busy') return;
    refreshHelpClose();
    var scheme = location.protocol;
    if (scheme !== 'http:' && scheme !== 'https:') {
      refreshNote('file:// 에서는 최신화를 쓸 수 없습니다.', 'fail');
      refreshHelpOpen(button, 'file');
      return;
    }
    refreshBusy(button);
    refreshNote('재생성 중…', 'busy');
    fetch('api/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'X-Weekly-Viewer': '1' },
      body: ''
    }).then(function(response){
      return response.text().then(function(text){
        var body = null;
        try { body = JSON.parse(text); } catch (error) { body = null; }
        return { ok: response.ok, status: response.status, body: body, text: text };
      });
    }).then(function(result){
      if (result.ok && result.body && result.body.ok) {
        var count = result.body.reports;
        button.setAttribute('data-state', 'done');
        refreshNote(count == null ? '재생성 완료' : '초안 ' + count + '건 재생성', 'done');
        setTimeout(function(){ location.reload(); }, 800);
        return;
      }
      refreshIdle(button);
      refreshNote(refreshDetail(result), 'fail');
    }).catch(function(){
      refreshIdle(button);
      refreshNote('헬퍼 서버에 연결하지 못했습니다.', 'fail');
      refreshHelpOpen(button, 'offline');
    });
  }

  function refreshInit(){
    var button = refreshButton();
    if (!button) return;
    button.addEventListener('click', refreshRun);
  }
'''
