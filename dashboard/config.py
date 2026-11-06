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
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except ValueError as exc:
            return self._set_aside(exc)
        if not isinstance(data, dict) or data.get("version") != VERSION or not isinstance(data.get("tabs"), dict):
            return self._set_aside(ValueError("config 형식이 아니다"))
        return data

    def _set_aside(self, exc: Exception) -> None:
        """읽지 못한 파일을 broken-<시각> 으로 옮긴다(UTF-8 이 아니거나 JSON·형식이 틀린 경우)."""
        aside = self.path.with_name(f"{self.path.name}.broken-{int(self._clock())}")
        self.path.replace(aside)
        print(f"[WARN] {self.path} 를 읽지 못해 {aside.name} 로 옮겼다: {exc}", file=sys.stderr)
        return None

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
    if field.kind == "choice":
        value = str(raw if raw is not None else "").strip() or field.default
        return (value, None) if value in {option for option, _ in field.options} else (field.default, "목록에 있는 값을 고르세요")
    items = raw if isinstance(raw, list) else [raw]
    if field.kind != "text" and any("\x00" in str(item) for item in items if item is not None):
        return ("" if field.kind != "dirs" else []), "경로 형식이 아닙니다"
    if field.kind == "dirs":
        items = raw if isinstance(raw, list) else str(raw or "").splitlines()
        paths = [_path(str(item)) for item in items if str(item).strip()]
        if not paths:
            return [], "폴더를 하나 이상 입력하세요" if field.required else None
        missing = next((p for p in paths if not Path(p).is_dir()), None)
        return paths, f"폴더가 없습니다: {missing}" if missing else None
    text = str(raw if raw is not None else "").strip() or field.default
    if not text:
        return "", "필수 항목입니다" if field.required else None
    if field.kind == "text":
        return text, None
    path = _path(text)
    if field.kind == "dir" and not Path(path).is_dir():
        return path, "폴더가 없습니다"
    if field.kind == "file" and not Path(path).is_file():
        return path, "파일이 없습니다"
    return path, None


def _project(raw, tabs: dict[str, Tab]) -> tuple[str, str | None]:
    """프로젝트 이름은 상태 폴더 이름으로도 쓴다. 경로 구분자·NUL·숨김 접두어·탭 id 와의 충돌을 막는다."""
    name = str(raw if raw is not None else "").strip()
    if not name:
        return "", "프로젝트 이름을 입력하세요"
    if any(ch in name for ch in "/\\\x00") or name.startswith(".") or name in (".", ".."):
        return name, "폴더 이름에 쓸 수 없는 글자(/ \\ 맨 앞 .)가 있습니다"
    if len(name) > 64:
        return name, "64자 이하로 적으세요"
    if name in tabs:
        return name, "탭 id와 같은 이름은 쓸 수 없습니다"
    return name, None


def normalize(tabs: dict[str, Tab], submitted) -> tuple[dict, dict]:
    """온보딩 제출값 {"project": 이름, "tabs": {id: {key: value}}} → (저장할 config, 오류). 오류가 있으면 config 는 {}."""
    picked = submitted.get("tabs") if isinstance(submitted, dict) else None
    if not isinstance(picked, dict) or not picked:
        return {}, {"_": {"tabs": "탭을 하나 이상 고르세요"}}
    errors: dict[str, dict[str, str]] = {}
    project, error = _project(submitted.get("project"), tabs)
    if error:
        errors["_"] = {"project": error}
    clean: dict[str, dict] = {}
    for tab_id, values in picked.items():
        tab = tabs.get(tab_id)
        if tab is None:
            errors["_"] = {**errors.get("_", {}), "tabs": f"알 수 없는 탭입니다: {tab_id}"}
            continue
        values = values if isinstance(values, dict) else {}
        settings, field_errors = {}, {}
        for field in tab.fields:
            # 조건(when)이 맞지 않는 필드는 화면에 없다. 받지도, 필수로 보지도, 저장하지도 않는다.
            if not field.shown(settings):
                continue
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
    return {"version": VERSION, "project": project, "tabs": clean}, {}
