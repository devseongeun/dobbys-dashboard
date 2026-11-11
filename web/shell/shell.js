// 웹 버전 셸: 사이드바·순서 끌기·접기·해시 라우팅·⚙ 설정·버전 줄. 로컬판 shell/shell.js 를 옮겼다.
// 로컬판과 다른 점: 설정·순서는 /_dashboard/* 대신 IndexedDB(store.js), 탭 상태는 폴더·파일 권한(config.tabStatus),
// ⬆ 업데이트가 없고 버전 줄은 GET api/version, 권한이 'prompt' 인 폴더는 위 안내 줄의 '폴더 다시 연결' 버튼으로 되살린다.
import { frameUrl, parseShellHash, pickInitial, toShellHash } from "../shared/route.js";
import { dropAfter, moveItem, sameOrder } from "../shared/order.js";
import { IMPORTED_KEY, UNSUPPORTED, labBadge, openOnboarding } from "./onboarding.js";
import { describe, reorder, tabStatus } from "../lib/config.js";
import * as fsa from "../lib/fsa.js";
import { apiFetch } from "../lib/api.js";
import { loadConfig, saveConfig } from "../lib/store.js";
import { WEB_TABS } from "../tabs/manifest.js";

const LAST_KEY = "dobbys-dashboard:last";
const COLLAPSED_KEY = "dobbys-dashboard:collapsed";
const nav = document.getElementById("nav");
const stage = document.getElementById("stage");
const framesEl = document.getElementById("frames");
const noticeEl = document.getElementById("notice");
const collapse = document.getElementById("collapse");
const onboarding = document.getElementById("onboarding");
const versionEl = document.getElementById("version");
const frames = new Map();
let items = [];
let saved = null;   // store.loadConfig() 결과
let desc = null;    // config.describe(saved)
let active = null;

const remember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* 저장소 차단 시 무시 */ } };
const recall = (key) => { try { return localStorage.getItem(key); } catch { return null; } };

function innerOf(frame) {
  try { return frame.contentWindow.location.hash.replace(/^#/, ""); } catch { return ""; }
}

function syncAddress(id) {
  if (id !== active) return;
  const next = toShellHash(id, innerOf(frames.get(id)));
  if (location.hash !== next) history.replaceState(null, "", next);
}

// 같은 출처 iframe 의 history 메서드를 감싸 앱 해시가 바뀔 때마다 셸 주소를 맞춘다(로컬판과 같다).
function watch(id, frame) {
  frame.addEventListener("load", () => {
    try {
      const win = frame.contentWindow;
      for (const name of ["replaceState", "pushState"]) {
        const original = win.history[name];
        win.history[name] = function (...args) {
          const result = original.apply(this, args);
          try { syncAddress(id); } catch { /* 셸 동기화 실패가 앱을 깨뜨리지 않게 한다 */ }
          return result;
        };
      }
      win.addEventListener("hashchange", () => syncAddress(id));
    } catch { /* 다른 출처로 이동한 경우 */ }
    syncAddress(id);
  });
}

function mark(id) {
  for (const link of nav.querySelectorAll("a")) {
    if (link.dataset.id === id) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

function show(id, inner) {
  const item = items.find((it) => it.id === id);
  let frame = frames.get(id);
  const created = !frame;
  if (created) {
    frame = document.createElement("iframe");
    frame.title = item.label;
    frame.src = frameUrl(item, inner || "");
    watch(id, frame);
    frames.set(id, frame);
    framesEl.append(frame);
  } else if (inner !== null && inner !== innerOf(frame)) {
    frame.contentWindow.history.replaceState(null, "", "#" + inner);
    frame.contentWindow.location.reload();
  }
  for (const [key, f] of frames) f.hidden = key !== id;
  active = id;
  remember(LAST_KEY, id);
  mark(id);
  if (created) history.replaceState(null, "", toShellHash(id, inner || ""));
  else syncAddress(id);
}

function buildNav() {
  for (const item of items) {
    const link = document.createElement("a");
    link.href = "#" + item.id;
    link.dataset.id = item.id;
    link.title = item.experimental ? `${item.label} (실험실)` : item.label;
    link.draggable = true;
    const icon = document.createElement("span");
    icon.className = "icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = item.icon;
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = item.label;
    if (item.experimental) label.append(labBadge());
    link.append(icon, label);
    link.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      show(item.id, null);
    });
    nav.append(link);
  }
  enableReorder();
}

// 놓으면 DOM 을 먼저 옮기고 IndexedDB(config.order)에 저장한다. 저장이 실패하면 되돌린다.
export async function persistOrder(order) {
  const next = reorder(saved, WEB_TABS, order);
  await saveConfig(next);
  saved = next;
  desc = describe(saved, WEB_TABS);
  return desc;
}

function enableReorder() {
  let dragging = null;
  const links = () => [...nav.querySelectorAll("a[data-id]")];
  const currentOrder = () => links().map((a) => a.dataset.id);
  const clearMarks = () => links().forEach((a) => a.classList.remove("drop-before", "drop-after"));
  const applyOrder = (order) => {
    const byId = new Map(links().map((a) => [a.dataset.id, a]));
    order.forEach((id) => nav.append(byId.get(id)));
    items = order.map((id) => items.find((item) => item.id === id));
  };

  nav.addEventListener("dragstart", (event) => {
    const link = event.target.closest("a[data-id]");
    if (!link) return;
    dragging = link.dataset.id;
    link.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dragging);
  });
  nav.addEventListener("dragover", (event) => {
    const link = event.target.closest("a[data-id]");
    if (!dragging || !link || link.dataset.id === dragging) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const after = dropAfter(event.clientY, link.getBoundingClientRect());
    clearMarks();
    link.classList.add(after ? "drop-after" : "drop-before");
  });
  nav.addEventListener("dragleave", (event) => {
    if (!nav.contains(event.relatedTarget)) clearMarks();
  });
  nav.addEventListener("drop", async (event) => {
    const link = event.target.closest("a[data-id]");
    if (!dragging || !link) return;
    event.preventDefault();
    const before = currentOrder();
    const order = moveItem(before, dragging, link.dataset.id, dropAfter(event.clientY, link.getBoundingClientRect()));
    clearMarks();
    if (sameOrder(before, order)) return;
    applyOrder(order);
    try {
      await persistOrder(order);
    } catch {
      applyOrder(before);
    }
  });
  nav.addEventListener("dragend", () => {
    links().forEach((a) => a.classList.remove("dragging"));
    clearMarks();
    dragging = null;
  });
}

function notice(nodes) {
  noticeEl.replaceChildren(...nodes);
  noticeEl.hidden = nodes.length === 0;
}

function para(text, cls = "") {
  const p = document.createElement("p");
  if (cls) p.className = cls;
  p.textContent = text;
  return p;
}

// 탭마다 폴더·파일 권한을 보고, 못 여는 탭은 사이드바 항목만 경고색으로. 권한이 'prompt' 면 위에 '폴더 다시 연결'.
async function markStatus() {
  let statuses;
  try {
    statuses = await tabStatus(desc, fsa);
  } catch {
    return;  // 상태 표시는 보조 기능이다
  }
  for (const link of nav.querySelectorAll("a[data-id]")) {
    link.classList.remove("warn");
    link.title = link.title.replace(/ — 초기화 실패: .*$/, "");
  }
  for (const s of statuses) {
    if (s.ok) continue;
    const link = nav.querySelector(`a[data-id="${s.id}"]`);
    if (!link) continue;
    link.classList.add("warn");
    link.title = `${link.title} — 초기화 실패: ${s.error}`;
  }
  const pending = statuses.flatMap((s) => s.pending);
  const nodes = [];
  if (!fsa.supported()) nodes.push(para(UNSUPPORTED, "warn"));
  if (pending.length) {
    nodes.push(para(`브라우저가 폴더 접근 권한을 다시 묻습니다: ${[...new Set(pending.map((p) => p.label))].join(", ")}. 아래 버튼을 눌러 허용하세요.`));
    const reconnectButton = document.createElement("button");
    reconnectButton.type = "button";
    reconnectButton.textContent = "폴더 다시 연결";
    reconnectButton.addEventListener("click", async () => {
      reconnectButton.disabled = true;
      const touched = new Set();
      for (const p of pending) {
        try {
          if ((await fsa.reconnect(p.handle, p.mode)) === "granted") touched.add(p.tab);
        } catch { /* 이 핸들은 다음 클릭에서 다시 묻는다 */ }
      }
      for (const id of touched) frames.get(id)?.contentWindow?.location.reload();
      await markStatus();
    });
    nodes.push(reconnectButton);
  }
  notice(nodes);
}

window.addEventListener("hashchange", () => {
  const { id, inner } = parseShellHash(location.hash, items);
  if (id) show(id, inner);
});

function setCollapsed(on) {
  document.body.classList.toggle("collapsed", on);
  collapse.setAttribute("aria-expanded", String(!on));
  collapse.setAttribute("aria-label", on ? "사이드바 펼치기" : "사이드바 접기");
  collapse.textContent = on ? "»" : "«";
}
setCollapsed(recall(COLLAPSED_KEY) === "1");
collapse.addEventListener("click", () => {
  const on = !document.body.classList.contains("collapsed");
  setCollapsed(on);
  remember(COLLAPSED_KEY, on ? "1" : "0");
});

document.getElementById("settings").addEventListener("click", (event) => {
  event.preventDefault();
  if (desc) openOnboarding(onboarding, desc, saved);
});

// 버전 줄: 서버가 기동 때 읽은 배포 체크아웃의 커밋. 모르면 빈칸.
async function showVersion() {
  try {
    const res = await apiFetch("version");
    if (!res.ok) return;
    const { commit, date } = await res.json();
    versionEl.textContent = commit ? `${commit}${date ? ` · ${date}` : ""}` : "";
  } catch { /* 버전 표시는 보조 기능이다 */ }
}

function takeImported() {
  try {
    const raw = sessionStorage.getItem(IMPORTED_KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(IMPORTED_KEY);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function boot() {
  showVersion();
  try {
    saved = await loadConfig();
  } catch {
    framesEl.textContent = "브라우저 저장소(IndexedDB)를 열지 못했다. 시크릿 창이거나 사이트 데이터 저장이 막혀 있으면 일반 창에서 열거나 이 사이트의 저장을 허용한다.";
    return;
  }
  desc = describe(saved, WEB_TABS);
  const imported = takeImported();
  if (!desc.configured) {
    openOnboarding(onboarding, desc, saved);
    return;
  }
  document.getElementById("project").textContent = desc.project;
  document.title = `${desc.project} · 도비의 대시보드`;
  items = desc.enabled.map((id) => desc.tabs.find((tab) => tab.id === id)).filter(Boolean);
  buildNav();
  markStatus();
  const start = parseShellHash(location.hash, items);
  const first = pickInitial(location.hash, recall(LAST_KEY), items);
  if (first) show(first, start.id ? start.inner : "");
  if (imported) {
    const label = (path) => {
      const [tabId, key] = String(path).split(".");
      const tab = desc.tabs.find((item) => item.id === tabId);
      const field = tab?.fields.find((item) => item.key === key.replace(/\[\d+\]$/, ""));
      return tab && field ? `${tab.label} › ${field.label}` : path;
    };
    const what = imported.length ? ` 다시 골라야 할 칸: ${[...new Set(imported.map(label))].join(", ")}.` : "";
    openOnboarding(onboarding, desc, saved, { notice: `설정을 가져왔습니다.${what} 폴더·파일은 이 브라우저에서 다시 골라 저장하세요.` });
  }
}

boot();
// 확인용: 셸 상태를 읽는 창구(테스트·브라우저 도구 eval 에서 쓴다). 화면 동작에는 쓰지 않는다.
window.__dobbysShell = { get desc() { return desc; }, get saved() { return saved; }, markStatus, persistOrder, stage };
