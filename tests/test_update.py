"""Updater: 임시 bare origin 과 두 clone 으로 뒤처짐·적용·거절을 실제 git 으로 확인한다. 재시작은 stub 이다."""
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from dashboard.update import TTL, Updater

GIT_ENV = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@x", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@x",
           "GIT_CONFIG_GLOBAL": "/dev/null", "HOME": "/nonexistent"}


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=str(cwd), capture_output=True, text=True, check=True, env=GIT_ENV).stdout.strip()


def commit(repo: Path, name: str, title: str) -> None:
    (repo / name).write_text(title, encoding="utf-8")
    git(repo, "add", name)
    git(repo, "commit", "-q", "-m", title)


class UpdaterTest(unittest.TestCase):
    def setUp(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.origin, self.author, self.install = root / "origin.git", root / "author", root / "install"
        git(root, "init", "-q", "--bare", "--initial-branch=main", str(self.origin))
        git(root, "clone", "-q", str(self.origin), str(self.author))
        commit(self.author, "a.txt", "첫 커밋")
        git(self.author, "push", "-q", "-u", "origin", "main")
        git(root, "clone", "-q", str(self.origin), str(self.install))
        self.restarts = 0
        self.clock = [0.0]

        def restart():
            self.restarts += 1

        self.updater = Updater(self.install, run=self._run, restart=restart, now=lambda: self.clock[0])

    @staticmethod
    def _run(cmd, **kwargs):
        return subprocess.run(cmd, env=GIT_ENV, **kwargs)

    def publish(self, name, title):
        commit(self.author, name, title)
        git(self.author, "push", "-q", "origin", "main")

    def test_up_to_date(self):
        state = self.updater.check()
        self.assertEqual((state["ok"], state["behind"], state["ahead"], state["dirty"], state["titles"]), (True, 0, 0, False, []))
        self.assertEqual(state["current"], git(self.install, "rev-parse", "--short", "HEAD"))
        self.assertEqual((state["branch"], state["upstream"]), ("main", "origin/main"))

    def test_behind_lists_titles_newest_first_and_is_cached_until_refresh(self):
        self.updater.check()
        self.publish("b.txt", "둘째")
        self.publish("c.txt", "셋째")
        self.assertEqual(self.updater.check()["behind"], 0)  # TTL 안이라 fetch 안 함
        self.assertEqual(self.updater.check(refresh=True)["titles"], ["셋째", "둘째"])
        self.clock[0] += TTL
        self.assertEqual(self.updater.check()["behind"], 2)

    def test_apply_pulls_and_schedules_restart(self):
        self.publish("b.txt", "둘째")
        before = self.updater.check(refresh=True)["current"]
        status, body = self.updater.apply()
        self.assertEqual(status, 200, body)
        self.assertEqual((body["updated"], body["from"], body["restarting"]), (True, before, True))
        self.assertEqual(body["to"], git(self.install, "rev-parse", "--short", "HEAD"))
        self.assertEqual(git(self.install, "rev-parse", "HEAD"), git(self.author, "rev-parse", "HEAD"))
        deadline = time.monotonic() + 5
        while self.restarts == 0 and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertEqual(self.restarts, 1)
        self.assertEqual(self.updater.check()["behind"], 0)

    def test_apply_without_updates_is_noop(self):
        status, body = self.updater.apply()
        self.assertEqual((status, body["updated"]), (200, False))
        time.sleep(0.7)
        self.assertEqual(self.restarts, 0)

    def test_apply_refuses_dirty_tree_and_local_commits(self):
        self.publish("b.txt", "둘째")
        (self.install / "a.txt").write_text("손댐", encoding="utf-8")
        status, body = self.updater.apply()
        self.assertEqual(status, 409)
        self.assertIn("커밋하지 않은 변경", body["error"])
        git(self.install, "checkout", "-q", "--", "a.txt")
        commit(self.install, "local.txt", "로컬 커밋")
        status, body = self.updater.apply()
        self.assertEqual(status, 409)
        self.assertIn("앞서 있어", body["error"])
        self.assertEqual(self.restarts, 0)

    def test_not_a_repo_is_reported_not_raised(self):
        plain = Path(self.enterContext(tempfile.TemporaryDirectory()))
        state = Updater(plain, run=self._run, restart=lambda: None).check()
        self.assertFalse(state["ok"])
        self.assertIn("git 저장소가 아니다", state["error"])
        self.assertEqual(state["behind"], 0)
        status, body = Updater(plain, run=self._run, restart=lambda: None).apply()
        self.assertEqual(status, 500)
        self.assertIn("git 저장소가 아니다", body["error"])
