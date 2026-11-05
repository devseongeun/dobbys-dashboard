"""설정(config.json) → 켜진 탭 마운트. 설정을 저장하면 마운트 표를 통째로 바꾼다(재기동 불필요).

개인 상태는 `<state_root>/<프로젝트>/<탭 id>/` 에 둔다. 프로젝트를 바꾸면 빈 상태에서 시작하고, 돌아오면 그대로 복원된다.
`project` 가 없는 옛 config 는 온보딩(값은 미리 채워짐)으로 보내고, 옛 `<state_root>/<탭 id>/` 는 처음 프로젝트 이름을 정할 때 그 아래로 옮긴다.
"""
from __future__ import annotations

import sys
import threading
from pathlib import Path
from typing import Sequence

from dashboard.config import ConfigStore, normalize
from dashboard.dispatch import Mount
from dashboard.tab import Tab


class Dashboard:
    def __init__(self, tabs: Sequence[Tab], store: ConfigStore, state_root: Path):
        self._tabs = {tab.id: tab for tab in tabs}
        self._order = [tab.id for tab in tabs]
        self._store = store
        self._state_root = Path(state_root)
        self._lock = threading.Lock()
        self.config = store.load()
        self._mounts: dict[str, Mount] = self._build(self.config) if self.project else {}

    @property
    def project(self) -> str | None:
        return self.config.get("project") if self.config else None

    def _state_dir(self, tab_id: str) -> Path:
        state_dir = self._state_root / self.project / tab_id
        legacy = self._state_root / tab_id
        if legacy.is_dir() and not state_dir.exists():
            state_dir.parent.mkdir(parents=True, exist_ok=True)
            legacy.rename(state_dir)
        state_dir.mkdir(parents=True, exist_ok=True)
        return state_dir

    def _build(self, config: dict) -> dict[str, Mount]:
        mounts = {}
        for tab_id in self._order:
            settings = config["tabs"].get(tab_id)
            if settings is None:
                continue
            try:
                state_dir = self._state_dir(tab_id)
                mount = self._tabs[tab_id].build(settings, state_dir)
            except Exception as exc:  # 탭 하나가 실패해도 나머지는 뜬다.
                mount = Mount(tab_id, None, f"{type(exc).__name__}: {exc}")
            if mount.error:
                print(f"[WARN] {tab_id} 초기화 실패: {mount.error}", file=sys.stderr)
            mounts[tab_id] = mount
        return mounts

    def mount(self, mount_id: str) -> Mount | None:
        return self._mounts.get(mount_id)

    def status(self) -> list[dict]:
        return [{"id": m.id, "ok": m.handler is not None, "error": m.error} for m in self._mounts.values()]

    def describe(self) -> dict:
        values = self.config["tabs"] if self.config else {}
        return {
            "configured": self.project is not None,
            "project": self.project or "",
            "tabs": [self._tabs[tab_id].describe() for tab_id in self._order],
            "enabled": [tab_id for tab_id in self._order if tab_id in values],
            "values": values,
        }

    def apply(self, submitted) -> tuple[int, dict]:
        with self._lock:
            config, errors = normalize(self._tabs, submitted)
            if errors:
                return 422, {"errors": errors}
            self._store.save(config)
            self.config = config
            self._mounts = self._build(config)
        return 200, self.describe()
