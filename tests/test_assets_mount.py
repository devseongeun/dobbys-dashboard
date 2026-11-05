import json
import tempfile
import unittest
from pathlib import Path

from tabs.assets import TAB, assets_index
from tests.support import dashboard_with, request

DOC = ('<section class="docst" data-doc="open"></section>'
       '회신 대상<b>기획</b> 집계<b>미결 1 · 완료 2 · 취소됨 0</b> 최종 갱신<b>2026-11-04</b>')
TAGGED = ('<html><head><meta charset="utf-8"><meta name="feature" content="외부 결재, 배포">'
          '<meta name="created" content="2026-10-01"></head><body>설명</body></html>')


class AssetsMountTest(unittest.TestCase):
    def setUp(self):
        self.folder = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        (self.folder / "TRB_4.0.0_결재_정책.html").write_text(DOC, encoding="utf-8")
        (self.folder / "ABC_v2_배포_설명.html").write_text(TAGGED, encoding="utf-8")
        self.port, _ = dashboard_with(self, TAB, {"folder": str(self.folder)})

    def test_index_is_generated_in_the_configured_folder_and_served(self):
        md, html = f"00_{self.folder.name}_목록.md", f"00_{self.folder.name}_목록.html"
        for name in (md, html):
            self.assertIn("대시보드 화면의 ⟳ 새로고침으로 다시 만든다", (self.folder / name).read_text(encoding="utf-8"))
        self.assertIn("| 외부 결재, 배포 | [[ABC_v2_배포_설명.html\\|배포 설명]] | 2026-10-01 |", (self.folder / md).read_text(encoding="utf-8"))
        self.assertEqual(request(self, self.port, "GET", "/assets/")[0], 200)

    def test_missing_meta_is_a_tab_warning_not_a_failure(self):
        status, _, body = request(self, self.port, "GET", "/assets/api/assets?refresh=1")
        result = json.loads(body)
        self.assertEqual((status, result["ok"], result["counts"]), (200, True, {"open": 1, "closed": 0, "reference": 1}))
        self.assertEqual([w.split(":")[0] for w in result["warnings"]], ["기능 구분 없음", "작성일 없음"])
        self.assertTrue(all("결재_정책" in w for w in result["warnings"]))

    def test_only_files_directly_in_folder_are_served(self):
        for path in ("/assets/assets_serve.py", "/assets/..%2Fx.html", "/assets/.hidden.html"):
            self.assertEqual(request(self, self.port, "GET", path)[0], 404, path)


class DisplayNameTest(unittest.TestCase):
    def test_project_version_prefix_is_stripped_whatever_the_project(self):
        for name, title in (("TRB_4.0.0_결재_정책.html", "결재 정책"), ("ABC_v2_배포_설명.html", "배포 설명"),
                            ("배포_설명.html", "배포 설명"), ("EXCN_TYPE_CD_설명.html", "EXCN_TYPE_CD 설명")):
            self.assertEqual(assets_index.display_name(name), title, name)
