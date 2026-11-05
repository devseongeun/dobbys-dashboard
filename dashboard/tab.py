"""탭 플러그인 계약. tabs/<id>/__init__.py 가 TAB 하나를 내보낸다."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from dashboard.dispatch import Mount

KINDS = ("dir", "dirs", "file", "text")


def no_checks(settings: dict) -> dict[str, str]:
    return {}


@dataclass(frozen=True)
class Field:
    key: str
    label: str
    kind: str
    required: bool = False
    default: str = ""
    help: str = ""


@dataclass(frozen=True)
class Tab:
    id: str
    label: str
    icon: str
    fields: tuple[Field, ...]
    build: Callable[[dict, Path], Mount]
    validate: Callable[[dict], dict[str, str]] = no_checks

    def describe(self) -> dict:
        return {
            "id": self.id, "label": self.label, "icon": self.icon, "src": f"/{self.id}/",
            "fields": [
                {"key": f.key, "label": f.label, "kind": f.kind, "required": f.required, "default": f.default, "help": f.help}
                for f in self.fields
            ],
        }
