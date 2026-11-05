"""dobbys-dashboard 서버. 127.0.0.1 과 ::1 에만 바인딩한다.

- 설정(~/.config/dobbys-dashboard/config.json)이 없으면 셸이 온보딩을 띄운다.
- `/` 는 사이드바 셸, `/<탭 id>/` 는 켜진 탭 handler 로 넘긴다(dashboard/dispatch.py).
- 탭 하나가 초기화에 실패해도 나머지는 뜬다. 실패한 prefix 는 503, 원인은 /_dashboard/status.

사용:
  python3 serve.py              # http://127.0.0.1:8787/
  PORT=8790 python3 serve.py
상주: scripts/install-launchd.sh (README 참고)
"""
import sys

if sys.version_info < (3, 11):
    sys.exit("Python 3.11 이상이 필요하다. python3 --version 을 확인한다.")

import socket  # noqa: E402
import threading  # noqa: E402
from http.server import ThreadingHTTPServer  # noqa: E402

from dashboard.app import Dashboard  # noqa: E402
from dashboard.config import ConfigStore  # noqa: E402
from dashboard.dispatch import make_dispatcher  # noqa: E402
from dashboard.paths import CONFIG_PATH, PORT, REPO_ROOT, STATE_ROOT  # noqa: E402
from tabs import ALL_TABS  # noqa: E402


class V4Server(ThreadingHTTPServer):
    daemon_threads = True


class V6Server(V4Server):
    """localhost 가 ::1 로 먼저 풀리는 환경을 위한 IPv6 루프백 소켓."""
    address_family = socket.AF_INET6


def open_servers(port: int, handler) -> list[ThreadingHTTPServer]:
    """127.0.0.1 은 반드시, ::1 은 열 수 있으면 같은 포트로 연다."""
    servers: list[ThreadingHTTPServer] = []
    for host, cls in (("127.0.0.1", V4Server), ("::1", V6Server)):
        try:
            server = cls((host, port), handler)
        except OSError as error:
            if not servers:
                raise
            print(f"[WARN] {host}:{port} 를 열지 못했다 ({error})", file=sys.stderr)
            continue
        servers.append(server)
        port = server.server_port
    return servers


def main() -> int:
    dashboard = Dashboard(ALL_TABS, ConfigStore(CONFIG_PATH), STATE_ROOT)
    try:
        servers = open_servers(PORT, make_dispatcher(dashboard, REPO_ROOT / "shell"))
    except OSError as error:
        print(f"{PORT} 포트를 열지 못했다: {error}", file=sys.stderr)
        return 1
    print(f"http://127.0.0.1:{servers[0].server_port}/  (도비의 대시보드, Ctrl+C 로 종료)")
    for server in servers[1:]:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        servers[0].serve_forever()
    except KeyboardInterrupt:
        print("\n종료")
    finally:
        for server in servers:
            server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
