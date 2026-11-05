"""테스트용 최소 xlsx. 실제 팀 WBS 처럼 sharedStrings 를 쓰고, 머리글은 9행·보조 라벨은 10행이다."""
from __future__ import annotations

import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
SHEET = "TROMBONE_v4.0.0_WBS(작업)"
HEADER = {"E": "요구사항ID", "F": "1 Depth", "G": "2 Depth", "H": "3 Depth", "I": "4 Depth", "J": "상세기능",
          "K": "구분", "L": "화면ID", "N": "시작분기", "O": "관리자", "P": "담당자", "Q": "실제 \n투입인원",
          "R": "계획\n시작일", "S": "예상\n완료일", "V": "계획\n기간"}
SUB = {"C": "가중치", "D": "수행단계", "R": 46282}
FIELDS = {"B": "pri", "C": "weight", "D": "stage", "E": "id", "F": "d1", "G": "d2", "H": "d3", "I": "name", "J": "detail",
          "K": "gubun", "L": "screen", "N": "q", "O": "mgr", "P": "owner", "Q": "people", "R": "start", "S": "end", "V": "md"}


def _shift(col: str, by: int) -> str:
    n = 0
    for ch in col:
        n = n * 26 + ord(ch) - 64
    n += by
    out = ""
    while n:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out


def make_xlsx(path: Path, sheets: dict[str, dict[int, dict[str, object]]]) -> Path:
    strings: list[str] = []

    def cell(ref, value):
        if isinstance(value, (int, float)):
            return f'<c r="{ref}"><v>{value}</v></c>'
        strings.append(str(value))
        return f'<c r="{ref}" t="s"><v>{len(strings) - 1}</v></c>'

    entries, rels = [], []
    with zipfile.ZipFile(path, "w") as book:
        for i, (name, rows) in enumerate(sheets.items(), start=1):
            body = "".join(
                f'<row r="{r}">' + "".join(cell(f"{c}{r}", v) for c, v in sorted(cols.items(), key=lambda kv: (len(kv[0]), kv[0]))) + "</row>"
                for r, cols in sorted(rows.items()))
            book.writestr(f"xl/worksheets/sheet{i}.xml", f'<worksheet xmlns="{MAIN}"><sheetData>{body}</sheetData></worksheet>')
            entries.append(f'<sheet name="{escape(name)}" sheetId="{i}" r:id="rId{i}"/>')
            rels.append(f'<Relationship Id="rId{i}" Type="{REL}/worksheet" Target="worksheets/sheet{i}.xml"/>')
        book.writestr("xl/workbook.xml", f'<workbook xmlns="{MAIN}" xmlns:r="{REL}"><sheets>{"".join(entries)}</sheets></workbook>')
        book.writestr("xl/_rels/workbook.xml.rels", f'<Relationships xmlns="{PKG}">{"".join(rels)}</Relationships>')
        book.writestr("xl/sharedStrings.xml",
                      f'<sst xmlns="{MAIN}">' + "".join(f"<si><t>{escape(s)}</t></si>" for s in strings) + "</sst>")
    return path


def wbs_book(path: Path, rows: list[dict], shift: int = 0, holidays: bool = True) -> Path:
    """rows: FIELDS 값 이름(pri, id, name, owner, start …) → 값. shift 만큼 모든 열을 오른쪽으로 민다."""
    sheet = {9: {_shift(c, shift): v for c, v in HEADER.items()}, 10: {_shift(c, shift): v for c, v in SUB.items()}}
    by_field = {field: col for col, field in FIELDS.items()}
    for i, row in enumerate(rows):
        sheet[11 + i] = {_shift(by_field[key], shift): value for key, value in row.items() if value is not None}
    sheets = {SHEET: sheet}
    if holidays:
        sheets["휴일"] = {1: {"A": "휴일"}, 2: {"A": 46289, "B": "추석 연휴"}}
    return make_xlsx(path, sheets)
