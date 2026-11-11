"""`/api/<이름>` 모듈이 주고받는 요청·응답. web_serve.py 가 만들어 `handle(request) -> Response` 로 넘긴다.

- 서버가 먼저 Host·Origin·`X-Dobbys-Proxy: 1`·본문 64 KiB 한도를 검사한다. 모듈은 자기 규칙(메서드·경로·대상)만 본다.
- 응답 헤더에 보안 헤더(CSP·nosniff·Referrer-Policy)와 Content-Length 는 서버가 덧붙인다.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Mapping


@dataclass(frozen=True)
class Request:
    method: str
    path: str  # 쿼리를 뗀 요청 경로(예: /api/version)
    query: dict[str, list[str]]
    headers: Mapping[str, str]  # 대소문자 무시(http.client.HTTPMessage)
    body: bytes = b""


@dataclass
class Response:
    status: int
    headers: dict[str, str] = field(default_factory=dict)
    body: bytes = b""


def json_response(status: int, payload) -> Response:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    return Response(status, {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}, body)
