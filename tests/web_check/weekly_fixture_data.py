"""주간 보고 Chrome 확인용 예제 폴더 두 개를 JSON 으로 낸다(웹 번들 아님).

사용: python3 tests/web_check/weekly_fixture_data.py <mock_data.py 가 만든 …/DEMO_100/80-weekly>

- 80-weekly: scripts/demo/mock_data.py 의 주간 보고 두 회차(weekly_md) 그대로.
- 80-weekly-old: 같은 초안의 날짜를 4주·5주 앞으로 옮긴 '예전 보고 폴더'(같은 모양, 다른 회차).
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path


def shift(text: str, days: int) -> str:
    return re.sub(r"\d{4}-\d{2}-\d{2}", lambda m: str(date.fromisoformat(m.group(0)) - timedelta(days=days)), text)


def main() -> None:
    current = Path(sys.argv[1])
    reports = {p.name: p.read_text(encoding="utf-8") for p in sorted(current.glob("*.md"))}
    old = {shift(name, 28): shift(text, 28) for name, text in reports.items()}
    print(json.dumps({"80-weekly": reports, "80-weekly-old": old}, ensure_ascii=False))


if __name__ == "__main__":
    main()
