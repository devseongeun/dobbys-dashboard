import contextlib
import io
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from dashboard.config import ConfigStore
from dashboard.config import normalize as normalize_config
from dashboard.dispatch import Mount
from dashboard.tab import Field, Tab


def make_tab(tab_id, fields, validate=None):
    extra = {"validate": validate} if validate else {}
    return Tab(tab_id, tab_id, "•", tuple(fields), build=lambda settings, state: Mount(tab_id, None, "unused"), **extra)


def normalize(tabs, submitted):
    """탭 필드 검증 테스트는 프로젝트 이름을 신경 쓰지 않도록 기본값을 채운다."""
    if isinstance(submitted, dict) and "project" not in submitted:
        submitted = {"project": "P", **submitted}
    return normalize_config(tabs, submitted)


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(contextlib.redirect_stderr(io.StringIO()))
        self.dir = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.store = ConfigStore(self.dir / "sub" / "config.json", clock=lambda: 1700000000)

    def test_missing_file_is_unconfigured(self):
        self.assertIsNone(self.store.load())

    def test_save_round_trips_with_owner_only_permissions(self):
        data = {"version": 1, "tabs": {"m": {"folder": "/tmp"}}}
        self.store.save(data)
        self.assertEqual(self.store.load(), data)
        self.assertEqual(stat.S_IMODE(os.stat(self.store.path).st_mode), 0o600)

    def test_broken_file_is_set_aside_and_treated_as_unconfigured(self):
        self.store.path.parent.mkdir(parents=True)
        self.store.path.write_text("{oops", encoding="utf-8")
        self.assertIsNone(self.store.load())
        self.assertFalse(self.store.path.exists())
        aside = self.store.path.parent / "config.json.broken-1700000000"
        self.assertEqual(aside.read_text(encoding="utf-8"), "{oops")

    def test_unknown_version_is_set_aside(self):
        self.store.path.parent.mkdir(parents=True)
        self.store.path.write_text('{"version": 99, "tabs": {}}', encoding="utf-8")
        self.assertIsNone(self.store.load())
        self.assertFalse(self.store.path.exists())
        self.assertTrue((self.store.path.parent / "config.json.broken-1700000000").exists())

    def test_non_utf8_file_is_set_aside(self):
        self.store.path.parent.mkdir(parents=True)
        self.store.path.write_bytes(b"\xff\xfe{")
        self.assertIsNone(self.store.load())
        self.assertFalse(self.store.path.exists())
        self.assertTrue((self.store.path.parent / "config.json.broken-1700000000").exists())


class NormalizeTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        self.meetings = self.root / "Obsidian Vault" / "회의 자료"
        self.meetings.mkdir(parents=True)
        self.book = self.root / "wbs.xlsx"
        self.book.write_bytes(b"x")
        self.tabs = {
            "m": make_tab("m", [Field("folder", "폴더", "dir", required=True)]),
            "w": make_tab("w", [Field("book", "파일", "file", required=True), Field("sheet", "시트", "text", default="기본")]),
            "k": make_tab("k", [Field("folders", "폴더들", "dirs", required=True)]),
            "o": make_tab("o", [Field("out", "내보낼 폴더", "dir")]),
        }

    def test_requires_at_least_one_tab(self):
        self.assertEqual(normalize(self.tabs, {"tabs": {}}), ({}, {"_": {"tabs": "탭을 하나 이상 고른다"}}))
        self.assertEqual(normalize(self.tabs, None)[1], {"_": {"tabs": "탭을 하나 이상 고른다"}})

    def test_unknown_tab_is_rejected(self):
        _, errors = normalize(self.tabs, {"tabs": {"nope": {}}})
        self.assertEqual(errors, {"_": {"tabs": "알 수 없는 탭이다: nope"}})

    def test_required_and_missing_paths(self):
        self.assertEqual(normalize(self.tabs, {"tabs": {"m": {"folder": " "}}})[1], {"m": {"folder": "필수 항목이다"}})
        self.assertEqual(normalize(self.tabs, {"tabs": {"m": {"folder": str(self.root / "없음")}}})[1],
                         {"m": {"folder": "폴더가 없다"}})
        self.assertEqual(normalize(self.tabs, {"tabs": {"w": {"book": str(self.meetings)}}})[1],
                         {"w": {"book": "파일이 없다"}})

    def test_nul_in_path_is_field_error(self):
        self.assertEqual(normalize(self.tabs, {"tabs": {"m": {"folder": "/tmp/a\x00b"}}})[1],
                         {"m": {"folder": "경로 형식이 아니다"}})

    def test_paths_with_spaces_korean_and_tilde_are_normalized(self):
        with mock.patch.dict(os.environ, {"HOME": str(self.root)}):
            config, errors = normalize(self.tabs, {"tabs": {"m": {"folder": "~/Obsidian Vault/회의 자료/"}}})
        self.assertEqual(errors, {})
        self.assertEqual(config["tabs"]["m"]["folder"], str(self.meetings))

    def test_text_default_applies_and_optional_dir_may_be_blank(self):
        config, errors = normalize(self.tabs, {"tabs": {"w": {"book": str(self.book), "sheet": ""}, "o": {"out": ""}}})
        self.assertEqual(errors, {})
        self.assertEqual(config["tabs"]["w"], {"book": str(self.book), "sheet": "기본"})
        self.assertEqual(config["tabs"]["o"], {"out": ""})

    def test_dirs_accepts_lines_or_list_and_requires_one(self):
        other = self.root / "둘째"
        other.mkdir()
        config, errors = normalize(self.tabs, {"tabs": {"k": {"folders": f"{self.meetings}\n\n {other} "}}})
        self.assertEqual((errors, config["tabs"]["k"]["folders"]), ({}, [str(self.meetings), str(other)]))
        config, errors = normalize(self.tabs, {"tabs": {"k": {"folders": [str(other)]}}})
        self.assertEqual(config["tabs"]["k"]["folders"], [str(other)])
        self.assertEqual(normalize(self.tabs, {"tabs": {"k": {"folders": "\n"}}})[1], {"k": {"folders": "폴더를 하나 이상 입력한다"}})
        self.assertEqual(normalize(self.tabs, {"tabs": {"k": {"folders": str(self.root / "x")}}})[1],
                         {"k": {"folders": f"폴더가 없다: {self.root / 'x'}"}})

    def test_tab_validate_runs_only_after_fields_pass(self):
        calls = []

        def validate(settings):
            calls.append(settings)
            return {"folder": "Vault 밖이다"}

        tabs = {"m": make_tab("m", [Field("folder", "폴더", "dir", required=True)], validate)}
        self.assertEqual(normalize(tabs, {"tabs": {"m": {"folder": ""}}})[1], {"m": {"folder": "필수 항목이다"}})
        self.assertEqual(calls, [])
        self.assertEqual(normalize(tabs, {"tabs": {"m": {"folder": str(self.meetings)}}})[1], {"m": {"folder": "Vault 밖이다"}})
        self.assertEqual(calls, [{"folder": str(self.meetings)}])

    def test_success_keeps_only_submitted_tabs(self):
        config, errors = normalize(self.tabs, {"tabs": {"m": {"folder": str(self.meetings), "extra": "무시"}}})
        self.assertEqual(errors, {})
        self.assertEqual(config, {"version": 1, "project": "P", "tabs": {"m": {"folder": str(self.meetings)}}})

    def test_project_name_is_required_and_must_be_a_safe_folder_name(self):
        ok = {"tabs": {"m": {"folder": str(self.meetings)}}}
        self.assertEqual(normalize_config(self.tabs, ok)[1], {"_": {"project": "프로젝트 이름을 적는다"}})
        self.assertEqual(normalize_config(self.tabs, {"project": "  ", **ok})[1], {"_": {"project": "프로젝트 이름을 적는다"}})
        for bad in ("a/b", "a\\b", ".hidden", "..", "x" * 65, "m"):
            self.assertIn("project", normalize_config(self.tabs, {"project": bad, **ok})[1].get("_", {}), bad)
        config, errors = normalize_config(self.tabs, {"project": " TRB 4.0.0 ", **ok})
        self.assertEqual((errors, config["project"]), ({}, "TRB 4.0.0"))

    def test_project_error_is_reported_alongside_tab_errors(self):
        _, errors = normalize_config(self.tabs, {"project": "", "tabs": {"m": {"folder": ""}, "nope": {}}})
        self.assertEqual(errors, {"_": {"project": "프로젝트 이름을 적는다", "tabs": "알 수 없는 탭이다: nope"}, "m": {"folder": "필수 항목이다"}})
