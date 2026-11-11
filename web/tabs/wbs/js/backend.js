// 로컬판 tabs/wbs/serve.py 의 GET/PUT/POST api/* 를 브라우저 안에서 대신한다.
// 엑셀은 파일 핸들에서 직접 읽고(서버로 보내지 않음), 개인 상태는 IndexedDB, Jira 는 api/jira 프록시.
// 돌려주는 모양과 오류 문구는 로컬판 응답과 같아서 app.js 는 fetch 대신 이것만 부른다.
import { JiraClient, JiraError, KEY_RE, cleanDomain, proxyFetch } from "./jira.js";
import { matchKeys } from "./matching.js";
import { BoardService } from "./service.js";
import { JiraSession } from "./session.js";
import { DraftStore, MapStore, cacheOf } from "./stores.js";
import { WbsSource, readFailure } from "./xlsx.js";

export const WBS = "wbs";
export const JIRA = "jira";
export const DEFAULT_SHEET = "TROMBONE_v4.0.0_WBS(작업)";
// 보드 칸(state.js STATUSES). Jira 상태가 이 다섯이 아닌 행(보드의 '기타')만 사용자가 칸을 지정한다.
export const BOARD_STATUSES = ["할 일", "진행", "개발완료", "완료", "취소"];

// 일정 기준 필드가 생기기 전 설정에는 mode 가 없다. 그때는 엑셀 기준이었다.
export const modeOf = (settings) => settings?.mode || WBS;

class NoWbs {
  async load() { return { tasks: [], holidays: {} }; }
}

// settings: 탭 설정(mode, workbook=파일 핸들, owner, sheet, jira_domain, jira_project)
// state: tabState('wbs'), secrets: web/lib/secrets.js, apiFetch: web/lib/api.js
export function createBackend({ settings, state, secrets, apiFetch, io = {}, clock, now, source: given }) {
  const domain = cleanDomain(settings.jira_domain);
  const mode = modeOf(settings);
  const source = given || (mode === WBS
    ? new WbsSource(settings.workbook, settings.sheet || DEFAULT_SHEET, settings.owner || "", io)
    : new NoWbs());
  const links = new MapStore(state, "links");
  const assigns = new MapStore(state, "status-assign");
  const drafts = new DraftStore(state);
  const clientFor = (email, token) => new JiraClient(proxyFetch(apiFetch, { domain, email, token }));
  const session = new JiraSession(secrets, domain, clientFor);
  const options = {};
  if (clock) options.clock = clock;
  if (now) options.now = now;
  const service = new BoardService(session, settings.jira_project, async () =>
    [...new Set(Object.values(await links.load()))].sort(), cacheOf(state), options);

  async function readWbs() {
    try {
      return [await source.load(), null];
    } catch (err) {
      return [{ tasks: [], holidays: {} }, `WBS 엑셀을 읽지 못했다: ${readFailure(err)}`];
    }
  }

  return {
    domain, mode, service, session, source,

    // GET api/wbs
    async wbs() {
      const [wbs, error] = await readWbs();
      return { ...wbs, error };
    },

    // GET api/board[?refresh=1]
    async board(refresh = false) {
      const payload = await service.payload(refresh);
      const [wbs] = await readWbs();
      return {
        ...payload, domain, mode,
        links: matchKeys(wbs.tasks, payload.issues || [], await links.load()),
        assigned: await assigns.load(),
      };
    },

    // GET api/issues?keys=
    async issues(keys) {
      try {
        return await service.lookup(keys);
      } catch (err) {
        return { issues: [], error: err.message };
      }
    },

    // GET/PUT api/drafts
    loadDrafts: () => drafts.load(),
    saveDrafts: (value) => drafts.save(value),

    // PUT api/links {task, key|null}. 실패는 Error(문구는 로컬판과 같다).
    async setLink(task, key) {
      const [wbs] = await readWbs();
      if (!wbs.tasks.some((t) => t.id === task)) throw new Error("WBS 에 없는 요구사항ID 다");
      if (key != null && (typeof key !== "string" || !KEY_RE.test(key))) {
        throw new Error("이슈 키 형식이 아니다 (예: PROJ-1234)");
      }
      const saved = await links.set(task, key);
      await service.invalidate();
      return { links: saved };
    },

    // PUT api/assign {key, status|null}
    async assign(key, status) {
      // 행 키는 Jira 이슈키이거나, Jira 에 연결되지 않은 WBS 행의 요구사항ID 다(model.js joinRows).
      const valid = typeof key === "string" && (KEY_RE.test(key) || (await readWbs())[0].tasks.some((t) => t.id === key));
      if (!valid) throw new Error("이슈키나 WBS 요구사항ID 가 아니다");
      if (status != null && !BOARD_STATUSES.includes(status)) {
        throw new Error("상태는 " + BOARD_STATUSES.join("·") + " 중 하나다");
      }
      return { assigned: await assigns.set(key, status) };
    },

    // POST api/login {email, token} + '이 브라우저에 기억'
    async login(email, token, { remember = false } = {}) {
      email = String(email || "").trim();
      token = String(token || "").trim();
      if (!email || !token) throw new Error("이메일과 API token 을 입력한다");
      let me;
      try {
        me = await session.login(email, token, { remember });
      } catch (err) {
        if (err instanceof JiraError && (err.status === 401 || err.status === 403)) {
          throw new Error("Jira 인증 실패: 이메일·API token 을 확인한다");
        }
        throw err;
      }
      await service.invalidate();
      return { displayName: me?.displayName ?? null };
    },

    // POST api/logout
    async logout() {
      await session.logout();
      await service.invalidate();
      return {};
    },
  };
}
