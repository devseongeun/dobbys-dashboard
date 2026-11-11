// Jira Cloud REST v3 조회. 로컬판 jira_client.py 이식이다.
// 브라우저는 Jira 를 직접 부르지 못해(CORS) 서버 api/jira 프록시를 거친다. 프록시는 전달만 하고,
// JQL 은 여기서 만든다(프록시는 이 모양만 통과시킨다). Jira 로는 아무것도 쓰지 않는다(GET 만).

export const FIELDS =
  "summary,status,issuetype,priority,assignee,duedate,timespent," +
  "customfield_11481,customfield_11484,customfield_11485,worklog";
// 일정 조정 탭에서 남의 이슈를 끌어올 때 쓴다. 워크로그는 필요 없다.
export const LOOKUP_FIELDS =
  "summary,status,issuetype,priority,assignee,duedate,timespent," +
  "customfield_11481,customfield_11484,customfield_11485";
export const LOOKUP_LIMIT = 50;
export const KEY_RE = /^[A-Z][A-Z0-9]*-\d+$/;
export const PROJECT_RE = /^[A-Z][A-Z0-9_]*$/;
export const ACCOUNT_RE = /^[A-Za-z0-9:_-]+$/;
export const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;
export const TIMEOUT_SECONDS = 30;

// Python repr 과 같은 따옴표(오류 문구를 로컬판과 같게).
function repr(value) {
  const s = String(value);
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  return quote + s.replaceAll("\\", "\\\\").replaceAll(quote, "\\" + quote) + quote;
}

const byKey = (a, b) => {
  const [pa, na] = a.split("-");
  const [pb, nb] = b.split("-");
  return pa < pb ? -1 : pa > pb ? 1 : Number(na) - Number(nb);
};

export function cleanDomain(raw) {
  let text = String(raw ?? "").trim();
  if (text.startsWith("https://")) text = text.slice(8);
  if (text.startsWith("http://")) text = text.slice(7);
  return text.replace(/^\/+|\/+$/g, "").toLowerCase();
}

// 내 담당 이슈 + 수동 연결 이슈. 프로젝트·accountId·키 형식을 검증해 JQL 주입을 막는다.
export function buildJql(project, accountId, linkedKeys) {
  if (!PROJECT_RE.test(project)) throw new Error(`프로젝트 키 형식이 아니다: ${repr(project)}`);
  if (!ACCOUNT_RE.test(accountId || "")) throw new Error("accountId 형식이 아니다");
  for (const key of linkedKeys) if (!KEY_RE.test(key)) throw new Error(`이슈 키 형식이 아니다: ${repr(key)}`);
  const ordered = [...new Set(linkedKeys)].sort(byKey);
  const tail = " ORDER BY duedate ASC";
  const mine = `assignee = "${accountId}"`;
  if (!ordered.length) return `project = ${project} AND ${mine}${tail}`;
  return `project = ${project} AND (${mine} OR key in (${ordered.join(",")}))${tail}`;
}

// 키 목록 조회 JQL. 키 형식을 검증해 JQL 주입을 막는다.
export function buildKeyJql(keys) {
  const unique = new Set(keys);
  if (!unique.size) throw new Error("이슈 키가 없다");
  if (unique.size > LOOKUP_LIMIT) throw new Error(`한 번에 ${LOOKUP_LIMIT}건까지 조회한다`);
  for (const key of unique) if (!KEY_RE.test(key)) throw new Error(`이슈 키 형식이 아니다: ${repr(key)}`);
  return `key in (${[...unique].sort(byKey).join(",")}) ORDER BY duedate ASC`;
}

const BLOCK_TYPES = new Set(["paragraph", "heading", "listItem", "blockquote", "codeBlock"]);

// ADF 문서를 줄바꿈 구분 평문으로 접는다. 화면에 ADF 를 노출하지 않기 위함.
export function adfToText(node) {
  if (node == null) return "";
  if (typeof node === "string") return node;
  const walk = (current) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return [];
    const kind = current.type;
    if (kind === "text") return [current.text ?? ""];
    if (kind === "hardBreak") return ["\n"];
    const parts = [];
    for (const child of current.content || []) parts.push(...walk(child));
    if (BLOCK_TYPES.has(kind)) parts.push("\n");
    return parts;
  };
  return walk(node).join("").split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
}

export class JiraError extends Error {
  constructor(message, status = null) {
    super(message);
    this.status = status;
  }
}

const REASONS = { 401: "인증 실패", 403: "권한 없음", 404: "리소스 없음" };

export function basicAuth(email, token) {
  const bytes = new TextEncoder().encode(`${email}:${token}`);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return "Basic " + btoa(binary);
}

// api/jira 프록시 한 번 부르기 → JSON. 오류 문구는 로컬판 JiraClient._http_get 과 같다.
// apiFetch: web/lib/api.js 의 apiFetch(상대 경로 + X-Dobbys-Proxy 헤더). 테스트는 대역을 넣는다.
export function proxyFetch(apiFetch, { domain, email, token }) {
  const authorization = basicAuth(email, token);
  return async (path, params = {}) => {
    const query = new URLSearchParams({ domain, path, ...params });
    let res;
    try {
      res = await apiFetch("jira?" + query.toString(), {
        method: "GET", headers: { Authorization: authorization, Accept: "application/json" },
        cache: "no-store", credentials: "same-origin",
      });
    } catch (err) {
      throw new JiraError(`Jira 연결 실패: ${err?.message || err}`);
    }
    const body = await res.json().catch(() => null);
    if (res.ok) {
      if (body === null) throw new JiraError("Jira 응답이 JSON 이 아니다");
      return body;
    }
    const status = body && Number.isInteger(body.jiraStatus) ? body.jiraStatus : null;
    if (status !== null) throw new JiraError(`${REASONS[status] || "요청 실패"} (${status})`, status);
    throw new JiraError(body?.error || `요청 실패 (${res.status})`);
  };
}

export class JiraClient {
  // fetch: (path, params) → JSON(proxyFetch). 실패는 JiraError.
  constructor(fetch) {
    this.fetch = fetch;
  }

  // 인증 신원을 확인한다. Jira Cloud 는 잘못된 토큰을 익명으로 처리해 search 에 200 + 0건을 준다.
  // 이 엔드포인트만 401 을 주므로 조회 전에 한 번 불러 '조용한 0건'을 걸러낸다.
  myself() {
    return this.fetch("/rest/api/3/myself");
  }

  // 브라우저가 nextPageToken 으로 한 페이지(최대 100건)씩 다시 부른다(프록시 응답 크기를 작게).
  async searchAll(jql, fields = FIELDS) {
    const issues = [];
    let token = null;
    for (;;) {
      const params = { jql, maxResults: "100", fields };
      if (token) params.nextPageToken = token;
      const payload = await this.fetch("/rest/api/3/search/jql", params);
      issues.push(...(payload.issues || []));
      if (!("isLast" in payload) || payload.isLast) return issues;
      token = payload.nextPageToken;
      if (!token) return issues;
    }
  }

  async issueWorklogs(key, startAt = 0) {
    const logs = [];
    for (;;) {
      const payload = await this.fetch(`/rest/api/3/issue/${key}/worklog`,
        { startAt: String(startAt), maxResults: "100" });
      const batch = payload.worklogs || [];
      logs.push(...batch);
      startAt += batch.length;
      if (!batch.length || startAt >= (payload.total || 0)) return logs;
    }
  }
}
