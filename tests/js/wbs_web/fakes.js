// 테스트 대역: tabState·secrets 를 메모리로.
export function memoryState(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get(name) { return data.has(name) ? structuredClone(data.get(name)) : undefined; },
    async set(name, value) { data.set(name, structuredClone(value)); },
    async remove(name) { data.delete(name); },
  };
}

// web/lib/secrets.js 처럼 값을 JSON 문자열로 넣고 읽을 때 푼다. initial·session·local 은 저장된 문자열 그대로다.
export function memorySecrets(initial = {}) {
  const session = new Map(Object.entries(initial));
  const local = new Map();
  const parse = (raw) => { try { return raw == null ? null : JSON.parse(raw); } catch { return null; } };
  return {
    session, local,
    getSecret: (name) => parse(session.get(name)) ?? parse(local.get(name)),
    setSecret: (name, value, { remember = false } = {}) => {
      session.delete(name);
      local.delete(name);
      (remember ? local : session).set(name, JSON.stringify(value));
    },
    clearSecret: (name) => { session.delete(name); local.delete(name); },
  };
}
