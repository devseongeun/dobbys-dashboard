"""Jira 로그인 상태. 이메일·API token 은 키체인(dobbys-dashboard.jira)에만 둔다."""
from __future__ import annotations

from .jira import JiraClient, JiraConfig

KEY = "jira"


class JiraSession:
    def __init__(self, keychain, domain: str, client_cls=JiraClient):
        self._keychain = keychain
        self._domain = domain
        self._client_cls = client_cls

    def _client_for(self, email: str, token: str):
        return self._client_cls(JiraConfig(f"https://{self._domain}", email, token))

    def client(self):
        creds = self._keychain.get(KEY)
        if not creds or creds.get("domain") != self._domain or not creds.get("email") or not creds.get("token"):
            return None
        return self._client_for(creds["email"], creds["token"])

    def login(self, email: str, token: str) -> dict:
        """/myself 로 신원을 확인한 뒤에만 저장한다. 실패하면 JiraError."""
        me = self._client_for(email, token).myself()
        self._keychain.set(KEY, {"domain": self._domain, "email": email, "token": token})
        return me

    def logout(self) -> None:
        self._keychain.delete(KEY)
