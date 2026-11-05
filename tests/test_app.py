import contextlib
import io
import json
import tempfile
import unittest
from http.server import BaseHTTPRequestHandler
from pathlib import Path

from dashboard.app import Dashboard
from dashboard.config import ConfigStore
from dashboard.dispatch import Mount
from dashboard.tab import Field, Tab


class EchoHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()


def recording_tab(tab_id, calls, fail=False):
    def build(settings, state_dir):
        calls.append((tab_id, settings, state_dir))
        if fail:
            raise RuntimeError("폴더가 사라졌다")
        return Mount(tab_id, EchoHandler)

    return Tab(tab_id, tab_id.upper(), "•", (Field("folder", "폴더", "dir", required=True),), build=build)


class DashboardTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(contextlib.redirect_stderr(io.StringIO()))
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        self.folder = self.root / "docs"
        self.folder.mkdir()
        self.calls = []
        self.tabs = (recording_tab("a", self.calls), recording_tab("b", self.calls), recording_tab("bad", self.calls, fail=True))
        self.store = ConfigStore(self.root / "config.json")

    def make(self):
        return Dashboard(self.tabs, self.store, self.root / "state")

    def test_unconfigured_describes_all_tabs_and_mounts_nothing(self):
        dashboard = self.make()
        described = dashboard.describe()
        self.assertEqual((described["configured"], described["enabled"]), (False, []))
        self.assertEqual([t["id"] for t in described["tabs"]], ["a", "b", "bad"])
        self.assertIsNone(dashboard.mount("a"))

    def test_invalid_submission_is_422_and_keeps_previous_config(self):
        dashboard = self.make()
        self.assertEqual(dashboard.apply({"tabs": {"a": {"folder": str(self.folder)}}})[0], 200)
        status, body = dashboard.apply({"tabs": {"b": {"folder": ""}}})
        self.assertEqual((status, body), (422, {"errors": {"b": {"folder": "필수 항목이다"}}}))
        self.assertIsNotNone(dashboard.mount("a"))
        self.assertEqual(json.loads(self.store.path.read_text(encoding="utf-8"))["tabs"], {"a": {"folder": str(self.folder)}})

    def test_valid_submission_mounts_only_selected_tabs_in_tab_order(self):
        dashboard = self.make()
        status, body = dashboard.apply({"tabs": {"b": {"folder": str(self.folder)}, "a": {"folder": str(self.folder)}}})
        self.assertEqual((status, body["configured"], body["enabled"]), (200, True, ["a", "b"]))
        self.assertIsNone(dashboard.mount("bad"))
        self.assertEqual([s["id"] for s in dashboard.status()], ["a", "b"])

    def test_resubmission_replaces_mounts(self):
        dashboard = self.make()
        dashboard.apply({"tabs": {"a": {"folder": str(self.folder)}}})
        dashboard.apply({"tabs": {"b": {"folder": str(self.folder)}}})
        self.assertIsNone(dashboard.mount("a"))
        self.assertIsNotNone(dashboard.mount("b"))

    def test_build_failure_marks_only_that_tab(self):
        dashboard = self.make()
        dashboard.apply({"tabs": {"a": {"folder": str(self.folder)}, "bad": {"folder": str(self.folder)}}})
        status = {s["id"]: s for s in dashboard.status()}
        self.assertTrue(status["a"]["ok"])
        self.assertEqual((status["bad"]["ok"], status["bad"]["error"]), (False, "RuntimeError: 폴더가 사라졌다"))

    def test_existing_config_is_mounted_at_start_with_per_tab_state_dir(self):
        self.store.save({"version": 1, "tabs": {"b": {"folder": str(self.folder)}}})
        dashboard = self.make()
        self.assertIsNotNone(dashboard.mount("b"))
        _, settings, state_dir = self.calls[-1]
        self.assertEqual((settings, state_dir), ({"folder": str(self.folder)}, self.root / "state" / "b"))
        self.assertTrue(state_dir.is_dir())
