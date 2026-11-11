// wbs 탭 개인 상태(IndexedDB, web/lib/store.js tabState('wbs')). 로컬판 tabs/wbs/store.py·serve.py 의 쓰기 검사 이식.
// links: 요구사항ID → Jira 이슈키 수동 연결, status-assign: 행 키 → 보드 칸 지정, plan-drafts: 일정 조정 초안,
// jira-cache: Jira 응답 캐시.

const isObject = (v) => Object.prototype.toString.call(v) === "[object Object]";

export const DRAFTS_MAX_BYTES = 256 * 1024;

// 읽기~쓰기를 한 덩어리로 줄 세운다(로컬판 store.py MapStore 의 threading.Lock).
// 같은 출처의 다른 창·탭까지 막으려고 Web Locks(navigator.locks)를 쓴다. 없으면(테스트·보안 맥락이 아닌 페이지)
// 이 페이지 안의 이름별 큐로 줄 세운다. 큐가 인스턴스가 아니라 모듈에 있어서 같은 페이지의 두 인스턴스도 막힌다.
const pending = new Map();

export function withLock(name, work, locks = globalThis.navigator?.locks) {
  if (locks && typeof locks.request === "function") return locks.request(name, { mode: "exclusive" }, () => work());
  const run = (pending.get(name) ?? Promise.resolve()).then(() => work());
  const tail = run.catch(() => {});
  pending.set(name, tail);
  tail.then(() => { if (pending.get(name) === tail) pending.delete(name); });
  return run;
}

// 문자열 → 문자열 개인 매핑. 저장 값이 객체가 아니면(깨짐) 덮어쓰지 않는다.
// 잠금 이름은 탭·키 단위(dobbys-dashboard/wbs/<name>)다. 프로젝트가 달라도 같은 잠금을 쓰지만 쓰기가 드물어 상관없다.
export class MapStore {
  constructor(state, name, { locks } = {}) {
    this.state = state;
    this.name = name;
    this.lockName = `dobbys-dashboard/wbs/${name}`;
    this.locks = locks;
  }

  async load() {
    const raw = await this.state.get(this.name);
    if (!isObject(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([k, v]) => typeof k === "string" && typeof v === "string"));
  }

  set(key, value) {
    return withLock(this.lockName, async () => {
      const raw = await this.state.get(this.name);
      if (raw !== undefined && raw !== null && !isObject(raw)) {
        throw new Error(`${this.name} 을 읽지 못해 덮어쓰지 않는다`);
      }
      const data = await this.load();
      if (value) data[key] = value;
      else delete data[key];
      await this.state.set(this.name, data);
      return data;
    }, this.locks);
  }
}

// 일정 조정 초안 {이슈키: {...}}. 저장 전에 로컬판 PUT api/drafts 와 같은 모양·크기 검사를 한다.
// 로컬판처럼 화면이 가진 초안 전체를 한 번에 바꿔 쓴다(읽기~수정~쓰기가 아니라 put 한 번이라 쓰는 도중 섞이지 않는다).
// 두 창이 각자 초안을 고치면 나중 저장이 이긴다. 로컬판 두 창도 같다.
export class DraftStore {
  constructor(state, name = "plan-drafts") {
    this.state = state;
    this.name = name;
  }

  async load() {
    const raw = await this.state.get(this.name);
    return raw == null ? {} : raw;
  }

  async save(drafts) {
    if (!isObject(drafts) || !Object.values(drafts).every(isObject)) {
      throw new Error("초안은 {이슈키: {...}} 객체여야 한다");
    }
    const size = new TextEncoder().encode(JSON.stringify(drafts)).length;
    if (size > DRAFTS_MAX_BYTES) throw new Error(`초안이 너무 크다 (${DRAFTS_MAX_BYTES / 1024} KiB 까지)`);
    await this.state.set(this.name, structuredClone(drafts));
    return Object.keys(drafts).length;
  }
}

// BoardService 의 cache 인터페이스.
export function cacheOf(state, name = "jira-cache") {
  return {
    read: async () => (await state.get(name)) ?? null,
    write: (payload) => state.set(name, structuredClone(payload)),
    clear: () => state.remove(name),
  };
}
