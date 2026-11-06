"""주간 보고 탭. 초안 md 폴더(여러 개)를 읽어 단일 HTML 뷰어를 만들고, 확인 상태는 개인 상태 폴더에 둔다."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from dashboard.dispatch import Mount
from dashboard.paths import PORT
from dashboard.tab import Field, Tab

VIEWER_NAME = "weekly-report-viewer.html"
SOURCES_NAME = "sources.json"  # 뷰어를 구운 폴더 목록. 설정이 바뀌면 다시 굽는다.


def _build(settings: dict, state_dir: Path) -> Mount:
    from .serve import make_handler, regenerate

    sources = [Path(p) for p in settings["folders"]]
    viewer = state_dir / VIEWER_NAME
    recorded = state_dir / SOURCES_NAME
    folders = [str(p) for p in sources]
    try:
        previous = json.loads(recorded.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        previous = None
    if not viewer.exists() or previous != folders:
        status, result = regenerate(sources, viewer, PORT)
        if status == 200:
            recorded.write_text(json.dumps(folders, ensure_ascii=False), encoding="utf-8")
        else:
            print(f"[WARN] weekly 뷰어 생성 실패: {result.get('error')} {result.get('stderr', '')}", file=sys.stderr)
    return Mount("weekly", make_handler(sources, viewer, state_dir / "reviewed.json"))


TAB = Tab(
    "weekly", "주간 보고", "📝",
    (Field("folders", "주간 보고 폴더", "dirs", required=True,
           help="주간 보고 초안 md가 쌓이는 폴더. 예전 보고 폴더가 따로 있으면 한 줄씩 더 적으세요."),),
    build=_build,
    question="주간 보고 초안을 챙기고 싶어요",
    summary="주간 보고 폴더의 초안 md를 모아 봐요.",
)
