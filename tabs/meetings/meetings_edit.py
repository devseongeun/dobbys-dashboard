"""회의 자료 Canvas 쓰기(대시보드 편집). HTTP와 무관하다(meetings_serve.py 가 쓴다).

- 모든 쓰기는 요청 version 이 meetings_canvas.version_of 와 같을 때만 한다(아니면 409). 잠금 하나로 직렬화한다.
- 저장은 같은 폴더 임시 파일 → os.replace. 읽은 JSON 객체를 고쳐 쓰므로 모르는 필드·id·edges 가 남는다. 탭 들여쓰기.
- 블록 안 순서만 바꿀 때는 `.order/<회의 id>.json`만 쓰고 Canvas 배치는 그대로 둔다.
- 카드 추가·다른 블록 이동은 대상 그룹 맨 아래에 놓고, 모자라면 그룹을 늘리고 그 아래 노드를 민다.
설계: projects/work/work-dashboard/docs/superpowers/specs/2026-11-04-meetings-canvas-design.md
"""
from __future__ import annotations

import datetime
import json
import os
import re
import secrets
import tempfile
import threading
import urllib.parse
from pathlib import Path

from . import meetings_canvas as mc

LOCK = threading.Lock()
PAD = 20
BLOCK_GAP = 80
BLOCK_SIZE = (900, 400)
FILE_SIZE = (400, 400)
LINK_SIZE = (400, 240)
MAX_NAME = 120
MAX_URL = 2048
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CONTROL = re.compile(r"[\x00-\x1f\x7f]")


class EditError(Exception):
    """HTTP 상태와 함께 올리는 편집 실패. 409 는 현재 version 을 담는다."""

    def __init__(self, status: int, message: str, version: str | None = None):
        super().__init__(message)
        self.status = status
        self.version = version


def clean_name(value, what: str = "이름") -> str:
    if not isinstance(value, str):
        raise EditError(400, f"{what}이 비었다")
    name = value.strip()
    if not name or len(name) > MAX_NAME or CONTROL.search(name):
        raise EditError(400, f"{what}은 1–{MAX_NAME}자, 제어 문자 없이 쓴다")
    return name


def meeting_id_for(date, title) -> str:
    name = clean_name(title, "회의 이름")
    if any(ch in name for ch in "/\\:") or name.startswith("."):
        raise EditError(400, "회의 이름에는 / \\ : 와 맨 앞 . 을 쓸 수 없다")
    if date is None:
        date = ""
    if not isinstance(date, str):
        raise EditError(400, "날짜는 YYYY-MM-DD 로 쓴다")
    date = date.strip()
    if not date:
        return name
    if not DATE.match(date):
        raise EditError(400, "날짜는 YYYY-MM-DD 로 쓴다")
    try:
        datetime.date.fromisoformat(date)
    except ValueError:
        raise EditError(400, "없는 날짜다") from None
    return f"{date} {name}"


def _dump(data) -> str:
    return json.dumps(data, ensure_ascii=False, indent="\t")


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o644
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _load(root: Path, meeting_id: str, version) -> tuple[Path, dict, dict]:
    path = mc.resolve_meeting(root, meeting_id)
    if path is None:
        raise EditError(404, "회의 Canvas가 없다")
    if not isinstance(version, str):
        raise EditError(400, "version 이 없다")
    current = mc.version_of(path)
    if version != current:
        raise EditError(409, "Canvas가 바뀌었다. 다시 불러온다", current)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise EditError(422, f"Canvas JSON을 읽지 못했다: {exc}") from exc
    if not isinstance(data, dict):
        raise EditError(422, "Canvas 최상위가 객체가 아니다")
    if not isinstance(data.setdefault("nodes", []), list):
        raise EditError(422, "Canvas nodes 가 배열이 아니다")
    return path, data, mc.read_order(path)


def _save(path: Path, data: dict | None = None, order: dict | None = None) -> None:
    if data is not None:
        _atomic_write(path, _dump(data))
    if order is not None:
        _atomic_write(mc.order_path(path), _dump(order))


def _nodes(data: dict) -> list[dict]:
    return [node for node in data["nodes"] if isinstance(node, dict)]


def _find(data: dict, node_id, what: str = "항목") -> dict:
    if isinstance(node_id, str):
        for node in _nodes(data):
            if node.get("id") == node_id:
                return node
    raise EditError(404, f"{what}이 없다")


def _target_group(data: dict, block_id) -> dict:
    if block_id == mc.UNGROUPED_ID:
        raise EditError(400, "미분류 블록에는 추가·이동할 수 없다")
    group = _find(data, block_id, "블록")
    if group.get("type") != "group":
        raise EditError(404, "블록이 없다")
    if mc.node_rect(group) is None:
        raise EditError(422, "그룹 좌표가 잘못됐다")
    return group


def _new_id(data: dict) -> str:
    used = {node.get("id") for node in _nodes(data)}
    while True:
        node_id = secrets.token_hex(8)
        if node_id not in used:
            return node_id


def _index(value) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise EditError(400, "index 는 정수다")
    return value


def _web_url(value) -> str:
    url = value.strip() if isinstance(value, str) else ""
    try:
        parts = urllib.parse.urlsplit(url)
    except ValueError:
        raise EditError(400, "http·https 주소만 추가할 수 있다") from None
    if parts.scheme not in ("http", "https") or not parts.netloc or len(url) > MAX_URL or CONTROL.search(url):
        raise EditError(400, "http·https 주소만 추가할 수 있다")
    return url


def _block_id_of(data: dict, node: dict) -> str | None:
    group = mc.group_of(_nodes(data), node)
    return mc.UNGROUPED_ID if group is None else group.get("id")


def _displayed_ids(data: dict, vault: Path, order: dict, block_id: str) -> list[str]:
    for block in mc.build_blocks(_nodes(data), vault, order):
        if block["id"] == block_id:
            return [item["id"] for item in block["items"] if item["id"] is not None]
    return []


def _put(order: dict, data: dict, vault: Path, block_id: str, item_id: str, index: int | None) -> None:
    ids = [i for i in _displayed_ids(data, vault, order, block_id) if i != item_id]
    at = len(ids) if index is None else max(0, min(index, len(ids)))
    ids.insert(at, item_id)
    order[block_id] = ids


def _drop(order: dict, item_id: str) -> None:
    for ids in order.values():
        while item_id in ids:
            ids.remove(item_id)


def _place(data: dict, group: dict, node: dict, size: tuple[float, float]) -> None:
    """node 를 group 맨 아래에 놓는다. 모자라면 group 과 원래 아래쪽 끝에 걸친 다른 그룹을 늘리고, 원래 아래쪽 끝 이하에 있던 나머지 노드를 그만큼 내린다."""
    nodes = _nodes(data)
    old = mc.node_rect(group)
    gx, gy, gw, gh = old
    old_bottom = gy + gh
    growers = [n for n in nodes
               if n is not group and n is not node and n.get("type") == "group"
               and (r := mc.node_rect(n)) is not None and r[1] < old_bottom <= r[1] + r[3]
               and not mc.inside(r, old)]
    bottoms = [r[1] + r[3] for n in nodes
               if n is not group and n is not node and (r := mc.node_rect(n)) is not None and mc.inside(r, old)]
    width, height = size
    x = gx + PAD
    y = max([gy + PAD] + [bottom + PAD for bottom in bottoms])
    node.update({"x": x, "y": y, "width": width, "height": height})
    if x + width > gx + gw:
        group["width"] = x + width + PAD - gx
    delta = y + height + PAD - old_bottom
    if delta <= 0:
        return
    group["height"] = gh + delta
    for other in nodes:
        if other is group or other is node or any(other is grower for grower in growers):
            continue
        rect = mc.node_rect(other)
        if rect is not None and rect[1] >= old_bottom:
            other["y"] = rect[1] + delta
    for grower in growers:
        grower["height"] = grower["height"] + delta


def create_meeting(root: Path, date, title) -> str:
    meeting_id = meeting_id_for(date, title)
    with LOCK:
        path = root / f"{meeting_id}.canvas"
        if path.exists():
            raise EditError(409, "같은 이름의 회의가 있다")
        _atomic_write(path, _dump({"nodes": [], "edges": []}))
    return meeting_id


def rename_meeting(root: Path, meeting_id: str, date, title, version) -> str:
    new_id = meeting_id_for(date, title)
    with LOCK:
        path, _, _ = _load(root, meeting_id, version)
        if new_id == path.stem:
            return new_id
        target = path.parent / f"{new_id}.canvas"
        if target.exists() and not target.samefile(path):
            raise EditError(409, "같은 이름의 회의가 있다")
        old_order = mc.order_path(path)
        os.replace(path, target)
        if old_order.exists():
            os.replace(old_order, mc.order_path(target))
    return new_id


def add_block(root: Path, meeting_id: str, label, version) -> str:
    name = clean_name(label, "블록 이름")
    with LOCK:
        path, data, _ = _load(root, meeting_id, version)
        rects = [r for n in _nodes(data) if (r := mc.node_rect(n)) is not None]
        x = min((r[0] for r in rects), default=0)
        y = max((r[1] + r[3] for r in rects), default=-BLOCK_GAP) + BLOCK_GAP
        width, height = BLOCK_SIZE
        data["nodes"].append({"id": _new_id(data), "type": "group", "x": x, "y": y,
                              "width": width, "height": height, "label": name})
        _save(path, data)
    return meeting_id


def rename_block(root: Path, meeting_id: str, block_id, label, version) -> str:
    name = clean_name(label, "블록 이름")
    with LOCK:
        path, data, _ = _load(root, meeting_id, version)
        group = _find(data, block_id, "블록")
        if group.get("type") != "group":
            raise EditError(404, "블록이 없다")
        group["label"] = name
        _save(path, data)
    return meeting_id


def add_item(root: Path, vault: Path, meeting_id: str, block_id, payload, version) -> str:
    if not isinstance(payload, dict):
        raise EditError(400, "본문이 객체가 아니다")
    kind = payload.get("kind")
    if kind not in ("file", "link"):
        raise EditError(400, "kind 는 file 또는 link 다")
    index = _index(payload.get("index"))
    url = _web_url(payload.get("url")) if kind == "link" else None
    with LOCK:
        path, data, order = _load(root, meeting_id, version)
        group = _target_group(data, block_id)
        if kind == "file":
            target = mc.resolve_vault_file(vault, payload.get("path") if isinstance(payload.get("path"), str) else "")
            if target is None:
                raise EditError(400, "Vault 안의 파일이 아니다")
            rel = target.relative_to(vault.resolve()).as_posix()
            nodes = _nodes(data)
            if any(n.get("type") == "file" and n.get("file") == rel and mc.group_of(nodes, n) is group for n in nodes):
                return meeting_id
            node, size = {"id": _new_id(data), "type": "file", "file": rel}, FILE_SIZE
        else:
            node, size = {"id": _new_id(data), "type": "link", "url": url}, LINK_SIZE
        data["nodes"].append(node)
        _place(data, group, node, size)
        _put(order, data, vault, block_id, node["id"], index)
        _save(path, data, order)
    return meeting_id


def move_item(root: Path, vault: Path, meeting_id: str, item_id, block_id, index, version) -> str:
    index = _index(index)
    if not isinstance(block_id, str):
        raise EditError(400, "block 이 없다")
    with LOCK:
        path, data, order = _load(root, meeting_id, version)
        node = _find(data, item_id)
        if node.get("type") == "group":
            raise EditError(400, "블록은 옮길 수 없다")
        if _block_id_of(data, node) == block_id:
            _put(order, data, vault, block_id, item_id, index)
            _save(path, order=order)
            return meeting_id
        group = _target_group(data, block_id)
        rect = mc.node_rect(node)
        if rect is None:
            raise EditError(400, "카드 좌표가 잘못됐다")
        _place(data, group, node, (rect[2], rect[3]))
        _drop(order, item_id)
        _put(order, data, vault, block_id, item_id, index)
        _save(path, data, order)
    return meeting_id


def delete_item(root: Path, meeting_id: str, item_id, version) -> str:
    with LOCK:
        path, data, order = _load(root, meeting_id, version)
        node = _find(data, item_id)
        if node.get("type") == "group":
            raise EditError(400, "블록은 지울 수 없다")
        data["nodes"] = [n for n in data["nodes"] if n is not node]
        edges = data.get("edges")
        if isinstance(edges, list):
            data["edges"] = [e for e in edges
                             if not (isinstance(e, dict) and item_id in (e.get("fromNode"), e.get("toNode")))]
        _drop(order, item_id)
        _save(path, data, order)
    return meeting_id
