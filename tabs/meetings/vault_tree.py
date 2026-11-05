"""회의 자료 화면의 Vault 트리·파일 검색. 숨김(`.`으로 시작) 항목과 Vault 밖을 가리키는 심볼릭 링크는 보이지 않는다.

이름·경로는 NFC로 돌려준다(macOS 파일명이 NFD여도 브라우저 검색어·Canvas 경로와 맞게).
설계: projects/work/work-dashboard/docs/superpowers/specs/2026-11-04-meetings-canvas-design.md
"""
from __future__ import annotations

import os
import unicodedata
from pathlib import Path

SEARCH_LIMIT = 50


def _nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)


def resolve_vault_dir(vault: Path, rel: str) -> Path | None:
    """Vault 기준 폴더 경로. 빈 값은 Vault 루트. 절대 경로·역슬래시·빈 조각·`.`으로 시작하는 조각·Vault 밖·폴더 아님은 None."""
    vault = vault.resolve()
    if rel == "":
        return vault
    if rel.startswith("/") or "\\" in rel or "\x00" in rel:
        return None
    if any(not part or part.startswith(".") for part in rel.split("/")):
        return None
    try:
        candidate = (vault / rel).resolve()
    except (ValueError, OSError):
        return None
    if not candidate.is_relative_to(vault) or not candidate.is_dir():
        return None
    return candidate


def _within(path: Path, vault: Path) -> bool:
    try:
        return path.resolve().is_relative_to(vault)
    except (ValueError, OSError):
        return False


def list_dir(vault: Path, rel: str) -> list[dict] | None:
    folder = resolve_vault_dir(vault, rel)
    if folder is None:
        return None
    vault = vault.resolve()
    try:
        children = list(folder.iterdir())
    except OSError:
        return None
    entries = []
    for child in children:
        if child.name.startswith(".") or not _within(child, vault):
            continue
        is_dir = child.is_dir()
        if not is_dir and not child.is_file():
            continue
        entries.append({"name": _nfc(child.name), "path": _nfc(child.relative_to(vault).as_posix()), "dir": is_dir})
    entries.sort(key=lambda e: (not e["dir"], e["name"].casefold()))
    return entries


def search(vault: Path, query: str, limit: int = SEARCH_LIMIT) -> tuple[list[dict], bool]:
    """Vault 기준 경로에 검색어가 들어간(대소문자 무시) 파일. 경로순 최대 limit 건, 넘치면 truncated=True."""
    needle = _nfc(query.strip()).casefold()
    if not needle:
        return [], False
    vault = vault.resolve()
    results = []
    for dirpath, dirnames, filenames in os.walk(vault):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        base = Path(dirpath)
        for name in sorted(filenames):
            if name.startswith("."):
                continue
            path = base / name
            if path.is_symlink() and not _within(path, vault):
                continue
            rel = _nfc(path.relative_to(vault).as_posix())
            if needle not in rel.casefold():
                continue
            results.append({"name": _nfc(name), "path": rel})
    results.sort(key=lambda r: (r["path"].casefold(), r["path"]))
    return results[:limit], len(results) > limit
