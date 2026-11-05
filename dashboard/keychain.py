"""macOS 키체인(security CLI) 래퍼. 비밀값은 argv 가 아니라 stdin 으로 넘기고, 로그·예외에 싣지 않는다.

저장은 `security -i`(대화형, 명령을 stdin 에서 읽는다)에 `add-generic-password ... -X <hex>` 한 줄을 보낸다.
`-w` 로 값을 stdin·프롬프트에서 읽히면 128바이트에서 잘리기 때문이다. 한 줄 길이 제한(약 4096자) 때문에
hex 로 늘어나기 전 값은 MAX_VALUE_BYTES 까지만 받는다.
값은 ASCII JSON 으로 저장한다(비ASCII 면 find -w 가 hex 로 돌려준다).
"""
from __future__ import annotations

import json
import subprocess

ACCOUNT = "default"
NOT_FOUND = 44
TIMEOUT = 10
MAX_VALUE_BYTES = 1900


class KeychainError(Exception):
    pass


class Keychain:
    def __init__(self, prefix: str = "dobbys-dashboard", run=subprocess.run):
        self._prefix = prefix
        self._run = run

    def _service(self, name: str) -> str:
        return f"{self._prefix}.{name}"

    def _call(self, service: str, args: list[str], stdin: str | None = None):
        """security 실행 자체가 실패하면(잠김으로 인한 시간 초과·명령 없음) KeychainError 로 바꾼다. 비밀값은 싣지 않는다."""
        # 제어 터미널이 있으면 security 가 stdin 대신 /dev/tty 로 물어 보고 멈춘다.
        # 새 세션으로 띄워 터미널을 떼어 내야 stdin 에서 읽는다.
        try:
            return self._run(["security", *args], input=stdin, capture_output=True, text=True, timeout=TIMEOUT,
                             start_new_session=True)
        except subprocess.TimeoutExpired:
            raise KeychainError(f"키체인 응답 시간 초과 ({service})") from None
        except OSError as exc:
            raise KeychainError(f"키체인 명령 실행 실패 ({service}, {type(exc).__name__})") from None

    def get(self, name: str) -> dict | None:
        service = self._service(name)
        done = self._call(service, ["find-generic-password", "-s", service, "-a", ACCOUNT, "-w"])
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
        service = self._service(name)
        secret = json.dumps(value).encode("utf-8")
        if len(secret) > MAX_VALUE_BYTES:
            raise KeychainError(f"키체인에 넣을 값이 너무 길다 ({service})")
        command = f"add-generic-password -U -s {service} -a {ACCOUNT} -X {secret.hex()}\n"
        done = self._call(service, ["-i"], stdin=command)
        # -i 모드는 명령이 실패해도 종료 코드가 0일 수 있어, stderr 에 무엇이든 찍히면 실패로 본다.
        if done.returncode != 0 or done.stderr.strip():
            raise KeychainError(f"키체인 저장 실패 ({service}, 코드 {done.returncode})")

    def delete(self, name: str) -> None:
        service = self._service(name)
        done = self._call(service, ["delete-generic-password", "-s", service, "-a", ACCOUNT])
        if done.returncode not in (0, NOT_FOUND):
            raise KeychainError(f"키체인 삭제 실패 ({self._service(name)}, 코드 {done.returncode})")
