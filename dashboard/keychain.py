"""macOS 키체인(security CLI) 래퍼. 비밀값은 argv 가 아니라 stdin 으로 넘기고, 로그·예외에 싣지 않는다.

`add-generic-password ... -w` 처럼 -w 를 맨 끝에 두고 값을 빼면 security 가 값과 확인값을 stdin 에서 두 번 읽는다.
값은 ASCII JSON 으로 저장한다(비ASCII 면 find -w 가 hex 로 돌려준다).
"""
from __future__ import annotations

import json
import subprocess

ACCOUNT = "default"
NOT_FOUND = 44
TIMEOUT = 10


class KeychainError(Exception):
    pass


class Keychain:
    def __init__(self, prefix: str = "dobbys-dashboard", run=subprocess.run):
        self._prefix = prefix
        self._run = run

    def _service(self, name: str) -> str:
        return f"{self._prefix}.{name}"

    def _call(self, args: list[str], stdin: str | None = None):
        return self._run(["security", *args], input=stdin, capture_output=True, text=True, timeout=TIMEOUT)

    def get(self, name: str) -> dict | None:
        done = self._call(["find-generic-password", "-s", self._service(name), "-a", ACCOUNT, "-w"])
        if done.returncode == NOT_FOUND:
            return None
        if done.returncode != 0:
            raise KeychainError(f"키체인 읽기 실패 ({self._service(name)}, 코드 {done.returncode})")
        try:
            value = json.loads(done.stdout.strip())
        except ValueError:
            raise KeychainError(f"키체인 값이 JSON 이 아니다 ({self._service(name)})") from None
        if not isinstance(value, dict):
            raise KeychainError(f"키체인 값이 객체가 아니다 ({self._service(name)})")
        return value

    def set(self, name: str, value: dict) -> None:
        secret = json.dumps(value)
        done = self._call(["add-generic-password", "-U", "-s", self._service(name), "-a", ACCOUNT, "-w"],
                          stdin=f"{secret}\n{secret}\n")
        if done.returncode != 0:
            raise KeychainError(f"키체인 저장 실패 ({self._service(name)}, 코드 {done.returncode})")

    def delete(self, name: str) -> None:
        done = self._call(["delete-generic-password", "-s", self._service(name), "-a", ACCOUNT])
        if done.returncode not in (0, NOT_FOUND):
            raise KeychainError(f"키체인 삭제 실패 ({self._service(name)}, 코드 {done.returncode})")
