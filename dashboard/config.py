"""config.json 읽기·쓰기와 온보딩 입력 정규화. 비밀값은 여기 두지 않는다(키체인)."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from pathlib import Path

from dashboard.tab import Field, Tab

VERSION = 1


class ConfigStore:
    def __init__(self, path: Path, clock=time.time):
        self.path = Path(path)
        self._clock = clock

    def load(self) -> dict | None:
        """없으면 None. 깨졌거나 모르는 버전이면 옆으로 치우고 None(온보딩을 다시 띄운다)."""
        try:
            raw = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        try:
            data = json.loads(raw)
            if not isinstance(data, dict) or data.get("version") != VERSION or not isinstance(data.get("tabs"), dict):
                raise ValueError("config 형식이 아니다")
        except ValueError as exc:
            aside = self.path.with_name(f"{self.path.name}.broken-{int(self._clock())}")
            self.path.replace(aside)
            print(f"[WARN] {self.path} 를 읽지 못해 {aside.name} 로 옮겼다: {exc}", file=sys.stderr)
            return None
        return data

    def save(self, data: dict) -> None:
        """임시 파일에 쓰고 교체한다. 권한은 0600."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle, temp = tempfile.mkstemp(dir=self.path.parent, prefix=".config-", suffix=".json")
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as stream:
                json.dump(data, stream, ensure_ascii=False, indent=2)
            os.chmod(temp, 0o600)
            os.replace(temp, self.path)
        except BaseException:
            Path(temp).unlink(missing_ok=True)
            raise


def _path(text: str) -> str:
    return str(Path(os.path.expanduser(text.strip())).resolve())


def _field(field: Field, raw) -> tuple[object, str | None]:
    if field.kind == "dirs":
        items = raw if isinstance(raw, list) else str(raw or "").splitlines()
        paths = [_path(str(item)) for item in items if str(item).strip()]
        if not paths:
            return [], "폴더를 하나 이상 입력한다" if field.required else None
        missing = next((p for p in paths if not Path(p).is_dir()), None)
        return paths, f"폴더가 없다: {missing}" if missing else None
    text = str(raw if raw is not None else "").strip() or field.default
    if not text:
        return "", "필수 항목이다" if field.required else None
    if field.kind == "text":
        return text, None
    path = _path(text)
    if field.kind == "dir" and not Path(path).is_dir():
        return path, "폴더가 없다"
    if field.kind == "file" and not Path(path).is_file():
        return path, "파일이 없다"
    return path, None


def normalize(tabs: dict[str, Tab], submitted) -> tuple[dict, dict]:
    """온보딩 제출값 {"tabs": {id: {key: value}}} → (저장할 config, 오류). 오류가 있으면 config 는 {}."""
    picked = submitted.get("tabs") if isinstance(submitted, dict) else None
    if not isinstance(picked, dict) or not picked:
        return {}, {"_": {"tabs": "탭을 하나 이상 고른다"}}
    errors: dict[str, dict[str, str]] = {}
    clean: dict[str, dict] = {}
    for tab_id, values in picked.items():
        tab = tabs.get(tab_id)
        if tab is None:
            errors["_"] = {"tabs": f"알 수 없는 탭이다: {tab_id}"}
            continue
        values = values if isinstance(values, dict) else {}
        settings, field_errors = {}, {}
        for field in tab.fields:
            settings[field.key], error = _field(field, values.get(field.key))
            if error:
                field_errors[field.key] = error
        if not field_errors:
            field_errors = tab.validate(settings)
        if field_errors:
            errors[tab_id] = field_errors
        clean[tab_id] = settings
    if errors:
        return {}, errors
    return {"version": VERSION, "tabs": clean}, {}
