// File System Access 층(web/lib/fsa.js)과 경로 복사(web/tabs/plans/copy_path.js), 비밀값·api·뷰어 규칙.
import { afterEach, expect, test } from "bun:test";
import {
  cleanRealRoot, errorText, isHandle, joinRealPath, permission, pickDirectory, pickFile, pickerId, pickerTypes, realPathMismatch, reconnect, relativePath, supported,
} from "../../../web/lib/fsa.js";
import { copyButtonFor, copyPathFor } from "../../../web/tabs/plans/copy_path.js";
import { PREFIX, clearSecret, getSecret, setSecret } from "../../../web/lib/secrets.js";
import { apiFetch, apiUrl } from "../../../web/lib/api.js";
import { obsidian, planName, splitFrontmatter } from "../../../web/tabs/plans/viewer.js";
import { dirHandle, tempFolder, write } from "./support.js";

const saved = { ...globalThis };
afterEach(() => {
  for (const key of ["showDirectoryPicker", "showOpenFilePicker", "sessionStorage", "localStorage", "fetch"]) {
    if (key in saved) globalThis[key] = saved[key]; else delete globalThis[key];
  }
});

test("joinRealPath: 실제 경로 + resolve() 조각, 구분자 정리(루트 끝·중복, / · \\)", () => {
  expect(joinRealPath("/Users/me/Vault/10-plans", ["a.md"])).toBe("/Users/me/Vault/10-plans/a.md");
  expect(joinRealPath("  /Users/me//Vault///10-plans//  ", ["sub", "a.md"])).toBe("/Users/me/Vault/10-plans/sub/a.md");
  expect(joinRealPath("C:\\Vault\\10-plans\\", ["a.md"])).toBe("C:\\Vault\\10-plans\\a.md");
  expect(joinRealPath("C:/Vault//10-plans", ["sub", "a.md"])).toBe("C:\\Vault\\10-plans\\sub\\a.md");
  expect(joinRealPath("C:\\Vault/10-plans\\\\", ["a.md"])).toBe("C:\\Vault\\10-plans\\a.md");
  expect(joinRealPath("\\\\server\\share\\\\plans", ["a.md"])).toBe("\\\\server\\share\\plans\\a.md");
  expect(joinRealPath("/", ["a.md"])).toBe("/a.md");
  expect(joinRealPath("C:\\", ["a.md"])).toBe("C:\\a.md");
  expect(joinRealPath("/x", [])).toBe("/x");
});

test("joinRealPath: 조각이 null(폴더 밖)이거나 실제 경로가 비면 null", () => {
  expect(joinRealPath("/x", null)).toBeNull();
  expect(joinRealPath("", ["a.md"])).toBeNull();
  expect(joinRealPath("   ", ["a.md"])).toBeNull();
  expect(cleanRealRoot(null)).toBeNull();
});

test("실제 경로의 마지막 조각이 고른 폴더 이름과 다르면 경고(P1)", () => {
  expect(realPathMismatch("/Users/me/Vault/10-plans/", "10-plans")).toBe(false);
  expect(realPathMismatch("C:\\Vault\\10-plans", "10-plans")).toBe(false);
  expect(realPathMismatch("/Users/me/Vault/plans", "10-plans")).toBe(true);
  expect(realPathMismatch("/x/" + "한글".normalize("NFD"), "한글")).toBe(false);
  expect(realPathMismatch("", "10-plans")).toBe(false);
  expect(realPathMismatch("/x", null)).toBe(false);
});

test("relativePath 는 resolve() 결과, 실패·밖이면 null", async () => {
  const fixture = tempFolder("plans");
  try {
    write(fixture.folder, "sub/a.md", "x");
    const root = dirHandle(fixture.folder);
    const sub = (await (async () => { for await (const [name, h] of root.entries()) if (name === "sub") return h; })());
    const inner = await sub.getFileHandle("a.md");
    expect(await relativePath(root, inner)).toEqual(["sub", "a.md"]);
    expect(await relativePath(sub, root)).toBeNull();
    expect(await relativePath({ resolve: async () => { throw new Error("x"); } }, inner)).toBeNull();
    expect(await relativePath(null, inner)).toBeNull();
  } finally {
    fixture.cleanup();
  }
});

test("경로 복사: 실제 경로가 비면 버튼이 없고, 있으면 마우스를 올렸을 때 경로가 보인다(P32)", () => {
  expect(copyButtonFor("")("a.md")).toBe("");
  expect(copyButtonFor("  ")("a.md")).toBe("");
  const html = copyButtonFor("/Users/me/10-plans/")("2026-11-01 a&b.md");
  expect(html).toContain('data-copy-file="2026-11-01 a&amp;b.md"');
  expect(html).toContain('title="/Users/me/10-plans/2026-11-01 a&amp;b.md"');
  expect(html).toContain(">경로 복사</button>");
});

test("경로 복사: 누르면 resolve() 로 경로를 만들고, null 이면 만들지 않고 안내(P32)", async () => {
  const fixture = tempFolder("10-plans");
  try {
    write(fixture.folder, "2026-11-01 a.md", "x");
    const folder = dirHandle(fixture.folder);
    expect(await copyPathFor(folder, "C:\\Vault\\10-plans\\", "2026-11-01 a.md")).toEqual({ path: "C:\\Vault\\10-plans\\2026-11-01 a.md" });
    const outside = { ...folder, resolve: async () => null };
    expect((await copyPathFor(outside, "/x", "2026-11-01 a.md")).error).toContain("경로를 만들지 않았다");
    expect((await copyPathFor(folder, "", "2026-11-01 a.md")).error).toContain("실제 경로 칸이 비어 있다");
    await expect(copyPathFor(folder, "/x", "없는.md")).rejects.toThrow();
  } finally {
    fixture.cleanup();
  }
});

test("미지원 브라우저 감지와 선택 창 옵션", async () => {
  expect(supported()).toBe(false);
  expect(errorText(new Error("x"))).toContain("Chrome·Edge");
  const calls = [];
  globalThis.showDirectoryPicker = async (options) => { calls.push(["dir", options]); return { kind: "directory", name: "d" }; };
  globalThis.showOpenFilePicker = async (options) => { calls.push(["file", options]); return [{ kind: "file", name: "f.xlsx" }]; };
  expect(supported()).toBe(true);
  expect((await pickDirectory({ id: "plans-folder", mode: "read" })).name).toBe("d");
  expect((await pickFile({ id: "wbs.workbook", accept: [".xlsx"] })).name).toBe("f.xlsx");
  expect(calls).toEqual([
    ["dir", { id: "plans-folder", mode: "read" }],
    ["file", { id: "wbs_workbook", types: pickerTypes([".xlsx"]), multiple: false }],
  ]);
  expect(pickerTypes([".xlsx"])).toEqual([{ description: ".xlsx", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } }]);
  expect(pickerId("x".repeat(40)).length).toBe(32);
});

test("취소(AbortError)는 null, 그 밖의 거절은 예외(S37·S39)", async () => {
  globalThis.showOpenFilePicker = async () => [];
  globalThis.showDirectoryPicker = async () => { throw Object.assign(new Error("cancel"), { name: "AbortError" }); };
  expect(await pickDirectory({ id: "a" })).toBeNull();
  globalThis.showDirectoryPicker = async () => { throw Object.assign(new Error("activation"), { name: "SecurityError" }); };
  const error = await pickDirectory({ id: "a" }).catch((e) => e);
  expect(error.name).toBe("SecurityError");
  expect(errorText(error)).toContain("버튼을 눌러 다시 고르세요");
});

test("권한 확인·다시 연결", async () => {
  const handle = { queryPermission: async ({ mode }) => (mode === "read" ? "prompt" : "denied"), requestPermission: async () => "granted" };
  expect(await permission(handle)).toBe("prompt");
  expect(await permission(handle, "readwrite")).toBe("denied");
  expect(await permission(null)).toBe("denied");
  expect(await permission({ queryPermission: async () => { throw new Error("x"); } })).toBe("denied");
  expect(await reconnect(handle)).toBe("granted");
  expect(isHandle({ kind: "directory", name: "x", isSameEntry() {} })).toBe(true);
  expect(isHandle({ $handle: "directory", name: "x" })).toBe(false);
});

const fakeStorage = () => {
  const map = new Map();
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
};

test("비밀값은 기본 sessionStorage, 기억하면 localStorage, 지우면 둘 다", () => {
  globalThis.sessionStorage = fakeStorage();
  globalThis.localStorage = fakeStorage();
  setSecret("jira", { token: "t" });
  expect([...globalThis.sessionStorage.map.keys()]).toEqual([PREFIX + "jira"]);
  expect(getSecret("jira")).toEqual({ token: "t" });
  setSecret("jira", { token: "u" }, { remember: true });
  expect(globalThis.sessionStorage.map.size).toBe(0);
  expect(getSecret("jira")).toEqual({ token: "u" });
  clearSecret("jira");
  expect(getSecret("jira")).toBeNull();
});

test("apiFetch 는 web/ 기준 api/<이름> 을 X-Dobbys-Proxy: 1 과 함께 부른다", async () => {
  let seen;
  globalThis.fetch = async (url, init) => { seen = { url: String(url), proxy: init.headers.get("X-Dobbys-Proxy"), method: init.method }; return new Response("{}"); };
  await apiFetch("/version", { method: "GET", headers: { "X-Dobbys-Proxy": "0" } });
  expect(seen.url.endsWith("/web/api/version")).toBe(true);
  expect(seen.proxy).toBe("1");
  expect(String(apiUrl("jira?x=1")).endsWith("/web/api/jira?x=1")).toBe(true);
});

test("뷰어: 폴더 바로 아래 .md 만 연다(P35), frontmatter·위키링크(P38)", () => {
  for (const name of ["2026-11-01 계획.md", "a.md"]) expect(planName(name)).toBe(true);
  for (const name of ["부속/report.md", ".hidden.md", "notes.txt", "../x.md", "..", "", "부속\\report.md"]) expect(planName(name)).toBe(false);
  expect(splitFrontmatter("---\nstatus: 완료\n---\n# 제목")).toEqual({ meta: { status: "완료" }, body: "# 제목" });
  expect(obsidian("[[a.md|별칭]] ![[img.png]]\n```\n[[그대로]]\n```")).toBe('별칭 <span class="embed">[이미지: img.png]</span>\n```\n[[그대로]]\n```');
});
