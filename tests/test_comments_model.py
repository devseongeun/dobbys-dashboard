import tempfile
import unittest
from pathlib import Path

from tabs.comments import model
from tabs.comments.markdown import build_markdown
from tabs.comments.overrides import OverrideStore

ME = "팀원"


def comment(cid, author, text, at, parent=None, eyes=()):
    reactions = [{"emoji": model.DECIDED_EMOJI, "actors": list(eyes)}] if eyes else []
    return {"commentId": cid, "author": author, "text": text, "at": at, "parentCommentId": parent, "reactions": reactions}


INBOX = [{"commentId": "CM1", "author": ME, "pageId": "P1", "path": "/spec/a", "at": "2026-11-01T10:00"},
         {"commentId": "CM9", "author": "남", "pageId": "P2", "path": "/spec/b", "at": "2026-11-01T10:00"}]
BUNDLE = {"page": {"autoScrnId": "TCK-0100-01", "title": "목록", "changeType": "수정", "author": "기획"},
          "comments": [
              comment("CM1", ME, "[담당자 지정] 누가 하나요", "2026-11-01T10:00"),
              comment("CM2", "기획", "제가 합니다", "2026-11-02T10:00", parent="CM1", eyes=[ME]),
              comment("CM3", ME, "설명 보완 요청", "2026-11-03T10:00"),
              comment("CM4", ME, "답변 안 하셔도 됩니다", "2026-11-03T11:00", parent="CM3"),
              comment("CM5", ME, "확인 부탁", "2026-11-04T10:00"),
          ]}


class CollectTest(unittest.TestCase):
    def collect(self, overrides=None):
        return model.collect(INBOX, lambda path: BUNDLE, ME, overrides or {"priority": {}, "resolved": {}})

    def test_answers_decisions_and_self_close(self):
        rows, pages, answered = self.collect()
        by = {r["commentId"]: r for r in rows}
        self.assertEqual(answered, 1)
        self.assertEqual((by["CM1"]["category"], by["CM1"]["decided"], by["CM1"]["decidedOn"]),
                         ("담당자·일정 지정", True, ["답글 `CM2`"]))
        self.assertTrue(by["CM3"]["resolved"].startswith("작성자 본인이 `CM4` 답글로 종결했다"))
        self.assertTrue(model.locked(by["CM3"]))
        self.assertEqual((model.target_of(by["CM1"]), model.already_eyed(by["CM1"], ME)), ("CM2", True))
        self.assertEqual((model.target_of(by["CM5"]), model.already_eyed(by["CM5"], ME)), ("CM5", False))
        self.assertEqual(list(pages), ["P1"])

    def test_overrides_set_priority_and_hold(self):
        rows, pages, _ = self.collect({"priority": {"CM5": {"level": "상", "reason": "먼저"}}, "resolved": {"CM5": "메일로 회신"}})
        row = {r["commentId"]: r for r in rows}["CM5"]
        self.assertEqual((row["priorityLevel"], row["priority"], row["resolved"], row["resolvedOwn"]), ("상", "먼저", "메일로 회신", True))
        payload = {c["id"]: c for c in model.page_payload(pages)[0]["comments"]}
        self.assertEqual((payload["CM5"]["priLv"], payload["CM5"]["st"], payload["CM5"]["resOwn"]), ("상", "lock", True))
        self.assertEqual(payload["CM3"]["resOwn"], False)

    def test_author_without_comments_is_empty(self):
        self.assertEqual(model.collect(INBOX, lambda path: BUNDLE, "없는 사람", {})[2], 0)
        self.assertEqual(model.collect(INBOX, lambda path: BUNDLE, "없는 사람", {})[0], [])

    def test_markdown_lists_comments_without_old_constants(self):
        rows, pages, answered = self.collect()
        md = build_markdown(rows, pages, answered, base="http://x", author=ME, date="2026-11-05", collected="2026-11-05 10:00")
        self.assertIn(f"# 웹 기획서 코멘트 리뷰 체크리스트 ({ME})", md)
        self.assertIn("TCK-0100-01", md)
        for gone in ("PRIORITY_HIGH", "PRIORITY_MID", "spec_comment_report", "[["):
            self.assertNotIn(gone, md)


class OverrideStoreTest(unittest.TestCase):
    def test_update_sets_and_clears(self):
        store = OverrideStore(Path(self.enterContext(tempfile.TemporaryDirectory())) / "c" / "overrides.json")
        self.assertEqual(store.load(), {"priority": {}, "resolved": {}})
        store.update("CM1", {"level": "중", "reason": "다음"}, "메일 회신")
        self.assertEqual(OverrideStore(store.path).load(),
                         {"priority": {"CM1": {"level": "중", "reason": "다음"}}, "resolved": {"CM1": "메일 회신"}})
        self.assertEqual(store.update("CM1", {"level": "", "reason": ""}, ""), {"priority": {}, "resolved": {}})
