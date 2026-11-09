"""회의 자료 Canvas 읽기(설정에서 고른 회의 폴더). HTTP와 무관한 순수 함수만 둔다(meetings_serve.py·meetings_edit.py 가 쓴다).

- 업무 1건 = 회의 폴더 바로 아래 `.canvas` 1개, 그 업무의 회의 1건(화면의 블록) = Canvas 그룹 1개.
  코드·API의 meeting 은 업무 Canvas, block 은 회의(그룹)다(저장 형식과 주소를 그대로 두려고 이름은 옛것을 쓴다).
- 노드 사각형이 그룹 사각형 안에 완전히 들어가면(경계 포함) 그 그룹 소속, 여럿이면 면적이 가장 작은 그룹, 없으면 `미분류`.
- 회의 블록은 이름 앞 `YYYY-MM-DD` 날짜 최신순, 날짜가 없으면 그 뒤에 Canvas 위치(y, x)순, `미분류`는 맨 뒤.
  블록 안 항목 순서는 `.order/<업무 id>.json`에 적힌 id를 먼저, 나머지는 위치순.
- Obsidian이 새로 만든 `{}` Canvas는 빈 업무다. `version`은 Canvas·순서 파일 내용 해시(쓰기 충돌 확인용).
설계: docs/superpowers/specs/2026-11-04-meetings-canvas-design.md
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

UNGROUPED = "미분류"
UNGROUPED_ID = "_ungrouped"
ORDER_DIR = ".order"
PREVIEW_MIME = {
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
}
DATE = re.compile(r"^(\d{4}-\d{2}-\d{2})\s*(.*)$")
COLOR = re.compile(r"^(?:[1-6]|#[0-9a-fA-F]{3,8})$")
ITEM_TYPES = ("file", "link", "text")


class CanvasError(ValueError):
    """Canvas JSON 을 블록으로 읽을 수 없다."""


def split_name(stem: str) -> tuple[str, str]:
    """`2026-11-05 이름` → ("2026-11-05", "이름"). 날짜가 없으면 ("", stem). 업무 파일명과 회의 블록 이름에 쓴다."""
    match = DATE.match(stem)
    if not match:
        return "", stem
    return match.group(1), match.group(2) or stem


def resolve_meeting(root: Path, meeting_id: str) -> Path | None:
    """root 바로 아래 `<meeting_id>.canvas` 만 돌려준다. 하위 폴더·숨김·상위 경로는 None."""
    if not meeting_id or meeting_id.startswith(".") or "/" in meeting_id or "\\" in meeting_id or "\x00" in meeting_id:
        return None
    root = root.resolve()
    try:
        candidate = (root / f"{meeting_id}.canvas").resolve()
    except (ValueError, OSError):
        return None
    if candidate.parent != root or not candidate.is_file():
        return None
    return candidate


def resolve_vault_file(vault: Path, rel: str) -> Path | None:
    """Vault 기준 상대 경로를 실제 파일로. 절대 경로·역슬래시·빈 조각·`.`으로 시작하는 조각(`..`·숨김)·Vault 밖(심볼릭 링크 포함)·폴더는 None."""
    if not rel or rel.startswith("/") or "\\" in rel or "\x00" in rel:
        return None
    if any(not part or part.startswith(".") for part in rel.split("/")):
        return None
    vault = vault.resolve()
    try:
        candidate = (vault / rel).resolve()
    except (ValueError, OSError):
        return None
    if not candidate.is_relative_to(vault) or not candidate.is_file():
        return None
    return candidate


def order_path(canvas: Path) -> Path:
    return canvas.parent / ORDER_DIR / f"{canvas.stem}.json"


def read_order(canvas: Path) -> dict[str, list[str]]:
    """블록 id → 항목 id 목록. 없거나 깨졌으면 빈 dict(위치순으로 보여 준다)."""
    try:
        data = json.loads(order_path(canvas).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {key: [i for i in ids if isinstance(i, str)]
            for key, ids in data.items() if isinstance(key, str) and isinstance(ids, list)}


def version_of(canvas: Path) -> str:
    digest = hashlib.sha256(canvas.read_bytes())
    digest.update(b"\0")
    try:
        digest.update(order_path(canvas).read_bytes())
    except OSError:
        pass
    return digest.hexdigest()[:16]


def read_nodes(path: Path) -> list[dict]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CanvasError(f"Canvas JSON을 읽지 못했다: {exc}") from exc
    if not isinstance(data, dict):
        raise CanvasError("Canvas 최상위가 객체가 아니다")
    nodes = data.get("nodes", [])
    if not isinstance(nodes, list):
        raise CanvasError("Canvas nodes 가 배열이 아니다")
    return [node for node in nodes if isinstance(node, dict)]


def node_rect(node: dict) -> tuple[float, float, float, float] | None:
    values = tuple(node.get(key) for key in ("x", "y", "width", "height"))
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in values):
        return None
    return values


def inside(inner, outer) -> bool:
    x, y, w, h = inner
    gx, gy, gw, gh = outer
    return gx <= x and gy <= y and x + w <= gx + gw and y + h <= gy + gh


def _position(entry) -> tuple[float, float]:
    rect = entry[0]
    return rect[1], rect[0]


def _groups(nodes: list[dict]) -> list[tuple[tuple, dict]]:
    groups = [(rect, node) for node in nodes
              if isinstance(node, dict) and node.get("type") == "group" and (rect := node_rect(node)) is not None]
    groups.sort(key=_position)
    return groups


def _owner(rect, groups, skip=None) -> int | None:
    owners = [index for index, (group_rect, group) in enumerate(groups) if group is not skip and inside(rect, group_rect)]
    if not owners:
        return None
    return min(owners, key=lambda i: groups[i][0][2] * groups[i][0][3])


def group_of(nodes: list[dict], node: dict) -> dict | None:
    """node 를 완전히 포함하는 그룹 중 면적이 가장 작은 것(같으면 위치순 앞). 없으면 None."""
    rect = node_rect(node)
    if rect is None:
        return None
    groups = _groups(nodes)
    index = _owner(rect, groups, skip=node)
    return None if index is None else groups[index][1]


def _item(node: dict, vault: Path) -> dict | None:
    kind = node["type"]
    node_id = node.get("id") if isinstance(node.get("id"), str) else None
    if kind == "file":
        path = node.get("file")
        if not isinstance(path, str) or not path:
            return None
        name = path.rsplit("/", 1)[-1]
        ext = Path(name).suffix.lower()
        subpath = node.get("subpath")
        return {"kind": "file", "id": node_id, "path": path, "name": name, "ext": ext,
                "subpath": subpath if isinstance(subpath, str) else "",
                "missing": resolve_vault_file(vault, path) is None, "preview": ext in PREVIEW_MIME}
    if kind == "link":
        url = node.get("url")
        return {"kind": "link", "id": node_id, "url": url} if isinstance(url, str) and url.strip() else None
    text = node.get("text")
    return {"kind": "text", "id": node_id, "text": text} if isinstance(text, str) and text.strip() else None


def _apply_order(items: list[dict], saved: list[str]) -> list[dict]:
    by_id = {item["id"]: item for item in items if item["id"] is not None}
    first, seen = [], set()
    for item_id in saved:
        if item_id in by_id and item_id not in seen:
            first.append(by_id[item_id])
            seen.add(item_id)
    return first + [item for item in items if item["id"] not in seen]


def build_blocks(nodes: list[dict], vault: Path, order: dict | None = None) -> list[dict]:
    order = order or {}
    groups = _groups(nodes)
    items = []
    for node in nodes:
        if node.get("type") not in ITEM_TYPES:
            continue
        rect = node_rect(node)
        item = _item(node, vault) if rect is not None else None
        if item is not None:
            items.append((rect, item))
    members = [[] for _ in groups]
    loose = []
    for rect, item in sorted(items, key=_position):
        index = _owner(rect, groups)
        (loose if index is None else members[index]).append(item)
    blocks = []
    for number, ((_, group), entries) in enumerate(zip(groups, members), 1):
        group_id = group.get("id") if isinstance(group.get("id"), str) else None
        label = group.get("label")
        color = group.get("color")
        blocks.append({
            "id": group_id,
            "label": label.strip() if isinstance(label, str) and label.strip() else f"블록 {number}",
            "color": color if isinstance(color, str) and COLOR.match(color) else "",
            "items": _apply_order(entries, order.get(group_id, []) if group_id else []),
        })
    # 날짜 최신순. 정렬은 안정적이라 날짜가 같거나 없는 블록은 위치순을 지킨다(빈 날짜는 reverse 로 맨 뒤).
    blocks.sort(key=lambda block: split_name(block["label"])[0], reverse=True)
    if loose:
        blocks.append({"id": UNGROUPED_ID, "label": UNGROUPED, "color": "",
                       "items": _apply_order(loose, order.get(UNGROUPED_ID, []))})
    return blocks


def list_meetings(root: Path) -> list[dict]:
    if not root.is_dir():
        return []
    meetings = []
    for path in root.iterdir():
        if path.name.startswith(".") or path.suffix != ".canvas" or not path.is_file():
            continue
        date, title = split_name(path.stem)
        entry = {"id": path.stem, "title": title, "date": date, "mtime": int(path.stat().st_mtime), "error": None}
        try:
            read_nodes(path)
        except CanvasError as exc:
            entry["error"] = str(exc)
        meetings.append(entry)
    meetings.sort(key=lambda m: m["title"])
    meetings.sort(key=lambda m: m["date"], reverse=True)
    return meetings


def read_meeting(root: Path, vault: Path, meeting_id: str) -> dict | None:
    path = resolve_meeting(root, meeting_id)
    if path is None:
        return None
    vault = vault.resolve()
    date, title = split_name(path.stem)
    return {"id": path.stem, "title": title, "date": date, "vault": vault.name,
            "canvasPath": path.relative_to(vault).as_posix(), "version": version_of(path),
            "blocks": build_blocks(read_nodes(path), vault, read_order(path))}
