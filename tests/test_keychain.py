import subprocess
import unittest

from dashboard.keychain import Keychain, KeychainError


class FakeRun:
    def __init__(self, *results):
        self.results = list(results)
        self.calls = []

    def __call__(self, args, **kwargs):
        self.calls.append((args, kwargs))
        code, out, *err = self.results.pop(0)
        return subprocess.CompletedProcess(args, code, out, err[0] if err else "")


class KeychainTest(unittest.TestCase):
    def test_set_sends_hex_value_in_one_interactive_line_not_argv(self):
        run = FakeRun((0, ""))
        Keychain(run=run).set("jira", {"token": "s3cret"})
        args, kwargs = run.calls[0]
        self.assertEqual(args, ["security", "-i"])
        self.assertNotIn("s3cret", " ".join(args))
        hex_value = '{"token": "s3cret"}'.encode("utf-8").hex()
        self.assertEqual(kwargs["input"], f"add-generic-password -U -s dobbys-dashboard.jira -a default -X {hex_value}\n")

    def test_set_stderr_output_is_failure(self):
        run = FakeRun((0, "", "security: SecKeychainItemCreateFromContent: returned 1"))
        with self.assertRaises(KeychainError) as caught:
            Keychain(run=run).set("jira", {"token": "s3cret"})
        self.assertNotIn("s3cret", str(caught.exception))

    def test_set_rejects_too_long_value_without_calling_security(self):
        run = FakeRun()
        with self.assertRaises(KeychainError) as caught:
            Keychain(run=run).set("jira", {"token": "x" * 1900})
        self.assertEqual(run.calls, [])
        self.assertIn("너무 길다", str(caught.exception))
        self.assertIn("dobbys-dashboard.jira", str(caught.exception))

    def test_every_call_detaches_from_controlling_terminal(self):
        run = FakeRun((0, ""), (0, '{"a": "b"}'), (0, ""))
        keychain = Keychain(run=run)
        keychain.set("jira", {"token": "x"})
        keychain.get("jira")
        keychain.delete("jira")
        self.assertEqual([kwargs["start_new_session"] for _, kwargs in run.calls], [True, True, True])

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

    def test_timeout_or_missing_command_raises_keychain_error(self):
        for error in (subprocess.TimeoutExpired(["security"], 10), FileNotFoundError("security")):
            def run(args, **kwargs):
                raise error
            keychain = Keychain(run=run)
            for call in (lambda: keychain.get("jira"), lambda: keychain.set("jira", {"token": "s3cret"}),
                         lambda: keychain.delete("jira")):
                with self.assertRaises(KeychainError) as caught:
                    call()
                self.assertNotIn("s3cret", str(caught.exception))
