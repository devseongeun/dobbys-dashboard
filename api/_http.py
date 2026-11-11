"""웹 서버(web_serve.py)와 api/<이름>.py 사이의 요청·응답 모양(공통 계약). web-core 가 내용을 채운다."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping


@dataclass(frozen=True)
class Request:
    method: str
    path: str
    query: dict[str, list[str]]
    headers: Mapping[str, str]
    body: bytes = b""


@dataclass
class Response:
    status: int
    headers: dict = field(default_factory=dict)
    body: bytes = b""
