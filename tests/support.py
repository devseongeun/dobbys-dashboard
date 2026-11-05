"""테스트 공용: 임시 포트 서버, HTTP 요청, 메모리 키체인, 탭 하나만 켠 대시보드."""
from __future__ import annotations

import contextlib
import http.client
import io
import json
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

from dashboard.app import Dashboard
from dashboard.config import ConfigStore
from dashboard.dispatch import make_dispatcher
from dashboard.paths import REPO_ROOT


def serve_handler(test, handler) -> int:
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    test.addCleanup(server.server_close)
    test.addCleanup(server.shutdown)
    test.enterContext(contextlib.redirect_stderr(io.StringIO()))
    return server.server_address[1]


def request(test, port, method, path, body=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    test.addCleanup(conn.close)
    conn.request(method, path, body=body, headers=dict(headers or {}))
    response = conn.getresponse()
    return response.status, dict(response.getheaders()), response.read()


def send_json(test, port, method, path, payload=None):
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    status, _, raw = request(test, port, method, path, body=body, headers={"Content-Type": "application/json"})
    return status, json.loads(raw or b"{}")


class MemoryKeychain:
    def __init__(self, items: dict | None = None):
        self.items = dict(items or {})

    def get(self, name):
        return self.items.get(name)

    def set(self, name, value):
        self.items[name] = dict(value)

    def delete(self, name):
        self.items.pop(name, None)


def dashboard_with(test, tab, settings: dict) -> tuple[int, Path]:
    """tab 하나만 켠 대시보드를 띄운다. 설정 검증을 실제로 거친다."""
    root = Path(test.enterContext(tempfile.TemporaryDirectory()))
    dashboard = Dashboard((tab,), ConfigStore(root / "config.json"), root / "state")
    status, body = dashboard.apply({"tabs": {tab.id: settings}})
    test.assertEqual(status, 200, body)
    mount = dashboard.mount(tab.id)
    test.assertIsNone(mount.error, mount.error)
    return serve_handler(test, make_dispatcher(dashboard, REPO_ROOT / "shell")), root / "state" / tab.id
