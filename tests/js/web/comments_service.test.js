// 웹 comments 탭 동작(web/tabs/comments/service.js·client.js·overrides.js·tab.js). 로컬판 tests/test_comments_service.py·
// test_comments_client.py·test_comments_serve.py 의 경우를 옮기고, 로컬판 CommentService 결과(report·export)와 비교한다.
// overrides 는 web/lib/store.js 의 tabState("comments")(브라우저에서는 IndexedDB)에 남는다.
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { memoryBackend, saveConfig, tabState, useBackend } from "../../../web/lib/store.js";
import { NOT_JSON, TromboneClient, TromboneError } from "../../../web/tabs/comments/client.js";
import { INVALID, OverrideStore } from "../../../web/tabs/comments/overrides.js";
import { CommentService, ExportDisabled, KEY, NeedLogin, NothingToExport } from "../../../web/tabs/comments/service.js";
import { COMMENTS_TAB } from "../../../web/tabs/comments/tab.js";
import { WEB_TABS } from "../../../web/tabs/manifest.js";
import { python, REPO } from "./support.js";

let data;
beforeAll(() => {
  const run = Bun.spawnSync(["python3", "tests/js/web/comments_fixture.py"], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  data = JSON.parse(run.stdout.toString());
});

const ME = "팀원";
const BASE = "http://trombone.mock:8088";

// web/lib/secrets.js 와 같은 모양(값은 JSON 으로 남긴다).
function memorySecrets(initial = {}) {
  const session = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  const local = new Map();
  return {
    session, local,
    getSecret: (name) => { const raw = session.get(name) ?? local.get(name); return raw === undefined ? null : JSON.parse(raw); },
    setSecret: (name, value, { remember = false } = {}) => { (remember ? local : session).set(name, JSON.stringify(value)); (remember ? session : local).delete(name); },
    clearSecret: (name) => { session.delete(name); local.delete(name); },
  };
}

class FakeClient {
  constructor() {
    this.base = BASE;
    this.reacted = [];
    this.reactError = null;
    this.logins = [];
  }
  async inbox() { return structuredClone(data.inputs.inbox); }
  async bundle(path) { return structuredClone(data.inputs.bundles[path]); }
  async login(loginId, password) {
    this.logins.push(loginId);
    if (password !== "pw") throw new TromboneError("/auth/login → HTTP 401 bad", 401);
    return { token: "T", name: ME };
  }
  async react(commentId, emoji, token) {
    if (this.reactError) throw this.reactError;
    this.reacted.push([commentId, emoji, token]);
    return [{ emoji, actors: [ME] }];
  }
}

// FSA 쓰기 폴더 흉내(getFileHandle({create}) → createWritable → write/close).
function writableDir(name = "체크리스트") {
  const files = new Map();
  return {
    kind: "directory", name, files,
    async getFileHandle(file, { create = false } = {}) {
      if (file.includes("/")) throw new TypeError("Name is not allowed.");
      if (!files.has(file) && !create) throw Object.assign(new Error("없음"), { name: "NotFoundError" });
      return {
        kind: "file", name: file,
        async createWritable() {
          let buffer = "";
          return { async write(text) { buffer += text; }, async close() { files.set(file, buffer); }, async abort() {} };
        },
      };
    },
  };
}

let mem;
beforeEach(async () => {
  mem = memoryBackend();
  useBackend(mem);
  await saveConfig({ project: "TRB", tabs: { comments: { export_dir: null } } });
});

function make({ loggedIn = true, exportDir = writableDir(), secrets } = {}) {
  const client = new FakeClient();
  const store = secrets ?? memorySecrets(loggedIn ? { [KEY]: { base: BASE, token: "T", name: ME } } : {});
  const service = new CommentService({
    client, secrets: store, overrides: new OverrideStore(tabState("comments")), exportDir,
    today: () => new Date(2026, 10, 12), now: () => new Date(2026, 10, 12, 9, 5),
  });
  return { service, client, secrets: store, exportDir };
}

async function applyFixtureOverrides(service) {
  for (const [id, pri] of Object.entries(data.scenarios[0].overrides.priority)) if (["상", "중"].includes(pri.level)) await service.setOverride(id, pri, null);
  for (const [id, why] of Object.entries(data.scenarios[0].overrides.resolved)) await service.setOverride(id, null, why);
}

describe("로그인", () => {
  test("token·이름·주소만 저장하고 비밀번호는 남기지 않는다", async () => {
    const { service, secrets, client } = make({ loggedIn: false });
    expect(await service.login("  a@b.c ", "pw")).toBe(ME);
    expect(client.logins).toEqual(["a@b.c"]);
    expect(JSON.parse(secrets.session.get(KEY))).toEqual({ base: BASE, token: "T", name: ME });
    expect(JSON.stringify([...secrets.session, ...secrets.local])).not.toContain("pw");
    expect(service.describe()).toEqual({ loggedIn: true, name: ME, base: BASE, exportEnabled: true });
  });

  test("'이 브라우저에 기억'이면 localStorage 쪽, 기본은 sessionStorage 쪽", async () => {
    const { service, secrets } = make({ loggedIn: false });
    await service.login("a@b.c", "pw", { remember: true });
    expect([secrets.session.has(KEY), secrets.local.has(KEY)]).toEqual([false, true]);
    service.logout();
    expect([secrets.session.has(KEY), secrets.local.has(KEY)]).toEqual([false, false]);
  });

  test("실패 문구는 로컬판 serve.py 와 같고 아무것도 저장하지 않는다", async () => {
    const { service, secrets } = make({ loggedIn: false });
    await expect(service.login("a@b.c", "nope")).rejects.toMatchObject({ message: "로그인 실패: /auth/login → HTTP 401 bad", status: 401 });
    await expect(service.login(" ", "pw")).rejects.toThrow("이메일과 비밀번호를 입력한다");
    await expect(service.login("a@b.c", "")).rejects.toThrow("이메일과 비밀번호를 입력한다");
    expect(secrets.session.size + secrets.local.size).toBe(0);
  });

  test("다른 기획서 주소의 로그인은 무시하고, 깨진 저장값은 로그아웃 상태 + 사유", () => {
    const { service, secrets } = make();
    secrets.session.set(KEY, JSON.stringify({ base: "http://other", token: "T", name: ME }));
    expect(service.describe().loggedIn).toBe(false);
    secrets.session.set(KEY, JSON.stringify("문자열"));
    expect(service.describe()).toMatchObject({ loggedIn: false, error: "저장된 기획서 로그인 정보를 읽지 못했다. 다시 로그인한다" });
    const broken = make({ secrets: { getSecret: () => { throw new Error("저장소 막힘"); } } }).service;
    expect(broken.describe()).toMatchObject({ loggedIn: false });
    expect(broken.describe().error).toContain("저장소 막힘");
  });
});

describe("목록·반응", () => {
  test("report 는 로컬판 CommentService.report() 와 같다(같은 응답·덮어쓰기·날짜)", async () => {
    const { service } = make();
    await applyFixtureOverrides(service);
    expect(JSON.parse(JSON.stringify(await service.report()))).toEqual({ ...data.service.report });
  });

  test("로그인 전에는 NeedLogin", async () => {
    await expect(make({ loggedIn: false }).service.report()).rejects.toBeInstanceOf(NeedLogin);
  });

  test("👀 는 결정·잠금·이미 붙은 건을 건너뛰고 답글이 있으면 마지막 답글에 붙인다(중복 ID 한 번)", async () => {
    const { service, client } = make();
    const result = await service.react(["CM1", "CM3", "CM5", "CM5", "CM23", "CM404"]);
    expect(result).toEqual({ applied: 2, skipped: 2, failed: ["CM404(코멘트 없음)"] });
    expect(client.reacted).toEqual([["CM5", "EMO005", "T"], ["CM23", "EMO005", "T"]]);
  });

  test("반영 뒤 내 이름이 없으면 실패로 센다", async () => {
    const { service, client } = make();
    client.react = async () => [{ emoji: "EMO005", actors: ["남"] }];
    expect(await service.react(["CM5"])).toEqual({ applied: 0, skipped: 0, failed: ["CM5(반영 후 확인 실패)"] });
  });

  test("401 이면 token 을 지우고 다시 로그인하게 한다, 그 밖 오류는 실패 목록", async () => {
    const { service, client, secrets } = make();
    client.reactError = new TromboneError("HTTP 500", 500);
    expect((await service.react(["CM5"])).failed).toEqual(["CM5(HTTP 500)"]);
    client.reactError = new TromboneError("HTTP 401", 401);
    await expect(service.react(["CM5"])).rejects.toBeInstanceOf(NeedLogin);
    expect(secrets.session.has(KEY)).toBe(false);
  });
});

describe("우선순위·보류는 IndexedDB(tabState('comments'))에 남는다", () => {
  test("지정·해제가 <project>/comments/overrides 에 저장되고 새 화면에서도 읽힌다", async () => {
    const { service } = make();
    await service.setOverride("CM1", { level: "중", reason: "다음" }, "메일 회신");
    expect(mem.stores.state.get("TRB/comments/overrides")).toEqual({ priority: { CM1: { level: "중", reason: "다음" } }, resolved: { CM1: "메일 회신" } });
    const again = new OverrideStore(tabState("comments"));
    expect(await again.load()).toEqual({ priority: { CM1: { level: "중", reason: "다음" } }, resolved: { CM1: "메일 회신" } });
    expect(await service.setOverride("CM1", { level: "", reason: "" }, "")).toEqual({ priority: {}, resolved: {} });
    expect(mem.stores.state.get("TRB/comments/overrides")).toEqual({ priority: {}, resolved: {} });
  });

  test("로컬판 OverrideStore 와 같은 결과가 된다", async () => {
    const { service } = make();
    await applyFixtureOverrides(service);
    expect(await new OverrideStore(tabState("comments")).load()).toEqual(data.service.overrides);
  });

  test("검사 규칙은 로컬판 serve.py PUT api/overrides 와 같다", async () => {
    const store = new OverrideStore(tabState("comments"));
    for (const [id, pri, res] of [["CM1", { level: "최상", reason: "" }, null], ["../x", null, "a"], ["CM1", null, null],
      ["CM1", { level: "상", reason: "가".repeat(501) }, null], ["CM1", null, "가".repeat(501)], ["CM1", null, 3]]) {
      await expect(store.update(id, pri, res)).rejects.toThrow(INVALID);
    }
    expect(await store.update("CM1", null, "가".repeat(500))).toMatchObject({ resolved: { CM1: "가".repeat(500) } });
  });

  test("깨진 저장값은 빈 값으로 읽는다", async () => {
    await tabState("comments").set("overrides", "oops");
    expect(await new OverrideStore(tabState("comments")).load()).toEqual({ priority: {}, resolved: {} });
  });
});

describe("체크리스트 md 내보내기(브라우저가 고른 폴더에 직접 쓴다)", () => {
  test("파일 이름·내용이 로컬판 export() 와 같다", async () => {
    const { service, exportDir } = make();
    await applyFixtureOverrides(service);
    const result = await service.export();
    expect(result.name).toBe(data.service.exportName);
    expect(result.folder).toBe("체크리스트");
    expect(exportDir.files.get(data.service.exportName)).toBe(data.service.exportText);
  });

  test("폴더를 안 골랐거나 코멘트가 없으면 로컬판과 같은 문구", async () => {
    await expect(make({ exportDir: null }).service.export()).rejects.toBeInstanceOf(ExportDisabled);
    const { service, secrets } = make();
    secrets.session.set(KEY, JSON.stringify({ base: BASE, token: "T", name: "코멘트 없는 사람" }));
    await expect(service.export()).rejects.toBeInstanceOf(NothingToExport);
    expect(make({ exportDir: null }).service.describe().exportEnabled).toBe(false);
  });

  test("쓰기 권한이 없으면 다시 허용하라는 문구", async () => {
    const dir = writableDir();
    dir.getFileHandle = async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); };
    await expect(make({ exportDir: dir }).service.export()).rejects.toThrow("체크리스트 저장 폴더에 쓸 권한이 없다");
  });
});

describe("api/trombone 클라이언트(로컬판 client.py 와 같은 문구)", () => {
  const respond = (status, body) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

  test("요청 모양: 상대 경로 trombone/<경로>, 조회는 Bearer 없음, 반응만 Bearer", async () => {
    const seen = [];
    const client = new TromboneClient(async (path, init) => { seen.push([path, init.method, init.headers.Authorization ?? null, init.body ?? null]); return new Response("[]"); });
    await client.inbox();
    await client.bundle("/spec/가 나?x=1");
    await client.login("a@b.c", "pw");
    await client.react("CM1", "EMO005", "TOK");
    expect(seen).toEqual([
      ["trombone/comments", "GET", null, null],
      ["trombone/spec?path=%2Fspec%2F%EA%B0%80%20%EB%82%98%3Fx%3D1", "GET", null, null],
      ["trombone/auth/login", "POST", null, '{"loginId":"a@b.c","password":"pw"}'],
      ["trombone/spec/comments/CM1/reactions", "POST", "Bearer TOK", '{"emoji":"EMO005"}'],
    ]);
  });

  test("TROMBONE HTTP 오류는 '<경로> → HTTP <코드> <message>' 와 상태", async () => {
    const client = new TromboneClient(respond(401, { tromboneStatus: 401, message: "bad" }));
    await expect(client.login("a", "b")).rejects.toMatchObject({ message: "/auth/login → HTTP 401 bad", status: 401 });
    const bare = new TromboneClient(respond(404, { tromboneStatus: 404 }));
    await expect(bare.bundle("/x")).rejects.toMatchObject({ message: "/spec → HTTP 404", status: 404 });
  });

  test("JSON 이 아닌 응답·중계 오류·서버 연결 실패", async () => {
    await expect(new TromboneClient(respond(200, "<html>")).inbox()).rejects.toThrow(NOT_JSON);
    await expect(new TromboneClient(respond(502, { error: "기획서 연결 실패: Connection refused" })).inbox())
      .rejects.toMatchObject({ message: "기획서 연결 실패: Connection refused", status: 502 });
    await expect(new TromboneClient(async () => { throw new TypeError("Failed to fetch"); }).inbox()).rejects.toThrow("대시보드 서버 연결 실패: Failed to fetch");
    expect(await new TromboneClient(respond(200, "")).inbox()).toEqual([]);
  });

  test("서버에 주소가 없으면 config() 가 503 TromboneError", async () => {
    const client = new TromboneClient(respond(503, { error: "서버에 기획서(TROMBONE) 주소가 설정되지 않았다. 운영자가 서버 환경변수 TROMBONE_BASE 를 정한다" }));
    await expect(client.config()).rejects.toMatchObject({ status: 503 });
    const ok = new TromboneClient(respond(200, { base: BASE }));
    expect(await ok.config()).toBe(BASE);
    expect(ok.base).toBe(BASE);
  });
});

describe("탭 등록", () => {
  test("항목은 로컬판 TAB.describe() 와 같고 base 칸만 빠졌다(대상은 서버 TROMBONE_BASE), 저장 폴더는 쓰기 권한", () => {
    const local = python(`import json; from tabs.comments import TAB; print(json.dumps(TAB.describe(), ensure_ascii=False))`);
    const { src, fields, ...rest } = COMMENTS_TAB;
    const { src: localSrc, fields: localFields, ...localRest } = local;
    expect(rest).toEqual(localRest);
    expect(src).toBe("tabs/comments/");
    expect(fields.map((f) => f.key)).toEqual(["export_dir"]);
    const { mode, help, ...field } = fields[0];
    const { help: localHelp, ...localField } = localFields.find((f) => f.key === "export_dir");
    expect(field).toEqual(localField);
    expect(mode).toBe("readwrite");
    expect(help.startsWith(localHelp)).toBe(true);
  });

  test("WEB_TABS 순서는 로컬판 ALL_TABS 순서를 따른다", () => {
    const order = python(`import json; from tabs import ALL_TABS; print(json.dumps([t.id for t in ALL_TABS]))`);
    const web = WEB_TABS.map((t) => t.id);
    expect(web).toContain("comments");
    expect(web).toEqual(order.filter((id) => web.includes(id)));
  });
});
