// Jira 로그인 상태. 로컬판 tabs/wbs/session.py 이식. 키체인 대신 브라우저에 둔다(web/lib/secrets.js):
// 기본 sessionStorage(탭을 닫으면 사라짐), '이 브라우저에 기억'이면 localStorage. 서버에는 저장하지 않는다.
export const KEY = "jira";

// secrets: {getSecret(name), setSecret(name, value, {remember}), clearSecret(name)}
// clientFor(email, token) → JiraClient
export class JiraSession {
  constructor(secrets, domain, clientFor) {
    this.secrets = secrets;
    this.domain = domain;
    this.clientFor = clientFor;
  }

  // 저장 값이 없거나 다른 도메인 것이면 null. 저장 값이 깨졌으면 throw(보드가 로그인 화면을 띄운다).
  async client() {
    const raw = await this.secrets.getSecret(KEY);
    if (raw == null || raw === "") return null;
    let creds;
    try {
      creds = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      throw new Error("저장된 Jira 로그인 정보를 읽지 못했다. 다시 로그인한다");
    }
    if (!creds || typeof creds !== "object") throw new Error("저장된 Jira 로그인 정보를 읽지 못했다. 다시 로그인한다");
    if (creds.domain !== this.domain || !creds.email || !creds.token) return null;
    return this.clientFor(creds.email, creds.token);
  }

  // /myself 로 신원을 확인한 뒤에만 저장한다. 실패하면 JiraError 를 그대로 던지고 아무것도 저장하지 않는다.
  async login(email, token, { remember = false } = {}) {
    const me = await this.clientFor(email, token).myself();
    await this.secrets.setSecret(KEY, { domain: this.domain, email, token }, { remember });
    return me;
  }

  async logout() {
    await this.secrets.clearSecret(KEY);
  }
}
