// 의사결정 현황 파서·목록 렌더(브라우저판). 로컬판 tabs/assets/assets_index.py(HTML 읽기·정렬·목록 md·경고)와
// assets_index_html.py(목록 md → 목록 HTML)를 옮겼다. 로컬판처럼 HTML → 목록 md → 화면 순서로 만들지만 파일은 쓰지 않는다.
// 같은 예제 폴더를 Python 과 이 파서에 넣어 결과를 맞춰 본다(tests/js/web/assets_index.test.js).
// Python 과 결과가 같도록 \s(str.isspace)·\d(유니코드 숫자)·$(끝 줄바꿈 앞)·read_text 의 줄바꿈 변환 규칙을 흉내 낸다.
// 문자열 도구(pyStrip·splitlines·cmp·esc·quote·stat·groups)는 구현 진행 현황(plans_index.js)과 같은 것을 쓴다.
import { asciiDigits, cmp, decode, esc, groups, pyStrip, quote, splitlines, stat } from "../plans/plans_index.js";

// 목록에서 문서를 열었다는 표시(sessionStorage 키). 뷰어의 '← 목록'이 뒤로 가기를 쓸지 정한다.
export const FROM_LIST = "dobbys-dashboard:assets-from-list";
export const STATES = ["open", "closed", "reference"];

// Python str.isspace() 글자(plans_index.js 와 같은 집합). 정규식 \s·strip() 이 이 집합을 쓴다.
const WS = "\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const D = "\\p{Nd}";  // Python \d
const END = "(?=\\n?$)";  // Python $(MULTILINE 없음): 끝, 또는 끝 줄바꿈 바로 앞
const IS_WS = new RegExp(`[${WS}]`, "u");

const META_TAG = new RegExp(`<meta[${WS}]+name="(feature|created)"[${WS}]+content="([^"]*)"`, "giu");
const DOCST = /<section class="docst" data-doc="(open|closed)"/;
const META = new RegExp(
  `회신 대상<b>([^<]*)</b>[\\s\\S]*?`
  + `집계<b>미결 (${D}+) · 완료 (${D}+) · 취소됨 (${D}+)</b>[\\s\\S]*?`
  + `최종 갱신<b>([${D}-]+)</b>`,
  "gu",
);
// 파일명 맨 끝의 `_v1.0` 같은 버전(예외 표기)과 맨 앞의 `프로젝트_버전_` 접두어(예: TRB_4.0.0_, ABC_v2_).
const VERSION = new RegExp(`_(v${D}+(?:\\.${D}+)*)${END}`, "u");
const VERSION_ALL = new RegExp(VERSION.source, "gu");
const PROJECT_PREFIX = new RegExp(`^[A-Za-z][A-Za-z0-9-]*_v?${D}+(?:\\.${D}+)*_`, "u");
// 문서 정보 줄의 버전. 파일명 버전과 같아야 한다.
const DOCINFO_VERSION = new RegExp(
  `<!-- docinfo:begin -->(?:(?!docinfo:end)[\\s\\S])*?<span class="scope-label">버전</span><span class="scope-chip">(v[${D}.]+)</span>`, "u");

// Python str.rstrip().
function pyRstrip(value) {
  const list = Array.from(String(value));
  let end = list.length;
  while (end > 0 && IS_WS.test(list[end - 1])) end--;
  return list.slice(0, end).join("");
}

const removeHtml = (name) => (name.endsWith(".html") ? name.slice(0, -5) : name);
// Python 의 int(): 유니코드 십진 숫자도 읽는다.
const pyInt = (digits) => Number(asciiDigits(digits));

// Python 의 dict["키"] 처럼 없으면 실패한다(로컬판은 KeyError·IndexError 로 동기화 전체가 실패한다).
function need(object, key) {
  if (object[key] === undefined) throw new Error(Array.isArray(object) ? "IndexError: list index out of range" : `KeyError: '${key}'`);
  return object[key];
}

export const cell = (value) => String(value).replaceAll("|", "/");
export const outputName = (folderName) => `00_${folderName}_목록.md`;
export const htmlName = (folderName) => `00_${folderName}_목록.html`;

// `<head>` 의 feature·created meta → {features: [...], date: "YYYY-MM-DD" | "-"}. 같은 meta 가 여럿이면 마지막 것.
export function metaTags(src) {
  const found = {};
  for (const match of src.matchAll(META_TAG)) found[match[1].toLowerCase()] = pyStrip(match[2]);
  return {
    features: (found.feature ?? "").split(",").map((v) => pyStrip(v)).filter(Boolean),
    date: found.created || "-",
  };
}

export function displayName(name) {
  const stem = removeHtml(name).replace(VERSION_ALL, "").replace(PROJECT_PREFIX, "");
  // 코드명(EXCN_TYPE_CD)의 밑줄은 남기고, 띄어쓰기를 대신한 밑줄만 공백으로 되돌린다.
  return stem.replace(/(?<![A-Z])_|_(?![A-Z])/g, " ");
}

// 문서 하나(assets_index.read). fileName 은 폴더에서 읽은 그대로, 화면 이름은 NFC 로 만든다.
export function readDoc(fileName, src) {
  const name = fileName.normalize("NFC");
  const entry = metaTags(src);
  const inName = removeHtml(name).match(VERSION);
  const inDoc = src.match(DOCINFO_VERSION);
  // 버전이 있는 문서는 화면 이름에 버전을 반드시 붙인다. 같은 제목 문서가 여럿일 때 구분하는 유일한 표시다.
  const found = inDoc || inName;
  const version = found ? found[1] : "";
  const doc = {
    file: fileName,
    title: pyRstrip(`${displayName(name)} ${version}`),
    version,
    name_version: inName ? inName[1] : "",
    date: entry.date,
    state: "reference",
    features: entry.features,
  };
  const state = src.match(DOCST);
  if (state) {
    doc.state = state[1];
    META.lastIndex = state.index;
    const meta = META.exec(src);
    if (meta) Object.assign(doc, { who: meta[1], open: meta[2], done: meta[3], cancel: meta[4], updated: meta[5] });
  }
  return doc;
}

const has = (doc, key) => Object.hasOwn(doc, key);
const get = (doc, key, fallback) => (has(doc, key) ? doc[key] : fallback);
const featureKey = (doc) => JSON.stringify(doc.features);

// items 는 작성일 내림차순이다. 묶음은 첫 등장(=묶음 안 최신 작성일) 순, 안정 정렬이라 묶음 안 순서는 유지. 기능 구분이 없으면 맨 뒤.
export function grouped(items) {
  const first = new Map();
  items.forEach((doc, i) => { if (!first.has(featureKey(doc))) first.set(featureKey(doc), i); });
  return [...items].sort((a, b) => (Number(!a.features.length) - Number(!b.features.length))
    || (first.get(featureKey(a)) - first.get(featureKey(b))));
}

// 한 상태의 문서. 작성일 내림차순(같은 날은 최종 갱신 순). Python sorted(reverse=True) 처럼 같은 값은 원래 순서를 지킨다.
export function byDate(docs, state) {
  const items = docs.filter((doc) => doc.state === state);
  items.sort((a, b) => cmp(b.date, a.date) || cmp(get(b, "updated", ""), get(a, "updated", "")));
  return grouped(items);
}

const link = (doc) => `[[${doc.file}\\|${cell(doc.title)}]]`;
const featureCell = (doc) => (doc.features.length ? cell(doc.features.join(", ")) : "-");

// 목록 md(assets_index.render). 로컬판은 이 글을 00_<폴더명>_목록.md 로 쓰지만 웹은 메모리에만 둔다.
export function renderMd(docs, folderName) {
  const [open, closed, refs] = STATES.map((state) => byDate(docs, state));
  const lines = [
    `# ${folderName} 목록`,
    "",
    "> 자동 생성 노트다. 직접 고치지 않는다.",
    "> HTML을 추가하거나 문의 현황 표를 고친 뒤 대시보드 화면의 ⟳ 새로고침으로 다시 만든다.",
    `> 같은 갱신에서 이 노트를 원본으로 [[${htmlName(folderName)}|의사결정 현황 HTML]]도 다시 만든다(대시보드 의사결정 현황 탭).`,
    "> 상태는 각 HTML 상단 문의 현황 표(`data-doc`)에서 읽는다.",
    "> 기능 구분·작성일은 각 HTML `<head>`의 `<meta name=\"feature\">`·`<meta name=\"created\">`에서 읽고, 구역마다 같은 기능 구분끼리 모아 보여 준다.",
    "",
  ];
  const header = ["| 기능 구분 | 문서 | 회신 대상 | 미결 · 완료 · 취소됨 | 최종 갱신 | 작성일 |", "| --- | --- | --- | --- | --- | --- |"];
  const rows = (items) => items.map((d) => `| ${featureCell(d)} | ${link(d)} | ${cell(get(d, "who", "-"))} `
    + `| ${get(d, "open", "-")} · ${get(d, "done", "-")} · ${get(d, "cancel", "-")} `
    + `| ${get(d, "updated", "-")} | ${d.date} |`);
  lines.push(`## 진행 중 (${open.length})`, "", ...header, ...rows(open), "");
  lines.push(`## 종결 (${closed.length})`, "", ...header, ...rows(closed), "");
  lines.push(`## 참고 (${refs.length})`, "", "답을 기다리지 않는 설명·분석·설계·점검표 문서다.", "");
  lines.push("| 기능 구분 | 문서 | 작성일 |", "| --- | --- | --- |");
  lines.push(...refs.map((d) => `| ${featureCell(d)} | ${link(d)} | ${d.date} |`));
  return lines.join("\n") + "\n";
}

// ---- 목록 md → 화면(assets_index_html.parse·render_html) ----

const SECTIONS = { "진행 중": "open", "종결": "closed", "참고": "ref" };
const SECTION = new RegExp(`^## (진행 중|종결|참고) \\((${D}+)\\)${END}`, "u");
const LINK = new RegExp(`^\\[\\[([^\\]|\\\\]+)(?:\\\\?\\|([^\\]]+))?\\]\\]${END}`, "u");
const COUNTS = new RegExp(`^(${D}+) · (${D}+) · (${D}+)${END}`, "u");
const PIPE = "\x00";

function row(cells) {
  const found = need(cells, 1).match(LINK);
  if (!found) throw new Error(`ValueError: 문서 링크를 읽을 수 없다: ${cells[1]}`);
  const item = {
    features: cells[0] === "-" ? [] : cells[0].split(",").map((f) => pyStrip(f)).filter(Boolean),
    file: found[1],
    title: found[2] || found[1],
  };
  if (cells.length === 3) return { ...item, date: cells[2] };
  const counts = need(cells, 3).match(COUNTS);
  return {
    ...item,
    who: cells[2],
    open: counts ? pyInt(counts[1]) : 0,
    done: counts ? pyInt(counts[2]) : 0,
    cancel: counts ? pyInt(counts[3]) : 0,
    updated: need(cells, 4),
    date: need(cells, 5),
  };
}

// md → {open|closed|ref: {label, count, note, rows}}. 표 머리·구분선과 인용문은 건너뛴다. 건수가 어긋나면 실패.
export function parseMd(md) {
  const sections = {};
  let current = null;
  for (const line of splitlines(md)) {
    const match = line.match(SECTION);
    if (match) {
      current = sections[SECTIONS[match[1]]] = { label: match[1], count: pyInt(match[2]), note: "", rows: [] };
      continue;
    }
    if (current === null || !pyStrip(line)) continue;
    if (!line.startsWith("|")) {
      if (!line.startsWith(">")) current.note = pyStrip(line);
      continue;
    }
    const cells = pyStrip(pyStrip(line.replaceAll("\\|", PIPE)), "|").split("|").map((c) => pyStrip(c).replaceAll(PIPE, "|"));
    if (cells[0] === "기능 구분" || cells[0].startsWith("---")) continue;
    current.rows.push(row(cells));
  }
  for (const section of Object.values(sections)) {
    if (section.rows.length !== section.count) {
      throw new Error(`ValueError: ${section.label}: 제목 건수 ${section.count}와 표 행 ${section.rows.length}이 다르다`);
    }
  }
  return sections;
}

// copyButton(file) → 경로 복사 버튼 HTML(실제 경로 칸이 비면 빈 문자열). 문서 링크는 뷰어(view.html#<파일명>)로 간다.
const docLink = (item, copyButton) =>
  `<span class="doc-entry"><a href="view.html#${esc(quote(item.file))}">${esc(item.title)}</a>${copyButton(item.file)}</span>`;

const rowAttrs = (item) => {
  const text = [item.title, get(item, "who", ""), ...item.features].join(" ").toLowerCase();
  return `data-features="${esc(item.features.join("|"))}" data-text="${esc(text)}"`;
};

function progress(item) {
  const [open, done, cancel] = ["open", "done", "cancel"].map((key) => need(item, key));
  const counts = { open, done, cancel };
  const bar = ["done", "cancel", "open"].filter((kind) => counts[kind])
    .map((kind) => `<i class="${kind}" style="flex:${counts[kind]}"></i>`).join("") || '<i style="flex:1"></i>';
  const pending = open ? ` <span class="dd">미결 ${open}</span>` : "";
  return `<div class="prog" title="미결 ${open} · 완료 ${done} · 취소 ${cancel} (총 ${open + done + cancel})"><div class="pbar">${bar}</div>`
    + `<span class="pn">${open} · ${done} · ${cancel}</span>${pending}</div>`;
}

const statusTable = (rows, copyButton) => {
  const body = rows.map((item) => `<tr ${rowAttrs(item)}><td class="doc">${docLink(item, copyButton)}</td><td class="who">${esc(need(item, "who"))}</td>`
    + `<td>${progress(item)}</td><td class="mono">${esc(need(item, "updated"))}</td><td class="mono">${esc(item.date)}</td></tr>`).join("");
  return '<table class="st-t"><thead><tr><th>문서</th><th>회신 대상</th><th>미결 · 완료 · 취소</th>'
    + `<th class="mono">최종 갱신</th><th class="mono">작성일</th></tr></thead><tbody>${body}</tbody></table>`;
};

const refTable = (rows, copyButton) => {
  const body = rows.map((item) => `<tr ${rowAttrs(item)}><td class="doc">${docLink(item, copyButton)}</td><td class="mono">${esc(item.date)}</td></tr>`).join("");
  return `<table class="ref-t"><thead><tr><th>문서</th><th class="mono">작성일</th></tr></thead><tbody>${body}</tbody></table>`;
};

function sectionHtml(key, section, copyButton) {
  const table = key === "ref" ? refTable : statusTable;
  const note = section.note ? `<p class="dim note">${esc(section.note)}</p>` : "";
  const body = groups(section.rows).map(([name, rows]) =>
    `<section class="grp"><div class="mhd"><b>${esc(name)}</b><span class="sub">${rows.length}건</span></div>${table(rows, copyButton)}</section>`).join("");
  // 검색 중에는 세 구역을 함께 보여 주므로 구역 제목(.ph)이 필요하다. 탭 보기에서는 숨긴다.
  return `<div class="panel" data-key="${key}" role="tabpanel" hidden>`
    + `<h2 class="ph" hidden>${esc(section.label)} <span class="cnt"></span></h2>${note}${body}`
    + '<p class="empty" hidden>조건에 맞는 문서가 없다.</p></div>';
}

const sum = (rows, key) => rows.reduce((total, row) => total + need(row, key), 0);

// 화면 조각 {stats, tabs, chips, panels}. assets_index_html.render_html 의 STATS·TABS·CHIPS·PANELS 와 같다.
export function renderParts(sections, copyButton = () => "") {
  const empty = (label) => ({ label, count: 0, note: "", rows: [] });
  const opened = sections.open ?? empty("진행 중");
  const closed = sections.closed ?? empty("종결");
  const refs = sections.ref ?? empty("참고");
  const ordered = [["open", opened], ["closed", closed], ["ref", refs]];
  const stats = [
    stat("진행 중", `${opened.count}건`, `완료 ${sum(opened.rows, "done")}건 포함`),
    stat("미결 항목", `${sum(opened.rows, "open")}건`, "진행 중 문서 합"),
    stat("종결", `${closed.count}건`, `완료 ${sum(closed.rows, "done")} · 취소 ${sum(closed.rows, "cancel")}`),
    stat("참고", `${refs.count}건`, "설명·분석·설계·점검표"),
    stat("동기화", "—", "정적 파일", ' id="syncstat"'),
  ].join("");
  const tabs = ordered.map(([key, s]) =>
    `<button class="tab" role="tab" data-tab="${key}">${esc(s.label)} <span class="cnt" data-total="${s.count}">${s.count}</span></button>`).join("");
  const features = [...new Set(ordered.flatMap(([, s]) => s.rows.flatMap((r) => r.features)))].sort(cmp);
  const chips = '<button class="f" data-feature="">전체</button>'
    + features.map((f) => `<button class="f" data-feature="${esc(f)}">${esc(f)}</button>`).join("");
  const panels = ordered.map(([key, s]) => sectionHtml(key, s, copyButton)).join("");
  return { stats, tabs, chips, panels };
}

// ---- 폴더 읽기 ----

// 폴더 바로 아래 `*.html`(Path.glob 처럼 대소문자 구분, 숨김 파일 포함) 중 `00_`(목록 화면 자신)을 뺀 것.
export const isDocName = (name) => name.endsWith(".html") && !name.startsWith("00_");

// {파일명: 본문} 목록 → 로컬판 sync 결과에서 파일 쓰기만 뺀 것.
// {docs, sections: {open, closed, reference}, counts, warnings, md, parsed(화면용 구역) | null, error(목록 화면을 못 만든 까닭) | null}
export function summarize(files, folderName) {
  const docs = [...files].filter(({ name }) => isDocName(name)).sort((a, b) => cmp(a.name, b.name)).map(({ name, text }) => readDoc(name, text));
  const warnings = [
    ...docs.filter((d) => !d.features.length).map((d) => `기능 구분 없음: ${d.file} → <head>에 <meta name="feature" content="…">를 넣는다`),
    ...docs.filter((d) => d.date === "-").map((d) => `작성일 없음: ${d.file} → <head>에 <meta name="created" content="YYYY-MM-DD">를 넣는다`),
    ...docs.filter((d) => d.name_version && d.name_version !== d.version)
      .map((d) => `버전 불일치: ${d.file} 파일명 ${d.name_version} ≠ 문서 정보 줄 ${d.version}`),
  ];
  const titles = new Map();
  for (const d of docs) titles.set(d.title, [...(titles.get(d.title) ?? []), d.file]);
  for (const files of titles.values()) if (files.length > 1) warnings.push(`같은 화면 이름(버전까지 같음): ${files.join(" / ")}`);
  const md = renderMd(docs, folderName);
  const sections = Object.fromEntries(STATES.map((state) => [state, byDate(docs, state)]));
  const counts = Object.fromEntries(STATES.map((state) => [state, docs.filter((d) => d.state === state).length]));
  let parsed = null;
  let error = null;
  try {
    parsed = parseMd(md);
    renderParts(parsed);  // 로컬판 render_html 처럼 화면을 못 만드는 목록(행 모양 어긋남)이면 여기서 실패한다
  } catch (err) {
    parsed = null;
    error = err.message;
  }
  return { docs, sections, counts, warnings, md, parsed, error };
}

// Python read_text(encoding="utf-8"): 잘못된 바이트는 오류, BOM 은 그대로, \r\n·\r 은 \n 으로.
export const readText = (buffer) => decode(buffer).replace(/\r\n?/g, "\n");

// 폴더 핸들 → [{name, text}]. 바로 아래만 본다. `*.html` 이름의 폴더는 로컬판처럼 실패한다(IsADirectoryError).
export async function readFolder(folder) {
  const files = [];
  for await (const [name, handle] of folder.entries()) {
    if (!isDocName(name)) continue;
    if (handle.kind !== "file") throw new Error(`IsADirectoryError: '${name}' 은(는) 폴더다. 의사결정 폴더 바로 아래에는 .html 이름의 폴더를 두지 않는다`);
    const file = await handle.getFile();
    files.push({ name, text: readText(await file.arrayBuffer()) });
  }
  return files;
}
