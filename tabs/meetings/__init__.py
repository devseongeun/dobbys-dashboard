"""회의 자료 탭. Vault 안 회의 폴더의 Obsidian Canvas(.canvas) 하나가 업무 하나, 그 안의 그룹 하나가 회의 하나다."""
from __future__ import annotations

from pathlib import Path

from dashboard.dispatch import Mount
from dashboard.tab import Field, Tab

OUTSIDE_VAULT = "Obsidian Vault 안의 폴더를 지정하세요(.obsidian 폴더가 없습니다)"


def find_vault(folder: Path) -> Path | None:
    """folder 와 그 위로 올라가며 .obsidian 폴더가 있는 첫 경로. Canvas 의 file 노드는 Vault 상대 경로다."""
    folder = Path(folder).resolve()
    for candidate in (folder, *folder.parents):
        if (candidate / ".obsidian").is_dir():
            return candidate
    return None


def _validate(settings: dict) -> dict[str, str]:
    return {} if find_vault(Path(settings["folder"])) else {"folder": OUTSIDE_VAULT}


def _build(settings: dict, state_dir: Path) -> Mount:
    from .meetings_serve import make_handler

    folder = Path(settings["folder"])
    vault = find_vault(folder)
    if vault is None:
        raise ValueError(OUTSIDE_VAULT)
    return Mount("meetings", make_handler(folder, vault))


TAB = Tab(
    "meetings", "회의 자료", "📎",
    (Field("folder", "회의 폴더", "dir", required=True,
           help="업무별 Canvas를 둘 Vault 안 폴더(예: …/TRB_400/70-meetings). Canvas 파일 카드는 이 Vault 기준으로 엽니다."),),
    build=_build, validate=_validate,
    question="회의 때 볼 자료를 한곳에 모아 두고 싶어요",
    summary="업무마다 회의 블록을 두고 Vault 파일과 웹 링크를 담아 둬요. Obsidian Vault가 필요하고, Obsidian Canvas에서도 열 수 있어요.",
)
