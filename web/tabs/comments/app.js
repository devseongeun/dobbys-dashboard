// 기획서 코멘트 현황 화면(브라우저판). 로컬판 tabs/comments/static/index.html 의 스크립트를 옮겼다(웹 CSP 는 인라인 스크립트를 막는다).
// 그리기·필터·칩·진행률 코드는 그대로이고, 로컬 서버 api/* 호출 자리만 브라우저 계층(service.js)으로 바꿨다:
// - 기획서 API 는 서버 중계 api/trombone/*(대상은 서버 환경변수 TROMBONE_BASE), 로그인 token 은 web/lib/secrets.js,
//   우선순위·보류는 IndexedDB(tabState("comments")), 체크리스트 md 는 ⚙ 설정에서 고른 폴더에 브라우저가 직접 쓴다.
import { apiFetch } from "../../lib/api.js";
import { permission, reconnect } from "../../lib/fsa.js";
import { clearSecret, getSecret, setSecret } from "../../lib/secrets.js";
import { tabContext } from "../../lib/tab.js";
import { TromboneClient } from "./client.js";
import { OverrideStore } from "./overrides.js";
import { CommentService } from "./service.js";

let CFG = { author: "", date: "", collected: "", categoryOrder: [], priorityOrder: ["상", "중"], headLimit: 80, decidedEmoji: "EMO005" }, CATC = {}, BASE = "";
let DATA = [], cats = [];
let filter = null, stat = null, dec = null, pri = null, hideDone = false;
// [👀 확인 완료] 대상으로 체크한 코멘트ID. 브라우저에 저장하지 않는다 — 반영하면 기획서 반응이 곧 상태다.
const sel = new Set();
const root = document.getElementById("root"), fb = document.getElementById("filters"), sb = document.getElementById("stats");
const subEl = document.getElementById("sub"), progEl = document.getElementById("prog"), rstat = document.getElementById("rstat");
const banner = document.getElementById("banner");
// 테마 토글. theme.js 가 처음 값을 정하고, 여기서는 버튼 글자와 전환·저장만 맡는다.
const themeBtn = document.getElementById("theme"), docEl = document.documentElement;
function paintTheme() { const dark = docEl.dataset.theme === "dark"; themeBtn.textContent = dark ? "☀️ 라이트" : "🌙 다크"; themeBtn.title = dark ? "라이트 테마로 바꿉니다" : "다크 테마(업무 대시보드 색)로 바꿉니다"; }
themeBtn.onclick = () => { const dark = docEl.dataset.theme !== "dark"; if (dark) docEl.dataset.theme = "dark"; else delete docEl.dataset.theme; try { localStorage.setItem("spec-comments:theme", dark ? "dark" : "light"); } catch (e) { /* 막힌 저장소 */ } paintTheme(); };
paintTheme();
const ST = { ans: "답변 완료", open: "미답변", lock: "답변 불필요" };
function hon(n) { return !n || n === "-" || /님$/.test(n) ? n : n + "님"; }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }
function total() { return DATA.reduce((a, p) => a + p.comments.length, 0); }
function cnt(f) { return DATA.reduce((a, p) => a + p.comments.filter(f).length, 0); }
function mkchip(label, n, fn) { const b = document.createElement("button"); b.className = "chip"; b.textContent = label + " " + n; b.onclick = fn; return b; }
function priBadge(c) { return c.priLv ? '<span class="pribadge' + (c.priLv === "중" ? " mid" : "") + '" title="' + esc(c.pri) + '">우선순위 ' + esc(c.priLv) + "</span>" : ""; }
// 칩은 최신화 때마다 건수가 바뀌므로 통째로 다시 만든다.
function buildChips() {
  fb.innerHTML = ""; sb.innerHTML = "";
  fb.appendChild(mkchip("전체", total(), () => { filter = null; render(); }));
  cats.forEach(([c, n]) => { const b = mkchip(c, n, () => { filter = (filter === c ? null : c); render(); }); b.dataset.v = c; fb.appendChild(b); });
  sb.appendChild(mkchip("상태 전체", total(), () => { stat = null; render(); }));
  Object.keys(ST).forEach((v) => { const n = cnt((c) => c.st === v); if (!n) return; const b = mkchip(ST[v], n, () => { stat = (stat === v ? null : v); render(); }); b.dataset.s = v; sb.appendChild(b); });
  const nd = cnt((c) => c.dec);
  if (nd) {
    const b1 = mkchip("결정 완료 👀", nd, () => { dec = (dec === "yes" ? null : "yes"); render(); }); b1.dataset.d = "yes"; sb.appendChild(b1);
    const b2 = mkchip("미결", cnt((c) => !c.dec && !c.lock), () => { dec = (dec === "no" ? null : "no"); render(); }); b2.dataset.d = "no"; sb.appendChild(b2);
  }
  // 우선순위는 등급별 칩이다. 건수 0 인 등급은 칩을 만들지 않는다.
  const lvs = CFG.priorityOrder.filter((lv) => cnt((c) => c.priLv === lv));
  lvs.forEach((lv) => { const b = mkchip("우선순위 " + lv, cnt((c) => c.priLv === lv), () => { pri = (pri === lv ? null : lv); render(); }); b.dataset.p = lv; sb.appendChild(b); });
  if (filter !== null && !cats.some(([c]) => c === filter)) filter = null;
  if (dec === "yes" && !nd) dec = null;
  if (pri !== null && !lvs.includes(pri)) pri = null;
}
// 헤더 요약·진행률. 분모는 답변을 받았거나 애초에 보류 근거가 없는 건만 리뷰 대상으로 센다(로컬판과 같은 식).
function updateHeader() {
  if (!BASE && !DATA.length) return;
  const na = cnt((c) => c.st === "ans");
  subEl.innerHTML = "코멘트 <b>" + total() + "</b>건 · 화면 <b>" + DATA.length + "</b>개 · 답변 완료 <b>" + na + "</b>건" + (na ? "" : "(전부 미응답)")
    + " · 수집 " + esc(CFG.collected) + "(기준 " + esc(CFG.date) + ') · 원본 <a href="' + esc(BASE) + '/" target="_blank" rel="noopener">' + esc(BASE) + "</a>";
  progEl.innerHTML = "<b>" + cnt((c) => c.dec) + "</b> / " + cnt((c) => c.st === "ans" || !c.res) + " 결정 완료 👀"
    + '<span class="meta">  ·  보류 ' + cnt((c) => c.st === "lock") + "건 제외</span>";
}
function render() {
  root.innerHTML = "";
  [...fb.children].forEach((b) => b.classList.toggle("on", ("v" in b.dataset) ? b.dataset.v === filter : filter === null));
  [...sb.children].forEach((b) => b.classList.toggle("on", ("s" in b.dataset) ? b.dataset.s === stat : ("d" in b.dataset) ? b.dataset.d === dec : ("p" in b.dataset) ? b.dataset.p === pri : (stat === null && dec === null && pri === null)));
  DATA.forEach((p) => {
    const cs = p.comments.filter((c) => !filter || c.cat === filter).filter((c) => !stat || c.st === stat)
      .filter((c) => !dec || (dec === "yes" ? c.dec : (!c.dec && !c.lock)))
      .filter((c) => !pri || c.priLv === pri)
      .filter((c) => !(hideDone && c.dec));
    if (!cs.length) return;
    const s = document.createElement("section");
    s.innerHTML = '<div class="ph"><span class="sid">' + esc(p.scrnId) + '</span><span class="pt">' + esc(p.title) + "</span>"
      + '<span class="meta"><a href="' + esc(BASE + encodeURI(p.path)) + '" target="_blank" rel="noopener">기획서 열기 ↗</a></span>'
      + '<span class="pill">' + esc(p.pageId) + '</span><span class="pill">변경 ' + esc(p.changeType) + '</span><span class="pill">기획 ' + esc(hon(p.author)) + "</span>"
      + '<span class="meta" style="margin-left:auto">' + cs.length + "건</span></div>";
    const ul = document.createElement("ul");
    // 코멘트는 전부 page 스코프다(specId 없음). 그래서 바로가기는 화면 경로 1개로 충분하다.
    const go = '<a class="go" href="' + esc(BASE + encodeURI(p.path)) + '" target="_blank" rel="noopener" title="이 코멘트가 달린 화면을 기획서에서 엽니다">기획서 ↗</a>';
    cs.forEach((c) => {
      const li = document.createElement("li");
      li.dataset.id = c.id;
      const multi = c.text !== c.head;
      const ansHtml = c.ans.map((a) => '<div class="ans"><span class="who">답변 · ' + esc(hon(a.author)) + " · " + esc(a.at) + " · " + esc(a.id) + (a.eyed ? " · 👀 확인" : "") + "</span>" + esc(a.text) + "</div>").join("");
      if (c.lock) {
        li.classList.add("locked");
        if (c.priLv) li.classList.add("pri", ...(c.priLv === "중" ? ["mid"] : []));
        li.innerHTML = '<span class="lock" title="답변 불필요 — 체크 대상이 아닙니다" aria-disabled="true">−</span>'
          + '<div class="body"><div class="head">' + esc(c.head) + (multi ? ' <span style="color:#9ca3af;font-size:11px">▾</span>' : "") + go + "</div>"
          + '<div class="tags">' + priBadge(c)
          + '<span class="cat" style="--c:' + esc(CATC[c.cat]) + '">' + esc(c.cat) + "</span>"
          + '<span class="mono">' + esc(c.id) + "</span><span>" + esc(c.at) + "</span><span>보류 · 답변 불필요</span>" + editBtns(c) + "</div>"
          + '<div class="why">답변 불필요 — ' + esc(c.lock) + "</div>"
          + '<div class="full">' + esc(c.text) + "</div></div>";
        li.querySelector(".head").onclick = (e) => { if (e.target.closest(".go")) return; li.classList.toggle("open"); };
        ul.appendChild(li);
        return;
      }
      if (c.dec) li.classList.add("done");
      if (c.ans.length) li.classList.add("answered");
      if (c.priLv) li.classList.add("pri", ...(c.priLv === "중" ? ["mid"] : []));
      if (sel.has(c.id)) li.classList.add("picked");
      li.innerHTML = (c.dec ? '<span class="bx ok" title="' + esc(c.decOn.join(" · ")) + ' 에 👀">✓</span>'
        : '<input type="checkbox" class="pick"' + (sel.has(c.id) ? " checked" : "") + ' title="체크 후 [👀 확인 완료] — ' + (c.ans.length ? "답글 " + esc(c.ans[c.ans.length - 1].id) : "코멘트 본문 " + esc(c.id)) + ' 에 👀"/>')
        + '<div class="body"><div class="head">' + esc(c.head) + (multi ? ' <span style="color:#9ca3af;font-size:11px">▾</span>' : "") + go + "</div>"
        + '<div class="tags">' + priBadge(c)
        + (c.dec ? '<span class="decbadge" title="' + esc(c.decOn.join(" · ")) + ' 에 👀">결정 완료 👀</span>' : "")
        + (c.ans.length ? '<span class="ansbadge">답변 완료</span>' : "")
        + '<span class="cat" style="--c:' + esc(CATC[c.cat]) + '">' + esc(c.cat) + "</span>"
        + '<span class="mono">' + esc(c.id) + "</span><span>" + esc(c.at) + "</span>" + (c.reply ? "<span>↳ 답글</span>" : "") + editBtns(c) + "</div>"
        + '<div class="full">' + esc(c.text) + "</div>" + ansHtml + "</div>";
      li.querySelector(".head").onclick = (e) => { if (e.target.closest(".go")) return; li.classList.toggle("open"); };
      const pick = li.querySelector("input.pick");
      if (pick) pick.onchange = () => { if (pick.checked) sel.add(c.id); else sel.delete(c.id); li.classList.toggle("picked", pick.checked); updateApply(); };
      ul.appendChild(li);
    });
    s.appendChild(ul); root.appendChild(s);
  });
}
document.getElementById("expand").onclick = () => document.querySelectorAll("li").forEach((l) => l.classList.add("open"));
document.getElementById("collapse").onclick = () => document.querySelectorAll("li").forEach((l) => l.classList.remove("open"));
document.getElementById("hidedone").onclick = (e) => { hideDone = !hideDone; e.target.textContent = hideDone ? "결정 완료 표시" : "결정 완료 숨기기"; render(); };

/* ------------------------------------------------------------------
   로컬판은 대시보드 서버(/comments/api/*)를 불렀다. 웹판은 같은 일을 service.js 가 브라우저 안에서 한다.
------------------------------------------------------------------ */
const loginBar = document.getElementById("loginbar"), lid = document.getElementById("lid"), lpw = document.getElementById("lpw"), lgo = document.getElementById("lgo");
const lremember = document.getElementById("lremember");
const refreshBtn = document.getElementById("refresh"), applyBtn = document.getElementById("apply"), logoutBtn = document.getElementById("logout"), exportBtn = document.getElementById("export");
let session = { loggedIn: false, name: null, base: "", exportEnabled: false }, busy = false, blocked = false;
let ctx = null, service = null;
function needLogin(msg) { session.loggedIn = false; loginBar.hidden = blocked; updateApply(); if (msg) { rstat.className = "rstat err"; rstat.textContent = msg; } }
function updateApply() {
  applyBtn.textContent = "👀 확인 완료" + (sel.size ? " (" + sel.size + ")" : "");
  applyBtn.disabled = busy || !session.loggedIn || !sel.size;
  refreshBtn.disabled = busy || !session.loggedIn;
  exportBtn.disabled = busy || !session.loggedIn || !session.exportEnabled;
  exportBtn.title = session.exportEnabled ? "현재 상태를 체크리스트 md 로 저장합니다." : "⚙ 설정에서 체크리스트 저장 폴더를 지정하면 쓸 수 있습니다.";
  logoutBtn.hidden = !session.loggedIn;
  logoutBtn.textContent = "로그아웃" + (session.name ? " (" + session.name + ")" : "");
}
async function reload() {
  const before = JSON.stringify(DATA);
  const t0 = Date.now();
  const r = await service.report();
  CFG = Object.assign(CFG, r.cfg); CATC = r.catColor; BASE = r.base; DATA = r.pages; cats = r.cats;
  document.title = "웹 기획서 코멘트 현황 · " + hon(CFG.author);
  document.getElementById("title").textContent = "웹 기획서 코멘트 현황 — " + hon(CFG.author);
  const live = new Set();
  DATA.forEach((p) => p.comments.forEach((c) => { if (!c.dec && !c.lock) live.add(c.id); }));
  [...sel].forEach((id) => { if (!live.has(id)) sel.delete(id); });
  buildChips(); updateHeader(); render(); updateApply();
  return { changed: before !== JSON.stringify(DATA), secs: ((Date.now() - t0) / 1000).toFixed(1) };
}
// 한 번에 하나만 돈다. 권한 창·확인 창이 떠 있는 사이 다른 버튼을 눌러도 겹쳐 돌지 않는다
// (👀 반응 API 가 토글이라 같은 건을 두 번 보내면 떼어진다).
async function guarded(label, fn) {
  if (busy) return;
  busy = true; updateApply();
  rstat.className = "rstat"; rstat.textContent = label;
  try { await fn(); } catch (e) { if (e.status === 401) needLogin(e.message); else { rstat.className = "rstat err"; rstat.textContent = e.message; } } finally { busy = false; updateApply(); }
}
refreshBtn.onclick = () => guarded("기획서 API 호출 중…", async () => {
  const r = await reload();
  rstat.className = "rstat ok";
  rstat.textContent = (r.changed ? "갱신됨" : "변경 없음") + " · 코멘트 " + total() + "건 / 화면 " + DATA.length + "개 · " + r.secs + "초";
});
applyBtn.onclick = () => {
  if (busy || !sel.size) return;
  if (!confirm("체크한 " + sel.size + "건에 기획서 👀 를 붙입니다. 진행할까요?")) return;
  guarded("👀 반영 중…", async () => {
    const r = await service.react([...sel]);
    sel.clear();
    await reload();
    rstat.className = r.failed.length ? "rstat err" : "rstat ok";
    rstat.textContent = "👀 반영 " + r.applied + "건" + (r.skipped ? " · 건너뜀 " + r.skipped + "건" : "")
      + (r.failed.length ? " · 실패 " + r.failed.length + "건: " + r.failed.join(", ") : "") + " · 화면 최신화 완료";
  });
};
exportBtn.onclick = () => guarded("체크리스트 저장 중…", async () => {
  // 쓰기 권한은 사용자 클릭 안에서만 받을 수 있다. 다른 일보다 먼저 묻는다(권한 창이 떠 있는 동안에도 busy 라 다른 버튼이 막힌다).
  const dir = ctx?.settings?.export_dir;
  if (dir) {
    try { if ((await permission(dir, "readwrite")) !== "granted") await reconnect(dir, "readwrite"); } catch (e) { /* 아래 export 가 문구를 보인다 */ }
  }
  const r = await service.export();
  rstat.className = "rstat ok"; rstat.textContent = "저장했습니다: " + r.folder + "/" + r.name;
});
lgo.onclick = () => guarded("로그인 중…", async () => {
  const id = lid.value.trim(), pw = lpw.value;
  if (!id || !pw) throw new Error("이메일과 비밀번호를 입력하세요.");
  const name = await service.login(id, pw, { remember: lremember.checked });
  lpw.value = ""; loginBar.hidden = true;
  session.loggedIn = true; session.name = name;
  await reload();
  rstat.className = "rstat ok"; rstat.textContent = hon(name) + "으로 로그인했습니다.";
});
lpw.onkeydown = (e) => { if (e.key === "Enter") lgo.click(); };
logoutBtn.onclick = () => guarded("로그아웃 중…", async () => {
  service.logout();
  DATA = []; cats = []; sel.clear(); buildChips(); updateHeader(); render();
  needLogin(); rstat.className = "rstat"; rstat.textContent = "로그아웃했습니다.";
});
function findComment(id) { for (const p of DATA) for (const c of p.comments) if (c.id === id) return c; return null; }
function editBtns(c) {
  return '<button class="act mini" type="button" data-pri="' + esc(c.id) + '">우선순위</button>'
    + '<button class="act mini" type="button" data-res="' + esc(c.id) + '">' + (c.resOwn ? "보류 해제" : "보류") + "</button>";
}
root.addEventListener("click", (e) => {
  const b = e.target.closest("[data-pri],[data-res]");
  if (!b) return;
  e.stopPropagation();
  if (busy) return;
  const c = findComment(b.dataset.pri || b.dataset.res);
  if (!c) return;
  let args;
  if (b.dataset.pri) {
    const level = prompt("우선순위: 상 · 중 (비우면 해제)", c.priLv || "");
    if (level === null) return;
    const lv = level.trim();
    if (lv && !CFG.priorityOrder.includes(lv)) { alert("상 또는 중만 쓸 수 있습니다."); return; }
    const reason = lv ? prompt("지정 근거", c.pri || "") : "";
    if (reason === null) return;
    args = [c.id, { level: lv, reason: (reason || "").trim() }, null];
  } else if (c.resOwn) {
    if (!confirm("보류를 해제할까요?")) return;
    args = [c.id, null, ""];
  } else {
    const why = prompt("보류 근거 (답변이 필요 없는 이유)", "");
    if (!why || !why.trim()) return;
    args = [c.id, null, why.trim()];
  }
  guarded("저장 중…", async () => { await service.setOverride(...args); await reload(); rstat.className = "rstat ok"; rstat.textContent = "저장했습니다."; });
}, true);

// 서버에 기획서 주소가 없으면 로그인도 막는다(대상은 서버 환경변수로만 정한다).
function notConfigured(message) {
  blocked = true;
  loginBar.hidden = true;
  subEl.textContent = "기획서에 연결할 수 없습니다.";
  banner.hidden = false;
  banner.innerHTML = "<b>서버에 기획서(TROMBONE) 주소가 설정되지 않았다.</b> 운영자가 서버 환경변수 <code>TROMBONE_BASE</code> 를 정하고 서버를 다시 띄운다."
    // 주소가 아예 없을 때는 위 문장과 같다. 형식이 틀렸을 때만 서버 문구를 덧붙인다.
    + (message && !message.includes("설정되지 않았다") ? '<br><span class="meta">' + esc(message) + "</span>" : "");
  updateApply();
}

(async () => {
  buildChips(); updateHeader(); render(); updateApply();
  ctx = await tabContext("comments");
  if (!ctx.settings) { subEl.textContent = "⚙ 설정에서 기획서 코멘트 현황 탭을 먼저 켠다."; return; }
  const client = new TromboneClient(apiFetch);
  service = new CommentService({
    client, secrets: { getSecret, setSecret, clearSecret }, overrides: new OverrideStore(ctx.state),
    exportDir: ctx.settings.export_dir || null,
  });
  try {
    await client.config();
  } catch (e) {
    if (e.status === 503) notConfigured(e.message);
    else { blocked = true; subEl.textContent = "기획서 주소를 서버에서 읽지 못했습니다."; rstat.className = "rstat err"; rstat.textContent = e.message; }
    return;
  }
  BASE = client.base;
  session = service.describe();
  subEl.textContent = "기획서: " + BASE;
  updateApply();
  if (!session.loggedIn) { needLogin(session.error); return; }
  await guarded("기획서 API 호출 중…", reload);
})();
