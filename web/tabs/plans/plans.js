// 구현 진행 현황 목록 화면(브라우저판). 로컬판은 폴더에 쓴 00_<폴더명>_목록.html 을 열었지만, 웹은 파일을 쓰지 않고
// 폴더 핸들을 읽어 같은 화면(plans_index.js renderParts)을 메모리에서 그린다. 탭·칩·검색 동작은 assets_index_html.py SCRIPT 를 옮겼다.
import { tabContext } from "../../lib/tab.js";
import * as fsa from "../../lib/fsa.js";
import { FROM_LIST, esc, readFolder, renderParts, summarize } from "./plans_index.js";
import { copyButtonFor, copyPathFor } from "./copy_path.js";

const $ = (id) => document.getElementById(id);
const state = { tab: "todo", f: "", q: "" };
let TABS = [];
let features = new Set([""]);
let panels = [];
let tabs = [];
let chips = [];
let folder = null;
let realRoot = "";

// 해시 상태: #tab=todo&f=배포&q=결재. 새로고침·셸 딥링크(#plans/tab=…)에도 보던 화면을 유지한다.
const parse = () => {
  const p = new URLSearchParams(location.hash.slice(1));
  const f = p.get("f") || "";
  return { tab: TABS.includes(p.get("tab")) ? p.get("tab") : TABS[0], f: features.has(f) ? f : "", q: p.get("q") || "" };
};
const toHash = () => {
  const p = new URLSearchParams({ tab: state.tab });
  if (state.f) p.set("f", state.f);
  if (state.q) p.set("q", state.q);
  return "#" + p.toString();
};
const searching = () => state.q.trim() !== "";

function render() {
  const words = state.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const all = words.length > 0;
  $("main").classList.toggle("searching", all);
  chips.forEach((c) => c.classList.toggle("on", c.dataset.feature === state.f));
  let total = 0;
  panels.forEach((panel) => {
    let shown = 0;
    panel.querySelectorAll(".grp").forEach((grp) => {
      let rows = 0;
      grp.querySelectorAll("tbody tr").forEach((tr) => {
        const ok = (!state.f || tr.dataset.features.split("|").includes(state.f)) && words.every((w) => tr.dataset.text.includes(w));
        tr.hidden = !ok;
        rows += ok;
      });
      grp.hidden = rows === 0;
      grp.querySelector(".mhd .sub").textContent = rows + "건";
      shown += rows;
    });
    total += shown;
    const key = panel.dataset.key;
    panel.hidden = all ? shown === 0 : key !== state.tab;
    panel.querySelector(".ph").hidden = !all;
    panel.querySelector(".ph .cnt").textContent = shown + "건";
    panel.querySelector(".empty").hidden = all || shown > 0;
    const tab = tabs.find((t) => t.dataset.tab === key);
    const cnt = tab.querySelector(".cnt");
    cnt.textContent = all ? shown : cnt.dataset.total;
    tab.classList.toggle("zero", all && shown === 0);
    tab.setAttribute("aria-selected", String(!all && key === state.tab));
  });
  $("nores").hidden = !all || total > 0;
  history.replaceState(null, "", location.pathname + location.search + toHash());
}

const hhmm = (date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

// res: {ok, error, warnings, syncedAt: Date|null, action: 배너 아래 버튼(폴더 다시 연결)}.
function showSync(res) {
  const time = res.syncedAt ? hhmm(res.syncedAt) : "—";
  $("synced").textContent = res.syncedAt ? "마지막 동기화 " + time : "";
  $("syncstat").innerHTML = "<span>동기화</span><b>" + esc(time) + "</b><span>" + (res.ok ? "최신" : "실패") + "</span>";
  const lines = [];
  if (res.error) lines.push("동기화 오류: " + res.error);
  (res.warnings || []).forEach((w) => lines.push("경고: " + w));
  $("banner").textContent = lines.join("\n");
  if (res.action) $("banner").append(res.action);
  $("banner").classList.toggle("hidden", lines.length === 0 && !res.action);
}

function bindCopy() {
  document.querySelectorAll("[data-copy-file]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      let note = null;
      try {
        const result = await copyPathFor(folder, realRoot, button.dataset.copyFile);
        if (result.error) {
          button.textContent = "경로 없음";
          note = Object.assign(document.createElement("span"), { className: "copy-note", textContent: result.error });
          button.after(note);
        } else {
          await navigator.clipboard.writeText(result.path);
          button.textContent = "복사됨";
        }
      } catch {
        button.textContent = "복사 실패";
      }
      setTimeout(() => {
        button.textContent = "경로 복사";
        button.disabled = false;
        note?.remove();
      }, 1600);
    });
  });
}

// 읽은 결과로 화면 조각을 갈아 끼우고 이벤트를 다시 붙인다. 해시(탭·칩·검색)는 유지한다.
function mount(sections) {
  const parts = renderParts(sections, copyButtonFor(realRoot));
  $("stats").innerHTML = parts.stats;
  $("tabs").innerHTML = parts.tabs;
  $("filters").innerHTML = parts.chips;
  $("panels").innerHTML = parts.panels;
  panels = [...document.querySelectorAll(".panel")];
  tabs = [...document.querySelectorAll(".tab")];
  chips = [...document.querySelectorAll("#filters button.f")];
  TABS = tabs.map((t) => t.dataset.tab);
  features = new Set(chips.map((c) => c.dataset.feature));
  Object.assign(state, parse());
  $("q").value = state.q;
  tabs.forEach((t) => t.addEventListener("click", () => {
    state.tab = t.dataset.tab;
    render();
    const panel = panels.find((p) => p.dataset.key === state.tab);
    if (searching() && !panel.hidden) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  chips.forEach((c) => c.addEventListener("click", () => { state.f = c.dataset.feature; render(); }));
  bindCopy();
  render();
}

const EMPTY = summarize([]).sections;

function setTitle(name) {
  const title = name ? `구현 진행 현황 · ${name}` : "구현 진행 현황";
  $("title").textContent = title;
  document.title = title;
  $("src").innerHTML = name
    ? `원본은 <code>${esc(name)}/*.md</code>의 frontmatter(<code>status</code>·<code>progress</code>·<code>feature</code>)와 체크박스다. 브라우저가 폴더를 직접 읽어 그리고 파일은 쓰지 않는다. ⟳ 새로고침으로 다시 읽는다. 계획을 누르면 md 뷰어가 열린다.`
    : "";
}

function reconnectButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "f";
  button.textContent = "폴더 다시 연결";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      if ((await fsa.reconnect(folder, "read")) === "granted") { await load(); return; }
    } catch { /* 아래에서 다시 누르게 둔다 */ }
    button.disabled = false;
  });
  return button;
}

// 화면에 그대로 보일 안내 문구.
class Shown extends Error {}

const reason = (error) => {
  if (error?.name === "NotFoundError") return "폴더를 찾을 수 없다(옮겨졌거나 지워졌다). ⚙ 설정에서 폴더를 다시 고른다.";
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "폴더를 읽을 권한이 없다. '폴더 다시 연결' 또는 ⚙ 설정에서 다시 고른다.";
  return `${error?.name ?? "Error"}: ${error?.message ?? error}`;
};

// 폴더를 (다시) 읽는다. 첫 화면과 ⟳ 새로고침이 함께 쓴다. 실패해도 화면은 뜨고 배너로 알린다.
async function load() {
  const button = $("refresh");
  button.disabled = true;
  button.textContent = "동기화 중…";
  try {
    let ctx;
    try {
      ctx = await tabContext("plans");
    } catch (error) {
      throw new Shown(`브라우저 저장소를 열지 못했다: ${error.message}`);
    }
    folder = ctx.settings?.folder ?? null;
    realRoot = ctx.settings?.folderRealPath ?? "";
    setTitle(fsa.isHandle(folder) ? folder.name : "");
    if (!fsa.supported() && !fsa.isHandle(folder)) throw new Shown("이 브라우저는 폴더 읽기(File System Access API)를 지원하지 않는다. Chrome·Edge 에서 연다.");
    if (!fsa.isHandle(folder)) throw new Shown("구현 계획 폴더가 없다. ⚙ 설정에서 폴더를 고른다.");
    const permission = await fsa.permission(folder, "read");
    if (permission === "prompt") {
      mount(EMPTY);
      showSync({ ok: false, error: "브라우저가 폴더 접근 권한을 다시 묻는다. 아래 버튼을 눌러 허용한다.", syncedAt: null, action: reconnectButton() });
      return;
    }
    if (permission !== "granted") throw new Shown("폴더 권한이 거부됐다. ⚙ 설정에서 폴더를 다시 고른다.");
    const data = summarize(await readFolder(folder));
    mount(data.sections);
    showSync({ ok: true, warnings: data.warnings, syncedAt: new Date() });
  } catch (error) {
    mount(EMPTY);
    showSync({ ok: false, error: error instanceof Shown ? error.message : reason(error), syncedAt: new Date() });
  } finally {
    button.disabled = false;
    button.textContent = "⟳ 새로고침";
  }
}

$("q").addEventListener("input", () => { state.q = $("q").value; render(); });
window.addEventListener("hashchange", () => { Object.assign(state, parse()); $("q").value = state.q; render(); });
$("refresh").addEventListener("click", () => load());
// 계획 링크로 뷰어를 열 때 표시를 남긴다(새 창·새 탭으로 여는 클릭은 제외).
$("panels").addEventListener("click", (event) => {
  const link = event.target.closest("a[href^='view.html#']");
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  try { sessionStorage.setItem(FROM_LIST, "1"); } catch { /* 표시가 없으면 ← 목록이 새로 연다 */ }
});
load();
