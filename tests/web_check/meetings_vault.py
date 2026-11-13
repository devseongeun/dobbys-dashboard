"""Chrome 확인용(웹 번들 아님). mock_data.py 가 만든 DemoVault 를 meetings_opfs.js installMeetingsVault() 에 넘길 JSON 으로.

사용: python3 tests/web_check/meetings_vault.py <임시 HOME>/DemoVault [경로 앞부분 …] > vault.json
경로 앞부분을 주면 그것으로 시작하는 파일만 싣는다(eval 할 코드를 줄이려고). 글 파일은 그대로, 나머지는 base64.
엑셀(.xlsx)은 빼고, 미리보기 확인용 작은 PDF 하나(DEMO_100/docs/한 쪽.pdf)를 더한다.
"""
import base64
import json
import sys
from pathlib import Path

PDF = (b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
       b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
       b"4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 20 60 Td (meetings pdf) Tj ET\nendstream endobj\n"
       b"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n")

TEXT = {".md", ".canvas", ".html", ".json", ".txt"}
vault = Path(sys.argv[1])
prefixes = tuple(sys.argv[2:]) or ("",)


def entry(data: bytes, suffix: str) -> dict:
    return {"text": data.decode("utf-8")} if suffix in TEXT else {"b64": base64.b64encode(data).decode()}


files = {p.relative_to(vault).as_posix(): entry(p.read_bytes(), p.suffix) for p in sorted(vault.rglob("*"))
         if p.is_file() and p.suffix != ".xlsx" and p.relative_to(vault).as_posix().startswith(prefixes)}
files["DEMO_100/docs/한 쪽.pdf"] = entry(PDF, ".pdf")
dirs = [p.relative_to(vault).as_posix() for p in sorted(vault.rglob("*")) if p.is_dir()]
print(json.dumps({"files": files, "dirs": dirs}, ensure_ascii=False))
