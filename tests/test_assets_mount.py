import json
import tempfile
import unittest
from pathlib import Path

from tabs.assets import TAB
from tests.support import dashboard_with, request

DOC = ('<section class="docst" data-doc="open"></section>'
       '회신 대상<b>기획</b> 집계<b>미결 1 · 완료 2 · 취소됨 0</b> 최종 갱신<b>2026-11-04</b>')


class AssetsMountTest(unittest.TestCase):
    def setUp(self):
        self.folder = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        (self.folder / "TRB_4.0.0_결재_정책.html").write_text(DOC, encoding="utf-8")
        self.port, _ = dashboard_with(self, TAB, {"folder": str(self.folder)})

    def test_index_is_generated_in_the_configured_folder_and_served(self):
        self.assertTrue((self.folder / "00_90-assets_목록.md").exists())
        self.assertTrue((self.folder / "00_90-assets_목록.html").exists())
        self.assertEqual(request(self, self.port, "GET", "/assets/")[0], 200)

    def test_missing_feature_table_is_a_tab_warning_not_a_failure(self):
        status, _, body = request(self, self.port, "GET", "/assets/api/assets?refresh=1")
        result = json.loads(body)
        self.assertEqual((status, result["ok"], result["counts"]["open"]), (200, True, 1))
        self.assertTrue(any("기능 구분 없음" in w for w in result["warnings"]))

    def test_only_files_directly_in_folder_are_served(self):
        for path in ("/assets/assets_serve.py", "/assets/..%2Fx.html", "/assets/.hidden.html"):
            self.assertEqual(request(self, self.port, "GET", path)[0], 404, path)
