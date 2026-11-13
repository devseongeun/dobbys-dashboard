// 코멘트 탭 동작. 로컬판 tabs/comments/service.py + serve.py 의 로그인 검사 이식.
// - 로그인 token·작성자 이름은 키체인 대신 브라우저(web/lib/secrets.js, 키 "trombone")에 둔다. 비밀번호는 저장하지 않는다.
// - 우선순위·보류는 IndexedDB(overrides.js), 체크리스트 md 는 고른 폴더(FSA 핸들)에 브라우저가 직접 쓴다.
import { TromboneError } from "./client.js";
import { buildMarkdown } from "./markdown.js";
import {
  CATEGORY_COLOR, CATEGORY_ORDER, DECIDED_EMOJI, HEAD_LIMIT_HTML, PRIORITY_ORDER, alreadyEyed, categoryCounts, collect,
  eyeActors, locked, pagePayload, pyStrip, targetOf,
} from "./model.js";

export const KEY = "trombone";

export class NeedLogin extends Error { constructor(message) { super(message); this.name = "NeedLogin"; this.status = 401; } }
export class ExportDisabled extends Error { constructor(message) { super(message); this.name = "ExportDisabled"; } }
export class NothingToExport extends Error { constructor(message) { super(message); this.name = "NothingToExport"; } }

const pad = (n) => String(n).padStart(2, "0");
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // date.isoformat()
export const stamp = (d) => `${isoDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; // strftime("%Y-%m-%d %H:%M")

export const exportName = (day, name) => `${day} 웹기획서 코멘트 리뷰 체크리스트 (${name}).md`;

export class CommentService {
  // client: TromboneClient, secrets: {getSecret, setSecret, clearSecret}, overrides: OverrideStore,
  // exportDir: 체크리스트 저장 폴더 핸들(없으면 null), today/now: () => Date
  constructor({ client, secrets, overrides, exportDir = null, today = () => new Date(), now = () => new Date() }) {
    this.client = client;
    this.secrets = secrets;
    this.overrides = overrides;
    this.exportDir = exportDir || null;
    this.today = today;
    this.now = now;
  }

  // 저장값이 깨졌으면 세션 없음으로 보고, 다시 로그인할 수 있게 사유만 돌려준다.
  readSession() {
    let creds;
    try {
      creds = this.secrets.getSecret(KEY);
    } catch (err) {
      return [null, `저장된 기획서 로그인 정보를 읽지 못했다: ${err?.message ?? err}`];
    }
    if (creds == null) return [null, null];
    if (typeof creds !== "object" || Array.isArray(creds)) return [null, "저장된 기획서 로그인 정보를 읽지 못했다. 다시 로그인한다"];
    if (creds.base !== this.client.base || !creds.token || !creds.name) return [null, null];
    return [creds, null];
  }

  session() {
    return this.readSession()[0];
  }

  describe() {
    const [creds, error] = this.readSession();
    const out = { loggedIn: creds !== null, name: creds ? creds.name : null, base: this.client.base, exportEnabled: this.exportDir !== null };
    if (error) out.error = error;
    return out;
  }

  // serve.py POST api/login 의 검사·오류 문구까지 옮겼다. 실패하면 아무것도 저장하지 않는다.
  async login(loginId, password, { remember = false } = {}) {
    if (typeof loginId !== "string" || !pyStrip(loginId) || typeof password !== "string" || !password) {
      throw new TromboneError("이메일과 비밀번호를 입력한다", 400);
    }
    let res;
    try {
      res = await this.client.login(pyStrip(loginId), password);
    } catch (err) {
      if (err instanceof TromboneError) {
        throw new TromboneError(`로그인 실패: ${err.message}`, [400, 401, 403].includes(err.status) ? 401 : 502);
      }
      throw err;
    }
    if (!res || typeof res !== "object" || !res.token || !res.name) {
      throw new TromboneError("로그인 실패: 로그인 응답에 token·name 이 없다", 502);
    }
    this.secrets.setSecret(KEY, { base: this.client.base, token: res.token, name: res.name }, { remember });
    return res.name;
  }

  logout() {
    this.secrets.clearSecret(KEY);
  }

  async collect() {
    const creds = this.session();
    if (creds === null) throw new NeedLogin("로그인이 필요하다");
    const { rows, pages, answered } = await collect(await this.client.inbox(), (path) => this.client.bundle(path), creds.name, await this.overrides.load());
    return { creds, rows, pages, answered };
  }

  async report() {
    const { creds, rows, pages } = await this.collect();
    return {
      base: this.client.base,
      pages: pagePayload(pages),
      cats: categoryCounts(rows),
      catColor: CATEGORY_COLOR,
      cfg: {
        author: creds.name, date: isoDate(this.today()), collected: stamp(this.now()),
        categoryOrder: CATEGORY_ORDER, priorityOrder: [...PRIORITY_ORDER],
        headLimit: HEAD_LIMIT_HTML, decidedEmoji: DECIDED_EMOJI,
      },
    };
  }

  // 방금 읽은 반응으로 이미 👀 가 있으면 건너뛴다(토글 API 라 다시 보내면 떼어진다).
  async react(ids) {
    const { creds, rows } = await this.collect();
    const byId = new Map(rows.map((r) => [r.commentId, r]));
    let applied = 0;
    let skipped = 0;
    const failed = [];
    for (const commentId of [...new Set(ids)]) {
      const row = byId.get(commentId);
      if (row === undefined) {
        failed.push(`${commentId}(코멘트 없음)`);
        continue;
      }
      if (row.decided || locked(row) || alreadyEyed(row, creds.name)) {
        skipped += 1;
        continue;
      }
      let after;
      try {
        after = await this.client.react(targetOf(row), DECIDED_EMOJI, creds.token);
      } catch (err) {
        if (!(err instanceof TromboneError)) throw err;
        if (err.status === 401) {
          this.logout();
          throw new NeedLogin(`로그인이 만료됐다. 다시 로그인한다 (반영 ${applied}건까지 완료)`);
        }
        failed.push(`${commentId}(${err.message})`);
        continue;
      }
      if (Array.isArray(after) && !eyeActors({ reactions: after }).includes(creds.name)) {
        failed.push(`${commentId}(반영 후 확인 실패)`);
        continue;
      }
      applied += 1;
    }
    return { applied, skipped, failed };
  }

  // 체크리스트 md 를 고른 폴더에 쓴다. 쓰기 권한은 부르는 쪽이 클릭 안에서 먼저 받는다(fsa.reconnect).
  async export() {
    if (this.exportDir === null) throw new ExportDisabled("⚙ 설정에서 체크리스트 저장 폴더를 지정해야 쓸 수 있다");
    const { creds, rows, pages, answered } = await this.collect();
    if (!rows.length) throw new NothingToExport("내보낼 코멘트가 없다");
    const day = isoDate(this.today());
    const md = buildMarkdown(rows, pages, answered, { base: this.client.base, author: creds.name, date: day, collected: stamp(this.now()) });
    const name = exportName(day, creds.name);
    try {
      const handle = await this.exportDir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      try {
        await writable.write(md);
        await writable.close();
      } catch (err) {
        try { await writable.abort?.(); } catch { /* 이미 닫혔다 */ }
        throw err;
      }
    } catch (err) {
      if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
        throw new Error("체크리스트 저장 폴더에 쓸 권한이 없다. [📝 MD 내보내기]를 다시 눌러 허용하거나 ⚙ 설정에서 폴더를 다시 고른다");
      }
      if (err?.name === "NotFoundError") throw new Error("체크리스트 저장 폴더를 찾을 수 없다. ⚙ 설정에서 폴더를 다시 고른다");
      throw new Error(`체크리스트를 쓰지 못했다: ${err?.message ?? err}`);
    }
    return { folder: this.exportDir.name, name, markdown: md };
  }

  setOverride(commentId, priority, resolved) {
    return this.overrides.update(commentId, priority, resolved);
  }
}
