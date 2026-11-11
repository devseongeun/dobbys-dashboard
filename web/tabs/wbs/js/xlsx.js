// 팀 WBS 엑셀(.xlsx)에서 담당자 행과 휴일을 읽는다. 로컬판 tabs/wbs/xlsx.py 의 브라우저 이식이다(라이브러리 없음).
// ZIP 은 직접 읽고 압축은 DecompressionStream('deflate-raw'), XML 은 DOMParser 로 푼다.
// 열 위치가 아니라 머리글 이름(공백·줄바꿈 제거)으로 찾는다. 머리글은 '요구사항ID'가 있는 행이고,
// 바로 아랫줄이 보조 라벨(가중치·수행단계) 줄이다. 우선순위(pri)는 '가중치' 바로 왼쪽 열이다.
// 파일 내용은 브라우저 안에서만 읽고 서버로 보내지 않는다.

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
export const HOLIDAY_SHEET = "휴일";
export const HEADERS = {
  id: "요구사항ID", d1: "1Depth", d2: "2Depth", d3: "3Depth", name: "4Depth",
  detail: "상세기능", gubun: "구분", screen: "화면ID", q: "시작분기", mgr: "관리자",
  owner: "담당자", people: "실제투입인원", start: "계획시작일", end: "예상완료일", md: "계획기간",
};
const REQUIRED = ["id", "name", "owner", "start", "end"];
const CELL_REF = /^([A-Z]+)\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86400000;
const NOT_XLSX = "xlsx 파일이 아닙니다";

export class XlsxError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
  }
}

const broken = () => new XlsxError("workbook", NOT_XLSX);

export const label = (text) => String(text ?? "").replace(/\s+/gu, "");

export function colIndex(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + ch.charCodeAt(0) - 64;
  return n;
}

export function colName(n) {
  let out = "";
  while (n) {
    const r = (n - 1) % 26;
    n = Math.floor((n - 1) / 26);
    out = String.fromCharCode(65 + r) + out;
  }
  return out;
}

// Python float() 이 받는 모양(밑줄 자릿수·inf·nan 포함)만 숫자로 본다. Number() 는 "" 나 "0x10" 도 받아서 쓰지 않는다.
const FLOAT_RE = /^[+-]?(?:(?:\d(?:_?\d)*)(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?$/;
const SPECIAL_RE = /^([+-]?)(inf|infinity|nan)$/i;

function pyFloat(value) {
  const text = value.trim();
  if (FLOAT_RE.test(text)) return Number(text.replaceAll("_", ""));
  const special = SPECIAL_RE.exec(text);
  if (!special) return null;
  if (special[2].toLowerCase() === "nan") return NaN;
  return special[1] === "-" ? -Infinity : Infinity;
}

export function toNumber(value) {
  if (value == null || value === "") return null;
  const num = pyFloat(String(value));
  return num === null ? null : num;
}

export function toDate(value) {
  if (value == null || value === "") return null;
  if (ISO_DATE.test(value)) return value;
  const num = toNumber(value);
  if (num === null || !Number.isFinite(num)) return null;
  const days = Math.trunc(num);
  if (Math.abs(days) > 999999999) return null;
  const at = new Date(EXCEL_EPOCH_MS + days * DAY_MS);
  const year = at.getUTCFullYear();
  if (Number.isNaN(at.getTime()) || year < 1 || year > 9999) return null;
  return String(year).padStart(4, "0") + "-" + String(at.getUTCMonth() + 1).padStart(2, "0") +
    "-" + String(at.getUTCDate()).padStart(2, "0");
}

const squash = (text) => String(text ?? "").split(/\s+/u).filter(Boolean).join(" ");
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function owned(value, owner) {
  const text = squash(value);
  return text === owner || new RegExp("^" + escapeRe(owner) + " ?외 ?\\p{Nd}+ ?명$", "u").test(text);
}

// --- ZIP ---------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// 중앙 디렉터리만 읽어 이름 → 위치를 만든다. 실제 내용은 read() 할 때 푼다(Python zipfile 과 같은 순서).
function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const min = Math.max(0, bytes.length - 22 - 65535);
  let end = -1;
  for (let i = bytes.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw broken();
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = new Map();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw broken();
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    entries.set(name, {
      method: view.getUint16(at + 10, true),
      crc: view.getUint32(at + 16, true),
      size: view.getUint32(at + 20, true),
      plain: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return { view, entries };
}

class Zip {
  constructor(bytes, inflate) {
    this.bytes = bytes;
    this.inflate = inflate;
    ({ view: this.view, entries: this.entries } = zipEntries(bytes));
  }

  has(name) {
    return this.entries.has(name);
  }

  // 없는 이름은 null, 깨진 내용은 XlsxError(workbook).
  async read(name) {
    const entry = this.entries.get(name);
    if (!entry) return null;
    const { view, bytes } = this;
    const at = entry.offset;
    if (at + 30 > bytes.length || view.getUint32(at, true) !== 0x04034b50) throw broken();
    const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
    if (start + entry.size > bytes.length) throw broken();
    const packed = bytes.subarray(start, start + entry.size);
    let data;
    if (entry.method === 0) data = packed;
    else if (entry.method === 8) {
      try { data = await this.inflate(packed); } catch { throw broken(); }
    } else throw broken();
    if (data.length !== entry.plain || crc32(data) !== entry.crc) throw broken();
    return new TextDecoder().decode(data);
  }
}

// --- XML ---------------------------------------------------------------

export function parseXmlDom(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("XML 을 읽지 못했다");
  return doc;
}

const all = (node, local) => Array.from(node.getElementsByTagNameNS(MAIN, local));
const text = (node) => node.textContent ?? "";

function childV(cell) {
  for (const child of Array.from(cell.childNodes)) {
    if (child.nodeType === 1 && child.namespaceURI === MAIN && child.localName === "v") return child;
  }
  return null;
}

class Workbook {
  static async open(bytes, { inflate = inflateRaw, parseXml = parseXmlDom } = {}) {
    const book = new Workbook();
    try {
      book.zip = new Zip(bytes, inflate);
    } catch {
      throw broken();
    }
    book.parseXml = parseXml;
    await book.load();
    return book;
  }

  async xml(name) {
    const raw = await this.zip.read(name);
    if (raw === null) throw broken();
    try { return this.parseXml(raw); } catch { throw broken(); }
  }

  async load() {
    const book = await this.xml("xl/workbook.xml");
    const rels = await this.xml("xl/_rels/workbook.xml.rels");
    const targets = new Map();
    for (const r of Array.from(rels.getElementsByTagNameNS(PKG, "Relationship"))) {
      targets.set(r.getAttribute("Id"), r.getAttribute("Target"));
    }
    this.sheets = new Map();
    for (const sheet of all(book, "sheet")) {
      const target = targets.get(sheet.getAttributeNS(REL, "id")) || "";
      this.sheets.set(sheet.getAttribute("name"), target.startsWith("/") ? target.replace(/^\/+/, "") : "xl/" + target);
    }
    if (!this.zip.has("xl/sharedStrings.xml")) {
      this.strings = [];
      return;
    }
    const strings = await this.xml("xl/sharedStrings.xml");
    this.strings = all(strings, "si").map((si) => all(si, "t").map(text).join(""));
  }

  value(cell) {
    const kind = cell.getAttribute("t");
    if (kind === "inlineStr") return all(cell, "t").map(text).join("");
    const node = childV(cell);
    const raw = node ? text(node) : "";
    if (!node || raw === "") return null;
    if (kind !== "s") return raw;
    const index = /^\s*[+-]?\d+\s*$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(index) || index >= this.strings.length || index < -this.strings.length) throw broken();
    return this.strings.at(index);
  }

  async rows(name) {
    if (!this.sheets.has(name)) {
      throw new XlsxError("sheet", `'${name}' 시트가 없습니다. 있는 시트: ${[...this.sheets.keys()].join(", ")}`);
    }
    const root = await this.xml(this.sheets.get(name));
    return all(root, "row").map((row) => {
      const cells = {};
      for (const cell of all(row, "c")) {
        const match = CELL_REF.exec(cell.getAttribute("r") || "");
        const value = match ? this.value(cell) : null;
        if (value !== null && value !== "") cells[match[1]] = value;
      }
      return cells;
    });
  }

  async holidays() {
    if (!this.sheets.has(HOLIDAY_SHEET)) return {};
    const out = {};
    for (const row of await this.rows(HOLIDAY_SHEET)) {
      if (toNumber(row.A) === null) continue;
      out[toDate(row.A)] = (row.B || "").trim();
    }
    return out;
  }
}

// bytes: Uint8Array(엑셀 파일 전체). 결과·오류 문구는 로컬판 read_wbs 와 같다.
export async function readWbs(bytes, sheet, owner, io = {}) {
  owner = squash(owner);
  const book = await Workbook.open(bytes, io);
  const rows = await book.rows(sheet);
  const head = rows.findIndex((row) => Object.values(row).some((v) => label(v) === HEADERS.id));
  if (head < 0) throw new XlsxError("sheet", `'${sheet}' 시트에 '${HEADERS.id}' 머리글이 없습니다`);
  const byLabel = new Map(Object.entries(rows[head]).map(([c, v]) => [label(v), c]));
  const cols = Object.fromEntries(Object.entries(HEADERS).map(([key, name]) => [key, byLabel.get(name) || null]));
  const missing = REQUIRED.filter((key) => !cols[key]).map((key) => HEADERS[key]);
  if (missing.length) throw new XlsxError("sheet", "머리글이 없습니다: " + missing.join(", "));
  const sub = head + 1 < rows.length ? new Map(Object.entries(rows[head + 1]).map(([c, v]) => [label(v), c])) : new Map();
  cols.weight = sub.get("가중치") || null;
  cols.stage = sub.get("수행단계") || null;
  cols.pri = cols.weight && colIndex(cols.weight) > 1 ? colName(colIndex(cols.weight) - 1) : null;

  const tasks = [];
  for (const row of rows.slice(head + 1)) {
    const get = (key) => (cols[key] ? row[cols[key]] ?? null : null);
    const taskId = (get("id") || "").trim();
    if (!taskId || !owned(get("owner"), owner)) continue;
    tasks.push({
      id: taskId, pri: get("pri"), weight: toNumber(get("weight")), stage: get("stage"),
      d1: get("d1"), d2: get("d2"), d3: get("d3"), name: get("name"),
      gubun: get("gubun"), screen: get("screen"), mgr: get("mgr"), owner: get("owner"),
      people: toNumber(get("people")), start: toDate(get("start")), end: toDate(get("end")),
      md: toNumber(get("md")), q: get("q"), detail: get("detail"), jira: null,
    });
  }
  if (!tasks.length) throw new XlsxError("owner", `담당자 '${owner}' 행이 없습니다`);
  return { tasks, holidays: await book.holidays() };
}

// 파일 핸들(FileSystemFileHandle)에서 읽는다. 파일이 바뀌었을 때(File.lastModified·size)만 다시 읽는다.
export class WbsSource {
  constructor(handle, sheet, owner, io = {}) {
    this.handle = handle;
    this.sheet = sheet;
    this.owner = owner;
    this.io = io;
    this.key = null;
    this.data = null;
    this.pending = null;
  }

  async load() {
    // 동시에 여러 번 불려도 한 번만 읽는다(⟳ 새로고침 연타).
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const file = await this.handle.getFile();
      const key = file.lastModified + ":" + file.size;
      if (key !== this.key) {
        this.data = await readWbs(new Uint8Array(await file.arrayBuffer()), this.sheet, this.owner, this.io);
        this.key = key;
      }
      return this.data;
    })();
    try {
      return await this.pending;
    } finally {
      this.pending = null;
    }
  }
}

// 파일을 못 읽은 이유를 사람이 읽을 문구로. 권한이 없으면(새로고침 뒤 prompt 상태) 다시 연결하라고 한다.
export function readFailure(err) {
  if (err instanceof XlsxError) return err.message;
  if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
    return "파일 권한이 없습니다. 탭 위 '다시 연결'을 누릅니다";
  }
  if (err?.name === "NotFoundError") return "파일이 없습니다(옮겨졌거나 지워졌습니다)";
  return err?.message || String(err);
}
