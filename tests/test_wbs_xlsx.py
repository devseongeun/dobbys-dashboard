import tempfile
import time
import unittest
import zipfile
from pathlib import Path

from tabs.wbs.xlsx import WbsSource, XlsxError, read_wbs
from tests.support_xlsx import SHEET, make_xlsx, wbs_book

ROW = {"pri": "P3", "weight": 4, "stage": "선행", "id": "TRBQ-CHM-037", "d1": "테스트", "d2": "테스트 의뢰 관리",
       "name": "테스트 의뢰 목록", "detail": "변경 없음", "gubun": "유지", "screen": "TST-0100-01", "mgr": "김철수",
       "owner": "홍길동", "people": 1, "start": 46282, "end": 46323, "md": 1}


class ReadWbsTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(self.enterContext(tempfile.TemporaryDirectory()))

    def book(self, rows, **kwargs):
        return wbs_book(self.dir / "wbs.xlsx", rows, **kwargs)

    def test_maps_columns_by_header_name_and_converts_dates(self):
        data = read_wbs(self.book([ROW]), SHEET, "홍길동")
        self.assertEqual(data["tasks"], [{
            "id": "TRBQ-CHM-037", "pri": "P3", "weight": 4, "stage": "선행", "d1": "테스트", "d2": "테스트 의뢰 관리",
            "d3": None, "name": "테스트 의뢰 목록", "gubun": "유지", "screen": "TST-0100-01", "mgr": "김철수",
            "owner": "홍길동", "people": 1, "start": "2026-09-17", "end": "2026-10-28", "md": 1, "q": None,
            "detail": "변경 없음", "jira": None,
        }])
        self.assertEqual(data["holidays"], {"2026-09-24": "추석 연휴"})

    def test_header_position_may_move(self):
        data = read_wbs(self.book([ROW], shift=2), SHEET, "홍길동")
        self.assertEqual((data["tasks"][0]["id"], data["tasks"][0]["pri"], data["tasks"][0]["start"]),
                         ("TRBQ-CHM-037", "P3", "2026-09-17"))

    def test_owner_filter_includes_group_rows_and_excludes_similar_names(self):
        rows = [{**ROW, "id": "A-1", "owner": "홍길동 외 4명"}, {**ROW, "id": "A-2", "owner": "홍길동"},
                {**ROW, "id": "A-3", "owner": "이영희"}, {**ROW, "id": "A-4", "owner": "홍길동2"}]
        self.assertEqual([t["id"] for t in read_wbs(self.book(rows), SHEET, " 홍길동 ")["tasks"]], ["A-1", "A-2"])
        with self.assertRaises(XlsxError) as caught:
            read_wbs(self.book(rows), SHEET, "홍길")
        self.assertEqual(caught.exception.field, "owner")

    def test_missing_holiday_sheet_is_empty(self):
        self.assertEqual(read_wbs(self.book([ROW], holidays=False), SHEET, "홍길동")["holidays"], {})

    def test_missing_sheet_or_header_is_a_sheet_error(self):
        path = self.book([ROW])
        with self.assertRaises(XlsxError) as caught:
            read_wbs(path, "없는 시트", "홍길동")
        self.assertEqual(caught.exception.field, "sheet")
        bad = make_xlsx(self.dir / "bad.xlsx", {SHEET: {9: {"E": "요구사항ID", "P": "담당자"}}})
        with self.assertRaises(XlsxError) as caught:
            read_wbs(bad, SHEET, "홍길동")
        self.assertEqual(caught.exception.field, "sheet")
        self.assertIn("4Depth", str(caught.exception))

    def test_not_an_xlsx_is_a_workbook_error(self):
        path = self.dir / "x.xlsx"
        path.write_bytes(b"not a zip")
        with self.assertRaises(XlsxError) as caught:
            read_wbs(path, SHEET, "홍길동")
        self.assertEqual(caught.exception.field, "workbook")

    def truncated(self, member):
        src = self.book([ROW])
        out = self.dir / "broken.xlsx"
        with zipfile.ZipFile(src) as zin, zipfile.ZipFile(out, "w") as zout:
            for info in zin.infolist():
                data = zin.read(info)
                zout.writestr(info, data[: len(data) // 2] if info.filename == member else data)
        return out

    def test_truncated_sheet_xml_is_a_workbook_error(self):
        with self.assertRaises(XlsxError) as caught:
            read_wbs(self.truncated("xl/worksheets/sheet1.xml"), SHEET, "홍길동")
        self.assertEqual(caught.exception.field, "workbook")

    def test_truncated_shared_strings_is_a_workbook_error(self):
        with self.assertRaises(XlsxError) as caught:
            read_wbs(self.truncated("xl/sharedStrings.xml"), SHEET, "홍길동")
        self.assertEqual(caught.exception.field, "workbook")

    def test_huge_date_serial_becomes_none(self):
        data = read_wbs(self.book([{**ROW, "start": 99999999}]), SHEET, "홍길동")
        self.assertIsNone(data["tasks"][0]["start"])


class WbsSourceTest(unittest.TestCase):
    def test_rereads_only_when_file_changes(self):
        path = Path(self.enterContext(tempfile.TemporaryDirectory())) / "wbs.xlsx"
        wbs_book(path, [ROW])
        source = WbsSource(path, SHEET, "홍길동")
        first = source.load()
        self.assertIs(source.load(), first)
        time.sleep(0.01)
        wbs_book(path, [ROW, {**ROW, "id": "TRBQ-CHM-038"}])
        self.assertEqual(len(source.load()["tasks"]), 2)
