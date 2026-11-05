"""의사결정 현황 탭. 90-assets 폴더 바로 아래 HTML 문서를 TRB 문서 규약대로 목록으로 만든다."""
from __future__ import annotations

import functools
import sys
from pathlib import Path

from dashboard.dispatch import Mount
from dashboard.tab import Field, Tab


def _build(settings: dict, state_dir: Path) -> Mount:
    from . import assets_index, assets_index_html
    from .assets_serve import Syncer, make_handler

    folder = Path(settings["folder"])
    syncer = Syncer(functools.partial(assets_index.sync, folder))
    first = syncer.run()
    if not first["ok"]:
        print(f"[WARN] assets 기동 동기화 실패: {first['error']}", file=sys.stderr)
    return Mount("assets", make_handler(syncer, folder, assets_index_html.HTML_NAME))


TAB = Tab(
    "assets", "의사결정 현황", "🗂️",
    (Field("folder", "90-assets 폴더", "dir", required=True,
           help="의사결정 HTML 문서와 00_90-assets_기능구분.md 가 있는 폴더."),),
    build=_build,
)
