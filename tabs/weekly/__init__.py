"""주간 보고 탭. 초안 md 폴더(여러 개)를 읽어 단일 HTML 뷰어를 만들고, 확인 상태는 개인 상태 폴더에 둔다."""
from __future__ import annotations

import sys
from pathlib import Path

from dashboard.dispatch import Mount
from dashboard.paths import PORT
from dashboard.tab import Field, Tab

VIEWER_NAME = "weekly-report-viewer.html"


def _build(settings: dict, state_dir: Path) -> Mount:
    from .serve import make_handler, regenerate

    sources = [Path(p) for p in settings["folders"]]
    viewer = state_dir / VIEWER_NAME
    if not viewer.exists():
        status, result = regenerate(sources, viewer, PORT)
        if status != 200:
            print(f"[WARN] weekly 뷰어 생성 실패: {result.get('error')} {result.get('stderr', '')}", file=sys.stderr)
    return Mount("weekly", make_handler(sources, viewer, state_dir / "reviewed.json"))


TAB = Tab(
    "weekly", "주간 보고", "📝",
    (Field("folders", "주간 보고 폴더", "dirs", required=True,
           help="주간 보고 초안 md 가 쌓이는 폴더. 예전 보고 폴더가 따로 있으면 한 줄씩 더 적는다."),),
    build=_build,
)
