// 비밀값(Jira token 등)은 브라우저에만 둔다. 기본은 sessionStorage(창을 닫으면 사라짐), remember=true 면 localStorage.
// 값은 JSON 으로 저장한다. IndexedDB·설정 내보내기에는 들어가지 않는다.
export const PREFIX = "dobbys-dashboard:secret:";

const area = (name) => {
  try { return globalThis[name] ?? null; } catch { return null; }  // 저장소가 막힌 창이면 접근 자체가 예외다
};

function read(storage, key) {
  try {
    const raw = storage?.getItem(key);
    return raw === null || raw === undefined ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

// 세션 값이 먼저다(이번 창에서 새로 로그인했으면 그 값을 쓴다).
export function getSecret(name) {
  const key = PREFIX + name;
  return read(area("sessionStorage"), key) ?? read(area("localStorage"), key);
}

export function setSecret(name, value, { remember = false } = {}) {
  const key = PREFIX + name;
  const keep = area(remember ? "localStorage" : "sessionStorage");
  const other = area(remember ? "sessionStorage" : "localStorage");
  if (!keep) throw new Error("브라우저 저장소를 쓸 수 없다");
  keep.setItem(key, JSON.stringify(value));
  try { other?.removeItem(key); } catch { /* 다른 쪽이 막혀 있으면 지울 것도 없다 */ }
}

export function clearSecret(name) {
  const key = PREFIX + name;
  for (const storage of [area("sessionStorage"), area("localStorage")]) {
    try { storage?.removeItem(key); } catch { /* 막힌 저장소 */ }
  }
}
