// 회의 자료 화면(웹 버전). 로컬판 tabs/meetings/meetings.js 를 옮겼다. 업무(Canvas) 목록·Vault 트리·회의 블록(Canvas 그룹)
// 카드·편집·미리보기를 그린다. 순수 함수는 로컬판 meetings_lib.js 를 그대로 쓴다(web_serve.py SHARED_FILES).
// 로컬판과 다른 곳(나머지 함수는 같다 — tests/js/meetings_web/same_screen.test.js):
// - getJson·postJson: 서버 fetch 대신 backend.js(같은 주소·같은 응답 모양, 폴더는 FSA 핸들로 직접 읽고 쓴다). 409 면 알리고 다시 읽는다.
// - renderMarkdown: md·메모의 원시 HTML 을 plans 뷰어와 같은 허용 목록(sanitize.js)으로 거른다.
// - renderPreview: /file 대신 Vault 핸들에서 읽은 Blob. HTML·SVG·이미지는 sandbox iframe(스크립트·같은 출처 접근 없음).
// - 시작: 설정의 Vault·회의 폴더를 연결하고, 못 하면 까닭(권한이 'prompt' 면 '폴더 다시 연결')을 보인다.
import {
  clampPane, dropIndex, fileInfo, filterMeetings, isWebUrl, linkLabel, obsidianToMarkdown, obsidianUri, parseState,
  stripFrontmatter, toHash, todayIso,
} from "./meetings_lib.js";
import { sanitize } from "../plans/sanitize.js";
import { tabContext } from "../../lib/tab.js";
import * as fsa from "../../lib/fsa.js";
import { openFolders } from "./backend.js";

const $ = (id) => document.getElementById(id);
// Obsidian Canvas 색 프리셋 1~6.
const PRESET = { 1: "#f87171", 2: "#fb923c", 3: "#facc15", 4: "#4ade80", 5: "#22d3ee", 6: "#c084fc" };
const UNGROUPED = "_ungrouped";
let meetings = [];
let listError = "";
let listQuery = "";
let loaded = { id: null, promise: null };
let current = null;
let renderedId = null;
let previewKey = ""; // 미리보기가 지금 보여 주는 것. 같으면 본문을 다시 그리지 않는다.
let addTarget = ""; // 미리보기 "담기"에서 마지막으로 고른 회의 블록 id.
let seq = 0;
let busy = false;
let dragging = null; // { kind: "item", id, block } | { kind: "file", path }
let marker = null; // { list, index }
let treeSeq = 0;
let searchTimer = 0;
let noticeTimer = 0;
const tree = { open: new Set(), dirs: new Map() };
let backend = null; // backend.js. 시작할 때 설정의 폴더로 만든다.
let previewUrl = ""; // 미리보기 iframe 의 Blob 주소. 바뀌면 이전 것을 놓는다.

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

// 로컬판 서버 응답과 같은 모양. 실패는 Error(message, status, version) — 깨진 Canvas(422)도 version 을 준다(업무 삭제에 쓴다).
function getJson(url) {
  return backend.get(url);
}

function postJson(url, body) {
  return backend.post(url, body);
}

function notice(text) {
  const box = $("notice");
  box.textContent = text;
  box.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { box.hidden = true; }, 5000);
}

// md 파일·메모 노드 렌더. 바깥 링크는 새 탭, 나머지(상대 경로·앵커)는 iframe 해시를 깨지 않게 글자로 둔다.
// marked 결과는 <template>(실행·로드 없음)에서 plans 뷰어와 같은 허용 목록(sanitize.js)으로 거른 뒤에 붙인다.
function renderMarkdown(target, src) {
  const rendered = document.createElement("template");
  rendered.innerHTML = marked.parse(obsidianToMarkdown(stripFrontmatter(src)), { gfm: true });
  target.replaceChildren(sanitize(rendered.content));
  for (const a of target.querySelectorAll("a[href]")) {
    if (isWebUrl(a.getAttribute("href"))) { a.target = "_blank"; a.rel = "noopener"; }
    else a.removeAttribute("href");
  }
}

async function refreshList() {
  try { meetings = (await getJson("api/meetings")).meetings; listError = ""; }
  catch (err) { meetings = []; listError = err.message; }
}

// 해시의 업무가 목록에 없으면(처음 열었거나 바깥에서 이름이 바뀜) 첫 업무로. 보고 있던 파일은 그대로 둔다.
function ensureSelection() {
  const { meeting, file } = parseState(location.hash);
  if (!meetings.length || meetings.some((m) => m.id === meeting)) return;
  history.replaceState(null, "", toHash({ meeting: meetings[0].id, file }));
}

function loadDetail(id) {
  if (loaded.id !== id) {
    const promise = id
      ? getJson("api/meetings/" + encodeURIComponent(id)).then(
        (detail) => ({ detail, error: "" }), (err) => ({ detail: null, error: err.message, version: err.version }))
      : Promise.resolve({ detail: null, error: "" });
    loaded = { id, promise };
  }
  return loaded.promise;
}

// ── 쓰기 ──────────────────────────────────────────────

// 쓰기 하나를 실행하고 바뀐 상세로 다시 그린다. 성공하면 그 상세를, 실패하면 null 을 돌려준다.
async function run(request) {
  if (busy) return null;
  busy = true;
  document.body.classList.add("busy");
  let result = null;
  try {
    const detail = await request();
    loaded = { id: detail.id, promise: Promise.resolve({ detail, error: "" }) };
    if (detail.id !== parseState(location.hash).meeting) {
      await refreshList();
      history.replaceState(null, "", toHash({ meeting: detail.id, file: parseState(location.hash).file }));
    }
    result = detail;
  } catch (err) {
    notice(err.status === 409 && err.version ? "Canvas가 바뀌어 다시 불러왔다. 한 번 더 해 본다." : "저장하지 못했다: " + err.message);
    loaded = { id: null, promise: null };
    await refreshList();
    ensureSelection();
  } finally {
    busy = false;
    document.body.classList.remove("busy");
  }
  await sync();
  return result;
}

function write(path, body = {}) {
  if (!current) return Promise.resolve();
  const url = `api/meetings/${encodeURIComponent(current.id)}${path}`;
  const version = current.version;
  return run(() => postJson(url, { ...body, version }));
}

// 한 줄 입력 폼. Enter 저장, Esc·취소는 onCancel. focus 가 참인 칸(없으면 첫 칸)에 초점을 둔다.
function inlineForm(fields, submitLabel, onSubmit, onCancel) {
  const form = el("form", "inline");
  let first = null;
  for (const field of fields) {
    const input = el("input");
    input.name = field.name;
    input.type = field.type || "text";
    input.value = field.value || "";
    input.placeholder = field.placeholder || "";
    input.required = Boolean(field.required);
    if (field.focus || !first) first = input;
    form.append(input);
  }
  const ok = el("button", "btn", submitLabel);
  ok.type = "submit";
  const cancel = el("button", "btn", "취소");
  cancel.type = "button";
  cancel.addEventListener("click", onCancel);
  form.append(ok, cancel);
  form.addEventListener("submit", (e) => { e.preventDefault(); onSubmit(Object.fromEntries(new FormData(form))); });
  form.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } });
  setTimeout(() => first?.focus(), 0);
  return form;
}

// 새 업무(Canvas)를 만들면 그 업무로 옮기고 첫 회의 입력 칸을 바로 연다.
function startNewMeeting() {
  const slot = $("new-meeting-slot");
  if (slot.firstChild) return;
  const close = () => slot.replaceChildren();
  slot.append(inlineForm([{ name: "title", placeholder: "업무 이름(예: 외부 연계, 외부 결재)", required: true }], "만들기",
    async ({ title }) => {
      close();
      const created = await run(() => postJson("api/meetings", { title }));
      if (created && current?.id === created.id) startNewBlock();
    }, close));
}

// 업무 이름은 파일명 그대로(예전 파일의 앞 날짜 포함) 한 칸에서 고친다.
function startRenameMeeting() {
  if (!current || busy) return;
  const title = $("title");
  if (title.hidden) return;
  const close = () => { form.remove(); title.hidden = false; };
  const form = inlineForm([{ name: "title", value: current.id, placeholder: "업무 이름", required: true }], "저장",
    ({ title: name }) => { close(); write("/rename", { title: name }); }, close);
  form.dataset.meeting = current.id;
  title.hidden = true;
  title.after(form);
}

// 회의 블록 이름은 `YYYY-MM-DD 회의 이름`. 날짜가 블록 정렬(최신순) 기준이다.
function startNewBlock() {
  const slot = $("new-block-slot");
  if (!current || slot.firstChild) return;
  const close = () => slot.replaceChildren();
  slot.append(inlineForm([
    { name: "date", type: "date", value: todayIso() },
    { name: "name", placeholder: "회의 이름(예: 인프라 업무 협조 요청)", required: true, focus: true },
  ], "만들기", ({ date, name }) => { close(); write("/blocks", { label: `${date} ${name.trim()}`.trim() }); }, close));
}

// 업무 지우기. Canvas는 회의 폴더의 .trash/ 로 옮겨지고 담긴 파일은 그대로다. 보고 있던 업무면 목록의 다음 업무로 옮긴다.
async function deleteMeeting(id) {
  if (busy) return;
  const { detail, error, version } = await loadDetail(id);
  const entry = meetings.find((m) => m.id === id);
  const name = entry ? entry.id : id;
  // 깨진 Canvas는 상세 대신 오류와 version 만 온다. 그래도 지울 수 있다.
  if (!detail && !version) { notice("업무를 불러오지 못해 지울 수 없다: " + error); return; }
  const cards = detail ? detail.blocks.reduce((sum, block) => sum + block.items.length, 0) : 0;
  const keep = detail ? `담긴 카드 ${cards}개의 파일은 지우지 않는다.` : "Canvas를 읽지 못해 담긴 카드를 셀 수 없지만 파일은 지우지 않는다.";
  const meetingsIn = detail ? `회의 ${detail.blocks.filter((b) => b.id !== UNGROUPED).length}개와 ` : "";
  if (!confirm(`"${name}" 업무를 지운다(${meetingsIn}Canvas 전체).\n\nCanvas는 회의 폴더의 .trash/ 로 옮겨 두고, ${keep}`)) return;
  const index = meetings.findIndex((m) => m.id === id);
  busy = true;
  document.body.classList.add("busy");
  try {
    meetings = (await postJson(`api/meetings/${encodeURIComponent(id)}/delete`, { version: detail?.version ?? version })).meetings;
    listError = "";
    loaded = { id: null, promise: null };
    const state = parseState(location.hash);
    if (state.meeting === id) {
      const next = meetings[Math.min(index, meetings.length - 1)];
      history.replaceState(null, "", toHash({ meeting: next?.id ?? "", file: state.file }) || location.pathname);
    }
    notice(`"${name}" 업무를 지웠다. 되살리려면 회의 폴더 .trash/ 안의 파일을 다시 옮긴다.`);
  } catch (err) {
    notice(err.status === 409 ? "Canvas가 바뀌어 지우지 않았다. 다시 확인하고 지운다." : "지우지 못했다: " + err.message);
    loaded = { id: null, promise: null };
    await refreshList();
    ensureSelection();
  } finally {
    busy = false;
    document.body.classList.remove("busy");
  }
  await sync();
}

// 목록의 ✎: 그 업무로 옮긴 뒤 이름 입력 칸을 연다.
async function renameFromList(id) {
  if (busy) return;
  if (parseState(location.hash).meeting !== id) {
    history.replaceState(null, "", toHash({ meeting: id, file: parseState(location.hash).file }));
    await sync();
  }
  startRenameMeeting();
}

function closeMenu() {
  $("meeting-menu-list").hidden = true;
  $("meeting-menu").setAttribute("aria-expanded", "false");
}

function deleteBlock(block) {
  if (busy) return;
  const cards = block.items.length;
  const rest = cards ? `안의 카드 ${cards}개는 지우지 않고 바깥 블록이나 미분류로 남는다.` : "빈 회의다.";
  if (confirm(`"${block.label}" 회의 블록을 지운다. ${rest}`)) write(`/blocks/${encodeURIComponent(block.id)}/delete`);
}

function startRenameBlock(heading, block) {
  if (busy) return;
  const close = () => { form.remove(); heading.hidden = false; };
  const form = inlineForm([{ name: "label", value: block.label, placeholder: "YYYY-MM-DD 회의 이름", required: true }], "저장",
    ({ label }) => { close(); write(`/blocks/${encodeURIComponent(block.id)}/rename`, { label }); }, close);
  heading.hidden = true;
  heading.after(form);
}

function addLinkButton(block) {
  const button = el("button", "btn add-link", "+ 링크");
  button.type = "button";
  button.addEventListener("click", () => {
    const close = () => form.replaceWith(button);
    const form = inlineForm([{ name: "url", type: "url", placeholder: "https://…", required: true }], "추가",
      ({ url }) => { close(); write(`/blocks/${encodeURIComponent(block.id)}/items`, { kind: "link", url }); }, close);
    button.replaceWith(form);
  });
  return button;
}

// ── 드래그 앤 드롭 ─────────────────────────────────────

function accepts(block) {
  if (!dragging || !block.id) return false;
  if (dragging.kind === "file") return block.id !== UNGROUPED;
  return dragging.block === block.id || block.id !== UNGROUPED;
}

function rowsFor(list) {
  return [...list.querySelectorAll(":scope > li.item")]
    .filter((li) => !(dragging?.kind === "item" && li.dataset.id === dragging.id));
}

function slotIndex(list, y) {
  return dropIndex(rowsFor(list).map((li) => { const r = li.getBoundingClientRect(); return r.top + r.height / 2; }), y);
}

function clearMarker() {
  document.querySelectorAll(".drop-marker").forEach((m) => m.remove());
  document.querySelectorAll(".drop-target").forEach((c) => c.classList.remove("drop-target"));
  marker = null;
}

function showMarker(card, list, index) {
  if (marker && marker.list === list && marker.index === index) return;
  clearMarker();
  list.insertBefore(el("li", "drop-marker"), rowsFor(list)[index] ?? null);
  card.classList.add("drop-target");
  marker = { list, index };
}

function wireDrop(card, list, block) {
  card.addEventListener("dragover", (e) => {
    if (!accepts(block)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = dragging.kind === "file" ? "copy" : "move";
    showMarker(card, list, slotIndex(list, e.clientY));
  });
  card.addEventListener("dragleave", (e) => {
    if (!card.contains(e.relatedTarget)) clearMarker();
  });
  card.addEventListener("drop", (e) => {
    if (!accepts(block)) return;
    e.preventDefault();
    const index = slotIndex(list, e.clientY);
    const drag = dragging;
    dragging = null;
    clearMarker();
    if (drag.kind === "file") {
      write(`/blocks/${encodeURIComponent(block.id)}/items`, { kind: "file", path: drag.path, index });
      return;
    }
    const from = block.items.findIndex((i) => i.id === drag.id);
    if (drag.block === block.id && from === index) return;
    write(`/items/${encodeURIComponent(drag.id)}/move`, { block: block.id, index });
  });
}

// ── 목록·보드 ─────────────────────────────────────────

function listAction(text, title, onClick) {
  const button = el("button", "act", text);
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("click", (e) => { e.preventDefault(); onClick(); });
  return button;
}

function renderList(state) {
  const ul = $("meetings");
  ul.replaceChildren();
  if (listError) { ul.append(el("li", "msg err", "목록을 불러오지 못했다: " + listError)); return; }
  if (!meetings.length) { ul.append(el("li", "msg", "업무가 없다. + 업무로 만든다.")); return; }
  const shown = filterMeetings(meetings, listQuery);
  if (!shown.length) { ul.append(el("li", "msg", "검색과 맞는 업무가 없다.")); return; }
  for (const meeting of shown) {
    const a = el("a");
    a.href = toHash({ meeting: meeting.id });
    if (meeting.date) a.append(el("span", "date", meeting.date));
    a.append(el("span", "name", meeting.title));
    if (meeting.error) { a.append(el("span", "badge err", "오류")); a.title = meeting.error; }
    const actions = el("span", "acts");
    actions.append(
      listAction("✎", "업무 이름 바꾸기", () => renameFromList(meeting.id)),
      listAction("🗑", "업무 삭제", () => deleteMeeting(meeting.id)),
    );
    const li = el("li", meeting.id === state.meeting ? "on" : "");
    li.append(a, actions);
    ul.append(li);
  }
}

function renderItem(detail, item, state, block) {
  const li = el("li", "item " + item.kind);
  if (item.id) {
    li.dataset.id = item.id;
    li.draggable = true;
    li.append(el("span", "handle", "⠿"));
    li.addEventListener("dragstart", (e) => {
      dragging = { kind: "item", id: item.id, block: block.id };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", item.id);
      li.classList.add("dragging");
    });
    li.addEventListener("dragend", () => { dragging = null; li.classList.remove("dragging"); clearMarker(); });
  }
  if (item.kind === "file") {
    if (item.path === state.file) li.classList.add("current");
    const a = el("a", "label", "📄 " + item.name + item.subpath);
    a.href = toHash({ meeting: detail.id, file: item.path });
    a.title = item.path;
    li.append(a);
    if (item.missing) li.append(el("span", "badge err", "파일 없음"));
    const open = el("a", "open", "↗");
    open.href = obsidianUri(detail.vault, item.path);
    open.title = "Obsidian에서 열기";
    li.append(open);
  } else if (item.kind === "link") {
    if (isWebUrl(item.url)) {
      const a = el("a", "label", "🔗 " + linkLabel(item.url));
      a.href = item.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.title = item.url;
      li.append(a);
    } else {
      li.append(el("span", "label", "🔗 " + item.url));
    }
  } else {
    const memo = el("div", "memo md");
    renderMarkdown(memo, item.text);
    li.append(el("span", "icon", "📝"), memo);
  }
  if (item.id) {
    const del = el("button", "del", "✕");
    del.type = "button";
    del.title = "이 회의에서 빼기(파일은 그대로)";
    del.addEventListener("click", () => {
      const name = item.kind === "file" ? item.name : item.kind === "link" ? item.url : "메모";
      if (confirm(`"${name}" 카드를 이 회의에서 뺀다. 파일은 지우지 않는다.`)) {
        write(`/items/${encodeURIComponent(item.id)}/delete`);
      }
    });
    li.append(del);
  }
  return li;
}

function renderBlock(detail, block, state) {
  const card = el("section", "block");
  const color = PRESET[block.color] || block.color;
  if (color) card.style.setProperty("--block", color);
  const editable = Boolean(block.id) && block.id !== UNGROUPED;
  const heading = el("h2", editable ? "editable" : "", block.label);
  const head = el("div", "block-head");
  head.append(heading);
  if (editable) {
    heading.title = "눌러서 회의 이름 바꾸기";
    heading.addEventListener("click", () => startRenameBlock(heading, block));
    const del = el("button", "del", "✕");
    del.type = "button";
    del.title = "회의 블록 삭제(안의 카드·파일은 그대로)";
    del.addEventListener("click", () => deleteBlock(block));
    head.append(del);
  }
  const list = el("ul", "items");
  if (!block.items.length) list.append(el("li", "msg", "비어 있음 — 파일을 여기로 끌어다 놓는다"));
  for (const item of block.items) list.append(renderItem(detail, item, state, block));
  card.append(head, list);
  if (editable) card.append(addLinkButton(block));
  wireDrop(card, list, block);
  return card;
}

function renderBoard(state, { detail, error }) {
  const box = $("blocks");
  box.replaceChildren();
  // 다른 업무로 바뀌면 이전 업무의 이름 바꾸기·새 회의 폼과 업무 메뉴를 닫는다.
  for (const form of document.querySelectorAll(".bar > form.inline[data-meeting]")) {
    if (form.dataset.meeting !== detail?.id) form.remove();
  }
  if (!document.querySelector(".bar > form.inline[data-meeting]")) $("title").hidden = false;
  if (renderedId !== (detail?.id ?? null)) { $("new-block-slot").replaceChildren(); closeMenu(); }
  renderedId = detail?.id ?? null;
  $("meeting-menu").hidden = true;
  $("new-block").hidden = true;
  current = detail;
  if (!detail) {
    $("title").textContent = state.meeting || "업무를 고른다";
    document.title = "회의 자료";
    if (state.meeting) box.append(el("p", "msg err", "불러오지 못했다: " + error));
    return;
  }
  $("title").textContent = (detail.date ? detail.date + " · " : "") + detail.title;
  document.title = detail.title + " · 회의 자료";
  $("open-canvas").href = obsidianUri(detail.vault, detail.canvasPath);
  $("meeting-menu").hidden = false;
  $("new-block").hidden = false;
  if (!detail.blocks.length) {
    box.append(el("p", "msg", "회의가 없다. + 회의로 만들거나, Obsidian에서 이 Canvas에 그룹을 만든다."));
    return;
  }
  for (const block of detail.blocks) box.append(renderBlock(detail, block, state));
}

// 미리보기 헤더의 "회의에 담기". 이미 이 업무에 담긴 파일이면 담긴 회의 이름만 보인다.
function renderAddControl(detail, path) {
  const box = $("preview-add");
  box.replaceChildren();
  if (!detail) return;
  const holders = detail.blocks.filter((b) => b.items.some((i) => i.kind === "file" && i.path === path));
  if (holders.length) { box.append(el("span", "badge", "담김 · " + holders.map((b) => b.label).join(", "))); return; }
  const targets = detail.blocks.filter((b) => b.id && b.id !== UNGROUPED);
  if (!targets.length) { box.append(el("span", "badge", "+ 회의를 먼저 만든다")); return; }
  const select = el("select");
  select.title = "담을 회의";
  for (const block of targets) {
    const option = el("option", "", block.label);
    option.value = block.id;
    select.append(option);
  }
  if (targets.some((b) => b.id === addTarget)) select.value = addTarget;
  select.addEventListener("change", () => { addTarget = select.value; });
  const button = el("button", "btn", "+ 담기");
  button.type = "button";
  button.addEventListener("click", () => {
    addTarget = select.value;
    write(`/blocks/${encodeURIComponent(select.value)}/items`, { kind: "file", path });
  });
  box.append(select, button);
}

function setPreviewUrl(url) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = url;
}

// 오른쪽 미리보기. 업무에 담긴 파일이면 그 카드 정보로, 아니면(Vault 트리에서 고른 파일) 경로로 판단한다.
// 파일은 Vault 핸들에서 Blob 으로 읽는다. md·txt 는 글로 그리고, 나머지는 Blob 주소 iframe 으로 연다.
async function renderPreview(state, detail) {
  const path = state.file;
  document.body.classList.toggle("previewing", Boolean(path));
  applyWidths();
  $("preview").hidden = !path;
  if (!path) { previewKey = ""; setPreviewUrl(""); $("preview-body").replaceChildren(); $("preview-add").replaceChildren(); return; }
  const item = detail?.blocks.flatMap((block) => block.items).find((i) => i.kind === "file" && i.path === path);
  const view = item ?? { path, missing: false, ...fileInfo(path) };
  $("preview-title").textContent = view.name;
  $("preview-title").title = path;
  $("preview-open").hidden = !detail;
  if (detail) $("preview-open").href = obsidianUri(detail.vault, path);
  $("preview-close").href = toHash({ meeting: state.meeting }) || "#";
  renderAddControl(detail, path);
  // 같은 파일을 보여 주고 있으면 본문을 그대로 둔다(편집·업무 전환에도 PDF 쪽·스크롤이 유지되게).
  const key = `${path}\n${view.missing}\n${view.preview}`;
  if (key === previewKey) return;
  previewKey = key;
  const body = $("preview-body");
  body.replaceChildren();
  setPreviewUrl("");
  if (view.missing) { body.append(el("p", "msg err", "파일이 없다. Canvas의 경로가 바뀌었는지 확인한다: " + path)); return; }
  if (!view.preview) { body.append(el("p", "msg", "이 형식은 미리보기를 지원하지 않는다. Obsidian에서 연다.")); return; }
  body.append(el("p", "msg", "불러오는 중…"));
  try {
    const blob = await backend.file(path);
    // 같은 키의 다음 sync 는 본문을 건드리지 않으므로 ticket 이 아니라 키로 판단한다.
    if (previewKey !== key) return;
    if (view.ext !== ".md" && view.ext !== ".txt") {
      const frame = el("iframe", "frame");
      // PDF(브라우저 PDF 뷰어는 sandbox 안에서 열리지 않는다) 말고는 스크립트·같은 출처 접근 없이 연다.
      if (view.ext !== ".pdf") frame.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
      frame.title = view.name;
      setPreviewUrl(URL.createObjectURL(blob));
      frame.src = previewUrl;
      body.replaceChildren(frame);
      return;
    }
    const text = await blob.text();
    if (previewKey !== key) return;
    const doc = el("article", "md doc");
    if (view.ext === ".md") renderMarkdown(doc, text);
    else doc.append(el("pre", "", text));
    body.replaceChildren(doc);
  } catch (err) {
    if (previewKey !== key) return;
    previewKey = ""; // 실패한 키는 남기지 않아 다음 sync 가 다시 시도한다.
    body.replaceChildren(el("p", "msg err", "불러오지 못했다: " + err.message));
  }
}

// 트리에서 지금 미리보기 중인 파일 행을 강조한다.
function markTree(path) {
  for (const row of $("tree").querySelectorAll(".node.file")) row.classList.toggle("current", row.dataset.path === path);
}

async function sync() {
  const ticket = ++seq;
  const state = parseState(location.hash);
  renderList(state);
  markTree(state.file);
  const result = await loadDetail(state.meeting);
  if (ticket !== seq) return;
  renderBoard(state, result);
  await renderPreview(state, result.detail);
}

// ── Vault 트리 ────────────────────────────────────────

function loadDir(path) {
  if (!tree.dirs.has(path)) {
    const promise = getJson("api/tree?path=" + encodeURIComponent(path)).then((data) => data.entries);
    promise.catch(() => tree.dirs.delete(path));
    tree.dirs.set(path, promise);
  }
  return tree.dirs.get(path);
}

function fileRow(entry, depth, sub) {
  const row = el("div", "node file");
  row.style.paddingLeft = 8 + depth * 14 + "px";
  row.append(el("span", "", "📄 " + entry.name));
  if (sub) row.append(el("span", "sub", sub));
  row.title = entry.path;
  row.dataset.path = entry.path;
  if (entry.path === parseState(location.hash).file) row.classList.add("current");
  row.addEventListener("click", () => {
    location.hash = toHash({ ...parseState(location.hash), file: entry.path });
  });
  row.draggable = true;
  row.addEventListener("dragstart", (e) => {
    dragging = { kind: "file", path: entry.path };
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", entry.path);
  });
  row.addEventListener("dragend", () => { dragging = null; clearMarker(); });
  return row;
}

async function dirRows(path, depth) {
  const rows = [];
  for (const entry of await loadDir(path)) {
    if (!entry.dir) { rows.push(fileRow(entry, depth)); continue; }
    const open = tree.open.has(entry.path);
    const row = el("div", "node dir", (open ? "▾ " : "▸ ") + entry.name);
    row.style.paddingLeft = 8 + depth * 14 + "px";
    row.title = entry.path;
    row.addEventListener("click", () => {
      if (open) tree.open.delete(entry.path);
      else tree.open.add(entry.path);
      renderTree();
    });
    rows.push(row);
    if (open) {
      try { rows.push(...(await dirRows(entry.path, depth + 1))); }
      catch {
        tree.open.delete(entry.path);
        tree.dirs.delete(entry.path);
        rows.push(el("p", "msg err", "폴더를 불러오지 못했다: " + entry.name));
      }
    }
  }
  return rows;
}

async function renderTree() {
  const ticket = ++treeSeq;
  const query = $("tree-search").value.trim();
  let rows;
  try {
    if (query) {
      const { results, truncated } = await getJson("api/search?q=" + encodeURIComponent(query));
      rows = results.map((r) => fileRow(r, 0, r.path.slice(0, r.path.length - r.name.length).replace(/\/$/, "")));
      if (!results.length) rows.push(el("p", "msg", "찾은 파일이 없다"));
      if (truncated) rows.push(el("p", "msg", "앞 50건만 보인다. 검색어를 더 적는다."));
    } else {
      rows = await dirRows("", 0);
    }
  } catch (err) {
    rows = [el("p", "msg err", "트리를 불러오지 못했다: " + err.message)];
  }
  if (ticket === treeSeq) $("tree").replaceChildren(...rows);
}

// ── 칸 너비 ───────────────────────────────────────────

// Vault 칸·미리보기 너비. null 은 기본(Vault 280px, 미리보기는 보드와 1:1.2). 사용자가 정한 값은 localStorage 에 둔다.
const PANES = {
  side: { key: "meetings.sideWidth", css: "--side-w", min: 200, node: () => document.querySelector(".side") },
  preview: { key: "meetings.previewWidth", css: "--preview-w", min: 280, node: () => $("preview") },
};
const widths = { side: recallWidth("side"), preview: recallWidth("preview") };

function recallWidth(pane) {
  try { return Number(localStorage.getItem(PANES[pane].key)) || null; } catch { return null; }
}

function rememberWidth(pane) {
  try {
    if (widths[pane] == null) localStorage.removeItem(PANES[pane].key);
    else localStorage.setItem(PANES[pane].key, String(widths[pane]));
  } catch { /* 저장소 차단 시 무시 */ }
}

// 정한 너비를 지금 화면 폭에 맞춰 줄여 그린다. Vault 칸은 미리보기 최소 폭을, 미리보기는 실제 Vault 칸 폭을 남긴다.
function applyWidths() {
  const viewport = document.documentElement.clientWidth;
  const previewing = document.body.classList.contains("previewing");
  const side = widths.side == null ? null
    : clampPane(widths.side, { min: PANES.side.min, viewport, others: previewing ? PANES.preview.min : 0 });
  const preview = widths.preview == null ? null
    : clampPane(widths.preview, { min: PANES.preview.min, viewport, others: side ?? 280 });
  const style = document.body.style;
  for (const [pane, value] of [["side", side], ["preview", preview]]) {
    if (value == null) style.removeProperty(PANES[pane].css);
    else style.setProperty(PANES[pane].css, value + "px");
  }
  return { side, preview };
}

// 너비를 바꾸고 화면 폭에 맞춘 값(실제로 그려진 값)을 남긴다.
function setWidth(pane, width) {
  widths[pane] = width;
  widths[pane] = applyWidths()[pane];
}

function wireResizer(handle, pane) {
  const sign = pane === "side" ? 1 : -1; // 미리보기는 오른쪽에 붙어 있어 왼쪽으로 끌수록 넓어진다.
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("on");
    document.body.classList.add("resizing");
    const startX = e.clientX;
    const startWidth = PANES[pane].node().getBoundingClientRect().width;
    const move = (ev) => setWidth(pane, startWidth + sign * (ev.clientX - startX));
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      handle.classList.remove("on");
      document.body.classList.remove("resizing");
      rememberWidth(pane);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  });
  handle.addEventListener("dblclick", () => { setWidth(pane, null); rememberWidth(pane); });
  handle.addEventListener("keydown", (e) => {
    const step = { ArrowLeft: -16, ArrowRight: 16 }[e.key];
    if (!step) return;
    e.preventDefault();
    setWidth(pane, PANES[pane].node().getBoundingClientRect().width + sign * step);
    rememberWidth(pane);
  });
}

// ── 시작 ─────────────────────────────────────────────

// 연결하지 못한 까닭을 보드 자리에 보인다. 권한이 'prompt' 인 폴더가 있으면 '폴더 다시 연결'(누르는 동작 안에서 묻는다).
function showBlocked({ error, pending = [] }) {
  $("meetings").replaceChildren(el("li", "msg", "—"));
  $("tree").replaceChildren();
  const message = el("p", "msg err", error);
  $("blocks").replaceChildren(message);
  if (!pending.length) return;
  const button = el("button", "btn", "폴더 다시 연결");
  button.type = "button";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      let granted = true;
      for (const handle of pending) granted = (await fsa.reconnect(handle, "readwrite")) === "granted" && granted;
      if (granted) { location.reload(); return; }
    } catch { /* 다시 누르게 둔다 */ }
    button.disabled = false;
  });
  message.after(button);
}

// 설정의 Vault·회의 폴더로 backend 를 만든다. 못 하면 까닭을 보이고 false.
async function connect() {
  let result;
  try {
    result = await openFolders((await tabContext("meetings")).settings);
  } catch (err) {
    result = { error: "브라우저 저장소를 열지 못했다: " + err.message };
  }
  if (result.backend) { backend = result.backend; return true; }
  showBlocked(result);
  return false;
}

$("title").addEventListener("click", startRenameMeeting);
$("new-block").addEventListener("click", startNewBlock);
$("new-meeting").addEventListener("click", startNewMeeting);
$("meeting-search").addEventListener("input", (e) => {
  listQuery = e.target.value;
  renderList(parseState(location.hash));
});
$("meeting-menu").addEventListener("click", (e) => {
  e.stopPropagation();
  const menu = $("meeting-menu-list");
  menu.hidden = !menu.hidden;
  $("meeting-menu").setAttribute("aria-expanded", String(!menu.hidden));
});
$("meeting-menu-list").addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  closeMenu();
  if (act === "rename") startRenameMeeting();
  else if (act === "delete" && current) deleteMeeting(current.id);
});
document.addEventListener("click", (e) => { if (!e.target.closest(".menu-wrap")) closeMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
$("reload").addEventListener("click", async () => {
  loaded = { id: null, promise: null };
  tree.dirs.clear();
  tree.open.clear();
  previewKey = "";
  await refreshList();
  ensureSelection();
  renderTree();
  sync();
});
$("tree-search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderTree, 200);
});
window.addEventListener("hashchange", sync);
window.addEventListener("resize", applyWidths);
wireResizer($("side-resizer"), "side");
wireResizer($("preview-resizer"), "preview");
applyWidths();

if (await connect()) {
  await refreshList();
  ensureSelection();
  renderTree();
  sync();
}
