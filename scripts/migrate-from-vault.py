#!/usr/bin/env python3
"""옛 work-dashboard(Vault 안 서버 코드)의 개인 상태를 dobbys-dashboard 로 한 번 옮긴다.

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

    drafts = HOME / "Library/Application Support/trb-wbs-jira/plan-drafts.json"
    if drafts.exists():
        write_json(STATE_ROOT / "wbs" / "plan-drafts.json", read_json(drafts))
        print(f"[OK] 일정 조정 초안 {len(read_json(drafts))}건")

    old = read_json(work / "TRB_400/90-assets/wbs-jira/wbs.json")
    issues = {i["key"]: i for i in read_json(HOME / "Library/Caches/trb-wbs-jira/jira.json").get("issues", [])}
    tasks = {t["id"]: t for t in read_wbs(args.workbook, args.sheet, args.owner)["tasks"]}
    auto = match_keys(list(tasks.values()), list(issues.values()), {})
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

    reviewed = work / "weekly-report/weekly-report-viewer/reviewed.json"
    if reviewed.exists():
        write_json(STATE_ROOT / "weekly" / "reviewed.json", read_json(reviewed))
        print(f"[OK] 주간 보고 확인 상태 {len(read_json(reviewed))}건")

    spec = importlib.util.spec_from_file_location(
        "old_spec_comment_report", work / "TRB_400/20-implementation-notes/scripts/spec_comment_report.py")
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


if __name__ == "__main__":
    sys.exit(main())
