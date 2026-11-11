// Jira 응답을 화면이 바로 쓰는 형태로 정규화하고 캐시한다. 로컬판 tabs/wbs/board.py 이식.
// 캐시는 메모리 + IndexedDB(<project>/wbs/jira-cache). TTL·무효화·실패 시 캐시 표시 규칙은 로컬판과 같다.
import { FIELDS, JiraError, KEY_RE, LOOKUP_FIELDS, adfToText, buildJql, buildKeyJql } from "./jira.js";

export const TTL_SECONDS = 120;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const get = (obj, key) => (isObject(obj) && obj[key] !== undefined ? obj[key] : null);
const name = (value, key = "name") => get(value, key);

export function normalizeIssue(raw) {
  const fields = get(raw, "fields") || {};
  const status = get(fields, "status") || {};
  return {
    key: get(raw, "key"),
    summary: get(fields, "summary"),
    status: name(status),
    statusCategory: name(get(status, "statusCategory") || {}),
    issuetype: name(get(fields, "issuetype")),
    priority: name(get(fields, "priority")),
    assignee: name(get(fields, "assignee"), "displayName"),
    planStart: get(fields, "customfield_11481"),
    actualStart: get(fields, "customfield_11484"),
    actualEnd: get(fields, "customfield_11485"),
    duedate: get(fields, "duedate"),
    timeSpentSeconds: get(fields, "timespent") || 0,
  };
}

export function normalizeWorklog(issueKey, raw) {
  const started = get(raw, "started") || "";
  return {
    id: get(raw, "id"),
    issueKey,
    author: name(get(raw, "author"), "displayName"),
    authorId: name(get(raw, "author"), "accountId"),
    started: started.slice(0, 10),
    startedAt: started,
    seconds: get(raw, "timeSpentSeconds") || 0,
    comment: adfToText(get(raw, "comment")),
  };
}

export const EMPTY = Object.freeze({
  fetchedAt: null, stale: false, error: null,
  me: { accountId: null, displayName: null }, issues: [], worklogs: [],
});
const empty = () => structuredClone(EMPTY);

// 로컬 시각 + 오프셋, 초 단위(Python datetime.now().astimezone().isoformat(timespec="seconds") 와 같은 모양).
export function localIso(date = new Date()) {
  const pad = (n) => String(Math.trunc(Math.abs(n))).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${offset >= 0 ? "+" : "-"}${pad(offset / 60)}:${pad(offset % 60)}`;
}

// session.client() → JiraClient | null(로그인 전). 저장된 값을 못 읽으면 throw(로그인 화면으로).
// cache: {read() → payload|null, write(payload), clear()} — IndexedDB. 실패는 조용히 넘긴다(로컬판 파일 캐시와 같다).
export class BoardService {
  constructor(session, project, linkedKeys, cache, { ttl = TTL_SECONDS, clock = () => Date.now() / 1000, now = localIso } = {}) {
    this.session = session;
    this.project = project;
    this.linkedKeys = linkedKeys;
    this.cache = cache;
    this.ttl = ttl;
    this.clock = clock;
    this.now = now;
    this.memo = null;
    this.memoAt = 0;
  }

  async invalidate() {
    this.memo = null;
    try { await this.cache.clear(); } catch { /* 캐시는 없어도 된다 */ }
  }

  async payload(refresh = false) {
    let client;
    try {
      client = await this.session.client();
    } catch (err) {
      // 깨진 저장 값은 다시 로그인하면 덮어쓴다. 로그인 화면을 보여 준다.
      return { ...empty(), connected: false, authError: true, error: String(err?.message || err) };
    }
    if (!client) return { ...empty(), connected: false, authError: false };
    const now = this.clock();
    if (!refresh && this.memo && now - this.memoAt < this.ttl) return this.memo;
    let built;
    try {
      built = await this.build(client);
    } catch (err) {
      if (!(err instanceof JiraError)) throw err;
      if (err.status === 401 || err.status === 403) {
        await this.invalidate();
        return { ...empty(), connected: false, authError: true, error: err.message };
      }
      return this.fallback(err.message);
    }
    this.memo = built;
    this.memoAt = now;
    try { await this.cache.write(built); } catch { /* 캐시 쓰기 실패는 화면에 영향 없다 */ }
    return built;
  }

  async build(client) {
    // 익명 폴백 방지: 신원 확인이 실패하면 조회 결과(200 + 0건)를 믿지 않는다.
    const me = await client.myself();
    if (!get(me, "accountId")) throw new JiraError("Jira 신원 확인 응답에 accountId 가 없다");
    const keys = (await this.linkedKeys()).filter((k) => typeof k === "string" && KEY_RE.test(k));
    const jql = buildJql(this.project, me.accountId, keys);
    const issues = [];
    const worklogs = [];
    for (const raw of await client.searchAll(jql, FIELDS)) {
      issues.push(normalizeIssue(raw));
      const key = get(raw, "key");
      const block = get(get(raw, "fields") || {}, "worklog") || {};
      let entries = block.worklogs || [];
      if ((block.total || 0) > (block.maxResults || 0)) entries = await client.issueWorklogs(key);
      for (const entry of entries) worklogs.push(normalizeWorklog(key, entry));
    }
    return {
      fetchedAt: this.now(), stale: false, error: null, connected: true, authError: false,
      me: { accountId: get(me, "accountId"), displayName: get(me, "displayName") },
      issues, worklogs,
    };
  }

  // 지정 키의 이슈를 읽기 전용으로 조회한다(담당자 무관, 캐시 없음). 키 형식이 틀리면 Error.
  async lookup(keys) {
    let client;
    try {
      client = await this.session.client();
    } catch (err) {
      return { issues: [], error: String(err?.message || err) };
    }
    if (!client) return { issues: [], error: "Jira 로그인이 필요하다" };
    const jql = buildKeyJql(keys);
    try {
      const raw = await client.searchAll(jql, LOOKUP_FIELDS);
      return { issues: raw.map(normalizeIssue), error: null };
    } catch (err) {
      if (!(err instanceof JiraError)) throw err;
      return { issues: [], error: err.message };
    }
  }

  async fallback(message) {
    let cached = this.memo;
    if (!cached) {
      try { cached = await this.cache.read(); } catch { cached = null; }
    }
    if (isObject(cached)) return { ...cached, stale: true, error: message };
    return { ...empty(), connected: true, authError: false, stale: true, error: message };
  }
}
