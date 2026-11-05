import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from tabs.weekly import TAB
from dashboard.app import Dashboard
from dashboard.config import ConfigStore
from dashboard.dispatch import make_dispatcher
from dashboard.paths import REPO_ROOT
from tests.support import dashboard_with, raw_exchange, request, serve_handler
from tests.test_report_parser import REPORT


class WeeklyMountTest(unittest.TestCase):
    def setUp(self):
        self.folder = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        (self.folder / "2026-11-02~ 2026-11-08-weekly-report.md").write_text(
            REPORT.format(date="2026-11-02", start="2026-10-26", end="2026-11-01", title="새 보고서"), encoding="utf-8")
        self.port, self.state = dashboard_with(self, TAB, {"folders": [str(self.folder)]})

    def test_viewer_is_built_into_state_dir_on_first_mount(self):
        self.assertTrue((self.state / "weekly-report-viewer.html").exists())
        self.assertEqual(request(self, self.port, "GET", "/weekly/")[0], 200)

    def test_health_and_origin_rules(self):
        status, _, body = request(self, self.port, "GET", "/weekly/api/health")
        self.assertEqual((status, json.loads(body)["ok"]), (200, True))
        allowed = {"Origin": f"http://127.0.0.1:{self.port}"}
        self.assertEqual(request(self, self.port, "GET", "/weekly/api/health", headers=allowed)[0], 200)
        self.assertEqual(request(self, self.port, "GET", "/weekly/api/health", headers={"Origin": "http://evil.example.com"})[0], 403)

    def test_reviewed_is_stored_in_state_dir(self):
        status, _, _ = request(self, self.port, "PUT", "/weekly/api/reviewed", body=b'{"slug":"w1","done":true}',
                               headers={"Content-Type": "application/json", "X-Weekly-Viewer": "1"})
        self.assertEqual(status, 200)
        self.assertIn("w1", json.loads((self.state / "reviewed.json").read_text(encoding="utf-8")))

    def test_reviewed_put_requires_header(self):
        status, _, _ = request(self, self.port, "PUT", "/weekly/api/reviewed", body=b'{"slug":"x","done":true}',
                               headers={"Content-Type": "application/json"})
        self.assertEqual(status, 403)

    def test_bad_content_length_closes_connection(self):
        raw = raw_exchange(self.port, b"POST /weekly/api/regenerate HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: abc\r\n\r\n")
        self.assertIn(b" 400 ", raw.split(b"\r\n", 1)[0])


class WeeklyEmptyFolderTest(unittest.TestCase):
    def test_folder_without_reports_still_mounts_and_explains(self):
        self.enterContext(contextlib.redirect_stderr(io.StringIO()))
        empty = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        port, _ = dashboard_with(self, TAB, {"folders": [str(empty)]})
        status, _, body = request(self, port, "GET", "/weekly/")
        self.assertEqual(status, 404)
        self.assertIn("최신화", body.decode("utf-8"))


class WeeklyFolderChangeTest(unittest.TestCase):
    def test_saving_new_folders_rebuilds_viewer_without_regenerate(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        a, b = root / "a", root / "b"
        a.mkdir()
        b.mkdir()
        (a / "2026-11-02~ 2026-11-08-weekly-report.md").write_text(
            REPORT.format(date="2026-11-02", start="2026-10-26", end="2026-11-01", title="A 보고서"), encoding="utf-8")
        (b / "2026-10-26~ 2026-11-01-weekly-report.md").write_text(
            REPORT.format(date="2026-10-26", start="2026-10-19", end="2026-10-25", title="B전용보고서"), encoding="utf-8")
        dashboard = Dashboard((TAB,), ConfigStore(root / "config.json"), root / "state")
        self.assertEqual(dashboard.apply({"tabs": {"weekly": {"folders": [str(a)]}}})[0], 200)
        port = serve_handler(self, make_dispatcher(dashboard, REPO_ROOT / "shell"))
        self.assertNotIn("B전용보고서", request(self, port, "GET", "/weekly/")[2].decode("utf-8"))
        self.assertEqual(dashboard.apply({"tabs": {"weekly": {"folders": [str(a), str(b)]}}})[0], 200)
        self.assertIn("B전용보고서", request(self, port, "GET", "/weekly/")[2].decode("utf-8"))
