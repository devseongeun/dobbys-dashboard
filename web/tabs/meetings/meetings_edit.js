// 회의 자료 Canvas 쓰기(브라우저판). 로컬판 tabs/meetings/meetings_edit.py 를 옮겼다. 경로 대신 FSA 디렉터리 핸들을 받는다.
// meeting = 업무 Canvas, block = 그 업무의 회의(Canvas 그룹). meetings_canvas.js 참고.
//
// - 모든 쓰기는 저장 직전 Canvas·순서 파일을 다시 읽어 version 이 요청 version 과 같을 때만 한다(아니면 409, 파일은 그대로).
//   잠금 하나(이 탭 안의 Promise 사슬)로 직렬화한다. 다른 탭·Obsidian 의 변경은 version 확인이 막는다.
// - 파일 하나는 createWritable() → write → close() 한 번으로 쓴다. 브라우저가 임시(swap) 파일에 쓰고 close() 때 원본과
//   바꾸므로 로컬판의 같은 폴더 임시 파일 → os.replace 와 같은 원자적 교체다. 중간에 실패하면 abort() 로 버린다(원본 그대로).
// - 읽은 JSON 객체를 고쳐 쓰므로 모르는 필드·id·edges 가 남는다. 탭 들여쓰기(JSON.stringify(_, null, "\t") = Python indent="\t").
// - 블록 안 순서만 바꿀 때는 `.order/<업무 id>.json`만 쓰고 Canvas 배치는 그대로 둔다.
// - 카드 추가·다른 회의 블록 이동은 대상 그룹 맨 아래에 놓고, 모자라면 그룹을 늘리고 그 아래 노드를 민다.
// - 업무 삭제는 Canvas·순서 파일을 회의 폴더의 `.trash/<지운 시각>/`으로 옮긴다. 담긴 Vault 파일은 지우지 않는다.
// 오류는 로컬판과 같은 상태 코드·문구의 EditError 다(서버 응답 대신 backend.js 가 화면에 넘긴다).
import {
  ORDER_DIR, UNGROUPED_ID, buildBlocks, childDir, fileIn, groupOf, inside, isAbsent, isObject, nodeRect, readCanvas, readOrder,
  resolveMeeting, resolveVaultFile, splitName, versionOf,
} from "./meetings_canvas.js";
import { pyStrip } from "../plans/plans_index.js";

const PAD = 20;
const BLOCK_GAP = 80;
const BLOCK_SIZE = [900, 400];
const FILE_SIZE = [400, 400];
const LINK_SIZE = [400, 240];
const MAX_NAME = 120;
const MAX_URL = 2048;
const DATE = /^\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}$/u;
const CONTROL = /[\x00-\x1f\x7f]/;
export const TRASH_DIR = ".trash";

/** 로컬판 EditError: HTTP 상태와 함께 올리는 편집 실패. 409 는 현재 version 을 담는다. */
export class EditError extends Error {
  constructor(status, message, version = null) {
    super(message);
    this.status = status;
    this.version = version;
  }
}

const randomId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
// 새 노드 id(secrets.token_hex(8))와 휴지통 시각(datetime.now()). 비교 테스트가 바꿔 끼운다.
export const hooks = { newId: randomId, now: () => new Date() };

// 이 탭 안의 쓰기를 하나씩(로컬판 threading.Lock). 앞 작업이 실패해도 다음 작업은 돈다.
let tail = Promise.resolve();
export function locked(work) {
  const run = tail.then(() => work());
  tail = run.then(() => {}, () => {});
  return run;
}

const length = (text) => [...text].length;

export function cleanName(value, what = "이름") {
  if (typeof value !== "string") throw new EditError(400, `${what}이 비었다`);
  const name = pyStrip(value);
  if (!name || length(name) > MAX_NAME || CONTROL.test(name)) throw new EditError(400, `${what}은 1–${MAX_NAME}자, 제어 문자 없이 쓴다`);
  return name;
}

// datetime.date.fromisoformat: ASCII 숫자, 1–9999년, 있는 날짜만.
function realDate(text) {
  const match = text.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function meetingIdFor(date, title) {
  const name = cleanName(title, "업무 이름");
  if (/[/\\:]/.test(name) || name.startsWith(".")) throw new EditError(400, "업무 이름에는 / \\ : 와 맨 앞 . 을 쓸 수 없다");
  if (date === null || date === undefined) date = "";
  if (typeof date !== "string") throw new EditError(400, "날짜는 YYYY-MM-DD 로 쓴다");
  date = pyStrip(date);
  if (!date) return name;
  if (!DATE.test(date)) throw new EditError(400, "날짜는 YYYY-MM-DD 로 쓴다");
  if (!realDate(date)) throw new EditError(400, "없는 날짜다");
  return `${date} ${name}`;
}

export const dump = (data) => JSON.stringify(data, null, "\t");

// 순서 파일(Map) → Python json.dumps(order, indent="\t") 와 같은 글자.
export function dumpOrder(order) {
  if (!order.size) return "{}";
  const rows = [...order].map(([key, ids]) =>
    `\t${JSON.stringify(key)}: ${ids.length ? `[\n${ids.map((id) => `\t\t${JSON.stringify(id)}`).join(",\n")}\n\t]` : "[]"}`);
  return `{\n${rows.join(",\n")}\n}`;
}

async function exists(dir, name) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch (error) {
    if (error?.name === "TypeMismatchError") return true; // 같은 이름의 폴더
    if (isAbsent(error)) return false;
    throw error;
  }
}

// 원자적 교체 한 번. 새로 만든 파일인데 쓰기가 실패하면 빈 파일도 남기지 않는다(로컬판 임시 파일처럼).
export async function writeFile(dir, name, data) {
  const existed = await exists(dir, name);
  const handle = await dir.getFileHandle(name, { create: true });
  let writable;
  try {
    writable = await handle.createWritable();
    try {
      await writable.write(data);
      await writable.close();
    } catch (error) {
      try { await writable.abort(); } catch { /* 이미 닫혔거나 중단됐다 */ }
      throw error;
    }
  } catch (error) {
    if (!existed) {
      try { await dir.removeEntry(name); } catch { /* 지우지 못하면 그대로 둔다 */ }
    }
    throw error;
  }
}

// 파일 옮기기(os.replace). 브라우저가 move() 를 주면 그것으로, 아니면 같은 내용을 쓰고(원자적 교체) 원본을 지운다.
async function moveFile(fromDir, fromName, toDir, toName) {
  const handle = await fromDir.getFileHandle(fromName);
  if (typeof handle.move === "function") {
    await handle.move(toDir, toName);
    return;
  }
  await writeFile(toDir, toName, await (await handle.getFile()).arrayBuffer());
  await fromDir.removeEntry(fromName);
}

// 같은 폴더 안 이름 바꾸기. 대소문자만 다른 같은 파일(대소문자 무시 파일 시스템)이면 임시 이름을 거친다.
async function rename(dir, fromName, toName) {
  const source = await dir.getFileHandle(fromName);
  const target = await fileIn(dir, toName);
  if (target && await target.isSameEntry(source)) {
    const temp = `.${toName}.${randomId()}.tmp`;
    await moveFile(dir, fromName, dir, temp);
    await moveFile(dir, temp, dir, toName);
    return;
  }
  if (target) await dir.removeEntry(toName); // os.replace 처럼 덮어쓴다(지금은 남은 순서 파일만 해당).
  await moveFile(dir, fromName, dir, toName);
}

async function checked(root, meetingId, version) {
  const handle = await resolveMeeting(root, meetingId);
  if (!handle) throw new EditError(404, "업무 Canvas가 없다");
  if (typeof version !== "string") throw new EditError(400, "version 이 없다");
  const current = await versionOf(root, handle, meetingId);
  if (version !== current) throw new EditError(409, "Canvas가 바뀌었다. 다시 불러온다", current);
  return handle;
}

async function load(root, meetingId, version) {
  const handle = await checked(root, meetingId, version);
  let data;
  try {
    data = await readCanvas(handle);
  } catch (error) {
    throw new EditError(422, error.message);
  }
  if (!isObject(data)) throw new EditError(422, "Canvas 최상위가 객체가 아니다");
  if (!Object.hasOwn(data, "nodes")) data.nodes = [];
  if (!Array.isArray(data.nodes)) throw new EditError(422, "Canvas nodes 가 배열이 아니다");
  return { data, order: await readOrder(root, meetingId) };
}

async function save(root, meetingId, data = null, order = null) {
  if (data !== null) await writeFile(root, `${meetingId}.canvas`, dump(data));
  if (order !== null) await writeFile(await root.getDirectoryHandle(ORDER_DIR, { create: true }), `${meetingId}.json`, dumpOrder(order));
}

const nodesOf = (data) => data.nodes.filter(isObject);

function find(data, nodeId, what = "항목") {
  if (typeof nodeId === "string") {
    for (const node of nodesOf(data)) if (node.id === nodeId) return node;
  }
  throw new EditError(404, `${what}이 없다`);
}

function targetGroup(data, blockId) {
  if (blockId === UNGROUPED_ID) throw new EditError(400, "미분류에는 추가·이동할 수 없다");
  const group = find(data, blockId, "회의 블록");
  if (group.type !== "group") throw new EditError(404, "회의 블록이 없다");
  if (!nodeRect(group)) throw new EditError(422, "그룹 좌표가 잘못됐다");
  return group;
}

function newId(data) {
  const used = new Set(nodesOf(data).map((node) => node.id));
  for (;;) {
    const id = hooks.newId();
    if (!used.has(id)) return id;
  }
}

function indexOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new EditError(400, "index 는 정수다");
  return value;
}

// ── http·https 주소 검사(Python urllib.parse.urlsplit 이 받는 것만) ───────────────
// urlsplit 의 scheme·netloc 판정, 대괄호 호스트(ipaddress.IPv6Address·IPvFuture), NFKC 검사를 옮겼다.
const SCHEME_CHARS = /^[A-Za-z0-9+\-.]*$/;
const HEXTET = /^[0-9A-Fa-f]{1,4}$/;

// Python str.split(sep, maxsplit): 앞에서 maxsplit 번만 나누고 나머지는 마지막 조각에 남긴다.
function splitMax(text, sep, maxsplit) {
  const parts = [];
  let rest = text;
  while (parts.length < maxsplit) {
    const at = rest.indexOf(sep);
    if (at < 0) break;
    parts.push(rest.slice(0, at));
    rest = rest.slice(at + sep.length);
  }
  parts.push(rest);
  return parts;
}

// ipaddress.IPv4Address: 십진 네 조각, 0–255, 앞자리 0 없음.
const isIpv4 = (text) => {
  const octets = text.split(".");
  return octets.length === 4 && octets.every((o) => /^[0-9]{1,3}$/.test(o) && Number(o) <= 255 && !(o.length > 1 && o[0] === "0"));
};

// ipaddress.IPv6Address(_split_scope_id + _ip_int_from_string).
function isIpv6(text) {
  if (text.includes("/")) return false;
  let address = text;
  const percent = text.indexOf("%");
  if (percent >= 0) {
    const scope = text.slice(percent + 1);
    if (!scope || scope.includes("%")) return false;
    address = text.slice(0, percent);
  }
  if (!address || length(address) > 45) return false;
  const parts = splitMax(address, ":", 9);
  if (parts.length < 3) return false;
  if (parts.at(-1).includes(".")) {
    if (!isIpv4(parts.pop())) return false;
    parts.push("0", "0");
  }
  if (parts.length > 9) return false;
  let skip = null;
  for (let i = 1; i < parts.length - 1; i++) {
    if (parts[i]) continue;
    if (skip !== null) return false;
    skip = i;
  }
  let hi;
  let lo;
  if (skip !== null) {
    hi = skip;
    lo = parts.length - skip - 1;
    if (!parts[0] && --hi) return false;
    if (!parts.at(-1) && --lo) return false;
    if (8 - (hi + lo) < 1) return false;
  } else {
    if (parts.length !== 8 || !parts[0] || !parts.at(-1)) return false;
    hi = parts.length;
    lo = 0;
  }
  return parts.slice(0, hi).every((p) => HEXTET.test(p)) && parts.slice(parts.length - lo).every((p) => HEXTET.test(p));
}

// _check_bracketed_host: IPvFuture(v…) 이거나 IPv6 여야 한다(IPv4 는 대괄호 안에 둘 수 없다).
const bracketedHostOk = (host) => (host.startsWith("v") ? /^v[a-fA-F0-9]+\.[^\n]+$/.test(host) : isIpv6(host));

// urlsplit 이 ValueError 를 내는 netloc 인가.
function badNetloc(netloc) {
  const open = netloc.includes("[");
  const close = netloc.includes("]");
  if (open !== close) return true;
  if (open) {
    const hostPort = netloc.slice(netloc.lastIndexOf("@") + 1);
    const at = hostPort.indexOf("[");
    let host;
    if (at >= 0) {
      if (at > 0) return true;
      const inner = hostPort.slice(at + 1);
      const end = inner.indexOf("]");
      host = end < 0 ? inner : inner.slice(0, end);
      const port = end < 0 ? "" : inner.slice(end + 1);
      if (port && !port.startsWith(":")) return true;
    } else {
      host = hostPort.split(":")[0];
    }
    if (!bracketedHostOk(host)) return true;
  }
  if (!/[^\x00-\x7f]/.test(netloc)) return false;
  const bare = netloc.replace(/[@:#?]/g, "");
  const normalized = bare.normalize("NFKC");
  return bare !== normalized && /[/?#@:]/.test(normalized);
}

// 웹 주소 → 다듬은 주소(앞뒤 공백 제거). http·https 이고 호스트가 있어야 한다.
export function webUrl(value) {
  const url = typeof value === "string" ? pyStrip(value) : "";
  const fail = () => new EditError(400, "http·https 주소만 추가할 수 있다");
  // 제어 문자가 있으면 urlsplit 결과와 관계없이 거절한다(urlsplit 이 앞에서 지우는 글자도 여기 든다).
  if (CONTROL.test(url) || length(url) > MAX_URL) throw fail();
  let rest = url;
  let scheme = "";
  const colon = rest.indexOf(":");
  if (colon > 0 && /^[A-Za-z]/.test(rest) && SCHEME_CHARS.test(rest.slice(0, colon))) {
    scheme = rest.slice(0, colon).toLowerCase();
    rest = rest.slice(colon + 1);
  }
  let netloc = "";
  if (rest.startsWith("//")) {
    const ends = ["/", "?", "#"].map((c) => rest.indexOf(c, 2)).filter((i) => i >= 0);
    netloc = rest.slice(2, ends.length ? Math.min(...ends) : rest.length);
    if (badNetloc(netloc)) throw fail();
  }
  if ((scheme !== "http" && scheme !== "https") || !netloc) throw fail();
  return url;
}

// ── 배치 ───────────────────────────────────────────────

function blockIdOf(data, node) {
  const group = groupOf(nodesOf(data), node);
  return group === null ? UNGROUPED_ID : group.id;
}

async function displayedIds(data, vault, order, blockId) {
  for (const block of await buildBlocks(nodesOf(data), vault, order)) {
    if (block.id === blockId) return block.items.map((entry) => entry.id).filter((id) => id !== null);
  }
  return [];
}

async function put(order, data, vault, blockId, itemId, index) {
  const ids = (await displayedIds(data, vault, order, blockId)).filter((id) => id !== itemId);
  const at = index === null ? ids.length : Math.max(0, Math.min(index, ids.length));
  ids.splice(at, 0, itemId);
  order.set(blockId, ids);
}

function drop(order, itemId) {
  for (const ids of order.values()) {
    for (let i = ids.indexOf(itemId); i >= 0; i = ids.indexOf(itemId)) ids.splice(i, 1);
  }
}

// node 를 group 맨 아래에 놓는다. 모자라면 group 과 원래 아래쪽 끝에 걸친 다른 그룹을 늘리고, 원래 아래쪽 끝 이하에 있던 나머지 노드를 그만큼 내린다.
function place(data, group, node, [width, height]) {
  const nodes = nodesOf(data);
  const old = nodeRect(group);
  const [gx, gy, gw, gh] = old;
  const oldBottom = gy + gh;
  const growers = nodes.filter((n) => {
    if (n === group || n === node || n.type !== "group") return false;
    const r = nodeRect(n);
    return r !== null && r[1] < oldBottom && oldBottom <= r[1] + r[3] && !inside(r, old);
  });
  const bottoms = [];
  for (const n of nodes) {
    if (n === group || n === node) continue;
    const r = nodeRect(n);
    if (r !== null && inside(r, old)) bottoms.push(r[1] + r[3]);
  }
  const x = gx + PAD;
  const y = Math.max(gy + PAD, ...bottoms.map((bottom) => bottom + PAD));
  Object.assign(node, { x, y, width, height });
  if (x + width > gx + gw) group.width = x + width + PAD - gx;
  const delta = y + height + PAD - oldBottom;
  if (delta <= 0) return;
  group.height = gh + delta;
  for (const other of nodes) {
    if (other === group || other === node || growers.includes(other)) continue;
    const rect = nodeRect(other);
    if (rect !== null && rect[1] >= oldBottom) other.y = rect[1] + delta;
  }
  for (const grower of growers) grower.height = grower.height + delta;
}

function withoutEdges(data, id) {
  if (Array.isArray(data.edges)) {
    data.edges = data.edges.filter((e) => !(isObject(e) && (e.fromNode === id || e.toNode === id)));
  }
}

// ── 업무 ───────────────────────────────────────────────

export function createMeeting(root, date, title) {
  const meetingId = meetingIdFor(date, title);
  return locked(async () => {
    const name = `${meetingId}.canvas`;
    if (await exists(root, name)) throw new EditError(409, "같은 이름의 업무가 있다");
    await writeFile(root, name, dump({ nodes: [], edges: [] }));
    return meetingId;
  });
}

export function renameMeeting(root, meetingId, date, title, version) {
  let newId;
  try {
    newId = meetingIdFor(date, title);
  } catch (error) {
    return Promise.reject(error);
  }
  return locked(async () => {
    await load(root, meetingId, version);
    if (newId === meetingId) return newId;
    const source = await root.getFileHandle(`${meetingId}.canvas`);
    const target = await fileIn(root, `${newId}.canvas`);
    const folderTaken = !target && await exists(root, `${newId}.canvas`);
    if (folderTaken || (target && !(await target.isSameEntry(source)))) throw new EditError(409, "같은 이름의 업무가 있다");
    await rename(root, `${meetingId}.canvas`, `${newId}.canvas`);
    const orders = await childDir(root, [ORDER_DIR]);
    if (orders && await fileIn(orders, `${meetingId}.json`)) await rename(orders, `${meetingId}.json`, `${newId}.json`);
    return newId;
  });
}

const pad = (n) => String(n).padStart(2, "0");
const stampOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

// 업무 Canvas와 순서 파일을 `.trash/<지운 시각>/` 아래 같은 배치(`<id>.canvas`, `.order/<id>.json`)로 옮긴다.
// 되살리려면 그 폴더 안의 것을 회의 폴더로 다시 옮긴다. 담긴 파일은 건드리지 않는다. 옮긴 폴더 이름을 돌려준다.
// JSON이 깨진 Canvas도 지울 수 있다(내용을 읽지 않는다).
export function deleteMeeting(root, meetingId, version) {
  return locked(async () => {
    await checked(root, meetingId, version);
    const stamp = stampOf(hooks.now());
    const trashRoot = await root.getDirectoryHandle(TRASH_DIR, { create: true });
    let name = stamp;
    for (let suffix = 2; await exists(trashRoot, name); suffix++) name = `${stamp}-${suffix}`;
    const trash = await trashRoot.getDirectoryHandle(name, { create: true });
    await moveFile(root, `${meetingId}.canvas`, trash, `${meetingId}.canvas`);
    const orders = await childDir(root, [ORDER_DIR]);
    if (orders && await fileIn(orders, `${meetingId}.json`)) {
      await moveFile(orders, `${meetingId}.json`, await trash.getDirectoryHandle(ORDER_DIR, { create: true }), `${meetingId}.json`);
    }
    return `${TRASH_DIR}/${name}`;
  });
}

// ── 회의 블록 ──────────────────────────────────────────

export function addBlock(root, meetingId, label, version) {
  let name;
  try {
    name = cleanName(label, "회의 이름");
  } catch (error) {
    return Promise.reject(error);
  }
  return locked(async () => {
    const { data } = await load(root, meetingId, version);
    const rects = nodesOf(data).map(nodeRect).filter((r) => r !== null);
    const x = rects.length ? Math.min(...rects.map((r) => r[0])) : 0;
    const y = (rects.length ? Math.max(...rects.map((r) => r[1] + r[3])) : -BLOCK_GAP) + BLOCK_GAP;
    const [width, height] = BLOCK_SIZE;
    data.nodes.push({ id: newId(data), type: "group", x, y, width, height, label: name });
    await save(root, meetingId, data);
    return meetingId;
  });
}

export function renameBlock(root, meetingId, blockId, label, version) {
  let name;
  try {
    name = cleanName(label, "회의 이름");
  } catch (error) {
    return Promise.reject(error);
  }
  return locked(async () => {
    const { data } = await load(root, meetingId, version);
    const group = find(data, blockId, "회의 블록");
    if (group.type !== "group") throw new EditError(404, "회의 블록이 없다");
    group.label = name;
    await save(root, meetingId, data);
    return meetingId;
  });
}

// 회의 블록(그룹 노드)만 지운다. 안의 카드는 그 자리에 남아 바깥 블록이나 미분류로 보인다.
export function deleteBlock(root, meetingId, blockId, version) {
  return locked(async () => {
    const { data, order } = await load(root, meetingId, version);
    if (blockId === UNGROUPED_ID) throw new EditError(400, "미분류는 지울 수 없다");
    const group = find(data, blockId, "회의 블록");
    if (group.type !== "group") throw new EditError(404, "회의 블록이 없다");
    data.nodes = data.nodes.filter((n) => n !== group);
    withoutEdges(data, blockId);
    order.delete(blockId);
    await save(root, meetingId, data, order);
    return meetingId;
  });
}

// ── 카드 ───────────────────────────────────────────────

export function addItem(root, vault, meetingId, blockId, payload, version) {
  let kind;
  let index;
  let url = null;
  try {
    if (!isObject(payload)) throw new EditError(400, "본문이 객체가 아니다");
    kind = payload.kind;
    if (kind !== "file" && kind !== "link") throw new EditError(400, "kind 는 file 또는 link 다");
    index = indexOf(payload.index);
    if (kind === "link") url = webUrl(payload.url);
  } catch (error) {
    return Promise.reject(error);
  }
  return locked(async () => {
    const { data, order } = await load(root, meetingId, version);
    const group = targetGroup(data, blockId);
    let node;
    let size;
    if (kind === "file") {
      const rel = typeof payload.path === "string" ? payload.path : "";
      if (!(await resolveVaultFile(vault, rel))) throw new EditError(400, "Vault 안의 파일이 아니다");
      const nodes = nodesOf(data);
      if (nodes.some((n) => n.type === "file" && n.file === rel && groupOf(nodes, n) === group)) return meetingId;
      [node, size] = [{ id: newId(data), type: "file", file: rel }, FILE_SIZE];
    } else {
      [node, size] = [{ id: newId(data), type: "link", url }, LINK_SIZE];
    }
    data.nodes.push(node);
    place(data, group, node, size);
    await put(order, data, vault, blockId, node.id, index);
    await save(root, meetingId, data, order);
    return meetingId;
  });
}

export function moveItem(root, vault, meetingId, itemId, blockId, index, version) {
  try {
    index = indexOf(index);
    if (typeof blockId !== "string") throw new EditError(400, "block 이 없다");
  } catch (error) {
    return Promise.reject(error);
  }
  return locked(async () => {
    const { data, order } = await load(root, meetingId, version);
    const node = find(data, itemId);
    if (node.type === "group") throw new EditError(400, "블록은 옮길 수 없다");
    if (blockIdOf(data, node) === blockId) {
      await put(order, data, vault, blockId, itemId, index);
      await save(root, meetingId, null, order);
      return meetingId;
    }
    const group = targetGroup(data, blockId);
    const rect = nodeRect(node);
    if (!rect) throw new EditError(400, "카드 좌표가 잘못됐다");
    place(data, group, node, [rect[2], rect[3]]);
    drop(order, itemId);
    await put(order, data, vault, blockId, itemId, index);
    await save(root, meetingId, data, order);
    return meetingId;
  });
}

export function deleteItem(root, meetingId, itemId, version) {
  return locked(async () => {
    const { data, order } = await load(root, meetingId, version);
    const node = find(data, itemId);
    if (node.type === "group") throw new EditError(400, "블록은 지울 수 없다");
    data.nodes = data.nodes.filter((n) => n !== node);
    withoutEdges(data, itemId);
    drop(order, itemId);
    await save(root, meetingId, data, order);
    return meetingId;
  });
}

export { splitName };
