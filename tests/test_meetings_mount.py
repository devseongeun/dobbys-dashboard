import json
import socket
import tempfile
import unittest
import urllib.parse
from pathlib import Path

from tabs.meetings import TAB, find_vault
from tests.support import dashboard_with, request

MEETING_ID = "2026-11-05 라이프사이클팀"
MEETING = urllib.parse.quote(MEETING_ID)
EDITOR = {"Content-Type": "application/json", "X-Meetings-Editor": "1"}


def vault_file(path=None):
    return "/meetings/file" + ("?" + urllib.parse.urlencode({"p": path}, quote_via=urllib.parse.quote) if path is not None else "")


def raw_exchange(port: int, request: bytes, timeout: float = 3.0) -> bytes:
    with socket.create_connection(("127.0.0.1", port), timeout=timeout) as sock:
        sock.sendall(request)
        chunks = []
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                return b"".join(chunks)
            chunks.append(chunk)


class MeetingsMountTest(unittest.TestCase):
    def setUp(self):
        support = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        self.vault = support / "vault"
        meetings_root = self.vault / "70-meetings"
        meetings_root.mkdir(parents=True)
        docs = self.vault / "docs"
        docs.mkdir()
        (docs / "협조 요청.md").write_text("# 협조", encoding="utf-8")
        (docs / "조사.html").write_text("<p>조사</p>", encoding="utf-8")
        (docs / "회의 밖.md").write_text("tree only", encoding="utf-8")
        (docs / "data.json").write_text("{}", encoding="utf-8")
        (self.vault / ".obsidian").mkdir()
        (self.vault / ".obsidian" / "숨김.md").write_text("hidden", encoding="utf-8")
        (support / "outside.md").write_text("outside", encoding="utf-8")
        nodes = [{"id": "g", "type": "group", "label": "인프라", "x": 0, "y": 0, "width": 1000, "height": 1000}]
        nodes += [{"id": f"f{i}", "type": "file", "file": f, "x": 10, "y": 10 + 100 * i, "width": 100, "height": 50}
                  for i, f in enumerate(["docs/협조 요청.md", "docs/조사.html", "../outside.md"])]
        (meetings_root / f"{MEETING_ID}.canvas").write_text(json.dumps({"nodes": nodes}, ensure_ascii=False), encoding="utf-8")
        (meetings_root / "2026-11-01 깨짐.canvas").write_text("{nodes", encoding="utf-8")
        self.port, _ = dashboard_with(self, TAB, {"folder": str(meetings_root)})

    def request(self, method, path, body=None, headers=None):
        return request(self, self.port, method, path, body=body, headers=headers)

    def test_meetings_page_and_static_files(self):
        for path in ("/meetings/", "/meetings/meetings.js", "/meetings/meetings_lib.js", "/meetings/meetings.css",
                     "/meetings/marked.umd.js"):
            self.assertEqual(self.request("GET", path)[0], 200, path)
        self.assertTrue(self.request("GET", "/meetings/meetings_lib.js")[1]["Content-Type"].startswith("text/javascript"))
        for path in ("/meetings/meetings_serve.py", "/meetings/meetings_canvas.py", "/meetings/%2e%2e/assets_serve.py"):
            self.assertEqual(self.request("GET", path)[0], 404, path)

    def test_meetings_list_marks_broken_canvas(self):
        status, _, body = self.request("GET", "/meetings/api/meetings")
        listed = {m["id"]: m for m in json.loads(body)["meetings"]}
        self.assertEqual(status, 200)
        self.assertEqual(list(listed), [MEETING_ID, "2026-11-01 깨짐"])
        self.assertIsNone(listed[MEETING_ID]["error"])
        self.assertIn("JSON", listed["2026-11-01 깨짐"]["error"])

    def test_meetings_detail_blocks_and_errors(self):
        status, _, body = self.request("GET", "/meetings/api/meetings/" + MEETING)
        detail = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(detail["canvasPath"], f"70-meetings/{MEETING_ID}.canvas")
        self.assertEqual([(b["label"], [i["path"] for i in b["items"]]) for b in detail["blocks"]],
                         [("인프라", ["docs/협조 요청.md", "docs/조사.html", "../outside.md"])])
        self.assertTrue(detail["blocks"][0]["items"][2]["missing"])
        self.assertEqual(self.request("GET", "/meetings/api/meetings/" + urllib.parse.quote("2026-11-01 깨짐"))[0], 422)
        for path in ("/meetings/api/meetings/nope", "/meetings/api/meetings/..%2F70-meetings%2Fx"):
            self.assertEqual(self.request("GET", path)[0], 404, path)

    def test_meetings_file_serves_any_vault_preview_file(self):
        status, headers, body = self.request("GET", vault_file("docs/협조 요청.md"))
        self.assertEqual((status, body), (200, "# 협조".encode("utf-8")))
        self.assertTrue(headers["Content-Type"].startswith("text/markdown"))
        self.assertTrue(self.request("GET", vault_file("docs/조사.html"))[1]["Content-Type"].startswith("text/html"))
        # Canvas에 담기지 않은 파일도 Vault 트리 미리보기로 연다.
        self.assertEqual(self.request("GET", vault_file("docs/회의 밖.md"))[:3:2], (200, b"tree only"))
        for path in (vault_file("../outside.md"), vault_file(str(self.vault / "docs" / "협조 요청.md")),
                     vault_file(".obsidian/숨김.md"), vault_file("docs/data.json"), vault_file("docs"),
                     vault_file("docs/없음.md"), vault_file(""), vault_file()):
            self.assertEqual(self.request("GET", path)[0], 404, path)

    def test_meetings_rejects_foreign_host_and_writes(self):
        self.assertEqual(self.request("GET", "/meetings/api/meetings", headers={"Host": "evil.example.com"})[0], 403)
        self.assertEqual(self.request("PUT", "/meetings/api/meetings", body=b"{}")[0], 405)

    def post_json(self, path, payload, headers=EDITOR):
        status, _, body = self.request("POST", path, body=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                                       headers=headers)
        return status, json.loads(body or b"{}")

    def meeting(self):
        return json.loads(self.request("GET", "/meetings/api/meetings/" + MEETING)[2])

    def test_meetings_tree_and_search(self):
        status, _, body = self.request("GET", "/meetings/api/tree?path=")
        self.assertEqual(status, 200)
        self.assertTrue({"docs", "70-meetings"} <= {e["name"] for e in json.loads(body)["entries"]})
        status, _, body = self.request("GET", "/meetings/api/tree?path=docs")
        self.assertIn("docs/협조 요청.md", [e["path"] for e in json.loads(body)["entries"]])
        for path in ("/meetings/api/tree?path=..", "/meetings/api/tree?path=docs%2F..%2F..",
                     "/meetings/api/tree?path=" + urllib.parse.quote("docs/협조 요청.md", safe="")):
            self.assertEqual(self.request("GET", path)[0], 404, path)
        status, _, body = self.request("GET", "/meetings/api/search?q=" + urllib.parse.quote("협조"))
        self.assertEqual((status, [r["path"] for r in json.loads(body)["results"]]), (200, ["docs/협조 요청.md"]))

    def test_meetings_edit_flow_add_move_delete(self):
        base = "/meetings/api/meetings/" + MEETING
        status, detail = self.post_json(base + "/blocks", {"label": "둘째", "version": self.meeting()["version"]})
        self.assertEqual(status, 200)
        second = next(b for b in detail["blocks"] if b["label"] == "둘째")
        status, detail = self.post_json(f"{base}/blocks/{second['id']}/items",
                                        {"kind": "link", "url": "https://contoso.sharepoint.com/x", "version": detail["version"]})
        self.assertEqual(status, 200)
        link = next(i for b in detail["blocks"] for i in b["items"] if i["kind"] == "link")
        status, detail = self.post_json(f"{base}/items/{link['id']}/move", {"block": "g", "index": 0, "version": detail["version"]})
        self.assertEqual((status, detail["blocks"][0]["items"][0]["id"]), (200, link["id"]))
        status, detail = self.post_json(f"{base}/items/{link['id']}/delete", {"version": detail["version"]})
        self.assertEqual(status, 200)
        self.assertNotIn(link["id"], [i["id"] for b in detail["blocks"] for i in b["items"]])

    def test_meetings_create_and_rename(self):
        status, detail = self.post_json("/meetings/api/meetings", {"date": "2026-11-20", "title": "새 회의"})
        self.assertEqual((status, detail["id"], detail["blocks"]), (200, "2026-11-20 새 회의", []))
        status, detail = self.post_json("/meetings/api/meetings/" + urllib.parse.quote("2026-11-20 새 회의") + "/rename",
                                        {"date": "2026-11-21", "title": "바뀐 회의", "version": detail["version"]})
        self.assertEqual((status, detail["id"]), (200, "2026-11-21 바뀐 회의"))
        listed = [m["id"] for m in json.loads(self.request("GET", "/meetings/api/meetings")[2])["meetings"]]
        self.assertIn("2026-11-21 바뀐 회의", listed)
        self.assertNotIn("2026-11-20 새 회의", listed)
        self.assertEqual(self.post_json("/meetings/api/meetings", {"date": "2026-11-21", "title": "바뀐 회의"})[0], 409)
        self.assertEqual(self.post_json("/meetings/api/meetings", {"date": "x", "title": "y"})[0], 400)

    def test_meetings_write_guards(self):
        version = self.meeting()["version"]
        url = "/meetings/api/meetings/" + MEETING + "/blocks"
        good = {"label": "x", "version": version}
        self.assertEqual(self.post_json(url, good, headers={"Content-Type": "application/json"})[0], 403)
        self.assertEqual(self.post_json(url, good, headers={**EDITOR, "Origin": "http://evil.example.com"})[0], 403)
        self.assertEqual(self.post_json(url, good, headers={**EDITOR, "Origin": "null"})[0], 403)
        status, body = self.post_json(url, {"label": "x", "version": "stale"})
        self.assertEqual((status, body["version"]), (409, version))
        raw = raw_exchange(self.port, f"POST {url} HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Meetings-Editor: 1\r\n"
                                      f"Content-Length: {64 * 1024 + 1}\r\n\r\n".encode("ascii"))
        self.assertIn(b" 413 ", raw.split(b"\r\n", 1)[0])
        self.assertEqual(self.request("POST", url, body=b"not json", headers=EDITOR)[0], 400)
        self.assertEqual(self.request("POST", url, body=b"[]", headers=EDITOR)[0], 400)
        self.assertEqual(self.post_json("/meetings/api/meetings/" + MEETING + "/nope", good)[0], 404)
        self.assertEqual(self.meeting()["version"], version)
        allowed = {**EDITOR, "Origin": f"http://127.0.0.1:{self.port}"}
        self.assertEqual(self.post_json(url, good, headers=allowed)[0], 200)

    def test_folder_outside_vault_is_rejected(self):
        outside = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        self.assertEqual(TAB.validate({"folder": str(outside)}),
                         {"folder": "Obsidian Vault 안의 폴더를 지정한다(.obsidian 폴더를 찾지 못했다)"})

    def test_vault_is_found_from_nested_folder(self):
        nested = self.vault / "70-meetings" / "a" / "b"
        nested.mkdir(parents=True)
        self.assertEqual(find_vault(nested), self.vault)
