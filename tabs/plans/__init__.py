"""구현 진행 현황 탭. 설정한 폴더 바로 아래 계획 md 의 frontmatter status·progress·feature 와 체크박스를 모은다."""
from __future__ import annotations

import functools
import sys
from pathlib import Path

from dashboard.dispatch import Mount
from dashboard.tab import Field, Tab, Template


def _build(settings: dict, state_dir: Path) -> Mount:
    from ..assets.assets_serve import Syncer
    from . import plans_index, plans_index_html
    from .plans_serve import make_handler

    folder = Path(settings["folder"])
    syncer = Syncer(functools.partial(plans_index.sync, folder))
    first = syncer.run()
    if not first["ok"]:
        print(f"[WARN] plans 기동 동기화 실패: {first['error']}", file=sys.stderr)
    return Mount("plans", make_handler(syncer, folder, plans_index_html.html_name(folder)))


TAB = Tab(
    "plans", "구현 진행 현황", "🛠️",
    (Field("folder", "구현 계획 폴더", "dir", required=True,
           help="계획 md가 쌓이는 폴더. 파일명은 'YYYY-MM-DD 제목.md', frontmatter status, progress, feature를 읽습니다. 예: …/10-plans"),),
    build=_build,
    question="구현이 어디까지 진행됐는지 한눈에 보고 싶어요",
    summary="구현 계획 md의 상태, 진행률, 체크 항목을 기능별로 모아 봐요.",
    templates=(Template(Path(__file__).parent / "templates" / "YYYY-MM-DD 계획 제목.md",
                        help="frontmatter status, progress, feature, updated가 들어 있습니다. 폴더에 넣고 파일명의 YYYY-MM-DD를 작성일로, 제목과 값을 고쳐 쓰세요."),),
)
