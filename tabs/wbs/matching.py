"""WBS 행 ↔ Jira 이슈 연결. 수동 연결이 먼저고, 제목이 정확히 한 이슈와만 맞을 때만 자동으로 잇는다."""
from __future__ import annotations

import re
from collections import Counter, defaultdict


def _norm(text: str | None) -> str:
    return re.sub(r"\s+", "", text or "").casefold()


def title_candidates(task: dict) -> set[str]:
    d1, d2, d3, name = (task.get(k) for k in ("d1", "d2", "d3", "name"))
    if not name:
        return set()
    shapes = ((d1, d2, name), (d1, name), (d1, d2, d3, name), (d1, d3, name))
    return {_norm("-".join(part for part in shape if part)) for shape in shapes}


def match_keys(tasks: list[dict], issues: list[dict], links: dict[str, str]) -> dict[str, str]:
    by_title: dict[str, set[str]] = defaultdict(set)
    for issue in issues:
        by_title[_norm(issue.get("summary"))].add(issue["key"])
    manual = {task["id"]: links[task["id"]] for task in tasks if task["id"] in links}
    claimed = set(manual.values())
    wanted: dict[str, str] = {}
    for task in tasks:
        if task["id"] in manual:
            continue
        hits = set().union(*(by_title.get(title, set()) for title in title_candidates(task)))
        if len(hits) == 1:
            wanted[task["id"]] = next(iter(hits))
    counts = Counter(wanted.values())
    auto = {task_id: key for task_id, key in wanted.items() if counts[key] == 1 and key not in claimed}
    return {**manual, **auto}
