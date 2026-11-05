import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path

from tabs.comments.client import TromboneError
from tabs.comments.overrides import OverrideStore
from tabs.comments.service import CommentService, ExportDisabled, NeedLogin, NothingToExport
from tests.support import MemoryKeychain
from tests.test_comments_model import BUNDLE, INBOX, ME


class FakeClient:
    base = "http://trombone"

    def __init__(self):
        self.reacted = []
        self.react_error = None

    def inbox(self):
        return INBOX

    def bundle(self, path):
        return BUNDLE

    def login(self, login_id, password):
        if password != "pw":
            raise TromboneError("/auth/login → HTTP 401", status=401)
        return {"token": "T", "name": ME}

    def react(self, comment_id, emoji, token):
        if self.react_error:
            raise self.react_error
        self.reacted.append((comment_id, emoji, token))
        return [{"emoji": emoji, "actors": [ME]}]


class ServiceTest(unittest.TestCase):
    def make(self, export=True, logged_in=True):
        self.dir = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.client = FakeClient()
        self.keychain = MemoryKeychain({"trombone": {"base": "http://trombone", "token": "T", "name": ME}} if logged_in else {})
        return CommentService(self.client, self.keychain, OverrideStore(self.dir / "overrides.json"),
                              self.dir if export else None, today=lambda: date(2026, 11, 5),
                              now=lambda: datetime(2026, 11, 5, 9, 30))

    def test_login_stores_base_token_name_and_never_password(self):
        service = self.make(logged_in=False)
        self.assertEqual(service.login("a@b.c", "pw"), ME)
        self.assertEqual(self.keychain.items["trombone"], {"base": "http://trombone", "token": "T", "name": ME})
        self.assertNotIn("pw", str(self.keychain.items))

    def test_report_requires_login(self):
        with self.assertRaises(NeedLogin):
            self.make(logged_in=False).report()

    def test_session_for_another_base_is_ignored(self):
        service = self.make()
        self.keychain.items["trombone"]["base"] = "http://other"
        self.assertFalse(service.describe()["loggedIn"])

    def test_report_is_for_logged_in_author(self):
        report = self.make().report()
        self.assertEqual((report["cfg"]["author"], report["cfg"]["date"], report["cfg"]["collected"]), (ME, "2026-11-05", "2026-11-05 09:30"))
        self.assertEqual(report["pages"][0]["scrnId"], "TCK-0100-01")

    def test_react_skips_decided_and_locked_and_targets_self(self):
        service = self.make()
        result = service.react(["CM1", "CM3", "CM5", "CM404"])
        self.assertEqual((result["applied"], result["skipped"]), (1, 2))
        self.assertEqual(result["failed"], ["CM404(코멘트 없음)"])
        self.assertEqual(self.client.reacted, [("CM5", "EMO005", "T")])

    def test_react_401_drops_token_and_asks_login(self):
        service = self.make()
        self.client.react_error = TromboneError("HTTP 401", status=401)
        with self.assertRaises(NeedLogin):
            service.react(["CM5"])
        self.assertNotIn("trombone", self.keychain.items)

    def test_export_writes_checklist_named_by_date_and_author(self):
        path = self.make().export()
        self.assertEqual(path.name, f"2026-11-05 웹기획서 코멘트 리뷰 체크리스트 ({ME}).md")
        self.assertIn("CM5", path.read_text(encoding="utf-8"))

    def test_export_disabled_or_empty(self):
        with self.assertRaises(ExportDisabled):
            self.make(export=False).export()
        service = self.make()
        self.keychain.items["trombone"]["name"] = "코멘트 없는 사람"
        with self.assertRaises(NothingToExport):
            service.export()
