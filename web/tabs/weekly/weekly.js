// 주간 보고 뷰어 화면(웹 버전). 로컬판 generate_viewer.py viewer_page 의 인라인 스크립트와 viewer_review·viewer_cite·
// viewer_guide·viewer_refresh 의 JS 를 옮겼다. 다른 점:
// - 자료: 로컬판은 뷰어 HTML 에 구워 넣은 JSON 이다. 웹은 설정의 폴더 핸들 여러 개를 읽어 이 자리에서 만든다(report_parser.js·viewer_html.js).
// - ↻ 최신화: 로컬판은 POST /api/regenerate 로 서버가 generate_viewer.py 를 다시 돌렸다. 웹은 폴더를 다시 읽는다.
// - 확인 완료: 로컬판은 reviewed.json(서버) 또는 localStorage. 웹은 IndexedDB tabState("weekly") 의 "reviewed"(review.js).
import { tabContext } from "../../lib/tab.js";
import * as fsa from "../../lib/fsa.js";
import { loadReports, readFolders } from "./report_parser.js";
import { esc, guideDialog, reviewButton, TEMPLATE_NAME, viewerPayload } from "./viewer_html.js";
import { loadReviewed, saveReviewed, toggled } from "./review.js";

const rail = document.getElementById("rail");
const pane = document.getElementById("pane");
const state = { slug: null, view: "briefing", q: "" };
let DATA = [];
let railSlug = null;
const REVIEW_BUTTON = reviewButton();

// 회차 선택은 세션 범위로만 살린다(오리진별 localStorage 혼선 방지).
function storedSlug() {
  try { return sessionStorage.getItem("weekly-viewer:slug"); } catch { return null; }
}
function initialSlug() {
  const saved = state.slug ?? storedSlug();
  if (saved && DATA.some((item) => item.slug === saved)) return saved;
  return DATA.length ? DATA[0].slug : null;
}
function setSlug(slug) {
  state.slug = slug;
  if (!slug) return;
  try { sessionStorage.setItem("weekly-viewer:slug", slug); } catch { /* 세션 저장소가 없으면 기억하지 않는다 */ }
}

function visible() {
  if (!state.q) return DATA;
  const needle = state.q.toLowerCase();
  return DATA.filter((item) => item.search.indexOf(needle) > -1);
}
const current = () => DATA.find((item) => item.slug === state.slug) ?? null;

function renderRail() {
  const rows = visible();
  if (!rows.length) {
    rail.innerHTML = DATA.length ? '<p class="empty">일치하는 회차가 없습니다.</p>' : '<p class="empty">주간 보고 초안이 없습니다.</p>';
    return;
  }
  let html = '<div class="rail-head"><span>회차</span><span>' + rows.length + "</span></div>";
  let month = null;
  rows.forEach((item) => {
    if (item.month !== month) { month = item.month; html += '<div class="month">' + esc(month) + "</div>"; }
    const done = reviewDone(item.slug);
    html += '<button class="wk" data-slug="' + esc(item.slug) + '" aria-current="' + (item.slug === state.slug) + '">'
      + '<span class="date">' + esc(item.date)
      + (item.period === item.date.replace(/-/g, ".") ? "" : " · " + esc(item.period)) + "</span>"
      + '<span class="name">' + esc(item.title) + "</span>"
      + (item.subtitle ? '<span class="sub">' + esc(item.subtitle) + "</span>" : "")
      + '<span class="badges"><span>' + esc(item.origin) + "</span>"
      + (done ? '<span class="ok">확인 완료</span>'
        : (item.flags ? '<span class="warn">미해결 ' + item.flags + "</span>" : ""))
      + "</span></button>";
  });
  rail.innerHTML = html;
  // 회차가 실제로 바뀔 때만 스크롤한다. 모바일 폭에서 rail 이 static 이라 확인 완료 토글마다 스크롤하면 화면이 끌려 올라간다.
  const active = rail.querySelector('[aria-current="true"]');
  if (active && railSlug !== state.slug) active.scrollIntoView({ block: "nearest" });
  railSlug = state.slug;
}

function renderPane() {
  const item = current();
  if (!item) { pane.innerHTML = '<p class="lead">왼쪽에서 회차를 선택하세요.</p>'; return; }
  pane.innerHTML = '<div class="detail-title"><div class="eyebrow">' + esc(item.period)
    + (item.approval ? ' <span class="tag">' + esc(item.approval) + "</span>" : "")
    + ' <span class="tag">' + esc(item.file) + "</span></div>"
    + "<h1>" + esc(item.title) + "</h1>"
    + (item.subtitle ? '<p class="lead">' + esc(item.subtitle) + "</p>" : "") + "</div>"
    + '<div class="tabs">'
    + '<button id="briefing-tab" data-view="briefing" class="' + (state.view === "briefing" ? "active" : "") + '">AI 브리핑</button>'
    + '<button id="document-tab" data-view="document" class="' + (state.view === "document" ? "active" : "") + '">초안 원문</button>'
    + REVIEW_BUTTON
    + "</div>"
    + '<section id="briefing-view" class="view' + (state.view === "briefing" ? " active" : "") + '">' + item.briefing + "</section>"
    + '<section id="document-view" class="view' + (state.view === "document" ? " active" : "") + '">' + item.document + "</section>";
  reviewApply(pane, item);
  citeReset();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function render() { renderRail(); renderPane(); }

rail.addEventListener("click", (event) => {
  const button = event.target.closest("[data-slug]");
  if (!button) return;
  setSlug(button.getAttribute("data-slug"));
  render();
});

pane.addEventListener("click", (event) => {
  if (reviewClick(event)) { renderRail(); return; }
  if (citeClick(event)) return;
  const tab = event.target.closest("[data-view]");
  if (tab) { state.view = tab.getAttribute("data-view"); renderPane(); return; }
  const jump = event.target.closest('a[href^="#"]');
  if (jump) {
    event.preventDefault();
    const id = decodeURIComponent(jump.getAttribute("href").slice(1));
    const target = document.getElementById(id);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      if (history.replaceState) history.replaceState(null, "", "#" + id);
    }
    return;
  }
  const copyButton = event.target.closest('[data-copy="ppt"]');
  if (copyButton) {
    const block = document.getElementById("ppt-block");
    if (!block) return;
    const flash = (text) => {
      copyButton.textContent = text;
      setTimeout(() => { copyButton.textContent = "원문 그대로 복사"; }, 1600);
    };
    if (!navigator.clipboard || !navigator.clipboard.writeText) { flash("복사 실패"); return; }
    navigator.clipboard.writeText(block.textContent).then(() => flash("복사됨"), () => flash("복사 실패"));
  }
});

const q = document.getElementById("q");
const qclear = document.getElementById("qclear");
q.addEventListener("input", () => {
  state.q = q.value.trim();
  qclear.hidden = !state.q;
  const rows = visible();
  if (rows.length && !rows.some((item) => item.slug === state.slug)) setSlug(rows[0].slug);
  render();
});
qclear.addEventListener("click", () => { q.value = ""; state.q = ""; qclear.hidden = true; q.focus(); render(); });

function step(direction) {
  const rows = visible();
  const index = rows.findIndex((item) => item.slug === state.slug);
  const next = direction === "older" ? index + 1 : index - 1;
  if (next >= 0 && next < rows.length) { setSlug(rows[next].slug); render(); }
}
document.addEventListener("keydown", (event) => {
  if (event.target.matches("input, textarea")) return;
  if (event.key === "ArrowDown" || event.key === "j") { event.preventDefault(); step("older"); }
  if (event.key === "ArrowUp" || event.key === "k") { event.preventDefault(); step("newer"); }
  if (event.key === "/") { event.preventDefault(); q.focus(); }
  if (event.key === "Tab" && !event.shiftKey && event.altKey) {
    event.preventDefault();
    state.view = state.view === "briefing" ? "document" : "briefing";
    renderPane();
  }
});

const themeBtn = document.getElementById("themeBtn");
try { const saved = localStorage.getItem("weekly-viewer:theme"); if (saved) document.documentElement.setAttribute("data-theme", saved); } catch { /* 저장소 없음 */ }
themeBtn.addEventListener("click", () => {
  const root = document.documentElement;
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try { localStorage.setItem("weekly-viewer:theme", next); } catch { /* 저장소 없음 */ }
});

// ---- 확인 완료(viewer_review JS) — 저장은 IndexedDB ------------------------------

const REVIEW_FAIL = "저장 실패 — 브라우저 저장소(IndexedDB)를 확인하세요.";
let reviewed = {};
let reviewState = null;
let saving = Promise.resolve();

function reviewDone(slug) {
  if (!slug) return "";
  const at = reviewed[slug];
  return typeof at === "string" && at ? at : "";
}

function reviewDay(iso) {
  // ISO 문자열을 로컬 날짜(YYYY-MM-DD)로 줄인다. 파싱이 안 되면 앞 10자를 쓴다.
  const date = new Date(iso);
  if (!date || isNaN(date.getTime())) return String(iso).slice(0, 10);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return date.getFullYear() + "-" + (month < 10 ? "0" : "") + month + "-" + (day < 10 ? "0" : "") + day;
}

function reviewApply(root, item) {
  const button = root?.querySelector?.("#reviewBtn");
  if (!button) return;
  const text = button.querySelector(".review-text");
  const at = item ? reviewDone(item.slug) : "";
  if (at) {
    button.setAttribute("aria-pressed", "true");
    button.setAttribute("data-done", "true");
    button.setAttribute("title", "확인 완료 · " + reviewDay(at) + " — 다시 누르면 해제됩니다.");
    if (text) text.textContent = "확인 완료 · " + reviewDay(at);
  } else {
    button.setAttribute("aria-pressed", "false");
    button.removeAttribute("data-done");
    button.setAttribute("title", "이 초안을 전부 확인했으면 누르세요.");
    if (text) text.textContent = "초안 확인 완료";
  }
}

function reviewClick(event) {
  const target = event?.target;
  if (!target?.closest || !target.closest("#reviewBtn")) return false;
  const item = current();
  if (!item) return true;
  const previous = reviewed;
  const next = toggled(previous, item.slug, !reviewDone(item.slug));
  // 화면부터 바꾸고 저장은 뒤따르게 한다. 실패하면 되돌리고 알린다.
  reviewed = next;
  reviewApply(pane, item);
  const store = reviewState;
  saving = saving.then(() => saveReviewed(store, next)).catch(() => {
    if (reviewed === next) reviewed = previous;
    reviewApply(pane, current());
    renderRail();
    pane.querySelector("#reviewBtn")?.setAttribute("title", REVIEW_FAIL);
  });
  return true;
}

// ---- 근거 배지(viewer_cite JS) ---------------------------------------------------

let citeOpenButton = null;

function citeHide() {
  if (!citeOpenButton) return null;
  const button = citeOpenButton;
  const pop = button.parentNode ? button.parentNode.querySelector(".cite-pop") : null;
  if (pop?.parentNode) pop.parentNode.removeChild(pop);
  button.setAttribute("aria-expanded", "false");
  citeOpenButton = null;
  return button;
}

function citePopMarkup(button) {
  const file = button.getAttribute("data-file") || "";
  const section = button.getAttribute("data-section") || "";
  const extra = button.getAttribute("data-extra") || "";
  let meta = section ? "초안 섹션 · " + section : "초안 섹션 정보 없음";
  if (extra) meta += " · " + extra;
  return '<div class="cite-pop" role="dialog" aria-label="근거 출처">'
    + '<div class="cite-file">' + esc(file || "(파일명 미확인)") + "</div>"
    + '<div class="cite-meta">' + esc(meta) + "</div>"
    + '<p class="cite-note">초안 원문 탭에서 전체 문장을 확인하세요.</p>'
    + '<button type="button" class="cite-copy" data-cite-copy="1">파일명 복사</button>'
    + "</div>";
}

function citeCopy(trigger) {
  const slot = trigger.closest(".cite-pop")?.querySelector(".cite-file");
  const name = slot ? slot.textContent : "";
  if (!name || !navigator.clipboard?.writeText) return;
  navigator.clipboard.writeText(name).then(() => {
    trigger.textContent = "복사됨";
    setTimeout(() => { trigger.textContent = "파일명 복사"; }, 1600);
  }, () => {});
}

function citePlace(pop) {
  if (!pop?.getBoundingClientRect) return;
  pop.style.left = "0px";
  const box = pop.getBoundingClientRect();
  const room = document.documentElement.clientWidth;
  const gap = 12;
  let shift = 0;
  if (box.right > room - gap) shift = (room - gap) - box.right;
  if (box.left + shift < gap) shift = gap - box.left;
  if (shift) pop.style.left = Math.round(shift) + "px";
}

function citeClick(event) {
  const target = event.target;
  if (!target?.closest) return false;
  const copy = target.closest("[data-cite-copy]");
  if (copy) { citeCopy(copy); return true; }
  if (target.closest(".cite-pop")) return true;
  const button = target.closest(".cite");
  if (!button) return false;
  const same = citeOpenButton === button;
  citeHide();
  if (same) return true;
  button.insertAdjacentHTML("afterend", citePopMarkup(button));
  button.setAttribute("aria-expanded", "true");
  citeOpenButton = button;
  citePlace(button.nextElementSibling);
  return true;
}

function citeReset() { citeOpenButton = null; }

document.addEventListener("click", (event) => {
  if (!citeOpenButton) return;
  if (event.target?.closest?.(".cite-wrap")) return;
  citeHide();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !citeOpenButton) return;
  citeHide()?.focus?.();
});

// ---- 표준 섹션 안내 창(viewer_guide JS). 템플릿은 web_serve.py 가 로컬판 templates/ 의 같은 파일을 준다 -----------

async function guideInit() {
  let template = "";
  try {
    const response = await fetch(new URL("templates/" + TEMPLATE_NAME, import.meta.url));
    if (response.ok) template = await response.text();
  } catch { /* 템플릿 없이 안내 표만 보인다 */ }
  document.getElementById("guide-slot").innerHTML = guideDialog(template);
}

document.addEventListener("click", (event) => {
  const dialog = document.getElementById("guide");
  if (!dialog) return;
  if (event.target.closest("[data-guide-open]")) { dialog.showModal(); return; }
  // 창 바깥(backdrop)을 누르면 dialog 자신이 target 이다.
  if (event.target === dialog || event.target.closest("[data-guide-close]")) { dialog.close(); return; }
  const copy = event.target.closest("[data-guide-copy]");
  if (!copy) return;
  const flash = (text) => {
    copy.textContent = text;
    setTimeout(() => { copy.textContent = "템플릿 복사"; }, 1600);
  };
  if (!navigator.clipboard?.writeText) { flash("복사 실패"); return; }
  navigator.clipboard.writeText(document.getElementById("guide-template").textContent).then(() => flash("복사됨"), () => flash("복사 실패"));
});

// ---- 폴더 읽기와 ↻ 최신화(viewer_refresh 대신) ---------------------------------

const refreshBtn = document.getElementById("refreshBtn");
const banner = document.getElementById("banner");

function refreshNote(text, tone) {
  const box = document.getElementById("refreshStatus");
  box.textContent = text || "";
  box.hidden = !text;
  if (text) box.setAttribute("title", text); else box.removeAttribute("title");
  if (tone) box.setAttribute("data-tone", tone); else box.removeAttribute("data-tone");
}

function showBanner(lines, action = null) {
  banner.replaceChildren();
  if (!lines.length && !action) { banner.hidden = true; return; }
  const text = document.createElement("span");
  text.className = "lines";
  text.textContent = lines.join("\n");
  banner.append(text);
  if (action) banner.append(action);
  banner.hidden = false;
}

function reconnectButton(handles) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "iconbtn";
  button.textContent = "폴더 다시 연결";
  button.addEventListener("click", async () => {
    button.disabled = true;
    for (const handle of handles) {
      try { await fsa.reconnect(handle, "read"); } catch { /* 거절되면 다음 읽기에서 다시 묻는다 */ }
    }
    await load();
  });
  return button;
}

const stamp = (date) => {
  const two = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
};

// 화면에 그대로 보일 안내 문구.
class Shown extends Error {}

const readError = (error) => {
  if (error?.name === "NotFoundError") return "폴더를 찾을 수 없다(옮겨졌거나 지워졌다)";
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "폴더를 읽을 권한이 없다";
  return `${error?.name ?? "Error"}: ${error?.message ?? error}`;
};

// 폴더를 (다시) 읽어 회차 목록을 새로 만든다. 첫 화면과 ↻ 최신화가 함께 쓴다. 실패해도 화면은 뜨고 띠로 알린다.
async function load({ manual = false } = {}) {
  if (refreshBtn.getAttribute("data-state") === "busy") return;
  refreshBtn.setAttribute("data-state", "busy");
  refreshBtn.disabled = true;
  if (manual) refreshNote("다시 읽는 중…", "busy");
  const lines = [];
  let action = null;
  try {
    let ctx;
    try {
      ctx = await tabContext("weekly");
    } catch (error) {
      throw new Shown(`브라우저 저장소를 열지 못했다: ${error.message}`);
    }
    reviewState = ctx.state;
    try {
      reviewed = await loadReviewed(reviewState);
    } catch (error) {
      lines.push(`확인 완료 기록을 읽지 못했다: ${error.message}`);
    }
    const handles = (ctx.settings?.folders ?? []).filter(fsa.isHandle);
    if (!handles.length) {
      throw new Shown(fsa.supported()
        ? "주간 보고 폴더가 없다. ⚙ 설정에서 폴더를 고른다."
        : "이 브라우저는 폴더 읽기(File System Access API)를 지원하지 않는다. Chrome·Edge 에서 연다.");
    }
    const granted = [];
    const asking = [];
    for (const handle of handles) {
      const permission = await fsa.permission(handle, "read");
      if (permission === "granted") granted.push(handle);
      else if (permission === "prompt") asking.push(handle);
      else lines.push(`폴더 ${handle.name} 권한이 거부됐다. ⚙ 설정에서 폴더를 다시 고른다.`);
    }
    if (asking.length) {
      lines.push(`브라우저가 폴더 접근 권한을 다시 묻는다(${asking.map((h) => h.name).join(", ")}). 아래 버튼을 눌러 허용한다.`);
      action = reconnectButton(asking);
    }
    const read = await readFolders(granted);
    const { reports, warnings } = loadReports(read.files);
    lines.push(...read.warnings, ...warnings);
    DATA = viewerPayload(reports);
    if (!DATA.length && !asking.length) lines.push("주간 보고 초안을 찾지 못했습니다. 파일명이 'YYYY-MM-DD 주간 보고.md' 꼴인지 확인하세요.");
    document.getElementById("hint").textContent = `초안 ${DATA.length}건 · ${stamp(new Date())} 읽음`;
    if (manual) refreshNote(`초안 ${DATA.length}건 다시 읽음`, "done");
  } catch (error) {
    DATA = [];
    lines.unshift(error instanceof Shown ? error.message : readError(error));
    document.getElementById("hint").textContent = "";
    if (manual) refreshNote("다시 읽지 못했습니다.", "fail");
  } finally {
    refreshBtn.removeAttribute("data-state");
    refreshBtn.disabled = false;
  }
  showBanner(lines, action);
  setSlug(initialSlug());
  render();
}

refreshBtn.addEventListener("click", () => load({ manual: true }));
guideInit();
load();
