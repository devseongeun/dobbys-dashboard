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

export function memorySecrets(initial = {}) {
  const session = new Map(Object.entries(initial));
  const local = new Map();
  return {
    session, local,
    getSecret: (name) => session.get(name) ?? local.get(name) ?? null,
    setSecret: (name, value, { remember = false } = {}) => {
      session.delete(name);
      local.delete(name);
      (remember ? local : session).set(name, value);
    },
    clearSecret: (name) => { session.delete(name); local.delete(name); },
  };
}
