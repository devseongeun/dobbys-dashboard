import json
import tempfile
import unittest
from pathlib import Path

from tabs.meetings import meetings_canvas as mc
from tabs.meetings import meetings_edit as me


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
        path.write_text(data if isinstance(data, str) else json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return path

    def v(self, name):
        return mc.version_of(self.root / f"{name}.canvas")

    def data(self, name):
        return json.loads((self.root / f"{name}.canvas").read_text(encoding="utf-8"))

    def nodes_by_id(self, name):
        return {n["id"]: n for n in self.data(name)["nodes"]}

    def blocks(self, name):
        return mc.read_meeting(self.root, self.vault, name)["blocks"]

    def labels(self, name):
        return [(b["label"], [i.get("text") or i.get("path") or i.get("url") for i in b["items"]]) for b in self.blocks(name)]

    def assertStatus(self, status, fn, *args):
        with self.assertRaises(me.EditError) as ctx:
            fn(*args)
        self.assertEqual(ctx.exception.status, status, str(ctx.exception))
        return ctx.exception


class NameTest(Fixture):
    def test_meeting_id_for_valid_and_invalid(self):
        self.assertEqual(me.meeting_id_for("2026-11-05", "  회의  "), "2026-11-05 회의")
        self.assertEqual(me.meeting_id_for("", "회의"), "회의")
        self.assertEqual(me.meeting_id_for(None, "회의"), "회의")
        for date, title in (("2026-13-01", "x"), ("20261105", "x"), ("2026-02-30", "x"), ("", ""), ("", "   "),
                            ("", "a/b"), ("", "a\\b"), ("", "a:b"), ("", ".x"), ("", "x" * 121), ("", "a\nb"),
                            (3, "x"), ("", None)):
            with self.subTest(date=date, title=title):
                self.assertStatus(400, me.meeting_id_for, date, title)


class MeetingTest(Fixture):
    def test_create_meeting_writes_empty_canvas_and_rejects_duplicate(self):
        self.assertEqual(me.create_meeting(self.root, "2026-11-20", "새 회의"), "2026-11-20 새 회의")
        self.assertEqual(self.data("2026-11-20 새 회의"), {"nodes": [], "edges": []})
        self.assertEqual(self.blocks("2026-11-20 새 회의"), [])
        self.assertStatus(409, me.create_meeting, self.root, "2026-11-20", "새 회의")

    def test_rename_meeting_moves_order_file_and_rejects_taken_name(self):
        self.canvas("2026-11-05 A", {"nodes": [node("group", 0, 0, 1000, 1000, label="g"),
                                               node("text", 10, 10, text="t1"), node("text", 10, 100, text="t2")]})
        order = mc.order_path(self.root / "2026-11-05 A.canvas")
        order.parent.mkdir()
        order.write_text(json.dumps({"group-0-0": ["text-10-100", "text-10-10"]}), encoding="utf-8")
        self.assertEqual(me.rename_meeting(self.root, "2026-11-05 A", "2026-11-06", "B", self.v("2026-11-05 A")), "2026-11-06 B")
        self.assertFalse((self.root / "2026-11-05 A.canvas").exists())
        self.assertFalse(order.exists())
        self.assertEqual(self.labels("2026-11-06 B"), [("g", ["t2", "t1"])])
        self.canvas("2026-11-07 C", "{}")
        self.assertStatus(409, me.rename_meeting, self.root, "2026-11-06 B", "2026-11-07", "C", self.v("2026-11-06 B"))
        self.assertEqual(me.rename_meeting(self.root, "2026-11-06 B", "2026-11-06", "B", self.v("2026-11-06 B")), "2026-11-06 B")
        self.assertStatus(404, me.rename_meeting, self.root, "없음", "", "x", "0" * 16)

    def test_stale_version_is_409_and_file_untouched(self):
        path = self.canvas("회의", {"nodes": [node("group", 0, 0, label="g")]})
        before = path.read_bytes()
        error = self.assertStatus(409, me.rename_block, self.root, "회의", "group-0-0", "새 이름", "stale")
        self.assertEqual(error.version, self.v("회의"))
        self.assertEqual(path.read_bytes(), before)
        self.assertStatus(400, me.rename_block, self.root, "회의", "group-0-0", "새 이름", None)

    def test_broken_canvas_is_422(self):
        self.canvas("깨짐", "{nodes")
        self.assertStatus(422, me.add_block, self.root, "깨짐", "x", self.v("깨짐"))


class BlockTest(Fixture):
    def test_add_block_goes_below_everything(self):
        self.canvas("회의", {"nodes": [node("text", 100, 50), node("group", -20, 0, 300, 200, label="첫")]})
        me.add_block(self.root, "회의", " 새 안건 ", self.v("회의"))
        added = self.data("회의")["nodes"][-1]
        self.assertRegex(added.pop("id"), r"^[0-9a-f]{16}$")
        self.assertEqual(added, {"type": "group", "x": -20, "y": 280, "width": 900, "height": 400, "label": "새 안건"})
        self.canvas("빈", "{}")
        me.add_block(self.root, "빈", "하나", self.v("빈"))
        self.assertEqual((self.data("빈")["nodes"][0]["x"], self.data("빈")["nodes"][0]["y"]), (0, 0))

    def test_rename_block_keeps_unknown_fields_and_tab_format(self):
        self.canvas("회의", {"nodes": [node("group", 0, 0, label="옛", styleAttributes={"x": 1})], "edges": [],
                             "metadata": {"version": "1.0-1.0"}})
        me.rename_block(self.root, "회의", "group-0-0", "새", self.v("회의"))
        text = (self.root / "회의.canvas").read_text(encoding="utf-8")
        self.assertTrue(text.startswith('{\n\t"nodes"'))
        data = json.loads(text)
        self.assertEqual((data["metadata"], data["nodes"][0]["label"], data["nodes"][0]["styleAttributes"]),
                         ({"version": "1.0-1.0"}, "새", {"x": 1}))
        self.assertStatus(404, me.rename_block, self.root, "회의", "_ungrouped", "x", self.v("회의"))
        self.assertStatus(400, me.rename_block, self.root, "회의", "group-0-0", "", self.v("회의"))


class AddItemTest(Fixture):
    def test_add_file_places_below_members_and_grows_group(self):
        self.canvas("회의", {"nodes": [node("group", 0, 0, 500, 300, label="g"), node("text", 20, 20, text="a"),
                                       node("text", 0, 400, text="below"), node("text", 600, 0, text="beside")]})
        me.add_item(self.root, self.vault, "회의", "group-0-0", {"kind": "file", "path": "docs/협조 요청.md"}, self.v("회의"))
        nodes = self.nodes_by_id("회의")
        added = next(n for n in nodes.values() if n.get("type") == "file")
        self.assertEqual((added["x"], added["y"], added["width"], added["height"]), (20, 100, 400, 400))
        self.assertEqual((nodes["group-0-0"]["width"], nodes["group-0-0"]["height"]), (500, 520))
        self.assertEqual((nodes["text-0-400"]["y"], nodes["text-600-0"]["y"]), (620, 0))
        self.assertEqual(self.labels("회의"), [("g", ["a", "docs/협조 요청.md"]), ("미분류", ["beside", "below"])])

    def test_growth_keeps_side_by_side_group_members(self):
        self.canvas("회의", {"nodes": [node("group", 0, 0, 500, 300, label="g1"), node("text", 20, 20, text="a"),
                                       node("group", 600, 0, 500, 800, label="g2"), node("text", 620, 700, text="c")]})
        me.add_item(self.root, self.vault, "회의", "group-0-0", {"kind": "file", "path": "docs/협조 요청.md"}, self.v("회의"))
        nodes = self.nodes_by_id("회의")
        self.assertEqual(nodes["group-600-0"]["height"], 1020)
        self.assertEqual(nodes["text-620-700"]["y"], 920)
        self.assertEqual(self.labels("회의"), [("g1", ["a", "docs/협조 요청.md"]), ("g2", ["c"])])

    def test_growth_does_not_grow_nested_group_touching_bottom(self):
        self.canvas("회의", {"nodes": [node("group", 0, 0, 500, 300, label="G"), node("group", 10, 10, 480, 290, label="I"),
                                       node("text", 20, 20, text="t")]})
        me.add_item(self.root, self.vault, "회의", "group-0-0", {"kind": "file", "path": "docs/협조 요청.md"}, self.v("회의"))
        self.assertEqual(self.nodes_by_id("회의")["group-10-10"]["height"], 290)
        self.assertEqual(self.labels("회의"), [("G", ["docs/협조 요청.md"]), ("I", ["t"])])

    def test_add_link_into_empty_nested_group_widens_and_grows_outer(self):
        self.canvas("회의", {"nodes": [node("group", 0, 0, 1000, 1000, label="O"), node("group", 50, 50, 300, 100, label="I")]})
        me.add_item(self.root, self.vault, "회의", "group-50-50", {"kind": "link", "url": "https://1drv.ms/x"}, self.v("회의"))
        nodes = self.nodes_by_id("회의")
        link = next(n for n in nodes.values() if n.get("type") == "link")
        self.assertEqual((link["x"], link["y"], link["width"], link["height"]), (70, 70, 400, 240))
        self.assertEqual((nodes["group-50-50"]["width"], nodes["group-50-50"]["height"]), (440, 280))
        self.assertEqual(nodes["group-0-0"]["height"], 1180)
        self.assertEqual(self.labels("회의"), [("O", []), ("I", ["https://1drv.ms/x"])])

    def test_index_places_in_order_and_duplicate_file_is_noop(self):
        self.canvas("회의", {"nodes": [node("group", 0, 0, 1000, 1000, label="g"),
                                       node("text", 10, 10, text="a"), node("text", 10, 100, text="b")]})
        me.add_item(self.root, self.vault, "회의", "group-0-0", {"kind": "file", "path": "docs/협조 요청.md", "index": 0}, self.v("회의"))
        self.assertEqual(self.labels("회의"), [("g", ["docs/협조 요청.md", "a", "b"])])
        version = self.v("회의")
        me.add_item(self.root, self.vault, "회의", "group-0-0", {"kind": "file", "path": "docs/협조 요청.md"}, version)
        self.assertEqual(self.v("회의"), version)

    def test_add_rejects_bad_targets_and_payloads(self):
        self.canvas("회의", {"nodes": [node("group", 0, 0, 1000, 1000, label="g"), node("text", 2000, 0, text="loose")]})
        (self.base / "outside.md").write_text("x", encoding="utf-8")
        (self.vault / ".obsidian").mkdir()
        (self.vault / ".obsidian" / "x.md").write_text("x", encoding="utf-8")
        v = self.v("회의")
        cases = [
            (400, "_ungrouped", {"kind": "link", "url": "https://a.b"}),
            (404, "nope", {"kind": "link", "url": "https://a.b"}),
            (404, "text-2000-0", {"kind": "link", "url": "https://a.b"}),
            (400, "group-0-0", {"kind": "file", "path": "../outside.md"}),
            (400, "group-0-0", {"kind": "file", "path": ".obsidian/x.md"}),
            (400, "group-0-0", {"kind": "file", "path": "docs/없음.md"}),
            (400, "group-0-0", {"kind": "file", "path": "docs"}),
            (400, "group-0-0", {"kind": "link", "url": "javascript:alert(1)"}),
            (400, "group-0-0", {"kind": "link", "url": "https://"}),
            (400, "group-0-0", {"kind": "link", "url": "http://[x"}),
            (400, "group-0-0", {"kind": "text", "text": "x"}),
            (400, "group-0-0", {"kind": "link", "url": "https://a.b", "index": "1"}),
            (400, "group-0-0", {"kind": "link", "url": "https://a.b", "index": True}),
        ]
        for status, block, payload in cases:
            with self.subTest(block=block, payload=payload):
                self.assertStatus(status, me.add_item, self.root, self.vault, "회의", block, payload, v)
        self.assertEqual(self.v("회의"), v)


class MoveDeleteTest(Fixture):
    def test_reorder_within_block_writes_order_only(self):
        path = self.canvas("회의", {"nodes": [node("group", 0, 0, 1000, 1000, label="g"), node("text", 10, 20, text="a"),
                                              node("text", 10, 100, text="b"), node("text", 10, 180, text="c")]})
        before = path.read_bytes()
        me.move_item(self.root, self.vault, "회의", "text-10-180", "group-0-0", 0, self.v("회의"))
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(self.labels("회의"), [("g", ["c", "a", "b"])])
        me.move_item(self.root, self.vault, "회의", "text-10-180", "group-0-0", 99, self.v("회의"))
        self.assertEqual(self.labels("회의"), [("g", ["a", "b", "c"])])

    def test_move_between_blocks_changes_position(self):
        self.canvas("회의", {"nodes": [node("group", 0, 0, 500, 300, label="g1"), node("text", 20, 20, text="a"),
                                       node("group", 600, 0, 500, 300, label="g2"), node("text", 620, 20, text="b")]})
        me.move_item(self.root, self.vault, "회의", "text-20-20", "group-600-0", 0, self.v("회의"))
        moved = self.nodes_by_id("회의")["text-20-20"]
        self.assertEqual((moved["x"], moved["y"], moved["width"], moved["height"]), (620, 100, 100, 60))
        self.assertEqual(self.labels("회의"), [("g1", []), ("g2", ["a", "b"])])

    def test_move_constraints_and_ungrouped_reorder(self):
        self.canvas("회의", {"nodes": [node("group", 0, 0, 500, 300, label="g"), node("text", 20, 20, text="a"),
                                       node("text", 2000, 0, text="l1"), node("text", 2000, 100, text="l2")]})
        v = self.v("회의")
        self.assertStatus(400, me.move_item, self.root, self.vault, "회의", "text-20-20", "_ungrouped", 0, v)
        self.assertStatus(400, me.move_item, self.root, self.vault, "회의", "group-0-0", "group-0-0", 0, v)
        self.assertStatus(404, me.move_item, self.root, self.vault, "회의", "nope", "group-0-0", 0, v)
        self.assertStatus(404, me.move_item, self.root, self.vault, "회의", "text-20-20", "nope", 0, v)
        self.assertStatus(400, me.move_item, self.root, self.vault, "회의", "text-20-20", "group-0-0", 1.5, v)
        self.assertStatus(400, me.move_item, self.root, self.vault, "회의", "text-20-20", None, 0, v)
        me.move_item(self.root, self.vault, "회의", "text-2000-100", "_ungrouped", 0, v)
        self.assertEqual(self.labels("회의"), [("g", ["a"]), ("미분류", ["l2", "l1"])])

    def test_delete_removes_node_edges_and_order(self):
        self.canvas("회의", {"nodes": [node("group", 0, 0, 1000, 1000, label="g"), node("text", 10, 10, text="a"),
                                       node("text", 10, 100, text="b")],
                             "edges": [{"id": "e1", "fromNode": "text-10-10", "toNode": "text-10-100"},
                                       {"id": "e2", "fromNode": "text-10-100", "toNode": "x"}]})
        me.move_item(self.root, self.vault, "회의", "text-10-100", "group-0-0", 0, self.v("회의"))
        me.delete_item(self.root, "회의", "text-10-10", self.v("회의"))
        data = self.data("회의")
        self.assertNotIn("text-10-10", [n["id"] for n in data["nodes"]])
        self.assertEqual([e["id"] for e in data["edges"]], ["e2"])
        self.assertEqual(mc.read_order(self.root / "회의.canvas"), {"group-0-0": ["text-10-100"]})
        self.assertStatus(400, me.delete_item, self.root, "회의", "group-0-0", self.v("회의"))
        self.assertStatus(404, me.delete_item, self.root, "회의", "nope", self.v("회의"))


if __name__ == "__main__":
    unittest.main()
