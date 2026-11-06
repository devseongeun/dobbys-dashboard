import tempfile
import unittest
from datetime import date
from pathlib import Path

from tabs.plans import TAB, plans_index, plans_index_html
from tabs.plans.plans_serve import resolve_plan

DONE_WITH_OPEN = """---
status: 완료
progress: 100
updated: 2026-11-02
---

# 계획

- [x] 끝난 일
- [ ] 체크 안 한 일
  * [X] 들여쓴 하위 항목

```markdown
- [ ] 코드 블록 안 예시는 세지 않는다
```
"""


def write(folder: Path, name: str, text: str) -> Path:
    path = folder / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


class ReadPlanTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.warnings = []

    def read(self, name, text):
        return plans_index.read(write(self.dir, name, text), self.warnings)

    def test_checkboxes_skip_fenced_code_and_flag_done_with_open_items(self):
        plan = self.read("2026-11-01 계획.md", DONE_WITH_OPEN)
        self.assertEqual((plan["checked"], plan["total"]), (2, 3))
        self.assertEqual(plan["state"], "done")
        self.assertTrue(plan["mismatch"])
        self.assertEqual(plan["updated"], "2026-11-02")

    def test_status_spellings_map_to_one_state(self):
        for status, state in (("진행중", "doing"), ("진행 중", "doing"), ("done", "done"), ("할 일", "todo")):
            plan = self.read("2026-11-01 a.md", f"---\nstatus: {status}\n---\n- [ ] x\n")
            self.assertEqual(plan["state"], state, status)
            self.assertEqual(plan["mismatch"], state == "done", status)

    def test_missing_frontmatter_is_reference_and_dates_fall_back_to_filename(self):
        plan = self.read("2026-10-19 인계.md", "# 인계\n\n- [ ] 남은 일\n")
        self.assertEqual((plan["state"], plan["progress"]), ("ref", None))
        self.assertEqual((plan["date"], plan["updated"], plan["title"]), ("2026-10-19", "2026-10-19", "인계"))
        self.assertEqual(self.warnings, [])

    def test_unclosed_frontmatter_is_not_frontmatter(self):
        plan = self.read("2026-10-19 b.md", "---\nstatus: 완료\n# 제목\n")
        self.assertEqual(plan["state"], "ref")

    def test_unknown_status_and_bad_progress_warn(self):
        plan = self.read("2026-10-19 c.md", "---\nstatus: 보류\nprogress: 반쯤\n---\n")
        self.assertEqual((plan["state"], plan["progress"]), ("ref", None))
        self.assertEqual(len(self.warnings), 2)

    def test_progress_is_clamped(self):
        plan = self.read("2026-10-19 d.md", "---\nstatus: 진행중\nprogress: 140\n---\n")
        self.assertEqual(plan["progress"], 100)

    def test_feature_spellings_map_to_one_list(self):
        for raw in ("외부 결재, 배포", "[외부 결재, 배포]", '["외부 결재", "배포"]'):
            plan = self.read("2026-10-19 e.md", f"---\nfeature: {raw}\n---\n")
            self.assertEqual(plan["features"], ["외부 결재", "배포"], raw)
        self.assertEqual(self.read("2026-10-19 f.md", "---\nfeature:\n---\n")["features"], ["미분류"])

    def test_downloaded_template_with_dated_name_reads_as_todo_without_warnings(self):
        name, body = TAB.template("0")
        today = date.today().isoformat()
        self.assertEqual(name, "YYYY-MM-DD 계획 제목.md")  # 내려받는 날과 무관하게 같다. 날짜는 사용자가 채운다
        plan = self.read(name.replace("YYYY-MM-DD", "2026-11-01"), body.decode("utf-8"))
        self.assertEqual(
            (plan["title"], plan["state"], plan["progress"], plan["features"], plan["date"], plan["updated"],
             plan["checked"], plan["total"]),
            ("계획 제목", "todo", 0, ["기능 구분 A", "기능 구분 B"], "2026-11-01", today, 0, 2))
        self.assertEqual(self.warnings, [])


class SyncTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.md, self.html = f"00_{self.dir.name}_목록.md", f"00_{self.dir.name}_목록.html"
        write(self.dir, "2026-11-01 매핑됨.md", "---\nstatus: 진행중\nprogress: 40\nfeature: 외부 결재, 배포\n---\n- [x] a\n- [ ] b\n")
        write(self.dir, "2026-11-02 매핑없음.md", "---\nstatus: 할 일\n---\n")
        write(self.dir, "2026-11-01 매핑됨 부속/report.md", "---\nstatus: 완료\nfeature: 배포\n---\n")

    def test_sync_lists_top_level_plans_and_warns_on_missing_feature(self):
        result = plans_index.sync(self.dir)
        self.assertEqual(result["counts"], {"todo": 1, "doing": 1, "done": 0, "ref": 0, "mismatch": 0})
        self.assertEqual(len(result["warnings"]), 1)
        self.assertIn("매핑없음", result["warnings"][0])
        md = (self.dir / self.md).read_text(encoding="utf-8")
        self.assertIn("| 외부 결재, 배포 | [[2026-11-01 매핑됨.md\\|매핑됨]] | 40% | 1/2 |", md)
        self.assertIn("| 미분류 | [[2026-11-02 매핑없음.md\\|매핑없음]] |", md)
        self.assertNotIn("report", md)
        html = (self.dir / self.html).read_text(encoding="utf-8")
        self.assertIn('href="view.html#2026-11-01%20%EB%A7%A4%ED%95%91%EB%90%A8.md"', html)
        self.assertIn('data-features="외부 결재|배포"', html)
        for text in (md, html):
            self.assertIn("대시보드 화면의 ⟳ 새로고침으로 다시 만든다", text)
            self.assertNotIn("scripts/", text)

    def test_check_mode_reports_stale_without_writing(self):
        self.assertEqual(plans_index.sync(self.dir, check=True)["stale"], [self.md, self.html])
        self.assertFalse((self.dir / self.md).exists())
        plans_index.sync(self.dir)
        self.assertEqual(plans_index.sync(self.dir, check=True)["stale"], [])

    def test_sections_order_by_date_desc_and_groups_by_newest(self):
        # B 묶음이 A 묶음보다 먼저 시작됐지만 최신 작성일(11-05)은 A 라서 A 묶음이 앞이다. 미분류는 맨 뒤다.
        write(self.dir, "2026-11-03 b-old.md", "---\nstatus: 완료\nfeature: B\nupdated: 2026-11-09\n---\n")
        write(self.dir, "2026-11-04 a-old.md", "---\nstatus: 완료\nfeature: A\n---\n")
        write(self.dir, "2026-11-05 a-new.md", "---\nstatus: 완료\nfeature: A\n---\n")
        write(self.dir, "2026-11-04 b-new.md", "---\nstatus: 완료\nfeature: B\n---\n")
        write(self.dir, "2026-11-06 none.md", "---\nstatus: 완료\n---\n")
        sections = plans_index.by_state([plans_index.read(p, []) for p in plans_index.plans_in(self.dir)])
        self.assertEqual([p["file"] for p in sections["done"]],
                         ["2026-11-05 a-new.md", "2026-11-04 a-old.md", "2026-11-04 b-new.md", "2026-11-03 b-old.md", "2026-11-06 none.md"])


class ResolvePlanTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        write(self.dir, "2026-11-01 계획.md", "x")
        write(self.dir, "부속/report.md", "x")
        write(self.dir, ".hidden.md", "x")
        write(self.dir, "notes.txt", "x")
        outside = write(self.dir.parent, f"{self.dir.name}-outside.md", "x")
        self.addCleanup(outside.unlink)

    def test_only_top_level_markdown_is_served(self):
        self.assertIsNotNone(resolve_plan(self.dir, "2026-11-01 계획.md"))
        for name in ("부속/report.md", ".hidden.md", "notes.txt", f"../{self.dir.name}-outside.md",
                     "..", "", "부속\\report.md", "없는파일.md"):
            self.assertIsNone(resolve_plan(self.dir, name), name)


if __name__ == "__main__":
    unittest.main()
