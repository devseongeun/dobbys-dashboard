// 회의 자료 화면. 목록·Vault 트리·블록 카드·편집·미리보기를 그린다. 순수 함수는 meetings_lib.js 에 있다.
// 쓰기는 POST + X-Meetings-Editor 헤더 + 상세의 version. 409 면 알리고 다시 읽는다.
import {
  dropIndex, fileInfo, fileUrl, isWebUrl, linkLabel, obsidianToMarkdown, obsidianUri, parseState, stripFrontmatter, toHash,
  todayIso,
} from "./meetings_lib.js";

const $ = (id) => document.getElementById(id);
// Obsidian Canvas 색 프리셋 1~6.
const PRESET = { 1: "#f87171", 2: "#fb923c", 3: "#facc15", 4: "#4ade80", 5: "#22d3ee", 6: "#c084fc" };
const UNGROUPED = "_ungrouped";
const EDITOR = { "Content-Type": "application/json", "X-Meetings-Editor": "1" };
let meetings = [];
let listError = "";
let loaded = { id: null, promise: null };
let current = null;
let renderedId = null;
let previewKey = ""; // 미리보기가 지금 보여 주는 것. 같으면 본문을 다시 그리지 않는다.
let addTarget = ""; // 미리보기 "담기"에서 마지막으로 고른 블록 id.
let seq = 0;
let busy = false;
let dragging = null; // { kind: "item", id, block } | { kind: "file", path }
let marker = null; // { list, index }
let treeSeq = 0;
let searchTimer = 0;
let noticeTimer = 0;
const tree = { open: new Set(), dirs: new Map() };

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

async function getJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "HTTP " + res.status);
  return body;
}

async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: EDITOR, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "HTTP " + res.status);
    err.status = res.status;
    err.version = data.version;
    throw err;
  }
  return data;
}

function notice(text) {
  const box = $("notice");
  box.textContent = text;
  box.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { box.hidden = true; }, 5000);
}

// md 파일·메모 노드 렌더. 바깥 링크는 새 탭, 나머지(상대 경로·앵커)는 iframe 해시를 깨지 않게 글자로 둔다.
function renderMarkdown(target, src) {
  target.innerHTML = marked.parse(obsidianToMarkdown(stripFrontmatter(src)), { gfm: true });
  for (const a of target.querySelectorAll("a[href]")) {
    if (isWebUrl(a.getAttribute("href"))) { a.target = "_blank"; a.rel = "noopener"; }
    else a.removeAttribute("href");
  }
}

async function refreshList() {
  try { meetings = (await getJson("api/meetings")).meetings; listError = ""; }
  catch (err) { meetings = []; listError = err.message; }
}

// 해시의 회의가 목록에 없으면(처음 열었거나 바깥에서 이름이 바뀜) 첫 회의로. 보고 있던 파일은 그대로 둔다.
function ensureSelection() {
  const { meeting, file } = parseState(location.hash);
  if (!meetings.length || meetings.some((m) => m.id === meeting)) return;
  history.replaceState(null, "", toHash({ meeting: meetings[0].id, file }));
}

function loadDetail(id) {
  if (loaded.id !== id) {
    const promise = id
      ? getJson("api/meetings/" + encodeURIComponent(id)).then(
        (detail) => ({ detail, error: "" }), (err) => ({ detail: null, error: err.message }))
      : Promise.resolve({ detail: null, error: "" });
    loaded = { id, promise };
  }
  return loaded.promise;
}

// ── 쓰기 ──────────────────────────────────────────────

async function run(request) {
  if (busy) return;
  busy = true;
  document.body.classList.add("busy");
  try {
    const detail = await request();
    loaded = { id: detail.id, promise: Promise.resolve({ detail, error: "" }) };
    if (detail.id !== parseState(location.hash).meeting) {
      await refreshList();
      history.replaceState(null, "", toHash({ meeting: detail.id, file: parseState(location.hash).file }));
    }
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
}

function write(path, body = {}) {
  if (!current) return Promise.resolve();
  const url = `api/meetings/${encodeURIComponent(current.id)}${path}`;
  const version = current.version;
  return run(() => postJson(url, { ...body, version }));
}

// 한 줄 입력 폼. Enter 저장, Esc·취소는 onCancel.
function inlineForm(fields, submitLabel, onSubmit, onCancel) {
  const form = el("form", "inline");
  for (const field of fields) {
    const input = el("input");
    input.name = field.name;
    input.type = field.type || "text";
    input.value = field.value || "";
    input.placeholder = field.placeholder || "";
    input.required = Boolean(field.required);
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
  setTimeout(() => form.querySelector("input")?.focus(), 0);
  return form;
}

function startNewMeeting() {
  const slot = $("new-meeting-slot");
  if (slot.firstChild) return;
  const close = () => slot.replaceChildren();
  slot.append(inlineForm([
    { name: "date", type: "date", value: todayIso() },
    { name: "title", placeholder: "회의 이름", required: true },
  ], "만들기", ({ date, title }) => { close(); run(() => postJson("api/meetings", { date, title })); }, close));
}

function startRenameMeeting() {
  if (!current || busy) return;
  const title = $("title");
  if (title.hidden) return;
  const close = () => { form.remove(); title.hidden = false; };
  const form = inlineForm([
    { name: "date", type: "date", value: current.date },
    { name: "title", value: current.title, placeholder: "회의 이름", required: true },
  ], "저장", ({ date, title: name }) => { close(); write("/rename", { date, title: name }); }, close);
  form.dataset.meeting = current.id;
  title.hidden = true;
  title.after(form);
}

function startNewBlock() {
  const slot = $("new-block-slot");
  if (!current || slot.firstChild) return;
  const close = () => slot.replaceChildren();
  slot.append(inlineForm([{ name: "label", placeholder: "블록 이름", required: true }], "만들기",
    ({ label }) => { close(); write("/blocks", { label }); }, close));
}

function startRenameBlock(heading, block) {
  if (busy) return;
  const close = () => { form.remove(); heading.hidden = false; };
  const form = inlineForm([{ name: "label", value: block.label, required: true }], "저장",
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

function renderList(state) {
  const ul = $("meetings");
  ul.replaceChildren();
  if (listError) { ul.append(el("li", "msg err", "목록을 불러오지 못했다: " + listError)); return; }
  if (!meetings.length) { ul.append(el("li", "msg", "회의가 없다. + 회의로 만든다.")); return; }
  for (const meeting of meetings) {
    const a = el("a");
    a.href = toHash({ meeting: meeting.id });
    a.append(el("span", "date", meeting.date || "날짜 없음"), el("span", "name", meeting.title));
    if (meeting.error) { a.append(el("span", "badge err", "오류")); a.title = meeting.error; }
    const li = el("li", meeting.id === state.meeting ? "on" : "");
    li.append(a);
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
  if (editable) {
    heading.title = "눌러서 블록 이름 바꾸기";
    heading.addEventListener("click", () => startRenameBlock(heading, block));
  }
  const list = el("ul", "items");
  if (!block.items.length) list.append(el("li", "msg", "비어 있음 — 파일을 여기로 끌어다 놓는다"));
  for (const item of block.items) list.append(renderItem(detail, item, state, block));
  card.append(heading, list);
  if (editable) card.append(addLinkButton(block));
  wireDrop(card, list, block);
  return card;
}

function renderBoard(state, { detail, error }) {
  const box = $("blocks");
  const open = $("open-canvas");
  box.replaceChildren();
  // 다른 회의로 바뀌면 이전 회의의 이름 바꾸기·새 블록 폼을 닫는다.
  for (const form of document.querySelectorAll(".bar > form.inline[data-meeting]")) {
    if (form.dataset.meeting !== detail?.id) form.remove();
  }
  if (!document.querySelector(".bar > form.inline[data-meeting]")) $("title").hidden = false;
  if (renderedId !== (detail?.id ?? null)) $("new-block-slot").replaceChildren();
  renderedId = detail?.id ?? null;
  open.hidden = true;
  $("new-block").hidden = true;
  current = detail;
  if (!detail) {
    $("title").textContent = state.meeting || "회의를 고른다";
    document.title = "회의 자료";
    if (state.meeting) box.append(el("p", "msg err", "불러오지 못했다: " + error));
    return;
  }
  $("title").textContent = (detail.date ? detail.date + " · " : "") + detail.title;
  document.title = detail.title + " · 회의 자료";
  open.href = obsidianUri(detail.vault, detail.canvasPath);
  open.hidden = false;
  $("new-block").hidden = false;
  if (!detail.blocks.length) {
    box.append(el("p", "msg", "블록이 없다. + 블록으로 만들거나, Obsidian에서 이 Canvas에 그룹을 만든다."));
    return;
  }
  for (const block of detail.blocks) box.append(renderBlock(detail, block, state));
}

// 미리보기 헤더의 "블록에 담기". 이미 이 회의에 담긴 파일이면 담긴 블록 이름만 보인다.
function renderAddControl(detail, path) {
  const box = $("preview-add");
  box.replaceChildren();
  if (!detail) return;
  const holders = detail.blocks.filter((b) => b.items.some((i) => i.kind === "file" && i.path === path));
  if (holders.length) { box.append(el("span", "badge", "담김 · " + holders.map((b) => b.label).join(", "))); return; }
  const targets = detail.blocks.filter((b) => b.id && b.id !== UNGROUPED);
  if (!targets.length) { box.append(el("span", "badge", "+ 블록을 먼저 만든다")); return; }
  const select = el("select");
  select.title = "담을 블록";
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

// 오른쪽 미리보기. 회의에 담긴 파일이면 그 카드 정보로, 아니면(Vault 트리에서 고른 파일) 경로로 판단한다.
async function renderPreview(state, detail) {
  const path = state.file;
  document.body.classList.toggle("previewing", Boolean(path));
  $("preview").hidden = !path;
  if (!path) { previewKey = ""; $("preview-body").replaceChildren(); $("preview-add").replaceChildren(); return; }
  const item = detail?.blocks.flatMap((block) => block.items).find((i) => i.kind === "file" && i.path === path);
  const view = item ?? { path, missing: false, ...fileInfo(path) };
  $("preview-title").textContent = view.name;
  $("preview-title").title = path;
  $("preview-open").hidden = !detail;
  if (detail) $("preview-open").href = obsidianUri(detail.vault, path);
  $("preview-close").href = toHash({ meeting: state.meeting }) || "#";
  renderAddControl(detail, path);
  // 같은 파일을 보여 주고 있으면 본문을 그대로 둔다(편집·회의 전환에도 PDF 쪽·스크롤이 유지되게).
  const key = `${path}\n${view.missing}\n${view.preview}`;
  if (key === previewKey) return;
  previewKey = key;
  const body = $("preview-body");
  body.replaceChildren();
  if (view.missing) { body.append(el("p", "msg err", "파일이 없다. Canvas의 경로가 바뀌었는지 확인한다: " + path)); return; }
  if (!view.preview) { body.append(el("p", "msg", "이 형식은 미리보기를 지원하지 않는다. Obsidian에서 연다.")); return; }
  const url = fileUrl(path);
  if (view.ext !== ".md" && view.ext !== ".txt") {
    const frame = el("iframe", "frame");
    frame.src = url;
    frame.title = view.name;
    body.append(frame);
    return;
  }
  body.append(el("p", "msg", "불러오는 중…"));
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    // 같은 키의 다음 sync 는 본문을 건드리지 않으므로 ticket 이 아니라 키로 판단한다.
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

// ── 시작 ─────────────────────────────────────────────

$("title").addEventListener("click", startRenameMeeting);
$("new-block").addEventListener("click", startNewBlock);
$("new-meeting").addEventListener("click", startNewMeeting);
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

await refreshList();
ensureSelection();
renderTree();
sync();
