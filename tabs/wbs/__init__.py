"""WBS·Jira 탭. 일정 기준을 고른다: WBS 엑셀 기준(내 행이 기본, Jira 에 로그인하면 Jira 값이 우선) 또는 Jira 기준(엑셀 없이 내 담당 이슈만)."""
from __future__ import annotations

import re
from pathlib import Path

from dashboard.dispatch import Mount
from dashboard.paths import CACHE_ROOT
from dashboard.tab import Field, Tab

DEFAULT_SHEET = "TROMBONE_v4.0.0_WBS(작업)"
DOMAIN_RE = re.compile(r"^[a-z0-9.-]+\.[a-z]{2,}$")
WBS, JIRA = "wbs", "jira"


def mode_of(settings: dict) -> str:
    """일정 기준 필드가 생기기 전 config 에는 mode 가 없다. 그때는 엑셀 기준이었다."""
    return settings.get("mode") or WBS


class NoWbs:
    """Jira 기준: WBS 행이 없다. 보드는 Jira 담당 이슈만으로 행을 만든다(js/model.js joinRows)."""

    def load(self) -> dict:
        return {"tasks": [], "holidays": {}}


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
    if mode_of(settings) != WBS:
        return errors
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
    mode = mode_of(settings)
    source = WbsSource(Path(settings["workbook"]), settings["sheet"], settings["owner"]) if mode == WBS else NoWbs()
    links = LinkStore(state_dir / "links.json")
    session = JiraSession(Keychain(), domain)
    service = BoardService(session, settings["jira_project"], lambda: sorted(set(links.load().values())),
                           CACHE_ROOT / "wbs-jira.json")
    return Mount("wbs", make_handler(service, source, links, session, state_dir / "plan-drafts.json", domain, mode))


TAB = Tab(
    "wbs", "WBS·Jira", "📅",
    (
        Field("mode", "일정 기준", "choice", default=WBS, options=((WBS, "WBS 엑셀 기준"), (JIRA, "Jira 기준")),
              help="WBS 엑셀 기준은 엑셀의 내 행으로 일정을 만들고 Jira에 로그인하면 Jira 값으로 덮습니다. "
                   "Jira 기준은 엑셀 없이 Jira의 내 담당 이슈만 봅니다."),
        Field("workbook", "WBS 엑셀 파일", "file", required=True, help="팀 WBS .xlsx 파일.", when=("mode", WBS)),
        Field("owner", "담당자 이름", "text", required=True, help="엑셀 '담당자' 열의 내 이름. '이름 외 N명' 행도 포함합니다.",
              when=("mode", WBS)),
        Field("sheet", "시트 이름", "text", default=DEFAULT_SHEET, when=("mode", WBS)),
        Field("jira_domain", "Jira 도메인", "text", required=True,
              help="예: yourcompany.atlassian.net. 탭 안에서 로그인합니다."),
        Field("jira_project", "Jira 프로젝트 키", "text", required=True, help="예: PROJ"),
    ),
    build=_build, validate=_validate,
    question="WBS나 Jira 일정을 한눈에 보고 관리하고 싶어요",
    summary="WBS 엑셀 기준이나 Jira 기준 중 하나를 골라 내 담당 일정을 모아요. WBS 기준이면 Jira 티켓과 연결해 Jira 일정과 진행 상황으로 보여 줘요.",
)
