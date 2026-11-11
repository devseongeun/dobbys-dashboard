// 로컬판 tests/test_wbs_serve.py 의 API 동작을 브라우저 계층(backend.js)에서 같은 입력·기대값으로 본다.
// Jira 는 api/jira 프록시 대역(목업 응답)으로, 실제 계정·네트워크를 쓰지 않는다.
import { describe, expect, test } from "bun:test";
import { createBackend } from "../../../web/tabs/wbs/js/backend.js";
import { memorySecrets, memoryState } from "./fakes.js";

const TASKS = [{ id: "A-1", d1: "공통", d2: "대시보드", d3: null, name: "대시보드", jira: null }];
const ISSUE = { key: "PROJ-9", fields: { summary: "공통 - 대시보드 - 대시보드", status: { name: "진행" }, worklog: { total: 0, maxResults: 20, worklogs: [] } } };
const GOOD = "Basic " + btoa("a@b.c:good");

// api/jira 대역: token 이 good 이면 통과, 아니면 Jira 401.
function mockProxy(calls = []) {
  return async (path, init) => {
    const url = new URL(path, "http://x/");
    calls.push({ path: url.searchParams.get("path"), jql: url.searchParams.get("jql"), auth: init.headers.Authorization });
    if (init.headers.Authorization !== GOOD) return new Response(JSON.stringify({ jiraStatus: 401 }), { status: 401 });
    if (url.searchParams.get("path") === "/rest/api/3/myself") return Response.json({ accountId: "acc-1", displayName: "팀원" });
    return Response.json({ issues: [ISSUE], isLast: true });
  };
}

function setup({ source, error, secrets = memorySecrets(), state = memoryState(), mode = "wbs" } = {}) {
  const calls = [];
  const backend = createBackend({
    settings: { mode, jira_domain: "https://Team.atlassian.net/", jira_project: "PROJ", owner: "홍길동", sheet: "S" },
    state, secrets, apiFetch: mockProxy(calls),
    source: source || { load: async () => { if (error) throw error; return { tasks: structuredClone(TASKS), holidays: {} }; } },
  });
  return { backend, calls, state, secrets };
}

const loggedIn = () => memorySecrets({ jira: JSON.stringify({ domain: "team.atlassian.net", email: "a@b.c", token: "good" }) });

describe("backend (serve.py 대신)", () => {
  test("도메인은 https:// 와 끝 / 를 떼고 소문자", () => {
    expect(setup().backend.domain).toBe("team.atlassian.net");
  });

  test("api/wbs: 행과 error=null", async () => {
    const body = await setup().backend.wbs();
    expect([body.tasks[0].id, body.error]).toEqual(["A-1", null]);
  });

  test("깨진 엑셀은 행 없이 'WBS 엑셀을 읽지 못했다' 오류", async () => {
    const body = await setup({ error: new Error("File is not a zip file") }).backend.wbs();
    expect(body.tasks).toEqual([]);
    expect(body.error).toBe("WBS 엑셀을 읽지 못했다: File is not a zip file");
  });

  test("파일 권한이 없으면 원인에 다시 연결 안내", async () => {
    const denied = Object.assign(new Error("x"), { name: "NotAllowedError" });
    expect((await setup({ error: denied }).backend.wbs()).error).toContain("다시 연결");
  });

  test("Jira 기준이면 엑셀 없이 행이 없다", async () => {
    const backend = createBackend({ settings: { mode: "jira", jira_domain: "team.atlassian.net", jira_project: "PROJ" },
      state: memoryState(), secrets: memorySecrets(), apiFetch: mockProxy() });
    expect(await backend.wbs()).toEqual({ tasks: [], holidays: {}, error: null });
  });

  test("api/board: 로그인 전이면 끊긴 빈 보드 + 도메인·mode", async () => {
    const { backend, calls } = setup();
    const body = await backend.board();
    expect([body.connected, body.authError, body.domain, body.mode, body.links]).toEqual([false, false, "team.atlassian.net", "wbs", {}]);
    expect(calls).toEqual([]);
  });

  test("api/board: 로그인돼 있으면 자동 연결된 links 가 실린다", async () => {
    const { backend, calls } = setup({ secrets: loggedIn() });
    const body = await backend.board(true);
    expect([body.connected, body.links, body.me.displayName]).toEqual([true, { "A-1": "PROJ-9" }, "팀원"]);
    expect(calls.map((c) => c.path)).toEqual(["/rest/api/3/myself", "/rest/api/3/search/jql"]);
  });

  test("연결: 검사·저장·캐시 무효화, 해제", async () => {
    const { backend, calls, state } = setup({ secrets: loggedIn() });
    await expect(backend.setLink("없음", "PROJ-1")).rejects.toThrow("WBS 에 없는 요구사항ID 다");
    await expect(backend.setLink("A-1", "proj 1")).rejects.toThrow("이슈 키 형식이 아니다 (예: PROJ-1234)");
    await backend.board();
    expect(state.data.has("jira-cache")).toBe(true);
    expect(await backend.setLink("A-1", "PROJ-100")).toEqual({ links: { "A-1": "PROJ-100" } });
    expect(state.data.has("jira-cache")).toBe(false);
    expect(state.data.get("links")).toEqual({ "A-1": "PROJ-100" });
    const body = await backend.board();
    expect(body.links).toEqual({ "A-1": "PROJ-100" });
    expect(calls.at(-1).jql).toBe('project = PROJ AND (assignee = "acc-1" OR key in (PROJ-100)) ORDER BY duedate ASC');
    expect((await backend.setLink("A-1", null)).links).toEqual({});
  });

  test("깨진 연결 값은 덮지 않고 오류", async () => {
    const { backend, state } = setup({ state: memoryState({ links: ["broken"] }) });
    await expect(backend.setLink("A-1", "PROJ-100")).rejects.toThrow("links 을 읽지 못해 덮어쓰지 않는다");
    expect(state.data.get("links")).toEqual(["broken"]);
  });

  test("칸 지정: 검사·저장·보드에 실림, 캐시는 그대로", async () => {
    const { backend, state } = setup({ secrets: loggedIn() });
    await backend.board();
    await expect(backend.assign("없음", "진행")).rejects.toThrow("이슈키나 WBS 요구사항ID 가 아니다");
    await expect(backend.assign("PROJ-9", "검토")).rejects.toThrow("상태는 할 일·진행·개발완료·완료·취소 중 하나다");
    expect(await backend.assign("PROJ-9", "진행")).toEqual({ assigned: { "PROJ-9": "진행" } });
    expect((await backend.assign("A-1", "완료")).assigned).toEqual({ "PROJ-9": "진행", "A-1": "완료" });
    expect((await backend.board()).assigned).toEqual({ "PROJ-9": "진행", "A-1": "완료" });
    expect((await backend.assign("PROJ-9", null)).assigned).toEqual({ "A-1": "완료" });
    expect(state.data.has("jira-cache")).toBe(true);
  });

  test("초안 왕복", async () => {
    const { backend, state } = setup();
    const drafts = { "PROJ-1": { start: "2026-11-03", end: "2026-11-05" } };
    expect(await backend.saveDrafts(drafts)).toBe(1);
    expect(await backend.loadDrafts()).toEqual(drafts);
    expect(state.data.get("plan-drafts")).toEqual(drafts);
  });

  test("로그인: 빈 칸·인증 실패 문구, 성공하면 저장하고 캐시 무효화", async () => {
    const { backend, secrets, state } = setup();
    await expect(backend.login("", "x")).rejects.toThrow("이메일과 API token 을 입력한다");
    await expect(backend.login("a@b.c", "bad")).rejects.toThrow("Jira 인증 실패: 이메일·API token 을 확인한다");
    expect([secrets.session.size, secrets.local.size]).toEqual([0, 0]);
    await state.set("jira-cache", { issues: [] });
    expect(await backend.login(" a@b.c ", " good ")).toEqual({ displayName: "팀원" });
    expect(JSON.parse(secrets.session.get("jira")).token).toBe("good");
    expect(state.data.has("jira-cache")).toBe(false);
    expect((await backend.board()).connected).toBe(true);
  });

  test("로그인 기억 체크는 localStorage 로", async () => {
    const { backend, secrets } = setup();
    await backend.login("a@b.c", "good", { remember: true });
    expect([secrets.session.has("jira"), secrets.local.has("jira")]).toEqual([false, true]);
  });

  test("로그아웃은 저장 값과 캐시를 지운다", async () => {
    const { backend, secrets, state } = setup({ secrets: loggedIn() });
    await backend.board();
    await backend.logout();
    expect([secrets.session.size, secrets.local.size, state.data.has("jira-cache")]).toEqual([0, 0, false]);
    expect((await backend.board()).connected).toBe(false);
  });

  test("Jira 401 이면 끊긴 상태(authError)", async () => {
    const secrets = memorySecrets({ jira: JSON.stringify({ domain: "team.atlassian.net", email: "a@b.c", token: "expired" }) });
    const body = await setup({ secrets }).backend.board();
    expect([body.connected, body.authError, body.error]).toEqual([false, true, "인증 실패 (401)"]);
  });

  test("api/issues: 키 조회와 잘못된 키 오류", async () => {
    const { backend, calls } = setup({ secrets: loggedIn() });
    expect((await backend.issues(["PROJ-9"])).issues[0].key).toBe("PROJ-9");
    expect(calls.at(-1).jql).toBe("key in (PROJ-9) ORDER BY duedate ASC");
    expect(await backend.issues(["bad"])).toEqual({ issues: [], error: "이슈 키 형식이 아니다: 'bad'" });
  });
});
