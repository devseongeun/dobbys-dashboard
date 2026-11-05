import unittest

from tabs.wbs.jira import JiraError
from tabs.wbs.session import JiraSession
from tests.support import MemoryKeychain


class FakeClient:
    def __init__(self, config):
        self.config = config

    def myself(self):
        if self.config.token != "good":
            raise JiraError("인증 실패 (401)", status=401)
        return {"accountId": "acc-1", "displayName": "팀원"}


class JiraSessionTest(unittest.TestCase):
    def test_login_verifies_then_stores_domain_email_token(self):
        keychain = MemoryKeychain()
        session = JiraSession(keychain, "team.atlassian.net", client_cls=FakeClient)
        self.assertEqual(session.login("a@b.c", "good")["displayName"], "팀원")
        self.assertEqual(keychain.items["jira"], {"domain": "team.atlassian.net", "email": "a@b.c", "token": "good"})
        self.assertEqual(session.client().config.base_url, "https://team.atlassian.net")

    def test_failed_login_stores_nothing(self):
        keychain = MemoryKeychain()
        with self.assertRaises(JiraError):
            JiraSession(keychain, "team.atlassian.net", client_cls=FakeClient).login("a@b.c", "bad")
        self.assertEqual(keychain.items, {})

    def test_credentials_for_another_domain_are_not_used(self):
        keychain = MemoryKeychain({"jira": {"domain": "old.atlassian.net", "email": "a", "token": "good"}})
        self.assertIsNone(JiraSession(keychain, "team.atlassian.net", client_cls=FakeClient).client())

    def test_logout_deletes_credentials(self):
        keychain = MemoryKeychain({"jira": {"domain": "team.atlassian.net", "email": "a", "token": "good"}})
        JiraSession(keychain, "team.atlassian.net", client_cls=FakeClient).logout()
        self.assertEqual(keychain.items, {})
