// 회의 자료 Canvas 읽기(브라우저판). 로컬판 tabs/meetings/meetings_canvas.py 를 옮겼다. 경로 대신 FSA 디렉터리 핸들을 받는다.
// - root: 회의 폴더 핸들, vault: Vault 루트(.obsidian 이 있는 폴더) 핸들. Canvas 의 file 노드 경로는 vault 기준이다.
// - 업무 1건 = 회의 폴더 바로 아래 `.canvas` 1개, 회의 1건(화면의 블록) = Canvas 그룹 1개. 이름(meeting·block)은 로컬판 API 를 따른다.
// - 같은 예제 Vault 를 Python 과 이 모듈에 넣어 결과를 맞춘다(tests/js/meetings_web/parity.test.js).
//   그래서 str.strip()·\d·`$`(끝 줄바꿈 앞)·Path.suffix·dict 순서·sha256 규칙을 그대로 흉내 낸다.
// - 블록 안 순서 파일(.order/<업무 id>.json)은 Map 으로 다룬다(블록 id 가 "__proto__"·숫자여도 키 순서·값이 그대로 남게).
import { cmp, decode, pyStrip } from "../plans/plans_index.js";

export const UNGROUPED = "미분류";
export const UNGROUPED_ID = "_ungrouped";
export const ORDER_DIR = ".order";
export const PREVIEW_MIME = {
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
};
const ITEM_TYPES = new Set(["file", "link", "text"]);
// Python str.isspace() 글자(re 의 \s). 날짜 뒤 공백을 건너뛸 때 쓴다.
const SPACE = /^[\t\n\x0b\x0c\r\x1c-\x1f \x85\xa0  - \u2028\u2029  \u3000]/u;
const DATE_PREFIX = /^\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}/u;
// Python re 의 `$` 는 끝의 줄바꿈 하나 앞에서도 맞는다.
const COLOR = /^(?:[1-6]|#[0-9a-fA-F]{3,8})\n?$/;
// FSA 가 '없다'로 답하는 오류. 그 밖(권한·이름 거절 TypeError·코드 실수)은 그대로 올린다.
const ABSENT = new Set(["NotFoundError", "TypeMismatchError"]);
// FSA 가 TypeError 로 거절하는 이름(빈 값·.·..·경로 구분자·NUL). 찾기 전에 걸러 '없음'으로 본다.
export const badName = (name) => typeof name !== "string" || name === "" || name === "." || name === ".." || /[/\\\0]/.test(name);

/** Canvas JSON 을 블록으로 읽을 수 없다. */
export class CanvasError extends Error {}

export const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export const isAbsent = (error) => ABSENT.has(error?.name);

// Python os.path.splitext 의 확장자(3.14 Path.suffix). 맨 앞 점들은 건너뛴다(".md" → "", "a." → ".").
export function pySuffix(name) {
  const dot = name.lastIndexOf(".");
  let start = 0;
  while (start < name.length && name[start] === ".") start++;
  return dot > start ? name.slice(dot) : "";
}

// `2026-11-05 이름` → ["2026-11-05", "이름"]. 날짜가 없으면 ["", stem]. 정규식 ^(\d{4}-\d{2}-\d{2})\s*(.*)$ 와 같다.
export function splitName(stem) {
  const match = String(stem).match(DATE_PREFIX);
  if (!match) return ["", stem];
  let rest = stem.slice(match[0].length);
  while (rest && SPACE.test(rest)) rest = rest.slice(rest.codePointAt(0) > 0xffff ? 2 : 1);
  const body = rest.endsWith("\n") ? rest.slice(0, -1) : rest;
  if (body.includes("\n")) return ["", stem];
  return [match[0], body || stem];
}

// dir 아래 이름 조각들의 폴더. 없거나 파일이면 null.
export async function childDir(dir, parts) {
  let current = dir;
  for (const part of parts) {
    if (badName(part)) return null;
    try {
      current = await current.getDirectoryHandle(part);
    } catch (error) {
      if (isAbsent(error)) return null;
      throw error;
    }
  }
  return current;
}

export async function fileIn(dir, name) {
  if (badName(name)) return null;
  try {
    return await dir.getFileHandle(name);
  } catch (error) {
    if (isAbsent(error)) return null;
    throw error;
  }
}

export async function readBytes(handle) {
  return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}

// root 바로 아래 `<meetingId>.canvas` 파일 핸들. 하위 폴더·숨김·상위 경로는 null.
export async function resolveMeeting(root, meetingId) {
  if (typeof meetingId !== "string" || !meetingId || meetingId.startsWith(".") || /[/\\\0]/.test(meetingId)) return null;
  return fileIn(root, `${meetingId}.canvas`);
}

// Vault 기준 상대 경로 → 파일 핸들. 절대 경로·역슬래시·빈 조각·`.`으로 시작하는 조각(`..`·숨김)·폴더는 null.
// 고른 Vault 핸들 밖으로는 FSA 가 나가지 않는다(심볼릭 링크 판정은 브라우저가 한다).
export async function resolveVaultFile(vault, rel) {
  if (typeof rel !== "string" || !rel || rel.startsWith("/") || rel.includes("\\") || rel.includes("\0")) return null;
  const parts = rel.split("/");
  if (parts.some((part) => !part || part.startsWith("."))) return null;
  const dir = await childDir(vault, parts.slice(0, -1));
  return dir ? fileIn(dir, parts.at(-1)) : null;
}

async function orderFile(root, stem) {
  const dir = await childDir(root, [ORDER_DIR]);
  return dir ? fileIn(dir, `${stem}.json`) : null;
}

// 블록 id → 항목 id 목록(Map). 없거나 깨졌으면 빈 Map(위치순으로 보여 준다).
export async function readOrder(root, stem) {
  let data;
  try {
    const handle = await orderFile(root, stem);
    if (!handle) return new Map();
    data = JSON.parse(decode(await readBytes(handle)));
  } catch {
    return new Map();
  }
  if (!isObject(data)) return new Map();
  return new Map(Object.entries(data).filter(([, ids]) => Array.isArray(ids))
    .map(([key, ids]) => [key, ids.filter((id) => typeof id === "string")]));
}

const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

// Canvas·순서 파일 내용 해시 앞 16자(쓰기 충돌 확인용). 순서 파일은 읽을 수 있을 때만 더한다.
export async function versionOf(root, canvas, stem) {
  const bytes = await readBytes(canvas);
  let order = new Uint8Array(0);
  try {
    const handle = await orderFile(root, stem);
    if (handle) order = await readBytes(handle);
  } catch { /* 읽지 못하면 Canvas 만 */ }
  const joined = new Uint8Array(bytes.length + 1 + order.length);
  joined.set(bytes, 0);
  joined.set(order, bytes.length + 1);
  return hex(await crypto.subtle.digest("SHA-256", joined)).slice(0, 16);
}

// Canvas JSON 최상위 객체. 읽기·디코드·JSON 오류는 CanvasError.
export async function readCanvas(handle) {
  let data;
  try {
    data = JSON.parse(decode(await readBytes(handle)));
  } catch (error) {
    throw new CanvasError(`Canvas JSON을 읽지 못했다: ${error?.message ?? error}`);
  }
  return data;
}

export async function readNodes(handle) {
  const data = await readCanvas(handle);
  if (!isObject(data)) throw new CanvasError("Canvas 최상위가 객체가 아니다");
  const nodes = Object.hasOwn(data, "nodes") ? data.nodes : [];
  if (!Array.isArray(nodes)) throw new CanvasError("Canvas nodes 가 배열이 아니다");
  return nodes.filter(isObject);
}

export function nodeRect(node) {
  const values = [node.x, node.y, node.width, node.height];
  return values.every((v) => typeof v === "number") ? values : null;
}

export function inside(inner, outer) {
  const [x, y, w, h] = inner;
  const [gx, gy, gw, gh] = outer;
  return gx <= x && gy <= y && x + w <= gx + gw && y + h <= gy + gh;
}

// Python 튜플 (y, x) 정렬. 같으면 0(안정 정렬이 원래 순서를 지킨다).
const byPosition = (a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

function groupsOf(nodes) {
  const groups = [];
  for (const node of nodes) {
    if (!isObject(node) || node.type !== "group") continue;
    const rect = nodeRect(node);
    if (rect) groups.push([rect, node]);
  }
  return groups.sort((a, b) => byPosition(a[0], b[0]));
}

// rect 를 완전히 포함하는 그룹 중 면적이 가장 작은 것의 번호(같으면 앞). 없으면 null.
function owner(rect, groups, skip = null) {
  let best = null;
  for (let i = 0; i < groups.length; i++) {
    const [groupRect, group] = groups[i];
    if (group === skip || !inside(rect, groupRect)) continue;
    if (best === null || groupRect[2] * groupRect[3] < groups[best][0][2] * groups[best][0][3]) best = i;
  }
  return best;
}

export function groupOf(nodes, node) {
  const rect = nodeRect(node);
  if (!rect) return null;
  const groups = groupsOf(nodes);
  const index = owner(rect, groups, node);
  return index === null ? null : groups[index][1];
}

const strOrNull = (value) => (typeof value === "string" ? value : null);
const filled = (value) => typeof value === "string" && pyStrip(value) !== "";

async function item(node, vault) {
  const kind = node.type;
  const id = strOrNull(node.id);
  if (kind === "file") {
    const path = node.file;
    if (typeof path !== "string" || !path) return null;
    const name = path.slice(path.lastIndexOf("/") + 1);
    const ext = pySuffix(name).toLowerCase();
    return {
      kind: "file", id, path, name, ext, subpath: typeof node.subpath === "string" ? node.subpath : "",
      missing: (await resolveVaultFile(vault, path)) === null, preview: Object.hasOwn(PREVIEW_MIME, ext),
    };
  }
  if (kind === "link") return filled(node.url) ? { kind: "link", id, url: node.url } : null;
  return filled(node.text) ? { kind: "text", id, text: node.text } : null;
}

// 순서 파일에 적힌 id 를 먼저, 나머지는 원래(위치) 순서. 같은 id 가 둘이면 Python dict 처럼 뒤의 것이 남는다.
function applyOrder(items, saved) {
  const byId = new Map();
  for (const entry of items) if (entry.id !== null) byId.set(entry.id, entry);
  const first = [];
  const seen = new Set();
  for (const id of saved) {
    if (byId.has(id) && !seen.has(id)) {
      first.push(byId.get(id));
      seen.add(id);
    }
  }
  return [...first, ...items.filter((entry) => !seen.has(entry.id))];
}

export async function buildBlocks(nodes, vault, order = new Map()) {
  const groups = groupsOf(nodes);
  const items = [];
  for (const node of nodes) {
    if (!ITEM_TYPES.has(node.type)) continue;
    const rect = nodeRect(node);
    const entry = rect ? await item(node, vault) : null;
    if (entry) items.push([rect, entry]);
  }
  const members = groups.map(() => []);
  const loose = [];
  for (const [rect, entry] of items.sort((a, b) => byPosition(a[0], b[0]))) {
    const index = owner(rect, groups);
    (index === null ? loose : members[index]).push(entry);
  }
  const blocks = groups.map(([, group], i) => {
    const id = strOrNull(group.id);
    const label = group.label;
    const color = group.color;
    return {
      id,
      label: filled(label) ? pyStrip(label) : `블록 ${i + 1}`,
      color: typeof color === "string" && COLOR.test(color) ? color : "",
      items: applyOrder(members[i], id ? order.get(id) ?? [] : []),
    };
  });
  // 날짜 최신순. 정렬은 안정적이라 날짜가 같거나 없는 블록은 위치순을 지킨다(빈 날짜는 맨 뒤).
  blocks.sort((a, b) => cmp(splitName(b.label)[0], splitName(a.label)[0]));
  if (loose.length) blocks.push({ id: UNGROUPED_ID, label: UNGROUPED, color: "", items: applyOrder(loose, order.get(UNGROUPED_ID) ?? []) });
  return blocks;
}

export async function listMeetings(root) {
  const meetings = [];
  try {
    for await (const [name, handle] of root.entries()) {
      if (name.startsWith(".") || pySuffix(name) !== ".canvas" || handle.kind !== "file") continue;
      const id = name.slice(0, -".canvas".length);
      const [date, title] = splitName(id);
      const file = await handle.getFile();
      const entry = { id, title, date, mtime: Math.trunc(file.lastModified / 1000), error: null };
      try {
        await readNodes(handle);
      } catch (error) {
        if (!(error instanceof CanvasError)) throw error;
        entry.error = error.message;
      }
      meetings.push(entry);
    }
  } catch (error) {
    if (error?.name === "NotFoundError") return [];
    throw error;
  }
  meetings.sort((a, b) => cmp(a.title, b.title));
  meetings.sort((a, b) => cmp(b.date, a.date));
  return meetings;
}

// rootParts: Vault 에서 회의 폴더까지의 이름들(fsa.relativePath). canvasPath 는 Obsidian 으로 열 Vault 기준 경로다.
export async function readMeeting(root, vault, rootParts, meetingId) {
  const handle = await resolveMeeting(root, meetingId);
  if (!handle) return null;
  const [date, title] = splitName(meetingId);
  const version = await versionOf(root, handle, meetingId);
  return {
    id: meetingId, title, date, vault: vault.name, canvasPath: [...rootParts, `${meetingId}.canvas`].join("/"), version,
    blocks: await buildBlocks(await readNodes(handle), vault, await readOrder(root, meetingId)),
  };
}
