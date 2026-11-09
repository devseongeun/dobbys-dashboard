import json
import tempfile
import unittest
from pathlib import Path

from tabs.meetings import meetings_canvas as mc


def node(kind, x, y, w=100, h=60, **extra):
    return {"id": f"{kind}-{x}-{y}", "type": kind, "x": x, "y": y, "width": w, "height": h, **extra}


class Fixture(unittest.TestCase):
    def setUp(self):
        self.base = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        self.vault = self.base / "vault"
        self.root = self.vault / "70-meetings"
        self.root.mkdir(parents=True)
        (self.vault / "docs").mkdir()
        (self.vault / "docs" / "협조 요청.md").write_text("# 협조", encoding="utf-8")

    def canvas(self, name, data):
        path = self.root / f"{name}.canvas"
        text = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
        path.write_text(text, encoding="utf-8")
        return path


def summary(blocks):
    return [(b["label"], [i.get("text") or i.get("path") or i.get("url") for i in b["items"]]) for b in blocks]


class BuildBlocksTest(Fixture):
    def blocks(self, nodes):
        return mc.build_blocks(nodes, self.vault)

    def test_node_inside_group_edges_count_and_partial_overlap_is_ungrouped(self):
        blocks = self.blocks([
            node("group", 0, 0, 400, 300, label="안건"),
            node("text", 0, 0, 400, 300, text="경계에 딱 맞음"),
            node("text", 350, 10, 100, 60, text="반쯤 걸침"),
        ])
        self.assertEqual(summary(blocks), [("안건", ["경계에 딱 맞음"]), ("미분류", ["반쯤 걸침"])])

    def test_nested_groups_assign_to_smallest(self):
        blocks = self.blocks([
            node("group", 0, 0, 1000, 1000, label="바깥"),
            node("group", 100, 100, 300, 300, label="안쪽"),
            node("text", 120, 120, text="안"),
            node("text", 600, 600, text="밖"),
        ])
        self.assertEqual(summary(blocks), [("바깥", ["밖"]), ("안쪽", ["안"])])

    def test_blocks_and_items_follow_canvas_position(self):
        blocks = self.blocks([
            node("group", 0, 500, 400, 400, label="아래"),
            node("group", 500, 0, 400, 400),
            node("group", 0, 0, 400, 400, label="왼쪽 위"),
            node("text", 10, 200, text="둘째"),
            node("text", 200, 10, text="첫째-오른쪽"),
            node("text", 10, 10, text="첫째-왼쪽"),
        ])
        self.assertEqual([b["label"] for b in blocks], ["왼쪽 위", "블록 2", "아래"])
        self.assertEqual([i["text"] for i in blocks[0]["items"]], ["첫째-왼쪽", "첫째-오른쪽", "둘째"])
        self.assertEqual(blocks[1]["items"], [])

    def test_meeting_blocks_newest_date_first_then_undated_by_position_and_ungrouped_last(self):
        blocks = self.blocks([
            node("group", 0, 0, 300, 300, label="11/3 ① 날짜 형식 아님"),
            node("group", 0, 400, 300, 300, label="2026-10-01 예전 회의"),
            node("group", 0, 800, 300, 300, label="날짜 없음"),
            node("group", 0, 1200, 300, 300, label="2026-11-03 최근 회의"),
            node("text", 2000, 0, text="밖"),
        ])
        self.assertEqual([b["label"] for b in blocks],
                         ["2026-11-03 최근 회의", "2026-10-01 예전 회의", "11/3 ① 날짜 형식 아님", "날짜 없음", "미분류"])

    def test_group_label_and_color_defaults(self):
        blocks = self.blocks([
            node("group", 0, 0, label="  ", color="3"),
            node("group", 0, 100, label="색", color="#A1B2C3"),
            node("group", 0, 200, label="잘못된 색", color="red"),
        ])
        self.assertEqual([(b["label"], b["color"]) for b in blocks],
                         [("블록 1", "3"), ("색", "#A1B2C3"), ("잘못된 색", "")])

    def test_file_items_report_missing_and_preview(self):
        items = self.blocks([
            node("file", 0, 0, file="docs/협조 요청.md", subpath="#배경"),
            node("file", 0, 100, file="docs/없는 파일.md"),
            node("file", 0, 200, file="docs/표.xlsx"),
        ])[0]["items"]
        self.assertEqual(items[0], {"kind": "file", "id": "file-0-0", "path": "docs/협조 요청.md", "name": "협조 요청.md",
                                    "ext": ".md", "subpath": "#배경", "missing": False, "preview": True})
        self.assertEqual((items[1]["missing"], items[2]["missing"], items[2]["preview"]), (True, True, False))

    def test_ignores_unknown_types_bad_coordinates_and_empty_content(self):
        blocks = self.blocks([
            node("group", 0, 0, 1000, 1000, label="안건"),
            node("link", 10, 10, url="https://contoso.sharepoint.com/x"),
            node("text", 10, 100, text="   "),
            node("link", 10, 200),
            node("file", 10, 300, file=""),
            node("note", 10, 400),
            {"id": "s", "type": "text", "text": "문자 좌표", "x": "1", "y": 0, "width": 10, "height": 10},
            {"id": "b", "type": "text", "text": "불리언 좌표", "x": True, "y": 0, "width": 10, "height": 10},
        ])
        self.assertEqual(blocks, [{"id": "group-0-0", "label": "안건", "color": "",
                                   "items": [{"kind": "link", "id": "link-10-10", "url": "https://contoso.sharepoint.com/x"}]}])

    def test_group_of_matches_block_membership(self):
        nodes = [
            node("group", 0, 0, 1000, 1000, label="바깥"),
            node("group", 100, 100, 300, 300, label="안쪽"),
            node("text", 120, 120, text="안"),
            node("text", 600, 600, text="밖"),
            node("text", 950, 950, 100, 100, text="걸침"),
        ]
        self.assertEqual([(mc.group_of(nodes, n) or {}).get("label") for n in nodes[2:]], ["안쪽", "바깥", None])


class ReadMeetingTest(Fixture):
    def test_new_obsidian_canvas_is_an_empty_meeting(self):
        path = self.canvas("2026-11-05 새 회의", "{}")
        self.assertEqual(mc.read_meeting(self.root, self.vault, "2026-11-05 새 회의"), {
            "id": "2026-11-05 새 회의", "title": "새 회의", "date": "2026-11-05", "vault": "vault",
            "canvasPath": "70-meetings/2026-11-05 새 회의.canvas", "version": mc.version_of(path), "blocks": [],
        })

    def test_broken_canvas_raises(self):
        for name, text in (("깨진 JSON", "{nodes"), ("배열", "[]"), ("nodes 객체", '{"nodes": {}}')):
            self.canvas(name, text)
            with self.subTest(name), self.assertRaises(mc.CanvasError):
                mc.read_meeting(self.root, self.vault, name)

    def test_unknown_or_unsafe_ids_return_none(self):
        self.canvas("2026-11-05 회의", "{}")
        (self.root / "sub").mkdir()
        (self.root / "sub" / "안.canvas").write_text("{}", encoding="utf-8")
        for bad in ("", "없음", "..", "../70-meetings/2026-11-05 회의", "sub/안", ".숨김", "a\\b"):
            with self.subTest(bad):
                self.assertIsNone(mc.read_meeting(self.root, self.vault, bad))

    def write_order(self, path, order):
        target = mc.order_path(path)
        target.parent.mkdir(exist_ok=True)
        target.write_text(order if isinstance(order, str) else json.dumps(order, ensure_ascii=False), encoding="utf-8")

    def test_saved_order_first_then_position_and_unknown_ids_ignored(self):
        path = self.canvas("회의", {"nodes": [
            node("group", 0, 0, 1000, 1000, label="안건"),
            node("text", 10, 10, text="가"), node("text", 10, 100, text="나"), node("text", 10, 200, text="다"),
            node("text", 2000, 0, text="밖1"), node("text", 2000, 100, text="밖2"),
        ]})
        self.write_order(path, {"group-0-0": ["text-10-200", "없는 id", "text-10-10"], "_ungrouped": ["text-2000-100"]})
        blocks = mc.read_meeting(self.root, self.vault, "회의")["blocks"]
        self.assertEqual([b["id"] for b in blocks], ["group-0-0", "_ungrouped"])
        self.assertEqual([[i["text"] for i in b["items"]] for b in blocks], [["다", "가", "나"], ["밖2", "밖1"]])

    def test_broken_order_file_falls_back_to_position(self):
        path = self.canvas("회의", {"nodes": [node("text", 0, 100, text="둘"), node("text", 0, 0, text="하나")]})
        for broken in ("{oops", "[]", '{"_ungrouped": "x"}'):
            self.write_order(path, broken)
            with self.subTest(broken):
                blocks = mc.read_meeting(self.root, self.vault, "회의")["blocks"]
                self.assertEqual([i["text"] for i in blocks[0]["items"]], ["하나", "둘"])

    def test_version_changes_with_canvas_and_order(self):
        path = self.canvas("회의", "{}")
        first = mc.version_of(path)
        self.write_order(path, {})
        second = mc.version_of(path)
        path.write_text('{"nodes": []}', encoding="utf-8")
        third = mc.version_of(path)
        self.assertRegex(first, r"^[0-9a-f]{16}$")
        self.assertEqual(len({first, second, third}), 3)


class ListMeetingsTest(Fixture):
    def test_sorted_by_date_desc_then_title_and_filters_entries(self):
        for name in ("2026-11-01 나", "2026-11-05 가", "2026-11-01 가", "날짜 없는 회의", ".숨김"):
            self.canvas(name, "{}")
        self.canvas("2026-11-02 깨짐", "{nodes")
        (self.root / "메모.md").write_text("x", encoding="utf-8")
        (self.root / "sub").mkdir()
        (self.root / "sub" / "2026-12-01 하위.canvas").write_text("{}", encoding="utf-8")
        (self.root / ".order").mkdir()
        (self.root / ".order" / "2026-11-05 가.json").write_text("{}", encoding="utf-8")
        listed = mc.list_meetings(self.root)
        self.assertEqual([m["id"] for m in listed],
                         ["2026-11-05 가", "2026-11-02 깨짐", "2026-11-01 가", "2026-11-01 나", "날짜 없는 회의"])
        self.assertEqual((listed[0]["title"], listed[0]["date"], listed[0]["error"]), ("가", "2026-11-05", None))
        self.assertIn("JSON", listed[1]["error"])
        self.assertEqual((listed[-1]["title"], listed[-1]["date"]), ("날짜 없는 회의", ""))

    def test_missing_folder_lists_nothing(self):
        self.assertEqual(mc.list_meetings(self.vault / "없음"), [])


class ResolveVaultFileTest(Fixture):
    def test_accepts_nested_files_and_rejects_escapes(self):
        self.assertEqual(mc.resolve_vault_file(self.vault, "docs/협조 요청.md"), self.vault / "docs" / "협조 요청.md")
        (self.base / "outside.md").write_text("x", encoding="utf-8")
        (self.vault / "docs" / "link.md").symlink_to(self.base / "outside.md")
        (self.vault / ".obsidian").mkdir()
        (self.vault / ".obsidian" / "a.md").write_text("x", encoding="utf-8")
        (self.vault / "docs" / ".숨김.md").write_text("x", encoding="utf-8")
        for bad in ("", "../outside.md", "docs/../../outside.md", str(self.base / "outside.md"), "docs",
                    "docs/link.md", "docs\\협조 요청.md", "docs/없음.md", ".obsidian/a.md", "docs/.숨김.md",
                    "docs//협조 요청.md"):
            with self.subTest(bad):
                self.assertIsNone(mc.resolve_vault_file(self.vault, bad))


if __name__ == "__main__":
    unittest.main()
