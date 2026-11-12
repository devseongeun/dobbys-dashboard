// 로컬판 tabs/meetings/meetings_serve.py 의 주소(GET·POST api/*, GET file?p=)를 브라우저 안에서 대신한다.
// 회의 폴더·Vault 는 FSA 핸들에서 직접 읽고 쓴다(서버로 보내지 않음). 돌려주는 모양·상태 코드·문구가 로컬판 응답과 같아서
// 화면(meetings.js)은 fetch 대신 이것만 부른다. 서버 쪽 검사(Host·Origin·X-Meetings-Editor·본문 크기)는 서버가 없어 하지 않는다.
import { CanvasError, PREVIEW_MIME, listMeetings, pySuffix, readMeeting, resolveMeeting, resolveVaultFile, versionOf } from "./meetings_canvas.js";
import * as edit from "./meetings_edit.js";
import { listDir, search } from "./vault_tree.js";
import { NOT_INSIDE, OUTSIDE_VAULT, hasObsidian } from "./tab.js";
import * as fsa from "../../lib/fsa.js";

/** 로컬판 서버의 오류 응답({error, version}) 과 같은 모양. status 는 HTTP 상태. */
export class HttpError extends Error {
  constructor(status, message, version = undefined) {
    super(message);
    this.status = status;
    if (version !== undefined && version !== null) this.version = version;
  }
}

const API = "api/meetings";

// 브라우저 쪽 실패(권한 해제·폴더 이동 등)를 화면 문구로.
export function reason(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "폴더 권한이 없다. 위의 '폴더 다시 연결'을 누르거나 ⚙ 설정에서 다시 고른다";
  }
  if (error?.name === "NotFoundError") return "폴더를 찾을 수 없다(옮겨졌거나 지워졌다). ⚙ 설정에서 다시 고른다";
  if (error?.name === "QuotaExceededError") return "저장 공간이 모자라 쓰지 못했다";
  if (error?.name === "TypeError" && /Name is not allowed/.test(error?.message ?? "")) return `브라우저가 받지 않는 파일 이름이다(${error.message})`;
  return `${error?.name ?? "Error"}: ${error?.message ?? error}`;
}

function parse(url) {
  const parsed = new URL(String(url), "http://meetings.invalid/");
  return { parts: parsed.pathname.split("/").slice(1).map(decodeURIComponent), query: parsed.searchParams };
}

// root: 회의 폴더 핸들, vault: Vault 루트 핸들, rootParts: Vault → 회의 폴더 이름들(fsa.relativePath).
export function createBackend({ root, vault, rootParts }) {
  async function detail(meetingId) {
    try {
      const meeting = await readMeeting(root, vault, rootParts, meetingId);
      if (meeting === null) throw new HttpError(404, "업무 Canvas가 없다");
      return meeting;
    } catch (error) {
      if (!(error instanceof CanvasError)) throw error;
      // 깨진 Canvas도 지울 수 있게 version(파일 해시)을 함께 준다. 파일조차 못 읽으면 version 없이.
      let version;
      try { version = await versionOf(root, await resolveMeeting(root, meetingId), meetingId); } catch { /* version 없이 */ }
      throw new HttpError(422, error.message, version);
    }
  }

  const list = async () => ({ meetings: await listMeetings(root) });

  async function get(url) {
    const { parts, query } = parse(url);
    if (parts.length === 2 && parts.join("/") === API) return list();
    if (parts.length >= 3 && parts.slice(0, 2).join("/") === API) return detail(parts.slice(2).join("/"));
    if (parts.join("/") === "api/tree") {
      const rel = query.get("path") ?? "";
      const entries = await listDir(vault, rel);
      if (entries === null) throw new HttpError(404, "폴더가 없다");
      return { path: rel, entries };
    }
    if (parts.join("/") === "api/search") {
      const [results, truncated] = await search(vault, query.get("q") ?? "");
      return { results, truncated };
    }
    throw new HttpError(404, "not found");
  }

  // 바뀐 업무 id(상세 응답), 목록 응답이면 LIST, 맞는 경로가 없으면 null.
  const LIST = Symbol("list");
  async function write(parts, body) {
    if (parts[0] !== "api" || parts[1] !== "meetings") return null;
    const version = body.version;
    const rest = parts.slice(2);
    const [meetingId, a, b, c] = rest;
    if (rest.length === 0) return edit.createMeeting(root, body.date, body.title);
    if (rest.length === 2 && a === "rename") return edit.renameMeeting(root, meetingId, body.date, body.title, version);
    if (rest.length === 2 && a === "blocks") return edit.addBlock(root, meetingId, body.label, version);
    if (rest.length === 2 && a === "delete") {
      await edit.deleteMeeting(root, meetingId, version);
      return LIST;
    }
    if (rest.length === 4 && a === "blocks" && c === "rename") return edit.renameBlock(root, meetingId, b, body.label, version);
    if (rest.length === 4 && a === "blocks" && c === "delete") return edit.deleteBlock(root, meetingId, b, version);
    if (rest.length === 4 && a === "blocks" && c === "items") return edit.addItem(root, vault, meetingId, b, body, version);
    if (rest.length === 4 && a === "items" && c === "move") return edit.moveItem(root, vault, meetingId, b, body.block, body.index, version);
    if (rest.length === 4 && a === "items" && c === "delete") return edit.deleteItem(root, meetingId, b, version);
    return null;
  }

  async function post(url, body = {}) {
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "본문은 JSON 객체다");
    // 로컬판처럼 JSON 으로 오간 값만 쓴다(화면이 넘긴 객체를 고쳐도 영향이 없게).
    const payload = JSON.parse(JSON.stringify(body));
    let result;
    try {
      result = await write(parse(url).parts, payload);
    } catch (error) {
      if (error instanceof edit.EditError) throw new HttpError(error.status, error.message, error.version);
      throw error;
    }
    if (result === null) throw new HttpError(404, "not found");
    if (result === LIST) return list();
    return detail(result);
  }

  // GET file?p=<vault 경로>: Vault 안 미리보기 형식 파일을 Blob 으로(형식은 PREVIEW_MIME). 없으면 404.
  async function file(path) {
    const handle = await resolveVaultFile(vault, path);
    const ext = handle ? pySuffix(handle.name).toLowerCase() : "";
    if (!Object.hasOwn(PREVIEW_MIME, ext)) throw new HttpError(404, "not found");
    const source = await handle.getFile();
    return source.slice(0, source.size, PREVIEW_MIME[ext]); // 복사 없이 형식만 바꾼다
  }

  // 화면은 로컬판처럼 오류 문구를 그대로 보인다. 브라우저 쪽 실패는 읽을 수 있는 문구의 500 으로.
  const guard = (work) => async (...args) => {
    try {
      return await work(...args);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(500, reason(error));
    }
  };

  return { get: guard(get), post: guard(post), file: guard(file) };
}

// 탭 설정({vault, folder}: FSA 폴더 핸들)으로 backend 를 연다. {backend} 또는 {error, pending: [{handle, mode}] 권한을 다시 물을 것}.
// io 는 web/lib/fsa.js(테스트에서 바꿔 끼운다).
export async function openFolders(settings, io = fsa) {
  const vault = settings?.vault;
  const folder = settings?.folder;
  const handles = io.isHandle(vault) && io.isHandle(folder);
  if (!io.supported() && !handles) return { error: "이 브라우저는 폴더 읽기·쓰기(File System Access API)를 지원하지 않는다. Chrome·Edge 에서 연다." };
  if (!handles) return { error: "Obsidian Vault 폴더·회의 폴더가 없다. ⚙ 설정에서 고른다." };
  // Vault 는 읽기만(파일 카드·트리·미리보기), 쓰기는 회의 폴더 핸들로만 한다.
  const wanted = [{ handle: vault, mode: "read" }, { handle: folder, mode: "readwrite" }];
  const states = [];
  for (const { handle, mode } of wanted) states.push(await io.permission(handle, mode));
  if (states.some((state) => state !== "granted" && state !== "prompt")) return { error: "폴더 권한이 거부됐다. ⚙ 설정에서 폴더를 다시 고른다." };
  const pending = wanted.filter((_, i) => states[i] === "prompt");
  if (pending.length) return { error: "브라우저가 폴더 접근 권한을 다시 묻는다. 아래 버튼을 눌러 허용한다.", pending };
  try {
    if (!(await hasObsidian(vault))) return { error: OUTSIDE_VAULT };
  } catch (error) {
    return { error: reason(error) };
  }
  const rootParts = await io.relativePath(vault, folder);
  if (rootParts === null) return { error: NOT_INSIDE };
  return { backend: createBackend({ root: folder, vault, rootParts }) };
}
