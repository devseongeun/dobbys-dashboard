import { openOnboarding } from "./onboarding.js";
import { frameUrl, parseShellHash, pickInitial, toShellHash } from "./route.js";

const LAST_KEY = "dobbys-dashboard:last";
const COLLAPSED_KEY = "dobbys-dashboard:collapsed";
const nav = document.getElementById("nav");
const stage = document.getElementById("stage");
const collapse = document.getElementById("collapse");
const onboarding = document.getElementById("onboarding");
const frames = new Map();
let items = [];
let config = null;
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

// 앱들은 history.replaceState 로 해시를 바꾸고, 이 호출은 hashchange 를 일으키지 않는다.
// 같은 출처 iframe 의 history 메서드를 감싸 바뀔 때마다 셸 주소를 맞춘다. 원래 호출이 먼저, 반환값도 그대로.
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

// inner === null: 사이드바 클릭. iframe 이 보던 화면을 그대로 둔다.
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
    stage.append(frame);
  } else if (inner !== null && inner !== innerOf(frame)) {
    // wbs·주간 뷰어는 hashchange 를 듣지 않는다. 주소창에서 바꾼 딥링크는 히스토리 항목을 늘리지 않게 해시를 바꾼 뒤 다시 불러와 적용한다.
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
    link.title = item.label;
    const icon = document.createElement("span");
    icon.className = "icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = item.icon;
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = item.label;
    link.append(icon, label);
    link.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      show(item.id, null);
    });
    nav.append(link);
  }
}

function markStatus() {
  fetch("/_dashboard/status").then((r) => r.json()).then(({ mounts }) => {
    for (const m of mounts) {
      if (m.ok) continue;
      const link = nav.querySelector(`a[data-id="${m.id}"]`);
      if (!link) continue;
      link.classList.add("warn");
      link.title = `${link.title} — 초기화 실패: ${m.error}`;
    }
  }).catch(() => { /* 상태 표시는 보조 기능이다 */ });
}

// 셸 자신은 replaceState 만 쓰므로, hashchange 는 사용자가 주소창을 고쳤거나 앞/뒤로 이동한 경우다.
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
  if (config) openOnboarding(onboarding, config);
});

async function boot() {
  try {
    config = await fetch("/_dashboard/config").then((r) => r.json());
  } catch {
    stage.textContent = "대시보드 서버에 연결하지 못했다.";
    return;
  }
  if (!config.configured) {
    openOnboarding(onboarding, config);
    return;
  }
  document.getElementById("project").textContent = config.project;
  document.title = `${config.project} · 도비의 대시보드`;
  items = config.tabs.filter((tab) => config.enabled.includes(tab.id));
  buildNav();
  markStatus();
  const start = parseShellHash(location.hash, items);
  const first = pickInitial(location.hash, recall(LAST_KEY), items);
  if (first) show(first, start.id ? start.inner : "");
}

boot();
