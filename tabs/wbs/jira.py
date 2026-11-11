"""옛 경로 호환. Jira 클라이언트는 저장소 루트 jira_client.py(표준 라이브러리만)로 옮겼다.

웹 프록시(api/jira.py)가 tabs 패키지를 끌고 오지 않으려고 옮긴 것이라, 이 파일은 같은 객체를 다시 내보내기만 한다.
새 코드는 jira_client 를 import 한다.
"""
from jira_client import (  # noqa: F401
    ACCOUNT_RE,
    DOMAIN_RE,
    FIELDS,
    KEY_RE,
    LOOKUP_FIELDS,
    LOOKUP_LIMIT,
    PROJECT_RE,
    TIMEOUT_SECONDS,
    JiraClient,
    JiraConfig,
    JiraError,
    adf_to_text,
    build_jql,
    build_key_jql,
)

__all__ = [
    "ACCOUNT_RE", "DOMAIN_RE", "FIELDS", "KEY_RE", "LOOKUP_FIELDS", "LOOKUP_LIMIT", "PROJECT_RE", "TIMEOUT_SECONDS",
    "JiraClient", "JiraConfig", "JiraError", "adf_to_text", "build_jql", "build_key_jql",
]
