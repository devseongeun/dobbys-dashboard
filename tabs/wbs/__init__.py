"""WBS·Jira 탭. 팀 WBS 엑셀의 내 행이 기본이고, Jira 에 로그인하면 Jira 값이 우선한다."""
from __future__ import annotations

import re
from pathlib import Path

from dashboard.dispatch import Mount
from dashboard.paths import CACHE_ROOT
from dashboard.tab import Field, Tab

DEFAULT_SHEET = "TROMBONE_v4.0.0_WBS(작업)"
DOMAIN_RE = re.compile(r"^[a-z0-9.-]+\.[a-z]{2,}$")


def clean_domain(raw: str) -> str:
    return raw.strip().removeprefix("https://").removeprefix("http://").strip("/").lower()


def _validate(settings: dict) -> dict[str, str]:
    from .jira import PROJECT_RE
    from .xlsx import XlsxError, read_wbs

    errors = {}
    if not DOMAIN_RE.match(clean_domain(settings["jira_domain"])):
        errors["jira_domain"] = "도메인 형식이 아닙니다(예: example.atlassian.net)"
    if not PROJECT_RE.match(settings["jira_project"]):
        errors["jira_project"] = "프로젝트 키는 영문 대문자로 시작합니다(예: PROJ)"
    try:
        read_wbs(Path(settings["workbook"]), settings["sheet"], settings["owner"])
    except XlsxError as exc:
        errors[exc.field] = str(exc)
    return errors


def _build(settings: dict, state_dir: Path) -> Mount:
    from dashboard.keychain import Keychain

    from .board import BoardService
    from .serve import make_handler
    from .session import JiraSession
    from .store import LinkStore
    from .xlsx import WbsSource

    domain = clean_domain(settings["jira_domain"])
    source = WbsSource(Path(settings["workbook"]), settings["sheet"], settings["owner"])
    links = LinkStore(state_dir / "links.json")
    session = JiraSession(Keychain(), domain)
    service = BoardService(session, settings["jira_project"], lambda: sorted(set(links.load().values())),
                           CACHE_ROOT / "wbs-jira.json")
    return Mount("wbs", make_handler(service, source, links, session, state_dir / "plan-drafts.json", domain))


TAB = Tab(
    "wbs", "WBS·Jira", "📅",
    (
        Field("workbook", "WBS 엑셀 파일", "file", required=True, help="팀 WBS .xlsx 파일."),
        Field("owner", "담당자 이름", "text", required=True, help="엑셀 '담당자' 열의 내 이름. '이름 외 N명' 행도 포함합니다."),
        Field("sheet", "시트 이름", "text", default=DEFAULT_SHEET),
        Field("jira_domain", "Jira 도메인", "text", required=True,
              help="예: yourcompany.atlassian.net. 탭 안에서 로그인합니다."),
        Field("jira_project", "Jira 프로젝트 키", "text", required=True, help="예: PROJ"),
    ),
    build=_build, validate=_validate,
    question="내 담당 기능 WBS가 궁금해요",
    summary="WBS 엑셀에서 내 담당 행을 모아 일정을 보고, Jira 이슈와 이어 진행 상황을 함께 봅니다.",
)
