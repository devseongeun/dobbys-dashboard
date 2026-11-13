"""의사결정 현황(assets) Chrome 확인용 주입 스크립트를 만든다(웹 번들에 넣지 않는다).

scripts/demo/mock_data.py 가 만드는 가짜 Vault 의 90-assets 문서에, 스크립트가 든 확인용 가짜 문서(tests/web_check/assets/)를
더해 하나의 JS 를 출력한다. 그 JS 를 브라우저 도구의 eval 로 웹 셸 페이지에 넣으면 OPFS 아래 `90-assets` 폴더가 생기고
window.showDirectoryPicker 가 그 폴더를 돌려준다(공통 계약 '확인용' 절, opfs_fixture.js 와 같은 방식).

사용: python3 tests/web_check/assets_fixture.py > /tmp/assets_fixture.js
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PROBE = Path(__file__).resolve().parent / "assets"

SCRIPT = """(async () => {
  const S = %s;
  const FILES = Object.fromEntries(Object.entries(%s).map(([k, v]) => [k, v.replaceAll("@@S@@", S)]));
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry("90-assets", { recursive: true }); } catch { /* 처음 */ }
  const folder = await root.getDirectoryHandle("90-assets", { create: true });
  for (const [path, text] of Object.entries(FILES)) {
    const parts = path.split("/");
    let dir = folder;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
    const writable = await (await dir.getFileHandle(parts.at(-1), { create: true })).createWritable();
    await writable.write(text);
    await writable.close();
  }
  window.__picked = [];
  window.showDirectoryPicker = async (options) => { window.__picked.push(options); return folder; };
  return `OPFS 예제 폴더 90-assets 준비(${Object.keys(FILES).length}개), 선택 창 대체 완료`;
})();
"""


def files() -> dict[str, str]:
    with tempfile.TemporaryDirectory() as home:
        subprocess.run([sys.executable, str(REPO / "scripts/demo/mock_data.py"), home], check=True, cwd=REPO, stdout=subprocess.DEVNULL)
        assets = next((Path(home) / "DemoVault").glob("*/90-assets"))
        out = {p.name: p.read_text(encoding="utf-8") for p in sorted(assets.iterdir()) if p.is_file()}
    out.update({p.name: p.read_text(encoding="utf-8") for p in sorted(PROBE.iterdir()) if p.is_file()})
    # 하위 폴더 문서는 목록에 나오지 않고, 문서 안 링크로도 열리지 않아야 한다.
    out["부속/메모.html"] = '<head><meta name="feature" content="빠짐"><meta name="created" content="2026-11-01"></head>하위 폴더'
    return out


def script() -> str:
    """주입 JS. 붙여 넣기 크기를 줄이려 문서마다 같은 문의 현황 <style> 블록을 한 번만 싣는다(펼친 내용은 같다)."""
    found = files()
    style = re.search(r'<section class="docst"[^>]*>\n(<style>.*?</style>)', "".join(found.values()), re.S).group(1)
    packed = {name: text.replace(style, "@@S@@") for name, text in found.items()}
    return SCRIPT % (json.dumps(style, ensure_ascii=False), json.dumps(packed, ensure_ascii=False))


if __name__ == "__main__":
    print(script())
