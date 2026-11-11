// 서버 /api/<이름> 호출. 주소는 이 모듈 위치(web/lib/) 기준으로 풀어 사내 서버가 하위 경로(/dashboard/)에 있어도 맞는다.
// X-Dobbys-Proxy: 1 헤더를 늘 붙인다(서버가 없으면 403, 단순 요청 CSRF 방어).
const ROOT = new URL("../", import.meta.url);

export const apiUrl = (path) => new URL("api/" + String(path).replace(/^\/+/, ""), ROOT);

export function apiFetch(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  headers.set("X-Dobbys-Proxy", "1");
  return fetch(apiUrl(path), { credentials: "same-origin", ...init, headers });
}
