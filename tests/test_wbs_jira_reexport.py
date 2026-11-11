"""옛 경로 tabs.wbs.jira 가 jira_client 의 공개 심볼을 같은 객체로 다시 내보내는지 본다(리뷰 지적 P3)."""
import importlib
import unittest

import jira_client


class ReexportTest(unittest.TestCase):
    def test_old_path_imports(self):
        old = importlib.import_module("tabs.wbs.jira")
        from tabs.wbs.jira import JiraClient, JiraError  # noqa: F401
        self.assertIs(JiraClient, jira_client.JiraClient)
        self.assertIs(JiraError, jira_client.JiraError)
        self.assertTrue(old.__all__)

    def test_every_public_symbol_is_the_same_object(self):
        old = importlib.import_module("tabs.wbs.jira")
        # 모듈·다른 모듈에서 가져온 함수·타입(urllib, dataclass, Sequence 등)은 빼고, jira_client 가 정의한 것만.
        public = {name for name, value in vars(jira_client).items()
                  if not name.startswith("_") and not isinstance(value, type(jira_client))
                  and (not callable(value) or getattr(value, "__module__", None) == "jira_client")}
        self.assertEqual(set(old.__all__), public)
        for name in public:
            with self.subTest(name=name):
                self.assertIs(getattr(old, name), getattr(jira_client, name))


if __name__ == "__main__":
    unittest.main()
