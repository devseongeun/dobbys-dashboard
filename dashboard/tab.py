"""탭 플러그인 계약. tabs/<id>/__init__.py 가 TAB 하나를 내보낸다."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Callable

from dashboard.dispatch import Mount


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


TODAY = "{{TODAY}}"


@dataclass(frozen=True)
class Template:
    """온보딩·설정에서 내려받는 문서 템플릿. 파일명은 그대로 주고, 본문의 {{TODAY}} 만 내려받는 날(YYYY-MM-DD)로 바꾼다."""
    path: Path
    help: str = ""

    def body(self) -> bytes:
        return self.path.read_text(encoding="utf-8").replace(TODAY, date.today().isoformat()).encode("utf-8")


@dataclass(frozen=True)
class Tab:
    id: str
    label: str
    icon: str
    fields: tuple[Field, ...]
    build: Callable[[dict, Path], Mount]
    validate: Callable[[dict], dict[str, str]] = no_checks
    question: str = ""  # 첫 온보딩에서 묻는 불편 지점. 비면 셸이 "{label} 탭을 쓸까요?"로 묻는다.
    summary: str = ""  # 질문 아래 한 줄 설명: 예를 고르면 무엇을 보게 되는지.
    templates: tuple[Template, ...] = ()  # 형식이 정해진 문서를 처음 만들 때 쓰는 템플릿. 순번이 내려받기 주소다.

    def describe(self) -> dict:
        return {
            "id": self.id, "label": self.label, "icon": self.icon, "src": f"/{self.id}/",
            "question": self.question, "summary": self.summary,
            "fields": [
                {"key": f.key, "label": f.label, "kind": f.kind, "required": f.required, "default": f.default, "help": f.help}
                for f in self.fields
            ],
            "templates": [
                {"name": t.path.name, "help": t.help, "url": f"/_dashboard/templates/{self.id}/{i}"}
                for i, t in enumerate(self.templates)
            ],
        }

    def template(self, index: str) -> tuple[str, bytes] | None:
        """내려받기 주소의 순번 → (파일명, 본문). 없는 순번이면 None."""
        if not index.isascii() or not index.isdigit() or int(index) >= len(self.templates):
            return None
        found = self.templates[int(index)]
        return found.path.name, found.body()
