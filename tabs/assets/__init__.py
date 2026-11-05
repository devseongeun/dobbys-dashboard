"""의사결정 현황 탭. 설정한 폴더 바로 아래 HTML 문서(문의 현황 표·feature/created meta)를 목록으로 만든다."""
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
    return Mount("assets", make_handler(syncer, folder, assets_index_html.html_name(folder)))


TAB = Tab(
    "assets", "의사결정 현황", "🗂️",
    (Field("folder", "의사결정 문서 폴더", "dir", required=True,
           help="회신 대기 문의·확인 요청 HTML과 참고 문서(설명·분석·설계·점검표)가 있는 폴더. "
                "기능 구분·작성일은 각 HTML <head>의 <meta name=\"feature\">·<meta name=\"created\">에서 읽습니다. 예: …/90-assets"),),
    build=_build,
    question="의사결정 기록과 현황을 파악하고 싶어요",
    summary="문의·확인 요청 문서마다 회신 대상과 미결·완료 건수를 모아 봅니다.",
)
