// 로컬판 tests/test_wbs_board.py·test_wbs_session.py·test_wbs_matching.py(MapStore) 와 같은 입력·기대값.
import { describe, expect, test } from "bun:test";
import { buildJql, JiraClient, JiraError, proxyFetch } from "../../../web/tabs/wbs/js/jira.js";
import { BoardService } from "../../../web/tabs/wbs/js/service.js";
import { JiraSession } from "../../../web/tabs/wbs/js/session.js";
import { cacheOf, DraftStore, MapStore } from "../../../web/tabs/wbs/js/stores.js";
import { memorySecrets, memoryState } from "./fakes.js";

const ACCOUNT = "acc-1";
const RAW_ISSUE = {
  key: "PROJ-1156",
  fields: {
    summary: "티켓 - 워크플로우 템플릿 관리 등록",
    status: { name: "진행", statusCategory: { name: "진행 중" } },
    issuetype: { name: "할 일" }, priority: { name: "Medium" }, assignee: { displayName: "홍길동" },
    duedate: "2026-10-01", timespent: 14400,
    customfield_11481: "2026-09-18", customfield_11484: "2026-09-22", customfield_11485: null,
    worklog: {
      total: 1, maxResults: 20,
      worklogs: [{
        id: "23809", author: { displayName: "홍길동", accountId: ACCOUNT },
        started: "2026-09-28T23:30:00.000+0900", timeSpentSeconds: 7200,
        comment: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "매핑 갱신" }] }] },
      }],
    },
  },
};
const copy = (v) => structuredClone(v);

class FakeClient {
  constructor(issues, { extra = {}, error = null, authError = null } = {}) {
    Object.assign(this, { issues, extra, error, authError, worklogCalls: [], myselfCalls: 0, jqls: [] });
  }
  async myself() {
    this.myselfCalls++;
    if (this.authError) throw this.authError;
    return { accountId: ACCOUNT, displayName: "홍길동" };
  }
  async searchAll(jql) {
    this.jqls.push(jql);
    if (this.error) throw this.error;
    return this.issues;
  }
  async issueWorklogs(key) {
    this.worklogCalls.push(key);
    return this.extra[key];
  }
}
const failing = (error) => ({ myself: async () => { throw error; } });
const sessionOf = (client) => ({ client: async () => client });
const brokenStore = { client: async () => { throw new Error("저장된 Jira 로그인 정보를 읽지 못했다. 다시 로그인한다"); } };

function service(session, linked = () => ["PROJ-1156"], state = memoryState(), options = {}) {
  return new BoardService(session, "PROJ", async () => linked(), cacheOf(state), options);
}

describe("BoardService (board.py)", () => {
  test("payload 에 이슈·워크로그가 담긴다", async () => {
    const client = new FakeClient([RAW_ISSUE]);
    const payload = await service(sessionOf(client)).payload();
    expect(client.jqls).toEqual([buildJql("PROJ", ACCOUNT, ["PROJ-1156"])]);
    expect([payload.stale, payload.error, payload.issues.length, payload.worklogs.length]).toEqual([false, null, 1, 1]);
  });

  test("손으로 고친 잘못된 연결 키는 무시한다", async () => {
    const client = new FakeClient([RAW_ISSUE]);
    const payload = await service(sessionOf(client), () => ["PROJ-1156", 'bad key"', "x-1"]).payload();
    expect(client.jqls).toEqual([buildJql("PROJ", ACCOUNT, ["PROJ-1156"])]);
    expect(payload.error).toBeNull();
  });

  test("잘린 워크로그는 이슈별로 더 받는다", async () => {
    const raw = copy(RAW_ISSUE);
    raw.fields.worklog.total = 25;
    const extra = Array.from({ length: 25 }, (_, i) => ({
      id: String(i), author: { displayName: "홍길동" }, started: "2026-09-20T09:00:00.000+0900", timeSpentSeconds: 1800, comment: null,
    }));
    const client = new FakeClient([raw], { extra: { "PROJ-1156": extra } });
    const payload = await service(sessionOf(client)).payload();
    expect(client.worklogCalls).toEqual(["PROJ-1156"]);
    expect(payload.worklogs.length).toBe(25);
  });

  test("TTL 안에서는 다시 묻지 않는다", async () => {
    const client = new FakeClient([RAW_ISSUE]);
    const ticks = [1000, 1050, 1050];
    const s = service(sessionOf(client), undefined, memoryState(), { ttl: 120, clock: () => ticks.shift() });
    await s.payload();
    client.error = new JiraError("호출되면 안 된다");
    expect((await s.payload()).stale).toBe(false);
    expect(client.jqls.length).toBe(1);
  });

  test("TTL 이 지나거나 refresh 면 다시 묻는다", async () => {
    const client = new FakeClient([RAW_ISSUE]);
    const ticks = [1000, 1121, 1122];
    const s = service(sessionOf(client), undefined, memoryState(), { ttl: 120, clock: () => ticks.shift() });
    await s.payload();
    await s.payload();
    await s.payload(true);
    expect(client.jqls.length).toBe(3);
  });

  test("실패하면 캐시(IndexedDB)로 돌아가 stale 표시", async () => {
    const state = memoryState();
    await service(sessionOf(new FakeClient([RAW_ISSUE])), undefined, state).payload();
    expect(state.data.get("jira-cache").issues.length).toBe(1);
    const broken = service(sessionOf(new FakeClient([], { error: new JiraError("Jira 오류 (502)", 502) })), undefined, state);
    const payload = await broken.payload(true);
    expect([payload.stale, payload.error, payload.issues.length]).toEqual([true, "Jira 오류 (502)", 1]);
  });

  test("캐시가 없으면 빈 payload", async () => {
    const payload = await service(sessionOf(new FakeClient([], { error: new JiraError("Jira 연결 실패: timed out") }))).payload();
    expect([payload.issues, payload.worklogs]).toEqual([[], []]);
    expect(payload.error).toContain("연결 실패");
  });

  test("내 accountId 가 payload 에 실린다", async () => {
    const payload = await service(sessionOf(new FakeClient([RAW_ISSUE]))).payload();
    expect(payload.me.accountId).toBe(ACCOUNT);
    expect(payload.worklogs[0].authorId).toBe(ACCOUNT);
  });

  test("익명 응답은 캐시를 빈 결과로 덮지 않는다", async () => {
    const state = memoryState();
    await service(sessionOf(new FakeClient([RAW_ISSUE])), undefined, state).payload();
    const anonymous = new FakeClient([], { authError: new JiraError("Jira 신원 확인 응답에 accountId 가 없다") });
    const payload = await service(sessionOf(anonymous), undefined, state).payload(true);
    expect(anonymous.myselfCalls).toBe(1);
    expect([payload.stale, payload.error, payload.issues.length]).toEqual([true, "Jira 신원 확인 응답에 accountId 가 없다", 1]);
    expect(state.data.get("jira-cache").issues.length).toBe(1);
  });

  test("accountId 없는 신원 응답은 오류", async () => {
    const client = new FakeClient([RAW_ISSUE]);
    client.myself = async () => ({ displayName: "익명" });
    const payload = await service(sessionOf(client)).payload();
    expect([payload.stale, payload.error]).toEqual([true, "Jira 신원 확인 응답에 accountId 가 없다"]);
    expect(client.jqls).toEqual([]);
  });

  test("lookup 은 남의 이슈를 캐시를 건드리지 않고 읽는다", async () => {
    const raw = copy(RAW_ISSUE);
    raw.key = "PROJ-1131";
    raw.fields.assignee = { displayName: "이영희" };
    const client = new FakeClient([raw]);
    const state = memoryState();
    const result = await service(sessionOf(client), () => [], state).lookup(["PROJ-1131"]);
    expect([result.error, result.issues[0].assignee, result.issues[0].duedate]).toEqual([null, "이영희", "2026-10-01"]);
    expect(client.jqls).toEqual(["key in (PROJ-1131) ORDER BY duedate ASC"]);
    expect(state.data.has("jira-cache")).toBe(false);
  });

  test("lookup 은 Jira 오류를 문구로 돌려준다", async () => {
    const client = new FakeClient([], { error: new JiraError("권한 없음 (403)", 403) });
    expect(await service(sessionOf(client), () => []).lookup(["PROJ-1131"])).toEqual({ issues: [], error: "권한 없음 (403)" });
  });

  test("로그인 전이면 끊긴 빈 보드", async () => {
    const payload = await service(sessionOf(null), () => []).payload();
    expect([payload.connected, payload.authError, payload.issues]).toEqual([false, false, []]);
  });

  test("인증 실패면 끊긴 상태 + 캐시를 지운다", async () => {
    const state = memoryState();
    await service(sessionOf(new FakeClient([RAW_ISSUE])), () => [], state).payload();
    const payload = await service(sessionOf(failing(new JiraError("인증 실패 (401)", 401))), () => [], state).payload();
    expect([payload.connected, payload.authError, payload.issues]).toEqual([false, true, []]);
    expect(state.data.has("jira-cache")).toBe(false);
  });

  test("저장된 로그인 값이 깨졌으면 오류 대신 로그인 화면", async () => {
    const s = service(brokenStore, () => []);
    const payload = await s.payload();
    expect([payload.connected, payload.authError, payload.issues]).toEqual([false, true, []]);
    expect(payload.error).toContain("읽지 못했다");
    expect(await s.lookup(["PROJ-1"])).toEqual({ issues: [], error: "저장된 Jira 로그인 정보를 읽지 못했다. 다시 로그인한다" });
  });

  test("다른 Jira 오류는 캐시로 stale", async () => {
    const state = memoryState();
    await service(sessionOf(new FakeClient([RAW_ISSUE])), () => [], state).payload();
    const payload = await service(sessionOf(failing(new JiraError("Jira 연결 실패: x"))), () => [], state).payload();
    expect([payload.connected, payload.stale, payload.issues.length > 0]).toEqual([true, true, true]);
  });
});

describe("JiraSession (session.py)", () => {
  const clientFor = (email, token) => ({
    email, token,
    myself: async () => {
      if (token !== "good") throw new JiraError("인증 실패 (401)", 401);
      return { accountId: "acc-1", displayName: "팀원" };
    },
  });

  test("신원 확인 뒤에만 도메인·이메일·token 을 저장한다(기본 sessionStorage)", async () => {
    const secrets = memorySecrets();
    const session = new JiraSession(secrets, "team.atlassian.net", clientFor);
    expect((await session.login("a@b.c", "good")).displayName).toBe("팀원");
    expect(JSON.parse(secrets.session.get("jira"))).toEqual({ domain: "team.atlassian.net", email: "a@b.c", token: "good" });
    expect(secrets.local.size).toBe(0);
    expect((await session.client()).email).toBe("a@b.c");
  });

  test("'이 브라우저에 기억'이면 localStorage", async () => {
    const secrets = memorySecrets();
    await new JiraSession(secrets, "team.atlassian.net", clientFor).login("a@b.c", "good", { remember: true });
    expect(secrets.local.has("jira")).toBe(true);
    expect(secrets.session.has("jira")).toBe(false);
  });

  test("실패한 로그인은 아무것도 저장하지 않는다", async () => {
    const secrets = memorySecrets();
    await expect(new JiraSession(secrets, "team.atlassian.net", clientFor).login("a@b.c", "bad")).rejects.toBeInstanceOf(JiraError);
    expect([secrets.session.size, secrets.local.size]).toEqual([0, 0]);
  });

  test("다른 도메인 로그인 값은 쓰지 않는다", async () => {
    const secrets = memorySecrets({ jira: JSON.stringify({ domain: "old.atlassian.net", email: "a", token: "good" }) });
    expect(await new JiraSession(secrets, "team.atlassian.net", clientFor).client()).toBeNull();
  });

  test("객체가 아닌 저장 값은 throw(보드가 로그인 화면), JSON 이 깨졌으면 secrets 가 null 이라 로그인 전", async () => {
    const odd = memorySecrets({ jira: JSON.stringify(42) });
    await expect(new JiraSession(odd, "team.atlassian.net", clientFor).client()).rejects.toThrow("읽지 못했다");
    const broken = memorySecrets({ jira: "{broken" });
    expect(await new JiraSession(broken, "team.atlassian.net", clientFor).client()).toBeNull();
  });

  test("web/lib/secrets.js 그대로: 기본 sessionStorage, 기억하면 localStorage, 로그아웃은 둘 다 지운다", async () => {
    const storage = () => {
      const map = new Map();
      return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
    };
    const saved = { sessionStorage: globalThis.sessionStorage, localStorage: globalThis.localStorage };
    const session = storage();
    const local = storage();
    Object.defineProperty(globalThis, "sessionStorage", { value: session, configurable: true, writable: true });
    Object.defineProperty(globalThis, "localStorage", { value: local, configurable: true, writable: true });
    try {
      const secrets = await import("../../../web/lib/secrets.js");
      const key = secrets.PREFIX + "jira";
      const jira = new JiraSession(secrets, "team.atlassian.net", clientFor);
      await jira.login("a@b.c", "good");
      expect(JSON.parse(session.map.get(key))).toEqual({ domain: "team.atlassian.net", email: "a@b.c", token: "good" });
      expect((await jira.client()).token).toBe("good");
      await jira.login("a@b.c", "good", { remember: true });
      expect([session.map.has(key), local.map.has(key)]).toEqual([false, true]);
      expect((await jira.client()).email).toBe("a@b.c");
      await jira.logout();
      expect([session.map.size, local.map.size]).toEqual([0, 0]);
      expect(await jira.client()).toBeNull();
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
      }
    }
  });

  test("로그아웃은 저장 값을 지운다", async () => {
    const secrets = memorySecrets({ jira: JSON.stringify({ domain: "team.atlassian.net", email: "a", token: "good" }) });
    await new JiraSession(secrets, "team.atlassian.net", clientFor).logout();
    expect([secrets.session.size, secrets.local.size]).toEqual([0, 0]);
  });
});

describe("MapStore·DraftStore (store.py · PUT api/drafts)", () => {
  test("설정·해제가 남는다", async () => {
    const state = memoryState();
    const store = new MapStore(state, "links");
    expect(await store.load()).toEqual({});
    expect(await store.set("A", "PROJ-1")).toEqual({ A: "PROJ-1" });
    expect(await new MapStore(state, "links").load()).toEqual({ A: "PROJ-1" });
    expect(await store.set("A", null)).toEqual({});
  });

  test("깨진 값(객체가 아님)은 덮어쓰지 않는다", async () => {
    const state = memoryState({ links: "{broken" });
    await expect(new MapStore(state, "links").set("A", "PROJ-1")).rejects.toThrow("덮어쓰지 않는다");
    expect(state.data.get("links")).toBe("{broken");
  });

  test("문자열이 아닌 값은 읽을 때 버린다", async () => {
    expect(await new MapStore(memoryState({ links: { A: "PROJ-1", B: 3 } }), "links").load()).toEqual({ A: "PROJ-1" });
  });

  test("동시에 쓴 값이 모두 남는다", async () => {
    const store = new MapStore(memoryState(), "status-assign");
    await Promise.all([store.set("A", "완료"), store.set("B", "취소")]);
    expect(await store.load()).toEqual({ A: "완료", B: "취소" });
  });

  test("초안은 {이슈키: {...}} 객체만, 256 KiB 이하", async () => {
    const state = memoryState();
    const drafts = new DraftStore(state);
    expect(await drafts.load()).toEqual({});
    expect(await drafts.save({ "PROJ-1": { start: "2026-01-01", end: "2026-01-02" } })).toBe(1);
    expect(await drafts.load()).toEqual({ "PROJ-1": { start: "2026-01-01", end: "2026-01-02" } });
    await expect(drafts.save([])).rejects.toThrow("초안은");
    await expect(drafts.save({ "PROJ-1": "x" })).rejects.toThrow("초안은");
    await expect(drafts.save({ "PROJ-1": { pad: "x".repeat(300 * 1024) } })).rejects.toThrow("너무 크다");
    expect(Object.keys(await drafts.load())).toEqual(["PROJ-1"]);
  });
});

describe("프록시 호출과 오류 문구 (jira_client._http_get)", () => {
  const reply = (status, body) => async () => new Response(body === undefined ? "" : JSON.stringify(body), { status });

  test("요청은 api/jira 상대 경로·Basic 인증·도메인·Jira 경로를 싣는다", async () => {
    const calls = [];
    const fetch = proxyFetch(async (path, init) => { calls.push([path, init]); return new Response('{"accountId":"a"}'); },
      { domain: "team.atlassian.net", email: "a@b.c", token: "T" });
    expect(await fetch("/rest/api/3/myself")).toEqual({ accountId: "a" });
    const [path, init] = calls[0];
    const url = new URL(path, "http://x/");
    expect(path.startsWith("jira?")).toBe(true);
    expect([url.searchParams.get("domain"), url.searchParams.get("path")]).toEqual(["team.atlassian.net", "/rest/api/3/myself"]);
    expect(init.headers.Authorization).toBe("Basic " + btoa("a@b.c:T"));
    expect(init.method).toBe("GET");
  });

  test("Jira 상태는 로컬판 문구로, token 은 어디에도 없다", async () => {
    const cases = [[401, "인증 실패 (401)"], [403, "권한 없음 (403)"], [404, "리소스 없음 (404)"], [500, "요청 실패 (500)"]];
    for (const [status, message] of cases) {
      const fetch = proxyFetch(reply(status, { jiraStatus: status }), { domain: "d", email: "a", token: "SECRET-TOKEN" });
      const err = await fetch("/rest/api/3/myself").catch((e) => e);
      expect([err instanceof JiraError, err.status, err.message]).toEqual([true, status, message]);
      expect(JSON.stringify(err) + err.message + err.stack).not.toContain("SECRET-TOKEN");
    }
  });

  test("프록시의 연결 실패·시간 초과 문구는 그대로, status 없음", async () => {
    for (const [status, error] of [[502, "Jira 연결 실패: x"], [504, "Jira 응답 시간 초과 (30s)"], [403, "X-Dobbys-Proxy 헤더가 필요하다"]]) {
      const err = await proxyFetch(reply(status, { error }), { domain: "d", email: "a", token: "t" })("/x").catch((e) => e);
      expect([err.status, err.message]).toEqual([null, error]);
    }
    const down = await proxyFetch(async () => { throw new TypeError("Failed to fetch"); }, { domain: "d", email: "a", token: "t" })("/x").catch((e) => e);
    expect(down.message).toBe("Jira 연결 실패: Failed to fetch");
  });

  test("searchAll 은 nextPageToken 으로 페이지마다 다시 부른다", async () => {
    const calls = [];
    const pages = [{ issues: [{ key: "PROJ-1" }], isLast: false, nextPageToken: "T2" }, { issues: [{ key: "PROJ-2" }], isLast: true }];
    const client = new JiraClient(async (path, params) => { calls.push([path, params]); return pages.shift(); });
    expect((await client.searchAll("project = PROJ")).map((i) => i.key)).toEqual(["PROJ-1", "PROJ-2"]);
    expect(calls[1][1].nextPageToken).toBe("T2");
    expect(calls[0][1].maxResults).toBe("100");
  });

  test("한 페이지면 한 번만 부른다", async () => {
    let n = 0;
    await new JiraClient(async () => { n++; return { issues: [], isLast: true }; }).searchAll("x");
    expect(n).toBe(1);
  });

  test("워크로그는 startAt 으로 끝까지 받는다", async () => {
    const calls = [];
    const pages = [
      { total: 25, worklogs: Array.from({ length: 20 }, (_, i) => ({ id: String(i) })) },
      { total: 25, worklogs: Array.from({ length: 5 }, (_, i) => ({ id: String(20 + i) })) },
    ];
    const client = new JiraClient(async (path, params) => { calls.push([path, params]); return pages.shift(); });
    expect((await client.issueWorklogs("PROJ-9")).length).toBe(25);
    expect(calls[1]).toEqual(["/rest/api/3/issue/PROJ-9/worklog", { startAt: "20", maxResults: "100" }]);
  });
});
