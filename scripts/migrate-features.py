#!/usr/bin/env python3
"""기능 구분 사이드카(`00_<폴더명>_기능구분.md`)를 각 문서 안으로 한 번 옮긴다.

- 의사결정 문서 폴더(--assets): `| 파일 | 기능 구분 | 작성일 |` 표 → 각 HTML `<head>`에
  `<meta name="feature" content="…">`·`<meta name="created" content="YYYY-MM-DD">`를 넣는다.
- 구현 계획 폴더(--plans): `| 파일 | 기능 구분 |` 표 → 각 md frontmatter에 `feature: …`를 넣는다.
  frontmatter가 없는 계획에는 `feature`만 든 frontmatter를 만든다(status가 없으니 참고 그대로).
- 이미 meta·feature가 있는 문서는 건너뛴다. 표에 있지만 파일이 없는 행은 경고만 한다.
- 다 옮기면 사이드카를 지운다. `--dry-run`이면 바꿀 내용만 보여 주고 아무것도 쓰지 않는다.

사용:
  python3 scripts/migrate-features.py --assets ~/Vault/…/90-assets --plans ~/Vault/…/10-plans [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from tabs.assets.assets_index import META_TAG  # noqa: E402
from tabs.plans.plans_index import frontmatter  # noqa: E402

HEAD_OPEN = re.compile(r"<head[^>]*>", re.I)
CHARSET = re.compile(r"<meta\s+charset=[^>]*>", re.I)


def nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)


def sidecar(folder: Path) -> Path:
    return folder / f"00_{folder.name}_기능구분.md"


def rows(path: Path, columns: int) -> dict:
    """사이드카 표 → {파일명(NFC): [열 값…]}. 머리·구분선·인용문은 건너뛴다."""
    table = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.startswith("|") or line.startswith("| 파일 ") or line.startswith("| ---"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < columns:
            cells += [""] * (columns - len(cells))
        table[nfc(cells[0])] = cells[1:columns]
    return table


def files_by_name(folder: Path, suffix: str) -> dict:
    return {nfc(p.name): p for p in folder.glob(f"*{suffix}") if p.is_file() and not p.name.startswith(("00_", "."))}


def meta_line(feature: str, created: str) -> str:
    tags = []
    if feature:
        tags.append(f'<meta name="feature" content="{feature.replace(chr(34), "&quot;")}">')
    if created:
        tags.append(f'<meta name="created" content="{created}">')
    return "".join(tags)


def patch_html(src: str, feature: str, created: str) -> str | None:
    """`<meta charset>` 뒤(없으면 `<head>` 바로 뒤)에 meta를 넣는다. 자리가 없으면 None."""
    existing = {m.group("name").lower() for m in META_TAG.finditer(src)}
    line = meta_line("" if "feature" in existing else feature, "" if "created" in existing else created)
    if not line:
        return src
    anchor = CHARSET.search(src) or HEAD_OPEN.search(src)
    if not anchor:
        return None
    return src[:anchor.end()] + line + src[anchor.end():]


def patch_md(src: str, feature: str) -> str:
    """frontmatter 첫 줄 뒤에 `feature:`를 넣는다. frontmatter가 없으면(닫히지 않은 블록 포함) 새로 만든다."""
    if "feature" in frontmatter(src):
        return src
    line = f"feature: {feature}\n"
    closed = src.startswith("---\n") and any(l.strip() == "---" for l in src.splitlines()[1:])
    if closed:
        return "---\n" + line + src[4:]
    return "---\n" + line + "---\n" + src


def migrate(folder: Path, suffix: str, columns: int, patch, dry_run: bool) -> tuple[int, list]:
    table_path = sidecar(folder)
    if not table_path.is_file():
        return 0, [f"사이드카가 없다: {table_path}"]
    table = rows(table_path, columns)
    files = files_by_name(folder, suffix)
    for name in sorted(set(table) - set(files)):
        print(f"  (표에만 있고 파일은 없음, 건너뜀: {name})")
    warnings = []
    changed = 0
    for name, values in table.items():
        path = files.get(name)
        if path is None:
            continue
        src = path.read_text(encoding="utf-8")
        out = patch(src, *values)
        if out is None:
            warnings.append(f"넣을 자리가 없음(<head> 없음): {path.name}")
            continue
        if out == src:
            continue
        changed += 1
        print(f"  {'[dry] ' if dry_run else ''}{path.name} ← {' / '.join(v for v in values if v)}")
        if not dry_run:
            path.write_text(out, encoding="utf-8")
    if warnings or dry_run:
        return changed, warnings
    table_path.unlink()
    print(f"  사이드카 삭제: {table_path.name}")
    return changed, warnings


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--assets", type=Path, help="의사결정 문서 폴더")
    ap.add_argument("--plans", type=Path, help="구현 계획 폴더")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not args.assets and not args.plans:
        ap.error("--assets 나 --plans 중 하나는 준다")
    failed = False
    for label, folder, suffix, columns, patch in (
        ("의사결정 문서", args.assets, ".html", 3, patch_html),
        ("구현 계획", args.plans, ".md", 2, patch_md),
    ):
        if folder is None:
            continue
        folder = folder.expanduser().resolve()
        if not folder.is_dir():
            print(f"[ERR] 폴더가 없다: {folder}", file=sys.stderr)
            failed = True
            continue
        print(f"{label}: {folder}")
        changed, warnings = migrate(folder, suffix, columns, patch, args.dry_run)
        print(f"  {changed}개 문서 {'변경 예정' if args.dry_run else '변경'}")
        for warning in warnings:
            print(f"  [WARN] {warning}")
        if warnings and not args.dry_run:
            print("  경고가 있어 사이드카를 남겨 둔다. 확인 후 다시 실행하거나 직접 지운다.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
