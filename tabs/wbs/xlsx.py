"""팀 WBS 엑셀(.xlsx)에서 담당자 행과 휴일을 읽는다. 표준 라이브러리(zipfile·xml.etree)만 쓴다.

열 위치가 아니라 머리글 이름(공백·줄바꿈 제거)으로 찾는다. 머리글은 '요구사항ID'가 있는 행이고,
바로 아랫줄이 보조 라벨(가중치·수행단계) 줄이다. 우선순위(pri)는 '가중치' 바로 왼쪽 열이다.
"""
from __future__ import annotations

import re
import threading
import xml.etree.ElementTree as ET
import zipfile
import zlib
from datetime import date, timedelta
from pathlib import Path

MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG = "{http://schemas.openxmlformats.org/package/2006/relationships}"
HOLIDAY_SHEET = "휴일"
EXCEL_EPOCH = date(1899, 12, 30)
HEADERS = {
    "id": "요구사항ID", "d1": "1Depth", "d2": "2Depth", "d3": "3Depth", "name": "4Depth",
    "detail": "상세기능", "gubun": "구분", "screen": "화면ID", "q": "시작분기", "mgr": "관리자",
    "owner": "담당자", "people": "실제투입인원", "start": "계획시작일", "end": "예상완료일", "md": "계획기간",
}
REQUIRED = ("id", "name", "owner", "start", "end")
CELL_REF = re.compile(r"^([A-Z]+)\d+$")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


BROKEN = (KeyError, IndexError, ValueError, zipfile.BadZipFile, zlib.error, EOFError, ET.ParseError, OSError)


class XlsxError(ValueError):
    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field


def label(text: str | None) -> str:
    return re.sub(r"\s+", "", text or "")


def col_index(col: str) -> int:
    n = 0
    for ch in col:
        n = n * 26 + ord(ch) - 64
    return n


def col_name(n: int) -> str:
    out = ""
    while n:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out


def _number(value: str | None):
    if value in (None, ""):
        return None
    try:
        num = float(value)
    except ValueError:
        return None
    return int(num) if num.is_integer() else num


def _date(value: str | None) -> str | None:
    if value in (None, ""):
        return None
    if ISO_DATE.match(value):
        return value
    num = _number(value)
    if num is None:
        return None
    try:
        return (EXCEL_EPOCH + timedelta(days=int(num))).isoformat()
    except (OverflowError, ValueError):
        return None


def _owned(value: str | None, owner: str) -> bool:
    text = " ".join((value or "").split())
    return text == owner or re.fullmatch(re.escape(owner) + r" ?외 ?\d+ ?명", text) is not None


class Workbook:
    def __init__(self, path: Path):
        try:
            self._zip = zipfile.ZipFile(path)
        except BROKEN as exc:
            raise XlsxError("workbook", "xlsx 파일이 아닙니다") from exc
        try:
            self._load()
        except BaseException:
            self._zip.close()
            raise

    def _load(self) -> None:
        try:
            book = ET.fromstring(self._zip.read("xl/workbook.xml"))
            rels = ET.fromstring(self._zip.read("xl/_rels/workbook.xml.rels"))
        except BROKEN as exc:
            raise XlsxError("workbook", "xlsx 파일이 아닙니다") from exc
        targets = {r.get("Id"): r.get("Target") for r in rels.iter(f"{PKG}Relationship")}
        self._sheets = {}
        for sheet in book.iter(f"{MAIN}sheet"):
            target = targets.get(sheet.get(f"{REL}id")) or ""
            self._sheets[sheet.get("name")] = target.lstrip("/") if target.startswith("/") else f"xl/{target}"
        try:
            data = self._zip.read("xl/sharedStrings.xml")
        except KeyError:
            data = None
        except BROKEN as exc:
            raise XlsxError("workbook", "xlsx 파일이 아닙니다") from exc
        if data is None:
            self._strings = []
            return
        try:
            strings = ET.fromstring(data)
        except BROKEN as exc:
            raise XlsxError("workbook", "xlsx 파일이 아닙니다") from exc
        self._strings = ["".join(t.text or "" for t in si.iter(f"{MAIN}t")) for si in strings.iter(f"{MAIN}si")]

    def close(self) -> None:
        self._zip.close()

    def _value(self, cell) -> str | None:
        kind = cell.get("t")
        if kind == "inlineStr":
            return "".join(t.text or "" for t in cell.iter(f"{MAIN}t"))
        node = cell.find(f"{MAIN}v")
        if node is None or node.text is None:
            return None
        if kind != "s":
            return node.text
        try:
            return self._strings[int(node.text)]
        except (IndexError, ValueError) as exc:
            raise XlsxError("workbook", "xlsx 파일이 아닙니다") from exc

    def rows(self, name: str) -> list[dict[str, str]]:
        if name not in self._sheets:
            raise XlsxError("sheet", f"'{name}' 시트가 없습니다. 있는 시트: {', '.join(self._sheets)}")
        try:
            root = ET.fromstring(self._zip.read(self._sheets[name]))
        except BROKEN as exc:
            raise XlsxError("workbook", "xlsx 파일이 아닙니다") from exc
        out = []
        for row in root.iter(f"{MAIN}row"):
            cells = {}
            for cell in row.iter(f"{MAIN}c"):
                match = CELL_REF.match(cell.get("r") or "")
                value = self._value(cell) if match else None
                if value not in (None, ""):
                    cells[match.group(1)] = value
            out.append(cells)
        return out

    def holidays(self) -> dict[str, str]:
        if HOLIDAY_SHEET not in self._sheets:
            return {}
        out = {}
        for row in self.rows(HOLIDAY_SHEET):
            if _number(row.get("A")) is None:
                continue
            out[_date(row["A"])] = (row.get("B") or "").strip()
        return out


def read_wbs(path: Path, sheet: str, owner: str) -> dict:
    owner = " ".join(owner.split())
    book = Workbook(path)
    try:
        rows = book.rows(sheet)
        head = next((i for i, row in enumerate(rows) if HEADERS["id"] in {label(v) for v in row.values()}), None)
        if head is None:
            raise XlsxError("sheet", f"'{sheet}' 시트에 '{HEADERS['id']}' 머리글이 없습니다")
        by_label = {label(v): c for c, v in rows[head].items()}
        cols = {key: by_label.get(text) for key, text in HEADERS.items()}
        missing = [HEADERS[key] for key in REQUIRED if not cols[key]]
        if missing:
            raise XlsxError("sheet", "머리글이 없습니다: " + ", ".join(missing))
        sub = {label(v): c for c, v in rows[head + 1].items()} if head + 1 < len(rows) else {}
        cols["weight"], cols["stage"] = sub.get("가중치"), sub.get("수행단계")
        cols["pri"] = col_name(col_index(cols["weight"]) - 1) if cols["weight"] and col_index(cols["weight"]) > 1 else None

        tasks = []
        for row in rows[head + 1:]:
            def get(key):
                return row.get(cols[key]) if cols.get(key) else None

            task_id = (get("id") or "").strip()
            if not task_id or not _owned(get("owner"), owner):
                continue
            tasks.append({
                "id": task_id, "pri": get("pri"), "weight": _number(get("weight")), "stage": get("stage"),
                "d1": get("d1"), "d2": get("d2"), "d3": get("d3"), "name": get("name"),
                "gubun": get("gubun"), "screen": get("screen"), "mgr": get("mgr"), "owner": get("owner"),
                "people": _number(get("people")), "start": _date(get("start")), "end": _date(get("end")),
                "md": _number(get("md")), "q": get("q"), "detail": get("detail"), "jira": None,
            })
        if not tasks:
            raise XlsxError("owner", f"담당자 '{owner}' 행이 없습니다")
        return {"tasks": tasks, "holidays": book.holidays()}
    finally:
        book.close()


class WbsSource:
    """파일이 바뀔 때(mtime·크기)만 다시 읽는다."""

    def __init__(self, path: Path, sheet: str, owner: str):
        self._path, self._sheet, self._owner = Path(path), sheet, owner
        self._lock = threading.Lock()
        self._key = None
        self._data = None

    def load(self) -> dict:
        stat = self._path.stat()
        key = (stat.st_mtime_ns, stat.st_size)
        with self._lock:
            if key != self._key:
                self._data = read_wbs(self._path, self._sheet, self._owner)
                self._key = key
            return self._data
