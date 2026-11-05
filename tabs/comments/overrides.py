"""탭에서 지정한 리뷰 표시(우선순위·보류). 기획서에는 없는 축이라 개인 상태 폴더에 둔다."""
from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path


class OverrideStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.Lock()

    def load(self) -> dict:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        data = data if isinstance(data, dict) else {}
        return {"priority": dict(data.get("priority") or {}), "resolved": dict(data.get("resolved") or {})}

    def update(self, comment_id: str, priority: dict | None, resolved: str | None) -> dict:
        with self._lock:
            data = self.load()
            if priority is not None:
                if priority.get("level"):
                    data["priority"][comment_id] = {"level": priority["level"], "reason": priority.get("reason") or ""}
                else:
                    data["priority"].pop(comment_id, None)
            if resolved is not None:
                if resolved:
                    data["resolved"][comment_id] = resolved
                else:
                    data["resolved"].pop(comment_id, None)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            handle, temp = tempfile.mkstemp(dir=self.path.parent, prefix=".overrides-", suffix=".json")
            try:
                with os.fdopen(handle, "w", encoding="utf-8") as stream:
                    json.dump(data, stream, ensure_ascii=False, indent=2)
                os.replace(temp, self.path)
            except BaseException:
                Path(temp).unlink(missing_ok=True)
                raise
            return data
