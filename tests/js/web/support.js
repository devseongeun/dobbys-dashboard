// 웹 모듈 테스트 도구: 디스크 폴더를 FSA 디렉터리 핸들처럼 보이게 하는 가짜, Python 실행.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

// 디스크 경로 → FileSystemDirectoryHandle 흉내(entries·getFileHandle·resolve·isSameEntry).
export function dirHandle(path, root = null) {
  const handle = {
    kind: "directory",
    name: path.split("/").at(-1),
    path,
    async *entries() {
      for (const name of readdirSync(path)) {
        const child = join(path, name);
        yield [name, statSync(child).isDirectory() ? dirHandle(child, root ?? handle) : fileHandle(child)];
      }
    },
    async getFileHandle(name) {
      if (name.includes("/") || name === "." || name === "..") throw new TypeError("Name is not allowed.");
      const child = join(path, name);
      let info;
      try { info = statSync(child); } catch { throw Object.assign(new Error("A requested file or directory could not be found"), { name: "NotFoundError" }); }
      if (!info.isFile()) throw Object.assign(new Error("type mismatch"), { name: "TypeMismatchError" });
      return fileHandle(child);
    },
    async resolve(other) {
      if (!other.path.startsWith(path + "/")) return null;
      return other.path.slice(path.length + 1).split("/");
    },
    async isSameEntry(other) { return other?.path === path; },
    async queryPermission() { return "granted"; },
    async requestPermission() { return "granted"; },
  };
  return handle;
}

export function fileHandle(path) {
  return {
    kind: "file",
    name: path.split("/").at(-1),
    path,
    async getFile() {
      const bytes = readFileSync(path);
      return { name: path.split("/").at(-1), async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }, async text() { return bytes.toString("utf-8"); } };
    },
    async isSameEntry(other) { return other?.path === path; },
    async queryPermission() { return "granted"; },
  };
}

// 저장소 루트에서 python3 -c 를 돌려 마지막 줄 JSON 을 돌려준다.
export function python(code, args = []) {
  const run = Bun.spawnSync(["python3", "-c", code, ...args], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  return JSON.parse(run.stdout.toString().trim().split("\n").at(-1));
}
