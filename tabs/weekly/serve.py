"""대시보드가 마운트하는 주간 보고 handler. 뷰어 HTML·reviewed.json 위치와 초안 폴더는 탭 설정에서 받는다."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit

REPO_ROOT = Path(__file__).resolve().parents[2]
GENERATOR = 'tabs.weekly.generate_viewer'
REGENERATE_TIMEOUT = 180
VIEWER_ROUTES = ('/', '/index.html', '/weekly-report-viewer.html')
ALLOWED_HOSTNAMES = frozenset({'127.0.0.1', 'localhost', '::1'})
REFRESH_HEADER = 'X-Weekly-Viewer'


def allowed_origins(port: int) -> tuple[str, ...]:
    """뷰어가 실제로 열리는 로컬 주소만 허용한다 (와일드카드·null 금지)."""
    return (f'http://127.0.0.1:{port}', f'http://localhost:{port}')


_regenerate_lock = threading.Lock()
_reviewed_lock = threading.Lock()


def _now_iso() -> str:
    """브라우저 new Date().toISOString() 과 같은 모양 — 밀리초 3자리 + Z."""
    now = datetime.now(timezone.utc)
    return '%s.%03dZ' % (now.strftime('%Y-%m-%dT%H:%M:%S'), now.microsecond // 1000)


def load_reviewed(path: Path) -> dict:
    """reviewed.json 을 읽는다. 없거나 깨졌으면 빈 맵 — 절대 예외로 죽지 않는다."""
    try:
        raw = path.read_text(encoding='utf-8')
    except (OSError, UnicodeDecodeError):
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {key: value for key, value in parsed.items() if isinstance(key, str) and isinstance(value, str)}


def save_reviewed(path: Path, data: dict) -> None:
    """같은 디렉터리에 임시 파일을 쓰고 os.replace 로 갈아끼운다(원자적 교체)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + '\n'
    handle, temp_name = tempfile.mkstemp(dir=str(path.parent), prefix='.reviewed-', suffix='.json')
    try:
        with os.fdopen(handle, 'w', encoding='utf-8') as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, path)
    except BaseException:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise


def set_reviewed(path: Path, slug: str, done: bool) -> dict:
    """한 slug 의 확인 상태를 바꾸고 갱신된 전체 맵을 돌려준다."""
    with _reviewed_lock:
        data = load_reviewed(path)
        if done:
            data[slug] = _now_iso()
        else:
            data.pop(slug, None)
        save_reviewed(path, data)
        return data


def _tail(text: str, limit: int = 2000) -> str:
    text = (text or '').strip()
    return text[-limit:]


def regenerate(sources: list[Path], viewer_path: Path, port: int) -> tuple[int, dict]:
    """generate_viewer.py 를 한 번에 하나만 실행하고 결과를 요약한다."""
    if not _regenerate_lock.acquire(blocking=False):
        return 409, {'ok': False, 'error': '이미 재생성 중입니다.'}
    try:
        try:
            done = subprocess.run(
                [sys.executable, '-m', GENERATOR, '--out', str(viewer_path),
                 *[arg for s in sources for arg in ('--source', str(s))]],
                cwd=str(REPO_ROOT),
                capture_output=True,
                text=True,
                timeout=REGENERATE_TIMEOUT,
                env={**os.environ, 'WEEKLY_VIEWER_PORT': str(port)},
            )
        except subprocess.TimeoutExpired:
            return 500, {
                'ok': False,
                'error': f'재생성이 {REGENERATE_TIMEOUT}초를 넘겨 중단했습니다.',
                'stderr': '',
            }
        except OSError as error:
            return 500, {'ok': False, 'error': f'{GENERATOR} 실행 실패: {error}', 'stderr': ''}

        if done.returncode != 0:
            return 500, {
                'ok': False,
                'error': f'{GENERATOR} 가 종료 코드 {done.returncode} 로 끝났습니다.',
                'stderr': _tail(done.stderr) or _tail(done.stdout),
            }

        stdout = _tail(done.stdout)
        summary: dict = {}
        try:
            parsed = json.loads(stdout)
            if isinstance(parsed, dict):
                summary = parsed
        except json.JSONDecodeError:
            summary = {}
        return 200, {
            'ok': True,
            'reports': summary.get('reports'),
            'latest': summary.get('latest'),
            'size_kb': summary.get('size_kb'),
            'stdout': stdout,
        }
    finally:
        _regenerate_lock.release()


def viewer_mtime(viewer_path: Path) -> str | None:
    if not viewer_path.exists():
        return None
    return datetime.fromtimestamp(viewer_path.stat().st_mtime).astimezone().isoformat(timespec='seconds')


class ViewerHandler(BaseHTTPRequestHandler):
    server_version = 'WeeklyViewerHelper/1.0'
    protocol_version = 'HTTP/1.1'
    sources: list[Path] = []
    viewer_path: Path
    reviewed_path: Path

    # ------------------------------------------------------------ 응답 헬퍼
    def _cors(self) -> None:
        self.send_header('Vary', 'Origin')
        if not self._origin() or not self._origin_allowed():
            return
        self.send_header('Access-Control-Allow-Origin', self._origin())
        self.send_header('Access-Control-Allow-Headers', 'content-type, x-weekly-viewer')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')

    def _send(self, status: int, body: bytes, content_type: str, no_store: bool = False) -> None:
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        if no_store:
            self.send_header('Cache-Control', 'no-store')
        self._cors()
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def _json(self, status: int, payload: dict, no_store: bool = False) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self._send(status, body, 'application/json; charset=utf-8', no_store=no_store)

    def _text(self, status: int, message: str) -> None:
        self._send(status, message.encode('utf-8'), 'text/plain; charset=utf-8')

    # ------------------------------------------------------------ 라우트
    def _route(self) -> str:
        return urlsplit(self.path or '/').path or '/'

    # ------------------------------------------------------------ 오리진 / 호스트
    @property
    def bound_port(self) -> int:
        return int(self.server.server_port)

    def _origin(self) -> str:
        return (self.headers.get('Origin') or '').strip()

    def _origin_allowed(self) -> bool:
        """Origin 헤더가 없으면(curl·직접 내비게이션) 통과, 있으면 화이트리스트만 통과."""
        origin = self._origin()
        return not origin or origin in allowed_origins(self.bound_port)

    def _host_allowed(self) -> bool:
        """DNS rebinding 차단 — 포트는 무시하고 호스트명만 본다."""
        raw = (self.headers.get('Host') or '').strip()
        if not raw:
            return True
        try:
            hostname = urlsplit(f'//{raw}').hostname
        except ValueError:
            return False
        return hostname in ALLOWED_HOSTNAMES

    def _reject_host(self) -> bool:
        if self._host_allowed():
            return False
        self._text(403, '허용되지 않은 Host 헤더입니다.')
        return True

    def _reject_origin(self) -> bool:
        if self._origin_allowed():
            return False
        self._json(403, {'ok': False, 'error': '허용되지 않은 오리진입니다.'})
        return True

    def _read_length(self) -> int | None:
        """Content-Length 를 안전하게 읽는다. 잘못된 값이면 400 후 None."""
        raw = (self.headers.get('Content-Length') or '0').strip()
        try:
            length = int(raw)
        except ValueError:
            self.close_connection = True
            self._json(400, {'ok': False, 'error': f'Content-Length 값을 숫자로 읽지 못했습니다: {raw!r}'})
            return None
        if length < 0:
            self.close_connection = True
            self._json(400, {'ok': False, 'error': 'Content-Length 값이 음수입니다.'})
            return None
        return length

    def _serve_viewer(self) -> None:
        """생성은 POST /api/regenerate 전용 — GET/HEAD 는 절대 subprocess 를 돌리지 않는다."""
        if not self.viewer_path.exists():
            self._text(404, '아직 뷰어가 없습니다. 상단 ↻ 최신화를 누르거나 주간 보고 폴더에 초안 md 를 넣으세요.')
            return
        self._send(200, self.viewer_path.read_bytes(), 'text/html; charset=utf-8', no_store=True)

    def do_OPTIONS(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler 규약
        if self._reject_host():
            return
        self.send_response(204)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self._reject_host():
            return
        route = self._route()
        if route.startswith('/api/') and self._reject_origin():
            return
        if route in VIEWER_ROUTES:
            self._serve_viewer()
            return
        if route == '/api/health':
            self._json(200, {'ok': True, 'viewer': self.viewer_path.exists(), 'mtime': viewer_mtime(self.viewer_path)})
            return
        if route == '/api/reviewed':
            self._json(200, {'ok': True, 'reviewed': load_reviewed(self.reviewed_path)}, no_store=True)
            return
        self._json(404, {'ok': False, 'error': f'알 수 없는 경로입니다: {route}'})

    def do_HEAD(self) -> None:  # noqa: N802
        self.do_GET()

    def do_POST(self) -> None:  # noqa: N802
        route = self._route()
        length = self._read_length()
        if length is None:
            return
        if length > 0:
            self.rfile.read(length)
        if self._reject_host() or self._reject_origin():
            return
        if route == '/api/regenerate':
            if not (self.headers.get(REFRESH_HEADER) or '').strip():
                self._json(403, {'ok': False, 'error': f'{REFRESH_HEADER} 헤더가 필요합니다.'})
                return
            status, payload = regenerate(self.sources, self.viewer_path, self.bound_port)
            self._json(status, payload)
            return
        self._json(404, {'ok': False, 'error': f'알 수 없는 경로입니다: {route}'})

    def do_PUT(self) -> None:  # noqa: N802
        route = self._route()
        length = self._read_length()
        if length is None:
            return
        raw = self.rfile.read(length) if length > 0 else b''
        if self._reject_host() or self._reject_origin():
            return
        if not (self.headers.get(REFRESH_HEADER) or '').strip():
            self._json(403, {'ok': False, 'error': f'{REFRESH_HEADER} 헤더가 필요합니다.'})
            return
        if route != '/api/reviewed':
            self._json(404, {'ok': False, 'error': f'알 수 없는 경로입니다: {route}'})
            return
        try:
            payload = json.loads(raw.decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._json(400, {'ok': False, 'error': '요청 본문을 JSON 으로 읽지 못했습니다.'})
            return
        if not isinstance(payload, dict):
            self._json(400, {'ok': False, 'error': '요청 본문은 JSON 객체여야 합니다.'})
            return
        slug = payload.get('slug')
        if not isinstance(slug, str) or not slug.strip():
            self._json(400, {'ok': False, 'error': 'slug 를 읽지 못했습니다.'})
            return
        try:
            reviewed = set_reviewed(self.reviewed_path, slug.strip(), bool(payload.get('done')))
        except OSError as error:
            self._json(500, {'ok': False, 'error': f'reviewed.json 저장에 실패했습니다: {error}'})
            return
        self._json(200, {'ok': True, 'reviewed': reviewed}, no_store=True)

    # ------------------------------------------------------------ 로그
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write('  %s\n' % (fmt % args))


def make_handler(sources: list[Path], viewer_path: Path, reviewed_path: Path) -> type[BaseHTTPRequestHandler]:
    return type('WeeklyHandler', (ViewerHandler,), {
        'sources': list(sources), 'viewer_path': viewer_path, 'reviewed_path': reviewed_path,
    })
