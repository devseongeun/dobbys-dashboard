"""bun 비교 테스트(parity.test.js)용. 같은 예제 Vault 를 로컬판 Python 코드로 읽고 고친 결과를 JSON 으로 낸다.

사용:
  python3 tests/js/meetings_web/fixture.py build <폴더>               → <폴더>/home 에 mock_data.py 예제 Vault + 경계 사례. 경로 JSON
  python3 tests/js/meetings_web/fixture.py read <vault> <회의 폴더>      → 업무 목록·상세·트리·검색·미리보기 판정 JSON
  python3 tests/js/meetings_web/fixture.py run <vault> <회의 폴더> <ops.json> → 연산마다 결과·상세, 끝난 뒤 파일 트리 JSON
  python3 tests/js/meetings_web/fixture.py snapshot <vault>             → 파일 트리(경로 → base64 내용, 폴더는 null) JSON
run 은 새 노드 id(secrets.token_hex)를 차례 번호로, 휴지통 시각(datetime.now)을 고정값으로 바꿔 JS 와 같은 값을 쓰게 한다.
"""
from __future__ import annotations

import base64
import datetime as real_datetime
import json
import subprocess
import sys
import types
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))

from tabs.meetings import meetings_canvas as mc  # noqa: E402
from tabs.meetings import meetings_edit as me  # noqa: E402
from tabs.meetings import vault_tree  # noqa: E402

FIXED_NOW = real_datetime.datetime(2026, 11, 12, 10, 30, 0)


def node(kind, x, y, w=100, h=60, **extra):
    return {"id": f"{kind}-{x}-{y}", "type": kind, "x": x, "y": y, "width": w, "height": h, **extra}


# 파서·배치 규칙이 갈릴 만한 Canvas. 이름 → 내용(문자열은 그대로, 나머지는 json.dumps).
EDGE_CANVASES = {
    "2026-11-05 경계": {
        "nodes": [
            node("group", 0, 0, 1000, 1000, label="2026-10-01 바깥", color="3"),
            node("group", 50, 50, 300, 300, label="  ", color="#abc"),
            node("text", 60, 60, text="안쪽 메모 [[링크|별칭]] <b>굵게</b>"),
            node("file", 60, 200, file="DEMO_100/docs/결제 흐름 정리.md", subpath="#목차"),
            node("text", 600, 600, text="바깥 메모"),
            node("file", 600, 700, file="DEMO_100/docs/없는 파일.md"),
            node("file", 600, 800, file="../밖.md"),
            node("file", 700, 800, file=".obsidian/app.json"),
            node("link", 800, 600, url="https://example.com/경계?q=1"),
            node("link", 800, 700, url="   "),
            node("text", 800, 800, text=" \n "),
            node("group", 1200, 0, 400, 400, label="2026-11-03 오른쪽", color="red", styleAttributes={"x": 1}),
            node("file", 1220, 20, file="DEMO_100/docs/PG사 비교표.md"),
            node("group", 0, 1200, 400, 400, label="2026-11-03 아래 같은 날", color="3\n"),
            node("text", 950, 950, 100, 100, text="경계에 딱 맞음"),
            node("text", 980, 20, 100, 60, text="반쯤 걸침"),
            {"id": "no-rect", "type": "text", "text": "좌표 없음"},
            {"id": "bool-rect", "type": "text", "text": "참거짓 좌표", "x": True, "y": 0, "width": 10, "height": 10},
            {"id": "float", "type": "text", "text": "소수 좌표", "x": 1210.5, "y": 300.25, "width": 50.5, "height": 20},
            node("text", 20, 1220, text="dup-a"),
            {**node("text", 20, 1300, text="dup-b"), "id": "text-20-1220"},
            5, None, "문자열 노드",
            {"id": 7, "type": "group", "x": 2000, "y": 0, "width": 100, "height": 100, "label": "숫자 id"},
            node("unknown", 2010, 10, text="모르는 종류"),
        ],
        "edges": [
            {"id": "e1", "fromNode": "text-60-60", "toNode": "text-600-600"},
            {"id": "e2", "fromNode": "group-50-50", "toNode": "file-60-200"},
            "깨진 edge",
        ],
        "metadata": {"version": "1.0-1.0", "frontmatter": {}},
    },
    "빈": "{}",
    "2026-11-01 깨짐": "{nodes",
    "배열": "[]",
    "노드아님": '{"nodes": {}}',
    "BOM": "﻿{}",
    "2026-11-04경계없음": {"nodes": [node("group", 0, 0, label="2026-11-04")]},
    "2026-13-45 이상한 날짜": {"nodes": []},
    "２０２６-１１-０５ 전각": {"nodes": [node("group", 0, 0, label="２０２６-１１-０６ 전각 회의")]},
    "edges 없음": {"nodes": [node("group", 0, 0, 500, 300, label="g")]},
}
EDGE_ORDER = {"2026-11-05 경계": {"group-0-0": ["text-600-600", "없는 id", 3, "text-600-600", "link-800-600"],
                                 "_ungrouped": ["text-980-20"], "group-1200-0": "목록 아님"}}
VAULT_EXTRA = {
    "DEMO_100/docs/메모.txt": "글 미리보기",
    "DEMO_100/docs/조사.html": "<h1>조사</h1><script>window.x=1</script>",
    "DEMO_100/docs/그림.PNG": b"\x89PNG\r\n\x1a\n",
    "DEMO_100/docs/문서.pdf": b"%PDF-1.4\n%%EOF\n",
    "DEMO_100/docs/data.json": "{}",
    "DEMO_100/docs/이름 끝 점.": "x",
    "DEMO_100/Notes/Zeta.md": "z",
    "DEMO_100/notes 소문자.md": "n",
    "DEMO_100/ß 독일어.md": "ss",
    ".obsidian/app.json": "{}",
    ".숨김.md": "hidden",
}


def build(out: Path) -> dict:
    home = out / "home"
    home.mkdir(parents=True)
    run = subprocess.run([sys.executable, str(REPO / "scripts/demo/mock_data.py"), str(home)], capture_output=True, text=True)
    if run.returncode != 0:
        raise SystemExit(run.stderr)
    vault = home / "DemoVault"
    root = vault / "DEMO_100" / "70-meetings"
    for name, data in EDGE_CANVASES.items():
        text = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False, indent=1)
        (root / f"{name}.canvas").write_text(text, encoding="utf-8")
    (root / ".order").mkdir()
    for name, order in EDGE_ORDER.items():
        (root / ".order" / f"{name}.json").write_text(json.dumps(order, ensure_ascii=False), encoding="utf-8")
    (root / ".숨김.canvas").write_text("{}", encoding="utf-8")
    (root / "메모.md").write_text("canvas 아님", encoding="utf-8")
    (root / "하위").mkdir()
    (root / "하위" / "안쪽.canvas").write_text("{}", encoding="utf-8")
    (root / "폴더.canvas").mkdir()
    for rel, data in VAULT_EXTRA.items():
        path = vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data if isinstance(data, bytes) else data.encode("utf-8"))
    nfd = unicodedata.normalize("NFD", "회의록 정리.md")
    (vault / "DEMO_100" / "docs" / nfd).write_text("# 회의록", encoding="utf-8")
    return {"vault": str(vault), "root": str(root)}


def read(vault: Path, root: Path) -> dict:
    meetings = mc.list_meetings(root)
    details = {}
    for meeting in meetings + [{"id": "없는 업무"}, {"id": ".숨김"}, {"id": "하위/안쪽"}, {"id": ""}]:
        try:
            details[meeting["id"]] = {"ok": mc.read_meeting(root, vault, meeting["id"])}
        except mc.CanvasError as exc:
            details[meeting["id"]] = {"error": str(exc), "version": mc.version_of(mc.resolve_meeting(root, meeting["id"]))}
    trees = {rel: vault_tree.list_dir(vault, rel) for rel in
             ("", "DEMO_100", "DEMO_100/docs", "DEMO_100/70-meetings", ".obsidian", "없음", "DEMO_100/docs/메모.txt", "../x", "a//b")}
    searches = {q: list(vault_tree.search(vault, q)) for q in
                ("", "  ", "결제", "MD", "회의록", "ss", "ß", "docs/", "notes", "zz없음")}
    searches["limit"] = list(vault_tree.search(vault, ".", limit=3))
    files = {}
    for rel in ("DEMO_100/docs/결제 흐름 정리.md", "DEMO_100/docs/메모.txt", "DEMO_100/docs/조사.html", "DEMO_100/docs/그림.PNG",
                "DEMO_100/docs/문서.pdf", "DEMO_100/docs/data.json", "DEMO_100/docs/이름 끝 점.", "../밖.md", ".obsidian/app.json",
                "DEMO_100/docs", "DEMO_100//docs/메모.txt", "/etc/hosts", "없음.md"):
        target = mc.resolve_vault_file(vault, rel)
        mime = mc.PREVIEW_MIME.get(target.suffix.lower()) if target else None
        files[rel] = {"type": mime, "body": base64.b64encode(target.read_bytes()).decode() if mime else None}
    return {"meetings": meetings, "details": details, "trees": trees, "searches": searches, "files": files}


def snapshot(vault: Path) -> dict:
    out = {}
    for path in sorted(vault.rglob("*")):
        rel = unicodedata.normalize("NFC", path.relative_to(vault).as_posix())
        out[rel] = None if path.is_dir() else base64.b64encode(path.read_bytes()).decode()
    return out


def run(vault: Path, root: Path, ops: list[dict]) -> dict:
    counter = iter(range(1, 10_000))
    me.secrets = types.SimpleNamespace(token_hex=lambda n: f"{next(counter):0{n * 2}x}")
    fake = types.SimpleNamespace(datetime=types.SimpleNamespace(now=lambda: FIXED_NOW), date=real_datetime.date)
    me.datetime = fake
    results = []
    for op in ops:
        meeting = op.get("meeting")
        path = root / f"{meeting}.canvas" if isinstance(meeting, str) else None
        version = op.get("version", "current")
        if version == "current":
            version = mc.version_of(path) if path is not None and path.is_file() else "missing"
        args = dict(op.get("args", {}))
        fn = getattr(me, op["fn"])
        try:
            if op["fn"] == "create_meeting":
                value = fn(root, args.get("date"), args.get("title"))
            elif op["fn"] == "rename_meeting":
                value = fn(root, meeting, args.get("date"), args.get("title"), version)
            elif op["fn"] == "delete_meeting":
                value = fn(root, meeting, version).relative_to(root).as_posix()
            elif op["fn"] in ("add_block",):
                value = fn(root, meeting, args.get("label"), version)
            elif op["fn"] == "rename_block":
                value = fn(root, meeting, args.get("block"), args.get("label"), version)
            elif op["fn"] == "delete_block":
                value = fn(root, meeting, args.get("block"), version)
            elif op["fn"] == "add_item":
                value = fn(root, vault, meeting, args.get("block"), args.get("payload"), version)
            elif op["fn"] == "move_item":
                value = fn(root, vault, meeting, args.get("item"), args.get("block"), args.get("index"), version)
            elif op["fn"] == "delete_item":
                value = fn(root, meeting, args.get("item"), version)
            else:
                raise SystemExit(f"모르는 연산: {op['fn']}")
            result = {"ok": value}
        except me.EditError as exc:
            result = {"error": [exc.status, str(exc), exc.version]}
        shown = value if "ok" in result and op["fn"] != "delete_meeting" else meeting
        try:
            result["detail"] = mc.read_meeting(root, vault, shown) if isinstance(shown, str) else None
        except mc.CanvasError as exc:
            result["detail"] = {"canvasError": str(exc)}
        results.append(result)
    return {"results": results, "files": snapshot(vault)}


def main() -> None:
    command = sys.argv[1]
    if command == "build":
        payload = build(Path(sys.argv[2]))
    elif command == "read":
        payload = read(Path(sys.argv[2]), Path(sys.argv[3]))
    elif command == "snapshot":
        payload = snapshot(Path(sys.argv[2]))
    elif command == "run":
        payload = run(Path(sys.argv[2]), Path(sys.argv[3]), json.loads(Path(sys.argv[4]).read_text(encoding="utf-8")))
    else:
        raise SystemExit(__doc__)
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
