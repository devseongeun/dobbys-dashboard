import subprocess
import unittest

from dashboard.keychain import Keychain, KeychainError


class FakeRun:
    def __init__(self, *results):
        self.results = list(results)
        self.calls = []

    def __call__(self, args, **kwargs):
        self.calls.append((args, kwargs))
        code, out = self.results.pop(0)
        return subprocess.CompletedProcess(args, code, out, "")


class KeychainTest(unittest.TestCase):
    def test_set_sends_secret_twice_on_stdin_not_argv(self):
        run = FakeRun((0, ""))
        Keychain(run=run).set("jira", {"token": "s3cret"})
        args, kwargs = run.calls[0]
        self.assertNotIn("s3cret", " ".join(args))
        self.assertEqual(args[:2], ["security", "add-generic-password"])
        self.assertIn("dobbys-dashboard.jira", args)
        self.assertEqual(args[-1], "-w")
        self.assertEqual(kwargs["input"], '{"token": "s3cret"}\n{"token": "s3cret"}\n')

    def test_set_failure_raises(self):
        with self.assertRaises(KeychainError):
            Keychain(run=FakeRun((1, ""))).set("jira", {"token": "x"})

    def test_get_missing_item_is_none(self):
        self.assertIsNone(Keychain(run=FakeRun((44, ""))).get("jira"))

    def test_get_returns_stored_dict(self):
        self.assertEqual(Keychain(run=FakeRun((0, '{"a": "b"}\n'))).get("jira"), {"a": "b"})

    def test_get_other_failure_or_garbage_raises(self):
        with self.assertRaises(KeychainError):
            Keychain(run=FakeRun((51, ""))).get("jira")
        with self.assertRaises(KeychainError):
            Keychain(run=FakeRun((0, "6162"))).get("jira")

    def test_delete_tolerates_missing_item_only(self):
        Keychain(run=FakeRun((44, ""))).delete("jira")
        with self.assertRaises(KeychainError):
            Keychain(run=FakeRun((1, ""))).delete("jira")
