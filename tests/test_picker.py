import subprocess
import tempfile
import threading
import unittest
from pathlib import Path

from dashboard.picker import SCRIPT, Picker


def done(stdout="", stderr="", code=0):
    return subprocess.CompletedProcess([], code, stdout, stderr)


class PickerTest(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.reply = done()

    def run_fake(self, args):
        self.calls.append(args)
        if isinstance(self.reply, BaseException):
            raise self.reply
        return self.reply

    def pick(self, payload):
        return Picker(self.run_fake).pick(payload)

    def test_picked_paths_lose_trailing_slash_and_keep_order(self):
        self.reply = done("/Users/me/Vault/90-assets/\n/Users/me/Vault/주간 보고/\n")
        self.assertEqual(self.pick({"kind": "dirs"}), (200, {"paths": ["/Users/me/Vault/90-assets", "/Users/me/Vault/주간 보고"]}))
        self.assertEqual(self.calls, [["osascript", str(SCRIPT), "dirs"]])

    def test_cancel_is_not_an_error_but_other_failures_are(self):
        self.reply = done(stderr="pick.applescript: execution error: User canceled. (-128)", code=1)
        self.assertEqual(self.pick({"kind": "dir"}), (200, {"cancelled": True}))
        self.reply = done(stderr="execution error: 권한 없음 (-1743)", code=1)
        status, body = self.pick({"kind": "dir"})
        self.assertEqual(status, 500)
        self.assertIn("-1743", body["error"])

    def test_starts_near_current_value_only_when_it_is_an_existing_absolute_folder(self):
        folder = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        (folder / "wbs.xlsx").write_text("", encoding="utf-8")
        for kind, current, start in (
            ("dir", str(folder), str(folder)),
            ("file", str(folder / "wbs.xlsx"), str(folder)),  # 파일 칸은 그 파일의 폴더에서
            ("dir", str(folder / "사라진 폴더"), str(folder)),  # 없는 폴더면 남아 있는 상위에서
            ("dirs", [str(folder)], str(folder)),
            ("dir", "상대/경로", None),
            ("dir", "", None),
            ("dir", "/a\x00b", None),
        ):
            self.calls.clear()
            self.pick({"kind": kind, "current": current})
            self.assertEqual(self.calls[0][3:], [start] if start else [], (kind, current))

    def test_rejects_unknown_kind_and_reports_missing_osascript_and_timeout(self):
        self.assertEqual(self.pick({"kind": "text"})[0], 400)
        self.assertEqual(self.pick(None)[0], 400)
        self.assertEqual(self.calls, [])
        self.reply = FileNotFoundError("osascript")
        self.assertEqual(self.pick({"kind": "dir"})[0], 501)
        self.reply = subprocess.TimeoutExpired("osascript", 600)
        self.assertEqual(self.pick({"kind": "dir"})[0], 504)

    def test_only_one_dialog_at_a_time(self):
        opened, release = threading.Event(), threading.Event()

        def slow(args):
            opened.set()
            release.wait(5)
            return done("/a\n")

        picker = Picker(slow)
        first = []
        worker = threading.Thread(target=lambda: first.append(picker.pick({"kind": "dir"})))
        worker.start()
        self.assertTrue(opened.wait(5))
        self.assertEqual(picker.pick({"kind": "dir"})[0], 409)
        release.set()
        worker.join(5)
        self.assertEqual(first, [(200, {"paths": ["/a"]})])
        picker._run = lambda args: done("/b\n")
        self.assertEqual(picker.pick({"kind": "dir"}), (200, {"paths": ["/b"]}))  # 창이 닫히면 다시 열린다


if __name__ == "__main__":
    unittest.main()
