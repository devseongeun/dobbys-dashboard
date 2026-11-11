// 구현 진행 현황 md 뷰어(웹). 화면·동작은 로컬판 plans_view.html 과 같고, 원문을 서버 /raw/ 대신 설정의 폴더 핸들에서 읽는다.
import { tabContext } from "../../lib/tab.js";
import * as fsa from "../../lib/fsa.js";
import { LABELS, STATES, obsidian, planName, splitFrontmatter, toSlug } from "./viewer.js";
import { FROM_LIST, decode } from "./plans_index.js";
import { sanitize } from "./sanitize.js";

const $ = (id) => document.getElementById(id);
const marked = globalThis.marked;

const chip = (text, cls = "") => {
  const el = document.createElement("span");
  el.className = "chip " + cls;
  el.textContent = text;
  return el;
};

const slug = (text, used) => {
  const base = toSlug(text);
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
};

function decorate(doc) {
  doc.querySelectorAll("table").forEach((t) => {
    const box = document.createElement("div");
    box.className = "tbl";
    t.replaceWith(box);
    box.appendChild(t);
  });
  doc.querySelectorAll("li input[type=checkbox]").forEach((box) => {
    const li = box.closest("li");
    box.disabled = true;
    li.classList.add("task");
    if (box.checked) li.classList.add("checked");
  });
  // 같은 폴더 md 링크는 뷰어로, 바깥 링크는 새 탭으로. 문서 안 #앵커는 해시(=파일명)를 건드리지 않고 스크롤만 한다.
  doc.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href");
    if (href.startsWith("#")) {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const target = document.getElementById(toSlug(decodeURIComponent(href.slice(1))));
        if (target) target.scrollIntoView({ block: "start" });
      });
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) { a.target = "_blank"; a.rel = "noopener"; return; }
    if (/\.md(#.*)?$/.test(href) && !href.includes("/")) a.href = "view.html#" + encodeURIComponent(decodeURIComponent(href.replace(/#.*$/, "")));
  });
  const used = new Set();
  const toc = $("toc");
  doc.querySelectorAll("h1, h2, h3").forEach((h) => {
    h.id = slug(h.textContent, used);
    const a = document.createElement("a");
    a.href = "#";
    a.className = h.tagName.toLowerCase();
    a.textContent = h.textContent;
    a.addEventListener("click", (e) => { e.preventDefault(); h.scrollIntoView({ block: "start" }); });
    toc.appendChild(a);
  });
  toc.hidden = used.size === 0;
}

function showMeta(meta, doc) {
  const box = $("meta");
  const state = STATES[(meta.status || "").toLowerCase()];
  if (state) box.appendChild(chip(LABELS[state], state));
  else if (meta.status) box.appendChild(chip("status: " + meta.status));
  if (meta.progress) box.appendChild(chip("진행률 " + meta.progress.replace(/%$/, "") + "%"));
  (meta.feature || "").replace(/^\[|\]$/g, "").split(",").map((f) => f.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
    .forEach((f) => box.appendChild(chip(f)));
  const boxes = [...doc.querySelectorAll("li.task input[type=checkbox]")];
  if (boxes.length) {
    const checked = boxes.filter((b) => b.checked).length;
    const warn = state === "done" && checked < boxes.length;
    box.appendChild(chip(`체크 ${checked}/${boxes.length}` + (warn ? " ⚠" : ""), warn ? "warn" : ""));
  }
  const updated = meta.updated || meta.created;
  if (updated) box.appendChild(chip("갱신 " + updated));
}

class Missing extends Error {}

// 폴더 핸들에서 원문을 읽는다. 권한이 'prompt' 면 null(다시 연결 버튼을 보인다).
async function readPlan(name) {
  const { settings } = await tabContext("plans");
  const folder = settings?.folder;
  if (!fsa.isHandle(folder)) throw new Error("구현 계획 폴더가 없다. ⚙ 설정에서 폴더를 고른다");
  const permission = await fsa.permission(folder, "read");
  if (permission === "prompt") return { folder, text: null };
  if (permission !== "granted") throw new Error("폴더 권한이 거부됐다");
  if (!planName(name)) throw new Missing();
  let handle;
  try {
    handle = await folder.getFileHandle(name);
  } catch (error) {
    if (["NotFoundError", "TypeMismatchError", "TypeError"].includes(error?.name)) throw new Missing();
    throw error;
  }
  return { folder, text: decode(await (await handle.getFile()).arrayBuffer()) };
}

function message(text, ...extra) {
  const doc = $("doc");
  doc.innerHTML = "";
  const p = document.createElement("p");
  p.className = "msg err";
  p.textContent = text;
  p.append(...extra);
  doc.appendChild(p);
}

async function load() {
  const name = decodeURIComponent(location.hash.slice(1));
  const doc = $("doc");
  $("toc").querySelectorAll("a").forEach((a) => a.remove());
  $("meta").replaceChildren();
  if (!name) { message("열 계획 파일명이 없다. 목록에서 계획을 누른다."); return; }
  $("title").textContent = name.replace(/\.md$/, "");
  document.title = name.replace(/\.md$/, "") + " · 계획 보기";
  try {
    const { folder, text } = await readPlan(name);
    if (text === null) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "폴더 다시 연결";
      button.addEventListener("click", async () => { if ((await fsa.reconnect(folder, "read")) === "granted") load(); });
      message("브라우저가 폴더 접근 권한을 다시 묻는다.", button);
      return;
    }
    const { meta, body } = splitFrontmatter(text);
    // md 의 원시 HTML 은 <template>(실행·로드 없음)에서 허용 목록으로 거른 뒤에 붙인다(sanitize.js).
    const rendered = document.createElement("template");
    rendered.innerHTML = marked.parse(obsidian(body), { gfm: true });
    doc.replaceChildren(sanitize(rendered.content));
    decorate(doc);
    showMeta(meta, doc);
    window.scrollTo(0, 0);
  } catch (err) {
    message(`${name} 을(를) 불러오지 못했다: ${err instanceof Missing ? "파일이 없거나 열 수 없는 경로다" : err.message}`);
  }
}

// 목록에서 왔으면 뒤로 가기로 돌아가 탭·필터·검색 상태를 살린다.
// 로컬판은 document.referrer 로 판정했지만 웹 서버는 Referrer-Policy: no-referrer 라 referrer(와 Navigation API 의 이전 URL)가 비어 있다.
// 그래서 목록이 계획 링크를 누를 때 남긴 표시(sessionStorage)를 이 문서가 열릴 때 한 번 읽어 같은 판정을 한다.
const fromList = (() => {
  try {
    const mark = sessionStorage.getItem(FROM_LIST);
    sessionStorage.removeItem(FROM_LIST);
    return mark === "1";
  } catch {
    return false;
  }
})();

$("back").addEventListener("click", (e) => {
  if (fromList && history.length > 1) {
    e.preventDefault();
    history.back();
  }
});
window.addEventListener("hashchange", load);
load();
