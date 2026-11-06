import json
import unittest

from dashboard.config import normalize
from tabs.wbs import TAB
from tests.support import dashboard_with, request

JIRA_ONLY = {"mode": "jira", "jira_domain": "https://team.atlassian.net/", "jira_project": "PROJ"}


class JiraModeTest(unittest.TestCase):
    def test_jira_mode_saves_without_workbook_and_drops_wbs_fields(self):
        config, errors = normalize({"wbs": TAB}, {"project": "P", "tabs": {"wbs": {**JIRA_ONLY, "workbook": "", "owner": ""}}})
        self.assertEqual(errors, {})
        self.assertEqual(config["tabs"]["wbs"], JIRA_ONLY)

    def test_wbs_mode_still_requires_workbook_and_owner(self):
        _, errors = normalize({"wbs": TAB}, {"project": "P", "tabs": {"wbs": {**JIRA_ONLY, "mode": "wbs"}}})
        self.assertEqual(errors["wbs"], {"workbook": "필수 항목입니다", "owner": "필수 항목입니다"})

    def test_jira_mode_mounts_with_no_wbs_rows(self):
        port, _ = dashboard_with(self, TAB, JIRA_ONLY)
        status, _, body = request(self, port, "GET", "/wbs/api/wbs")
        self.assertEqual((status, json.loads(body)), (200, {"tasks": [], "holidays": {}, "error": None}))


if __name__ == "__main__":
    unittest.main()
