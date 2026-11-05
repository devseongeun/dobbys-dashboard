import json
import tempfile
import unittest
import urllib.parse
from pathlib import Path

from tabs.plans import TAB
from tests.support import dashboard_with, request

PLAN = "2026-11-03 티켓 초기화 시 외부 결재 회수.md"


class PlansMountTest(unittest.TestCase):
    def setUp(self):
        self.folder = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        (self.folder / PLAN).write_text("---\nstatus: 진행 중\nprogress: 40\n---\n- [x] a\n- [ ] b\n", encoding="utf-8")
        sub = self.folder / "2026-10-19 testMng FE 4.0.0 이관 부속"
        sub.mkdir()
        (sub / "decisions.md").write_text("# 부속", encoding="utf-8")
        self.port, _ = dashboard_with(self, TAB, {"folder": str(self.folder)})

    def get(self, path):
        return request(self, self.port, "GET", path)

    def test_list_viewer_and_raw_markdown_are_served(self):
        self.assertEqual(self.get("/plans/")[0], 200)
        self.assertEqual(self.get("/plans/view.html")[0], 200)
        self.assertEqual(self.get("/plans/marked.umd.js")[0], 200)
        status, _, body = self.get("/plans/raw/" + urllib.parse.quote(PLAN))
        self.assertEqual((status, body.decode("utf-8").splitlines()[1]), (200, "status: 진행 중"))

    def test_raw_rejects_sources_subfolders_and_traversal(self):
        sub = urllib.parse.quote("2026-10-19 testMng FE 4.0.0 이관 부속/decisions.md")
        for path in ("/plans/raw/" + sub, "/plans/raw/..%2F00-index%2FTRB_400.md", "/plans/raw/%2e%2e/00-index/TRB_400.md",
                     "/plans/raw/.gitkeep", "/plans/plans_serve.py", "/plans/raw/plans_view.html"):
            self.assertEqual(self.get(path)[0], 404, path)

    def test_api_resyncs_the_configured_folder(self):
        status, _, body = self.get("/plans/api/plans?refresh=1")
        self.assertEqual((status, json.loads(body)["counts"]["doing"]), (200, 1))
        self.assertTrue((self.folder / "00_10-plans_목록.html").exists())
