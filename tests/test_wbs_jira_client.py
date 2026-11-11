import unittest

from jira_client import JiraClient, JiraConfig, JiraError

CONFIG = JiraConfig(base_url="https://example.atlassian.net", email="a@b.c", token="T")


def issue(key, worklog_total=0, inline=0):
    return {
        "key": key,
        "fields": {
            "summary": key,
            "worklog": {
                "total": worklog_total,
                "maxResults": 20,
                "startAt": 0,
                "worklogs": [
                    {"id": f"{key}-{i}", "timeSpentSeconds": 3600}
                    for i in range(inline)
                ],
            },
        },
    }


class FakeFetch:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def __call__(self, path):
        self.calls.append(path)
        for prefix, payload in self.responses:
            if path.startswith(prefix):
                if isinstance(payload, list):
                    return payload.pop(0)
                return payload
        raise AssertionError("예상하지 못한 경로: " + path)


class SearchAllTest(unittest.TestCase):
    def test_follows_next_page_token_until_is_last(self):
        fetch = FakeFetch(
            [
                (
                    "/rest/api/3/search/jql",
                    [
                        {"issues": [issue("PROJ-1")], "isLast": False, "nextPageToken": "T2"},
                        {"issues": [issue("PROJ-2")], "isLast": True},
                    ],
                )
            ]
        )
        client = JiraClient(CONFIG, fetch=fetch)
        issues = client.search_all("project = PROJ")
        self.assertEqual([i["key"] for i in issues], ["PROJ-1", "PROJ-2"])
        self.assertIn("nextPageToken=T2", fetch.calls[1])

    def test_single_page_makes_one_call(self):
        fetch = FakeFetch(
            [("/rest/api/3/search/jql", {"issues": [issue("PROJ-1")], "isLast": True})]
        )
        client = JiraClient(CONFIG, fetch=fetch)
        client.search_all("project = PROJ")
        self.assertEqual(len(fetch.calls), 1)


class IssueWorklogsTest(unittest.TestCase):
    def test_pages_through_worklog_endpoint(self):
        fetch = FakeFetch(
            [
                (
                    "/rest/api/3/issue/PROJ-9/worklog",
                    [
                        {"total": 25, "maxResults": 20, "startAt": 0,
                         "worklogs": [{"id": str(i)} for i in range(20)]},
                        {"total": 25, "maxResults": 20, "startAt": 20,
                         "worklogs": [{"id": str(i)} for i in range(20, 25)]},
                    ],
                )
            ]
        )
        client = JiraClient(CONFIG, fetch=fetch)
        logs = client.issue_worklogs("PROJ-9")
        self.assertEqual(len(logs), 25)
        self.assertIn("startAt=20", fetch.calls[1])


class HttpErrorTranslationTest(unittest.TestCase):
    def test_401_becomes_jira_error_without_credentials(self):
        import io
        import urllib.error
        import urllib.request
        from unittest import mock

        secret = JiraConfig(
            base_url="https://example.atlassian.net", email="a@b.c", token="SECRET-TOKEN"
        )
        seen = {}

        def fake_urlopen(request, timeout=None):
            seen["auth"] = request.headers.get("Authorization")
            raise urllib.error.HTTPError(
                request.full_url, 401, "Unauthorized", {}, io.BytesIO(b"")
            )

        with mock.patch.object(urllib.request, "urlopen", fake_urlopen):
            with self.assertRaises(JiraError) as ctx:
                JiraClient(secret).search_all("project = PROJ")

        self.assertTrue(seen["auth"].startswith("Basic "))
        self.assertEqual(ctx.exception.status, 401)
        self.assertEqual(ctx.exception.message, "인증 실패 (401)")
        self.assertNotIn("SECRET-TOKEN", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
