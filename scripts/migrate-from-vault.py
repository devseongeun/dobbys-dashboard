#!/usr/bin/env python3
"""옛 Vault 안 업무 대시보드 서버 코드의 개인 상태를 dobbys-dashboard 로 한 번 옮긴다.

옮기는 것: 일정 조정 초안, WBS-Jira 수동 연결(자동 매칭과 다른 것만), 주간 보고 확인 상태,
코멘트 우선순위·보류, Jira 자격증명(.jira_config.ini → 키체인). 설정(config.json)은 온보딩에서 입력한다.
"""
from __future__ import annotations

import argparse
import configparser
import importlib.util
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from dashboard.keychain import Keychain  # noqa: E402
from dashboard.paths import STATE_ROOT  # noqa: E402
from tabs.comments.overrides import OverrideStore  # noqa: E402
from tabs.wbs import DEFAULT_SHEET, clean_domain  # noqa: E402
from tabs.wbs.matching import match_keys  # noqa: E402
from tabs.wbs.store import LinkStore, read_json, write_json  # noqa: E402
from tabs.wbs.xlsx import read_wbs  # noqa: E402

HOME = Path.home()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--vault", type=Path, required=True)
    ap.add_argument("--workbook", type=Path, required=True)
    ap.add_argument("--owner", required=True)
    ap.add_argument("--sheet", default=DEFAULT_SHEET)
    ap.add_argument("--jira-ini", type=Path, required=True)
    args = ap.parse_args()
    work = args.vault / "projects" / "work"
    old_wbs = work / "TRB_400/90-assets/wbs-jira/wbs.json"
    old_report_path = work / "TRB_400/20-implementation-notes/scripts/spec_comment_report.py"
    jira_cache = HOME / "Library/Caches/trb-wbs-jira/jira.json"
    for path, message in ((old_wbs, "옛 wbs.json 이 없다"), (old_report_path, "옛 spec_comment_report.py 가 없다"),
                          (args.jira_ini, "Jira 설정 파일이 없다")):
        if not path.is_file():
            print(f"{message}: {path}", file=sys.stderr)
            return 1

    drafts = HOME / "Library/Application Support/trb-wbs-jira/plan-drafts.json"
    if drafts.exists():
        draft_data = read_json(drafts)
        write_json(STATE_ROOT / "wbs" / "plan-drafts.json", draft_data)
        print(f"[OK] 일정 조정 초안 {len(draft_data)}건")

    if jira_cache.is_file():
        _migrate_links(args, read_json(old_wbs), read_json(jira_cache))
    else:
        print(f"[WARN] 옛 Jira 캐시가 없어 자동 매칭 비교를 못 한다: {jira_cache} — WBS-Jira 연결은 옮기지 않는다 (탭에서 로그인하면 자동 매칭된다)")

    reviewed = work / "weekly-report/weekly-report-viewer/reviewed.json"
    if reviewed.exists():
        reviewed_data = read_json(reviewed)
        write_json(STATE_ROOT / "weekly" / "reviewed.json", reviewed_data)
        print(f"[OK] 주간 보고 확인 상태 {len(reviewed_data)}건")

    spec = importlib.util.spec_from_file_location("old_spec_comment_report", old_report_path)
    old_report = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(old_report)
    overrides = OverrideStore(STATE_ROOT / "comments" / "overrides.json")
    for level, table in (("중", old_report.PRIORITY_MID), ("상", old_report.PRIORITY_HIGH)):  # 같은 ID 면 상이 이긴다
        for comment_id, reason in table.items():
            overrides.update(comment_id, {"level": level, "reason": reason}, None)
    for comment_id, reason in old_report.RESOLVED.items():
        overrides.update(comment_id, None, reason)
    data = overrides.load()
    print(f"[OK] 코멘트 우선순위 {len(data['priority'])}건, 보류 {len(data['resolved'])}건")

    ini = configparser.ConfigParser()
    ini.read(args.jira_ini, encoding="utf-8")
    section = ini["jira"]
    Keychain().set("jira", {"domain": clean_domain(section["domain"]), "email": section["email"].strip(),
                            "token": section["api_token"].strip()})
    print("[OK] Jira 자격증명 → 키체인 dobbys-dashboard.jira")
    return 0


def _migrate_links(args: argparse.Namespace, old: dict, cache: dict) -> None:
    issues = {i["key"]: i for i in cache.get("issues", [])}
    tasks = {t["id"]: t for t in read_wbs(args.workbook, args.sheet, args.owner)["tasks"]}
    # 새 보드는 수동 연결 없이 내 담당 이슈만 가져오므로, 자동 매칭 비교도 내 담당 이슈로 한정한다.
    me = (cache.get("me") or {}).get("displayName")
    mine = [i for i in issues.values() if me and i.get("assignee") == me]
    auto = match_keys(list(tasks.values()), mine, {})
    links = LinkStore(STATE_ROOT / "wbs" / "links.json")
    print("[..] WBS-Jira 연결: 자동 매칭과 다른 것만 수동 연결로 옮긴다. 아래 목록을 검토한다.")
    for task in old.get("tasks", []):
        key = task.get("jira")
        if not key:
            continue
        if task["id"] not in tasks:
            print(f"     건너뜀 {task['id']} → {key}: 현재 엑셀에 내 행이 없다")
            continue
        if auto.get(task["id"]) == key:
            continue
        links.set(task["id"], key)
        print(f"     수동 연결 {task['id']} → {key} | WBS: {tasks[task['id']]['name']} | Jira: {issues.get(key, {}).get('summary', '(캐시에 없음)')}")
    print(f"[OK] 자동 매칭 {sum(1 for t in old.get('tasks', []) if auto.get(t['id']) == t.get('jira'))}건, 수동 연결 {len(links.load())}건")


if __name__ == "__main__":
    sys.exit(main())
