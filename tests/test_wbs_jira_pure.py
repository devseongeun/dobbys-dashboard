import unittest

from jira_client import LOOKUP_LIMIT, JiraConfig, adf_to_text, build_jql, build_key_jql


class BuildJqlTest(unittest.TestCase):
    def test_unions_assignee_and_wbs_keys(self):
        jql = build_jql("PROJ", "acc-1", ["PROJ-1102", "PROJ-1156"])
        self.assertEqual(
            jql,
            'project = PROJ AND (assignee = "acc-1" '
            "OR key in (PROJ-1102,PROJ-1156)) ORDER BY duedate ASC",
        )

    def test_deduplicates_and_sorts_keys(self):
        jql = build_jql("PROJ", "acc-1", ["PROJ-20", "PROJ-3", "PROJ-20"])
        self.assertIn("key in (PROJ-3,PROJ-20)", jql)

    def test_without_keys_falls_back_to_assignee_only(self):
        jql = build_jql("PROJ", "acc-1", [])
        self.assertEqual(
            jql,
            'project = PROJ AND assignee = "acc-1" ORDER BY duedate ASC',
        )

    def test_rejects_malformed_key(self):
        with self.assertRaises(ValueError):
            build_jql("PROJ", "acc-1", ["PROJ-1; DROP"])

    def test_build_jql_rejects_bad_project_key(self):
        with self.assertRaises(ValueError):
            build_jql("proj or 1=1", "acc-1", [])


class BuildKeyJqlTest(unittest.TestCase):
    def test_dedupes_and_sorts_numerically(self):
        self.assertEqual(
            build_key_jql(["PROJ-1392", "PROJ-1131", "PROJ-1392"]),
            "key in (PROJ-1131,PROJ-1392) ORDER BY duedate ASC",
        )

    def test_rejects_injection_empty_and_oversized_lists(self):
        for keys in (["PROJ-1) OR (project = X"], [], [f"PROJ-{i}" for i in range(LOOKUP_LIMIT + 1)]):
            with self.assertRaises(ValueError):
                build_key_jql(keys)



class AdfToTextTest(unittest.TestCase):
    def test_flattens_paragraphs_and_lists(self):
        doc = {
            "type": "doc",
            "version": 1,
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "매핑 현황 업데이트"}]},
                {
                    "type": "bulletList",
                    "content": [
                        {
                            "type": "listItem",
                            "content": [
                                {
                                    "type": "paragraph",
                                    "content": [{"type": "text", "text": "검증 요청"}],
                                }
                            ],
                        }
                    ],
                },
            ],
        }
        self.assertEqual(adf_to_text(doc), "매핑 현황 업데이트\n검증 요청")

    def test_hard_break_becomes_newline(self):
        doc = {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [
                        {"type": "text", "text": "앞"},
                        {"type": "hardBreak"},
                        {"type": "text", "text": "뒤"},
                    ],
                }
            ],
        }
        self.assertEqual(adf_to_text(doc), "앞\n뒤")

    def test_none_and_plain_string_are_handled(self):
        self.assertEqual(adf_to_text(None), "")
        self.assertEqual(adf_to_text("이미 평문"), "이미 평문")


if __name__ == "__main__":
    unittest.main()


class JiraConfigTest(unittest.TestCase):
    def test_repr_hides_token(self):
        self.assertNotIn("secret-token", repr(JiraConfig("https://x", "a@b", "secret-token")))
