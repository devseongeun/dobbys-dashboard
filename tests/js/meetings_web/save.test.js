// 회의 자료 저장 확인(c2). 로컬판 meetings_edit.py 의 저장 규칙이 웹에서도 지켜지는가.
// - 저장 직전 Canvas·순서 파일을 다시 읽어 version 이 화면이 읽은 것과 다르면 쓰지 않는다(409 + 현재 version, 파일 그대로).
// - 파일마다 createWritable() 한 번: swap 파일에 쓰고 close() 때 원본과 바뀐다(그 전까지 원본은 옛 내용). 실패하면 abort().
// - 한 탭 안의 동시 저장은 하나씩 돈다(같은 version 으로 두 번 저장하면 하나만 쓰이고 하나는 409).
// 가짜 FSA(tests/js/web/support.js)는 Chrome 처럼 `<이름>.crswap` 에 쓰고 close() 때 rename 한다.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as canvas from "../../../web/tabs/meetings/meetings_canvas.js";
import * as edit from "../../../web/tabs/meetings/meetings_edit.js";
import { createBackend, openFolders } from "../../../web/tabs/meetings/backend.js";
import { NOT_INSIDE, OUTSIDE_VAULT, validate } from "../../../web/tabs/meetings/tab.js";
import { dirHandle, tempFolder, write } from "../web/support.js";

const MEETING = "2026-11-05 협조";
const CANVAS = { nodes: [{ id: "g", type: "group", x: 0, y: 0, width: 500, height: 300, label: "2026-11-05 회의" },
  { id: "t", type: "text", x: 20, y: 20, width: 100, height: 60, text: "메모" }], edges: [] };

let fx;
let vaultPath;
let rootPath;
let events;
let failAt;

function open(options = {}) {
  const trace = (step, path) => {
    events.push([step, path.slice(vaultPath.length + 1)]);
    if (failAt?.(step, path)) throw Object.assign(new Error(`${step} 실패(테스트)`), { name: "AbortError" });
  };
  const vault = dirHandle(vaultPath, null, { trace, ...options });
  const root = dirHandle(rootPath, vault, { trace, ...options });
  return { vault, root, backend: createBackend({ root, vault, rootParts: ["70-meetings"] }) };
}

const canvasFile = () => join(rootPath, `${MEETING}.canvas`);
const read = () => readFileSync(canvasFile(), "utf-8");
const leftovers = () => readdirSync(rootPath, { recursive: true }).filter((p) => String(p).endsWith(".crswap"));

beforeEach(() => {
  fx = tempFolder("vault");
  vaultPath = fx.folder;
  rootPath = join(vaultPath, "70-meetings");
  write(vaultPath, ".obsidian/app.json", "{}");
  write(vaultPath, "docs/협조 요청.md", "# 협조");
  write(rootPath, `${MEETING}.canvas`, JSON.stringify(CANVAS));
  events = [];
  failAt = null;
});
afterEach(() => fx.cleanup());

describe("저장 직전 충돌 확인", () => {
  test("화면이 읽은 뒤 Canvas 가 바뀌었으면 쓰지 않고 409 와 현재 version 을 준다. 다시 읽으면 바뀐 내용이다", async () => {
    const { backend } = open();
    const seen = await backend.get(`api/meetings/${encodeURIComponent(MEETING)}`);
    // 그사이 Obsidian 이 회의 블록을 하나 더했다.
    const changed = JSON.stringify({ ...CANVAS, nodes: [...CANVAS.nodes, { id: "g2", type: "group", x: 0, y: 400, width: 300, height: 200, label: "2026-11-06 Obsidian 에서" }] });
    writeFileSync(canvasFile(), changed);
    events = [];
    const error = await backend.post(`api/meetings/${encodeURIComponent(MEETING)}/blocks/g/items`, { kind: "link", url: "https://a.b", version: seen.version })
      .then(() => null, (err) => err);
    expect([error?.status, error?.message]).toEqual([409, "Canvas가 바뀌었다. 다시 불러온다"]);
    expect(read()).toBe(changed);
    expect(events.filter(([step]) => step === "createWritable")).toEqual([]);
    const reloaded = await backend.get(`api/meetings/${encodeURIComponent(MEETING)}`);
    expect(error.version).toBe(reloaded.version);
    expect(reloaded.blocks.map((b) => b.label)).toEqual(["2026-11-06 Obsidian 에서", "2026-11-05 회의"]);
  });

  test("순서 파일만 바뀌어도 version 이 달라 막는다", async () => {
    const { backend } = open();
    const seen = await backend.get(`api/meetings/${encodeURIComponent(MEETING)}`);
    write(rootPath, `.order/${MEETING}.json`, JSON.stringify({ g: ["t"] }));
    const error = await backend.post(`api/meetings/${encodeURIComponent(MEETING)}/blocks`, { label: "x", version: seen.version }).catch((err) => err);
    expect(error.status).toBe(409);
    expect(read()).toBe(JSON.stringify(CANVAS));
  });

  test("업무 삭제도 바뀐 Canvas 면 휴지통으로 옮기지 않는다", async () => {
    const { root } = open();
    const version = await canvas.versionOf(root, await canvas.resolveMeeting(root, MEETING), MEETING);
    writeFileSync(canvasFile(), "{}");
    const error = await edit.deleteMeeting(root, MEETING, version).catch((err) => err);
    expect(error.status).toBe(409);
    expect(existsSync(canvasFile())).toBe(true);
    expect(existsSync(join(rootPath, ".trash"))).toBe(false);
  });
});

describe("원자적 교체", () => {
  test("파일마다 createWritable 한 번, close() 전까지 원본은 옛 내용이고 swap 에 새 내용 전체가 있다", async () => {
    const { root, vault } = open();
    const before = read();
    const atClose = [];
    failAt = (step, path) => {
      if (step === "close") atClose.push({ path, original: readFileSync(path, "utf-8"), swap: readFileSync(path + ".crswap", "utf-8") });
      return false;
    };
    const version = await canvas.versionOf(root, await canvas.resolveMeeting(root, MEETING), MEETING);
    await edit.addItem(root, vault, MEETING, "g", { kind: "file", path: "docs/협조 요청.md" }, version);
    const writes = events.filter(([step]) => step === "createWritable").map(([, path]) => path);
    expect(writes).toEqual([`70-meetings/${MEETING}.canvas`, `70-meetings/.order/${MEETING}.json`]);
    expect(events.filter(([step]) => step === "close").length).toBe(2);
    const canvasClose = atClose.find((c) => c.path === canvasFile());
    expect(canvasClose.original).toBe(before);
    expect(canvasClose.swap).toBe(read());
    expect(JSON.parse(read()).nodes.at(-1)).toMatchObject({ type: "file", file: "docs/협조 요청.md" });
    expect(read().startsWith('{\n\t"nodes": [')).toBe(true);
    expect(leftovers()).toEqual([]);
  });

  for (const step of ["write", "close"]) {
    test(`${step} 중에 실패하면 abort() 로 swap 을 버리고 원본은 바이트 그대로다`, async () => {
      const { root } = open();
      const before = read();
      failAt = (s, path) => s === step && path === canvasFile();
      const version = await canvas.versionOf(root, await canvas.resolveMeeting(root, MEETING), MEETING);
      const error = await edit.addBlock(root, MEETING, "새 회의", version).catch((err) => err);
      expect(error?.message).toBe(`${step} 실패(테스트)`);
      expect(read()).toBe(before);
      expect(events.some(([s]) => s === "abort")).toBe(true);
      expect(leftovers()).toEqual([]);
    });
  }

  test("새 업무 Canvas 쓰기가 실패하면 빈 파일도 남기지 않는다(로컬판 임시 파일처럼)", async () => {
    const { root } = open();
    failAt = (step) => step === "write";
    const error = await edit.createMeeting(root, "", "새 업무").catch((err) => err);
    expect(error?.message).toBe("write 실패(테스트)");
    expect(existsSync(join(rootPath, "새 업무.canvas"))).toBe(false);
    expect(leftovers()).toEqual([]);
  });
});

describe("한 탭 안 동시 저장은 하나씩", () => {
  test("같은 version 으로 두 번 저장하면 하나만 쓰이고 하나는 409, 두 저장의 파일 쓰기는 섞이지 않는다", async () => {
    const { root, vault } = open();
    const version = await canvas.versionOf(root, await canvas.resolveMeeting(root, MEETING), MEETING);
    const results = await Promise.allSettled([
      edit.addItem(root, vault, MEETING, "g", { kind: "link", url: "https://one.example" }, version),
      edit.addItem(root, vault, MEETING, "g", { kind: "link", url: "https://two.example" }, version),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(results[1].reason.status).toBe(409);
    const links = JSON.parse(read()).nodes.filter((n) => n.type === "link").map((n) => n.url);
    expect(links).toEqual(["https://one.example"]);
    expect(events.map(([step]) => step)).toEqual(["createWritable", "write", "close", "createWritable", "write", "close"]);
  });

  test("앞 저장이 실패해도 다음 저장은 돈다", async () => {
    const { root } = open();
    const version = await canvas.versionOf(root, await canvas.resolveMeeting(root, MEETING), MEETING);
    const [bad, good] = await Promise.allSettled([edit.addBlock(root, MEETING, "a", "stale"), edit.addBlock(root, MEETING, "b", version)]);
    expect([bad.status, bad.reason.status, good.status]).toEqual(["rejected", 409, "fulfilled"]);
  });
});

describe("옮기기(이름 바꾸기·휴지통)", () => {
  for (const move of [true, false]) {
    test(`move() ${move ? "있는" : "없는"} 브라우저: 이름 바꾸기는 순서 파일도 옮기고, 삭제는 .trash/<시각>/ 로 옮긴다`, async () => {
      const { root } = open({ move });
      write(rootPath, `.order/${MEETING}.json`, JSON.stringify({ g: ["t"] }));
      const bytes = read();
      const now = edit.hooks.now;
      edit.hooks.now = () => new Date(2026, 10, 12, 9, 5, 7);
      try {
        let version = await canvas.versionOf(root, await canvas.resolveMeeting(root, MEETING), MEETING);
        expect(await edit.renameMeeting(root, MEETING, "2026-11-06", "바뀜", version)).toBe("2026-11-06 바뀜");
        expect(existsSync(canvasFile())).toBe(false);
        expect(readFileSync(join(rootPath, ".order", "2026-11-06 바뀜.json"), "utf-8")).toBe(JSON.stringify({ g: ["t"] }));
        version = await canvas.versionOf(root, await canvas.resolveMeeting(root, "2026-11-06 바뀜"), "2026-11-06 바뀜");
        expect(await edit.deleteMeeting(root, "2026-11-06 바뀜", version)).toBe(".trash/2026-11-12 090507");
        const trash = join(rootPath, ".trash", "2026-11-12 090507");
        expect(readFileSync(join(trash, "2026-11-06 바뀜.canvas"), "utf-8")).toBe(bytes);
        expect(existsSync(join(trash, ".order", "2026-11-06 바뀜.json"))).toBe(true);
        expect(await canvas.listMeetings(root)).toEqual([]);
        expect(existsSync(join(vaultPath, "docs", "협조 요청.md"))).toBe(true);
        expect(leftovers()).toEqual([]);
      } finally {
        edit.hooks.now = now;
      }
    });
  }

  test("대소문자만 바꾸는 이름 바꾸기(대소문자 무시 파일 시스템이면 같은 파일)도 파일을 잃지 않는다", async () => {
    const { root } = open({ move: false });
    const version = await canvas.versionOf(root, await canvas.resolveMeeting(root, MEETING), MEETING);
    await edit.renameMeeting(root, MEETING, "2026-11-05", "협조 ABC", version);
    const v2 = await canvas.versionOf(root, await canvas.resolveMeeting(root, "2026-11-05 협조 ABC"), "2026-11-05 협조 ABC");
    expect(await edit.renameMeeting(root, "2026-11-05 협조 ABC", "2026-11-05", "협조 abc", v2)).toBe("2026-11-05 협조 abc");
    const names = readdirSync(rootPath).filter((n) => n.endsWith(".canvas"));
    expect(names).toEqual(["2026-11-05 협조 abc.canvas"]);
    expect(JSON.parse(readFileSync(join(rootPath, names[0]), "utf-8"))).toEqual(CANVAS);
  });
});

describe("설정의 Vault·회의 폴더", () => {
  const io = (permission = "granted") => ({
    supported: () => true, isHandle: (h) => Boolean(h?.kind), permission: async () => permission,
    relativePath: async (a, b) => a.resolve(b), errorText: (e) => String(e),
  });

  test(".obsidian 이 없으면 로컬판 OUTSIDE_VAULT 문구, 회의 폴더가 Vault 밖이면 막는다", async () => {
    const vault = dirHandle(vaultPath);
    const folder = dirHandle(rootPath);
    expect(await validate({ vault, folder }, io())).toEqual({});
    expect(await validate({ vault: folder, folder }, io())).toEqual({ vault: OUTSIDE_VAULT });
    expect(OUTSIDE_VAULT).toBe("Obsidian Vault 안의 폴더를 지정하세요(.obsidian 폴더가 없습니다)");
    write(fx.folder, "../밖/x.md", "x");
    const outside = dirHandle(join(fx.folder, "..", "밖"));
    expect(await validate({ vault, folder: outside }, io())).toEqual({ folder: NOT_INSIDE });
    expect(await validate({ vault, folder: vault }, io())).toEqual({});
  });

  test("openFolders: 권한이 prompt 면 다시 연결할 핸들을, 아니면 backend 를 준다", async () => {
    const vault = dirHandle(vaultPath);
    const folder = dirHandle(rootPath);
    const pending = await openFolders({ vault, folder }, io("prompt"));
    expect([pending.backend, pending.pending.length]).toEqual([undefined, 2]);
    expect((await openFolders({ vault, folder }, io("denied"))).error).toContain("거부");
    expect((await openFolders({ vault: folder, folder }, io())).error).toBe(OUTSIDE_VAULT);
    expect((await openFolders({}, io())).error).toContain("⚙ 설정");
    const { backend } = await openFolders({ vault, folder }, io());
    const detail = await backend.get(`api/meetings/${encodeURIComponent(MEETING)}`);
    expect([detail.vault, detail.canvasPath]).toEqual(["vault", `70-meetings/${MEETING}.canvas`]);
  });
});
