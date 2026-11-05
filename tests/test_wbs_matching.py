import tempfile
import unittest
from pathlib import Path

from tabs.wbs.matching import match_keys
from tabs.wbs.store import LinkStore


def task(task_id, d1, d2, name, d3=None):
    return {"id": task_id, "d1": d1, "d2": d2, "d3": d3, "name": name}


def issue(key, summary):
    return {"key": key, "summary": summary}


class MatchTest(unittest.TestCase):
    def test_full_title_and_d2_omitted_titles_match(self):
        tasks = [task("A", "테스트", "테스트 의뢰 관리", "테스트 의뢰 목록"),
                 task("B", "티켓", "워크플로우 템플릿 관리", "워크플로우 템플릿 관리 목록")]
        issues = [issue("PROJ-1", "테스트 - 테스트 의뢰 관리 - 테스트 의뢰 목록"), issue("PROJ-2", "티켓 - 워크플로우 템플릿 관리 목록")]
        self.assertEqual(match_keys(tasks, issues, {}), {"A": "PROJ-1", "B": "PROJ-2"})

    def test_d3_titles_and_whitespace_case_are_ignored(self):
        tasks = [task("A", "공통", "헤더 영역", "알림 목록", d3="알림")]
        self.assertEqual(match_keys(tasks, [issue("PROJ-3", "공통 -  헤더영역 - 알림 - 알림 목록")], {}), {"A": "PROJ-3"})

    def test_manual_link_wins_and_claims_its_key(self):
        tasks = [task("A", "공통", "대시보드", "대시보드"), task("B", "공통", "대시보드", "대시보드")]
        issues = [issue("PROJ-9", "공통 - 대시보드 - 대시보드")]
        self.assertEqual(match_keys(tasks, issues, {"A": "PROJ-100"}), {"A": "PROJ-100", "B": "PROJ-9"})
        self.assertEqual(match_keys(tasks, issues, {"A": "PROJ-9"}), {"A": "PROJ-9"})

    def test_ambiguous_titles_stay_unlinked(self):
        tasks = [task("A", "공통", "대시보드", "대시보드")]
        issues = [issue("PROJ-1", "공통 - 대시보드 - 대시보드"), issue("PROJ-2", "공통 - 대시보드")]
        self.assertEqual(match_keys(tasks, issues, {}), {})

    def test_same_key_wanted_by_two_rows_stays_unlinked(self):
        tasks = [task("A", "공통", "대시보드", "대시보드"), task("B", "공통", "대시보드", "대시보드")]
        self.assertEqual(match_keys(tasks, [issue("PROJ-9", "공통 - 대시보드 - 대시보드")], {}), {})


class LinkStoreTest(unittest.TestCase):
    def test_set_and_clear_persist(self):
        path = Path(self.enterContext(tempfile.TemporaryDirectory())) / "wbs" / "links.json"
        store = LinkStore(path)
        self.assertEqual(store.load(), {})
        self.assertEqual(store.set("A", "PROJ-1"), {"A": "PROJ-1"})
        self.assertEqual(LinkStore(path).load(), {"A": "PROJ-1"})
        self.assertEqual(store.set("A", None), {})

    def test_set_refuses_to_overwrite_corrupt_file(self):
        path = Path(self.enterContext(tempfile.TemporaryDirectory())) / "links.json"
        path.write_text("{broken", encoding="utf-8")
        with self.assertRaises(ValueError):
            LinkStore(path).set("A", "PROJ-1")
        self.assertEqual(path.read_text(encoding="utf-8"), "{broken")
