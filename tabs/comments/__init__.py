"""기획서 코멘트 현황 탭. 탭 안에서 기획서 계정으로 로그인하면 내 코멘트를 실시간으로 조회한다."""
from __future__ import annotations

from pathlib import Path

from dashboard.dispatch import Mount
from dashboard.tab import Field, Tab


def _validate(settings: dict) -> dict[str, str]:
    if not settings["base"].startswith(("http://", "https://")):
        return {"base": "http:// 또는 https:// 로 시작하는 주소를 입력한다"}
    return {}


def _build(settings: dict, state_dir: Path) -> Mount:
    from dashboard.keychain import Keychain

    from .client import TromboneClient
    from .overrides import OverrideStore
    from .serve import make_handler
    from .service import CommentService

    service = CommentService(TromboneClient(settings["base"]), Keychain(), OverrideStore(state_dir / "overrides.json"),
                             Path(settings["export_dir"]) if settings["export_dir"] else None)
    return Mount("comments", make_handler(service))


TAB = Tab(
    "comments", "기획서 코멘트 현황", "💬",
    (
        Field("base", "기획서(TROMBONE) 주소", "text", required=True,
              help="예: http://기획서-서버:8088. 로그인은 탭 안에서 한다. 사내망(VPN)에서만 열린다."),
        Field("export_dir", "체크리스트 저장 폴더", "dir", help="비우면 MD 내보내기를 쓰지 않는다."),
    ),
    build=_build, validate=_validate,
)
