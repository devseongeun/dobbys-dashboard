// 브라우저 저장소(IndexedDB, DB 이름 dobbys-dashboard). 설정·탭별 개인 상태·캐시를 둔다. 비밀값은 secrets.js(세션·로컬 저장소)에 둔다.
// - 설정: config 저장소의 "current" 레코드 {version, project, tabs, order}. 형식·버전이 틀리면 "broken-<시각>" 으로 옮기고 null(온보딩을 다시 띄운다).
// - 탭 상태: state 저장소의 키 "<project>/<tabId>/<name>". 프로젝트 이름을 바꾸면 빈 상태, 돌아오면 그대로다.
// - 값은 structured clone 이 되는 값이면 된다(FSA 핸들 포함).
import { isHandle } from "./fsa.js";

export const DB_NAME = "dobbys-dashboard";
export const FORMAT = "dobbys-dashboard-web";
const VERSION = 1;
const CONFIG = "config";
const STATE = "state";
const CURRENT = "current";

// 저장 계층. 브라우저에서는 IndexedDB, 테스트에서는 memoryBackend() 를 useBackend 로 끼운다.
function idbBackend() {
  let opened = null;
  const db = () => opened ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("이 브라우저에는 IndexedDB 가 없다")); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      for (const name of [CONFIG, STATE]) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 를 열지 못했다"));
    request.onblocked = () => reject(new Error("IndexedDB 가 다른 탭에 막혀 있다"));
  }).catch((error) => { opened = null; throw error; });
  const run = async (store, mode, work) => {
    const tx = (await db()).transaction(store, mode);
    const result = work(tx.objectStore(store));
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB 쓰기가 취소됐다"));
    });
  };
  return {
    get: (store, key) => run(store, "readonly", (s) => s.get(key)),
    put: (store, key, value) => run(store, "readwrite", (s) => { s.put(value, key); }),
    delete: (store, key) => run(store, "readwrite", (s) => { s.delete(key); }),
    async entries(store) {
      let keys, values;
      await run(store, "readonly", (s) => {
        const k = s.getAllKeys();
        const v = s.getAll();
        k.onsuccess = () => { keys = k.result; };
        v.onsuccess = () => { values = v.result; };
      });
      return keys.map((key, i) => [key, values[i]]);
    },
    // 설정 옮기기(broken)처럼 두 키를 한 번에 바꾼다.
    replace: (store, changes) => run(store, "readwrite", (s) => {
      for (const [key, value] of changes) if (value === undefined) s.delete(key); else s.put(value, key);
    }),
  };
}

// clone=false 는 함수가 든 가짜 핸들을 그대로 두는 테스트용이다.
export function memoryBackend({ clone = true } = {}) {
  const stores = { [CONFIG]: new Map(), [STATE]: new Map() };
  const copy = (value) => (value === undefined || !clone ? value : structuredClone(value));
  return {
    stores,
    async get(store, key) { return copy(stores[store].get(key)); },
    async put(store, key, value) { stores[store].set(key, copy(value)); },
    async delete(store, key) { stores[store].delete(key); },
    async entries(store) { return [...stores[store]].map(([key, value]) => [key, copy(value)]); },
    async replace(store, changes) { for (const [key, value] of changes) if (value === undefined) stores[store].delete(key); else stores[store].set(key, copy(value)); },
  };
}

let backend = null;
const be = () => (backend ??= idbBackend());
export function useBackend(next) { backend = next; }

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value) && !isHandle(value);

function validRecord(record) {
  return isPlainObject(record) && record.version === VERSION && typeof record.project === "string" && record.project !== ""
    && isPlainObject(record.tabs) && (record.order === undefined || Array.isArray(record.order));
}

// {project, tabs: {<id>: values}, order} | null.
export async function loadConfig() {
  const record = await be().get(CONFIG, CURRENT);
  if (record === undefined) return null;
  if (!validRecord(record)) {
    const aside = `broken-${Date.now()}`;
    await be().replace(CONFIG, [[aside, record], [CURRENT, undefined]]);
    console.warn(`[dobbys-dashboard] 설정 레코드를 읽지 못해 ${aside} 로 옮겼다`);
    return null;
  }
  return { project: record.project, tabs: record.tabs, order: Array.isArray(record.order) ? record.order : [] };
}

// 트랜잭션 한 번으로 통째로 쓴다. 실패하면 예외(셸이 "저장 실패: …" 를 보인다).
export async function saveConfig(config) {
  const record = { version: VERSION, project: config.project, tabs: config.tabs, order: Array.isArray(config.order) ? config.order : [] };
  if (!validRecord(record)) throw new Error("설정 형식이 아니다");
  await be().put(CONFIG, CURRENT, record);
}

export const stateKey = (project, tabId, name) => `${project}/${tabId}/${name}`;

// 탭 하나의 개인 상태. 지금 프로젝트 이름 아래에 둔다.
export function tabState(tabId) {
  const key = async (name) => {
    const config = await loadConfig();
    if (!config) throw new Error("설정이 먼저다");
    return stateKey(config.project, tabId, name);
  };
  return {
    get: async (name) => be().get(STATE, await key(name)),
    set: async (name, value) => be().put(STATE, await key(name), value),
    remove: async (name) => be().delete(STATE, await key(name)),
  };
}

// 내보내기: 핸들은 {"$handle": 종류, name} 으로만 남긴다(권한·위치는 옮길 수 없다).
// 비밀값은 IndexedDB 에 두지 않지만, 혹시 이름이 비밀값처럼 보이는 상태 키는 싣지 않는다.
const SECRET_NAME = /(secret|token|password|credential)/i;

function toPortable(value) {
  if (isHandle(value)) return { $handle: value.kind, name: value.name };
  if (Array.isArray(value)) return value.map(toPortable);
  if (isPlainObject(value) && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toPortable(item)]));
  }
  return value;
}

const isPlaceholder = (value) => isPlainObject(value) && typeof value.$handle === "string";

// 가져오기: 핸들 자리는 비운다(null). missing 에 어느 칸을 다시 골라야 하는지 적는다.
function fromPortable(value, path, missing) {
  if (isPlaceholder(value)) { missing.push(path); return null; }
  if (Array.isArray(value)) {
    const items = value.map((item, i) => fromPortable(item, `${path}[${i}]`, missing));
    return items.some((item, i) => item === null && isPlaceholder(value[i])) ? items.filter((item) => item !== null) : items;
  }
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fromPortable(item, path ? `${path}.${key}` : key, missing)]));
  return value;
}

export async function exportAll() {
  const config = await loadConfig();
  const state = {};
  for (const [key, value] of await be().entries(STATE)) {
    if (typeof key !== "string" || SECRET_NAME.test(key.split("/").at(-1))) continue;
    state[key] = toPortable(value);
  }
  return { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), config: config ? toPortable(config) : null, state };
}

// 가져온 설정으로 바꾼다. 반환: {project, missing: ["<tabId>.<key>", …]}(폴더·파일은 이 브라우저에서 다시 골라야 한다).
export async function importAll(data) {
  if (!isPlainObject(data) || data.format !== FORMAT || data.version !== VERSION) throw new Error("도비의 대시보드(웹) 설정 파일이 아니다");
  const config = data.config;
  if (!isPlainObject(config) || typeof config.project !== "string" || !config.project || !isPlainObject(config.tabs)) {
    throw new Error("설정 파일에 프로젝트·탭 설정이 없다");
  }
  const missing = [];
  const tabs = fromPortable(config.tabs, "", missing);
  await saveConfig({ project: config.project, tabs, order: Array.isArray(config.order) ? config.order.filter((id) => typeof id === "string") : [] });
  const state = isPlainObject(data.state) ? data.state : {};
  for (const [key, value] of Object.entries(state)) {
    if (key.split("/").length < 3 || SECRET_NAME.test(key.split("/").at(-1))) continue;
    await be().put(STATE, key, fromPortable(value, key, []));
  }
  return { project: config.project, missing };
}
