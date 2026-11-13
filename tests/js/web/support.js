// 웹 모듈 테스트 도구: 디스크 폴더를 FSA 디렉터리 핸들처럼 보이게 하는 가짜, Python 실행.
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const REPO = resolve(import.meta.dir, "../../..");

export function tempFolder(name = "10-plans") {
  const base = mkdtempSync(join(tmpdir(), "dobbys-web-"));
  const folder = join(base, name);
  mkdirSync(folder);
  return { folder, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

export function write(folder, name, text) {
  const path = join(folder, name);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof text === "string" ? Buffer.from(text, "utf-8") : text);
  return path;
}

// 디스크 경로 → FileSystemDirectoryHandle 흉내(entries·getDirectoryHandle·getFileHandle·removeEntry·resolve·isSameEntry).
// 쓰기는 Chrome 처럼 createWritable() 이 같은 폴더의 `<이름>.crswap` 에 쓰고 close() 때 원본과 바꾼다(rename = 원자적 교체),
// abort() 는 swap 파일을 버린다. options: {move: false 면 FileSystemHandle.move() 가 없는 브라우저,
// trace(step, path): createWritable·write·close·abort·move·remove 직전에 불린다(던지면 그 단계가 실패한다)}.
const fail = (name, message) => Object.assign(new Error(message), { name });
const DENIED_NAME = (name) => typeof name !== "string" || !name || name === "." || name === ".." || name.includes("/") || name.includes("\0");

function lookup(path, name) {
  if (DENIED_NAME(name)) throw new TypeError("Name is not allowed.");
  const child = join(path, name);
  try { return { child, info: statSync(child) }; } catch { return { child, info: null }; }
}

export function dirHandle(path, root = null, options = {}) {
  const handle = {
    kind: "directory",
    name: path.split("/").at(-1),
    path,
    async *entries() {
      for (const name of readdirSync(path)) {
        const child = join(path, name);
        yield [name, statSync(child).isDirectory() ? dirHandle(child, root ?? handle, options) : fileHandle(child, options)];
      }
    },
    async getDirectoryHandle(name, { create = false } = {}) {
      const { child, info } = lookup(path, name);
      if (info?.isDirectory()) return dirHandle(child, root ?? handle, options);
      if (info) throw fail("TypeMismatchError", "type mismatch");
      if (!create) throw fail("NotFoundError", "A requested file or directory could not be found");
      mkdirSync(child);
      return dirHandle(child, root ?? handle, options);
    },
    async getFileHandle(name, { create = false } = {}) {
      const { child, info } = lookup(path, name);
      if (info?.isFile()) return fileHandle(child, options);
      if (info) throw fail("TypeMismatchError", "type mismatch");
      if (!create) throw fail("NotFoundError", "A requested file or directory could not be found");
      writeFileSync(child, "");
      return fileHandle(child, options);
    },
    async removeEntry(name, { recursive = false } = {}) {
      const { child, info } = lookup(path, name);
      if (!info) throw fail("NotFoundError", "A requested file or directory could not be found");
      if (info.isDirectory() && !recursive && readdirSync(child).length) throw fail("InvalidModificationError", "not empty");
      options.trace?.("remove", child);
      rmSync(child, { recursive: true, force: true });
    },
    async resolve(other) {
      if (!other.path.startsWith(path + "/")) return other.path === path ? [] : null;
      return other.path.slice(path.length + 1).split("/");
    },
    async isSameEntry(other) { return sameEntry(path, other?.path); },
    async queryPermission() { return "granted"; },
    async requestPermission() { return "granted"; },
  };
  return handle;
}

// 같은 파일인가(대소문자 무시 파일 시스템에서 "A" 와 "a" 도 같다).
function sameEntry(a, b) {
  if (!b) return false;
  try {
    const x = statSync(a);
    const y = statSync(b);
    return x.dev === y.dev && x.ino === y.ino;
  } catch {
    return a === b;
  }
}

function bytesOf(data) {
  if (typeof data === "string") return Buffer.from(data, "utf-8");
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError("이 가짜 writable 은 문자열·ArrayBuffer·TypedArray 만 받는다");
}

export function fileHandle(path, options = {}) {
  const handle = {
    kind: "file",
    name: path.split("/").at(-1),
    path,
    // 브라우저 File 처럼 name·size·lastModified·arrayBuffer·text·slice 를 준다. 펼쳐 쓰는 도구({...file}, weekly_support.js)가
    // 메서드를 잃지 않게 원형이 아닌 자기 속성으로 둔다.
    async getFile() {
      const bytes = readFileSync(handle.path);
      const blob = new Blob([bytes]);
      return {
        name: handle.name, size: bytes.byteLength, type: "", lastModified: Math.floor(statSync(handle.path).mtimeMs),
        async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
        async text() { return bytes.toString("utf-8"); },
        slice: (start, end, type) => blob.slice(start, end, type),
      };
    },
    async createWritable({ keepExistingData = false } = {}) {
      const target = handle.path;
      const swap = target + ".crswap";
      options.trace?.("createWritable", target);
      writeFileSync(swap, keepExistingData ? readFileSync(target) : "");
      let open = true;
      const closed = () => { if (!open) throw new TypeError("Cannot write to a CLOSED writable stream"); };
      return {
        async write(data) {
          closed();
          options.trace?.("write", target);
          appendFileSync(swap, bytesOf(data));
        },
        async close() {
          closed();
          options.trace?.("close", target);
          open = false;
          renameSync(swap, target);
        },
        async abort() {
          if (!open) throw new TypeError("Cannot abort a CLOSED writable stream");
          open = false;
          options.trace?.("abort", target);
          rmSync(swap, { force: true });
        },
      };
    },
    async isSameEntry(other) { return sameEntry(handle.path, other?.path); },
    async queryPermission() { return "granted"; },
  };
  if (options.move !== false) {
    // move(새 폴더, 새 이름) · move(새 이름). 옮긴 뒤 이 핸들은 새 위치를 가리킨다.
    handle.move = async (dir, name) => {
      const [toDir, toName] = typeof dir === "string" ? [handle.path.slice(0, handle.path.lastIndexOf("/")), dir] : [dir.path, name];
      const next = join(toDir, toName);
      options.trace?.("move", handle.path);
      renameSync(handle.path, next);
      handle.path = next;
      handle.name = toName;
    };
  }
  return handle;
}

// 저장소 루트에서 python3 -c 를 돌려 마지막 줄 JSON 을 돌려준다.
export function python(code, args = []) {
  const run = Bun.spawnSync(["python3", "-c", code, ...args], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  return JSON.parse(run.stdout.toString().trim().split("\n").at(-1));
}
