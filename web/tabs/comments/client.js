// TROMBONE 웹 기획서 API. 로컬판 tabs/comments/client.py 이식. 브라우저는 TROMBONE 에 직접 가지 않고
// 서버 중계 api/trombone/* 를 부른다(대상 주소는 서버 환경변수 TROMBONE_BASE, 규칙은 api/trombone.py).
// 조회(GET)는 인증이 없고, 반응(POST)은 로그인 token(Bearer)이 필요하다. 오류 문구는 로컬판과 같은 모양이다.

export class TromboneError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = "TromboneError";
    this.status = status;
  }
}

export const NOT_JSON = "기획서 응답이 JSON 이 아니다 · 사내 서버에서 기획서에 닿는지 확인한다";

// apiFetch: web/lib/api.js 의 apiFetch(path, init) (테스트에서 바꿔 끼운다).
export class TromboneClient {
  constructor(apiFetch, base = "") {
    this.apiFetch = apiFetch;
    this.base = base;
  }

  async call(method, path, body = undefined, token = null) {
    const headers = { Accept: "application/json" };
    const init = { method, headers, cache: "no-store" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    if (token) headers.Authorization = "Bearer " + token;
    let res;
    try {
      res = await this.apiFetch("trombone" + path, init);
    } catch (err) {
      throw new TromboneError(`대시보드 서버 연결 실패: ${err?.message ?? err}`);
    }
    const text = await res.text();
    if (!res.ok) {
      let detail = null;
      try { detail = text ? JSON.parse(text) : null; } catch { detail = null; }
      // TROMBONE 이 준 HTTP 오류: 로컬판 "<경로> → HTTP <코드> <message>" 모양.
      if (detail && Number.isInteger(detail.tromboneStatus)) {
        const message = `HTTP ${detail.tromboneStatus}` + (typeof detail.message === "string" && detail.message ? " " + detail.message : "");
        throw new TromboneError(`${path.split("?")[0]} → ${message}`, detail.tromboneStatus);
      }
      // 중계가 거절했거나 TROMBONE 에 닿지 못했다(503 주소 미설정·502 연결 실패·504 시간 초과 등).
      throw new TromboneError(typeof detail?.error === "string" ? detail.error : `대시보드 서버 HTTP ${res.status}`, res.status);
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new TromboneError(NOT_JSON);
    }
  }

  // 서버가 정한 TROMBONE_BASE. 없으면 TromboneError(status 503).
  async config() {
    const res = await this.call("GET", "/config");
    this.base = String(res?.base ?? "");
    return this.base;
  }

  async inbox() {
    return (await this.call("GET", "/comments")) || [];
  }

  bundle(pagePath) {
    return this.call("GET", "/spec?path=" + encodeURIComponent(pagePath));
  }

  login(loginId, password) {
    return this.call("POST", "/auth/login", { loginId, password });
  }

  // 토글 API 다. 이미 붙은 반응에 다시 보내면 떼어진다(호출 전에 확인할 것).
  react(commentId, emoji, token) {
    return this.call("POST", `/spec/comments/${encodeURIComponent(commentId)}/reactions`, { emoji }, token);
  }
}
