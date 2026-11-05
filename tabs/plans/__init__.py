"""구현 진행 현황 탭. 10-plans 폴더 바로 아래 계획 md 의 frontmatter status·progress 와 체크박스를 모은다."""
from __future__ import annotations

import functools
import sys
from pathlib import Path

from dashboard.dispatch import Mount
from dashboard.tab import Field, Tab


def _build(settings: dict, state_dir: Path) -> Mount:
    from ..assets.assets_serve import Syncer
    from . import plans_index, plans_index_html
    from .plans_serve import make_handler

    folder = Path(settings["folder"])
    syncer = Syncer(functools.partial(plans_index.sync, folder))
    first = syncer.run()
    if not first["ok"]:
        print(f"[WARN] plans 기동 동기화 실패: {first['error']}", file=sys.stderr)
    return Mount("plans", make_handler(syncer, folder, plans_index_html.HTML_NAME))


TAB = Tab(
    "plans", "구현 진행 현황", "🛠️",
    (Field("folder", "10-plans 폴더", "dir", required=True,
           help="계획 md(frontmatter status·progress)와 00_10-plans_기능구분.md 가 있는 폴더."),),
    build=_build,
)
