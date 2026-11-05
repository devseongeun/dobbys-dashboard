"""WBS 탭 개인 상태 파일(초안·수동 연결). 임시 파일에 쓰고 교체해 쓰는 도중 꺼져도 기존 파일이 깨지지 않게 한다."""
from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path


def read_json(path: Path) -> dict:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def write_json(path: Path, data: dict) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.stem}-", suffix=".json")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(data, stream, ensure_ascii=False, indent=2)
        os.replace(temp, path)
    except BaseException:
        Path(temp).unlink(missing_ok=True)
        raise


class LinkStore:
    """요구사항ID → Jira 이슈키 수동 연결."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.Lock()

    def load(self) -> dict[str, str]:
        return {k: v for k, v in read_json(self.path).items() if isinstance(k, str) and isinstance(v, str)}

    def set(self, task_id: str, key: str | None) -> dict[str, str]:
        with self._lock:
            data = self.load()
            if key:
                data[task_id] = key
            else:
                data.pop(task_id, None)
            write_json(self.path, data)
            return data
