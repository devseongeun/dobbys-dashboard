// 탭에서 지정한 리뷰 표시(우선순위·보류). 기획서에는 없는 축이라 브라우저 IndexedDB(tabState("comments") 의 "overrides")에 둔다.
// 로컬판 tabs/comments/overrides.py(파일 저장) + serve.py PUT api/overrides 의 검사를 옮겼다.
import { PRIORITY_ORDER, pyLen } from "./model.js";

export const NAME = "overrides";
export const MAX_TEXT = 500;
export const COMMENT_ID = /^[A-Za-z0-9_-]{1,40}$/;
export const INVALID = "id 와 priority{level: 상|중|'', reason} 또는 resolved 가 필요하다";

const isObject = (v) => Object.prototype.toString.call(v) === "[object Object]";

// 읽기~쓰기를 한 덩어리로 줄 세운다(로컬판 threading.Lock). 같은 출처 다른 창까지는 Web Locks, 없으면 이 페이지 안 큐.
let queue = Promise.resolve();
function withLock(name, work, locks = globalThis.navigator?.locks) {
  if (locks && typeof locks.request === "function") return locks.request(name, { mode: "exclusive" }, () => work());
  const run = queue.then(() => work());
  queue = run.catch(() => {});
  return run;
}

// serve.py do_PUT 과 같은 검사. 틀리면 Error(INVALID).
export function check(commentId, priority, resolved) {
  const validPriority = priority == null || (isObject(priority) && ["", ...PRIORITY_ORDER].includes(priority.level ?? "")
    && typeof (priority.reason ?? "") === "string" && pyLen(priority.reason ?? "") <= MAX_TEXT);
  const validResolved = resolved == null || (typeof resolved === "string" && pyLen(resolved) <= MAX_TEXT);
  if (typeof commentId !== "string" || !COMMENT_ID.test(commentId) || !validPriority || !validResolved
      || (priority == null && resolved == null)) {
    throw new Error(INVALID);
  }
}

export class OverrideStore {
  // state: web/lib/store.js tabState("comments")
  constructor(state, { locks } = {}) {
    this.state = state;
    this.locks = locks;
  }

  async load() {
    const raw = await this.state.get(NAME);
    const data = isObject(raw) ? raw : {};
    return {
      priority: isObject(data.priority) ? { ...data.priority } : {},
      resolved: isObject(data.resolved) ? { ...data.resolved } : {},
    };
  }

  async update(commentId, priority, resolved) {
    check(commentId, priority, resolved);
    return withLock("dobbys-dashboard/comments/overrides", async () => {
      const data = await this.load();
      if (priority != null) {
        if (priority.level) data.priority[commentId] = { level: priority.level, reason: priority.reason || "" };
        else delete data.priority[commentId];
      }
      if (resolved != null) {
        if (resolved) data.resolved[commentId] = resolved;
        else delete data.resolved[commentId];
      }
      await this.state.set(NAME, structuredClone(data));
      return data;
    }, this.locks);
  }
}
