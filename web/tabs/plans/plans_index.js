// 구현 진행 현황 파서·목록 렌더(브라우저판). 로컬판 tabs/plans/plans_index.py(파서·정렬)와 plans_index_html.py(목록 HTML)를 옮겼다.
// 파일을 쓰지 않는다. 폴더 핸들에서 계획 md 를 읽어 메모리에서 같은 화면을 그린다.
// 같은 예제 폴더를 Python 과 이 파서에 넣어 결과를 맞춰 본다(tests/js/web/plans_index.test.js).
// Python 과 결과가 같도록 str.strip()·splitlines()·round()(짝수 반올림)·\d(유니코드 숫자) 규칙을 그대로 흉내 낸다.

export const UNMAPPED = "미분류";
// 목록에서 계획을 열었다는 표시(sessionStorage 키). 뷰어의 '← 목록'이 뒤로 가기를 쓸지 정한다.
export const FROM_LIST = "dobbys-dashboard:plans-from-list";
export const STATES = { todo: "할 일", doing: "진행 중", done: "완료", ref: "참고" };
export const TABS = [["todo", "할 일"], ["doing", "진행 중"], ["done", "완료"], ["ref", "참고"]];
const STATUS = {
  "할 일": "todo", "할일": "todo", "todo": "todo",
  "진행 중": "doing", "진행중": "doing", "doing": "doing", "in progress": "doing", "in-progress": "doing",
  "완료": "done", "done": "done",
};
// Python str.isspace() 글자. 정규식 \s·strip() 이 이 집합을 쓴다.
const WS = "\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const DATE = /^(\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2})/u;
const CHECKBOX = new RegExp(`^[${WS}]*[-*+] \\[([ xX])\\]`, "u");
const FENCE = new RegExp(`^[${WS}]*(\`\`\`|~~~)`, "u");
const IS_WS = new RegExp(`[${WS}]`, "u");

// Python str.strip(chars).
export function pyStrip(value, chars = null) {
  const s = String(value);
  const strip = chars === null ? (ch) => IS_WS.test(ch) : (ch) => chars.includes(ch);
  const list = Array.from(s);
  let start = 0;
  let end = list.length;
  while (start < end && strip(list[start])) start++;
  while (end > start && strip(list[end - 1])) end--;
  return list.slice(start, end).join("");
}

// Python str.splitlines().
export function splitlines(value) {
  const lines = String(value).split(/\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

// Python round(x)(짝수 반올림).
export function roundHalfEven(x) {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

// Python float(). 못 읽거나 round() 가 실패할 값(nan·inf)은 NaN.
export function pyFloat(raw) {
  const s = pyStrip(raw);
  const number = /^[+-]?(\d(_?\d)*(\.(\d(_?\d)*)?)?|\.\d(_?\d)*)([eE][+-]?\d(_?\d)*)?$/;
  if (!number.test(s)) return NaN;
  const value = Number(s.replaceAll("_", ""));
  return Number.isFinite(value) ? value : NaN;
}

// 문자열을 코드 포인트 순으로 비교한다(Python 문자열 비교).
export function cmp(a, b) {
  const x = Array.from(String(a));
  const y = Array.from(String(b));
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d) return d < 0 ? -1 : 1;
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

// frontmatter `feature` 값 → 목록. `A, B`·`[A, B]`·`["A", "B"]` 모두 받는다.
export function featuresOf(raw) {
  return pyStrip(pyStrip(raw), "[]").split(",").map((v) => pyStrip(pyStrip(v), "\"'")).filter(Boolean);
}

// 맨 앞 `---` 블록의 `키: 값` 한 줄짜리 항목만. 닫는 줄이 없으면 frontmatter 가 아니다.
export function frontmatter(src) {
  const lines = splitlines(src);
  if (!lines.length || pyStrip(lines[0]) !== "---") return {};
  const meta = Object.create(null);
  for (const line of lines.slice(1)) {
    if (pyStrip(line) === "---") return meta;
    const at = line.indexOf(":");
    if (at < 0) continue;
    const key = line.slice(0, at);
    if (key && !key.startsWith(" ") && !key.startsWith("-")) meta[pyStrip(key)] = pyStrip(pyStrip(line.slice(at + 1)), "\"'");
  }
  return {};
}

// [체크됨, 전체]. 펜스 코드 블록 안의 예시 체크박스는 세지 않는다.
export function checkboxes(src) {
  let checked = 0;
  let total = 0;
  let fenced = false;
  for (const line of splitlines(src)) {
    if (FENCE.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const match = line.match(CHECKBOX);
    if (match) {
      total += 1;
      checked += match[1] !== " " ? 1 : 0;
    }
  }
  return [checked, total];
}

const get = (meta, key) => (Object.hasOwn(meta, key) ? meta[key] : "");

export function readPlan(fileName, src, warnings) {
  const name = fileName.normalize("NFC");
  const meta = frontmatter(src);
  const date = name.match(DATE);
  const [checked, total] = checkboxes(src);
  const base = name.endsWith(".md") ? name.slice(0, -3) : name;
  const plan = {
    file: fileName,
    title: pyStrip(base.replace(DATE, "")) || name,
    date: date ? date[1] : "-",
    features: featuresOf(get(meta, "feature")).length ? featuresOf(get(meta, "feature")) : [UNMAPPED],
    checked,
    total,
    progress: null,
    state: "ref",
  };
  const status = get(meta, "status");
  if (status) {
    const state = Object.hasOwn(STATUS, status.toLowerCase()) ? STATUS[status.toLowerCase()] : null;
    if (state) plan.state = state;
    else warnings.push(`모르는 status '${status}': ${fileName} → 할 일·진행중·완료 중 하나로 고친다`);
  }
  const raw = get(meta, "progress");
  if (raw) {
    const value = pyFloat(raw.replace(/%+$/u, ""));  // raw.rstrip("%")
    if (Number.isNaN(value)) warnings.push(`progress 값을 읽을 수 없음 '${raw}': ${fileName}`);
    else plan.progress = Math.max(0, Math.min(100, roundHalfEven(value)));
  }
  const updated = ["updated", "created"].map((key) => get(meta, key)).find((value) => DATE.test(value)) ?? plan.date;
  plan.updated = updated.match(DATE)?.[1] ?? updated;
  plan.mismatch = plan.state === "done" && checked < total;
  return plan;
}

// 폴더 바로 아래 `*.md` 중 `00_`(목록 노트)·숨김 파일을 뺀 것.
export const isPlanName = (name) => name.endsWith(".md") && !name.startsWith("00_") && !name.startsWith(".");

// items 는 작성일 내림차순이다. 묶음은 첫 등장(=묶음 안 최신 작성일) 순, 안정 정렬이라 묶음 안 순서는 유지. 미분류는 맨 뒤.
export function grouped(items) {
  const first = new Map();
  items.forEach((plan, i) => { const key = JSON.stringify(plan.features); if (!first.has(key)) first.set(key, i); });
  const unmapped = (plan) => (plan.features.length === 1 && plan.features[0] === UNMAPPED ? 1 : 0);
  return [...items].sort((a, b) => (unmapped(a) - unmapped(b)) || (first.get(JSON.stringify(a.features)) - first.get(JSON.stringify(b.features))));
}

export function byState(plans) {
  const out = {};
  for (const key of Object.keys(STATES)) {
    const items = plans.filter((plan) => plan.state === key);
    items.sort((a, b) => cmp(b.date, a.date) || cmp(b.updated, a.updated));
    out[key] = grouped(items);
  }
  return out;
}

// {파일명: 본문} 목록 → {sections, counts, warnings}(plans_index.sync 의 결과에서 파일 쓰기만 뺀 것).
export function summarize(files) {
  const warnings = [];
  const plans = [...files].sort((a, b) => cmp(a.name, b.name)).map(({ name, text }) => readPlan(name, text, warnings));
  for (const plan of plans) {
    if (plan.features.length === 1 && plan.features[0] === UNMAPPED) warnings.push(`기능 구분 없음: ${plan.file} → frontmatter에 feature: 를 적는다`);
  }
  const sections = byState(plans);
  const counts = Object.fromEntries(Object.entries(sections).map(([key, items]) => [key, items.length]));
  counts.mismatch = plans.filter((plan) => plan.mismatch).length;
  return { sections, counts, warnings };
}

// UTF-8 로 엄격히 읽는다(Python read_text(encoding="utf-8") 처럼 잘못된 바이트는 오류, BOM 은 그대로 둔다).
export const decode = (buffer) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);

// 폴더 핸들 → [{name, text}]. 바로 아래 파일만 본다(하위 폴더는 읽지 않는다).
export async function readFolder(folder) {
  const files = [];
  for await (const [name, handle] of folder.entries()) {
    if (handle.kind !== "file" || !isPlanName(name)) continue;
    const file = await handle.getFile();
    files.push({ name, text: decode(await file.arrayBuffer()) });
  }
  return files;
}

// ---- 목록 HTML(plans_index_html.py·assets_index_html.py 와 같은 마크업) ----

// html.escape(quote=True).
export const esc = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll("\"", "&quot;").replaceAll("'", "&#x27;");

// urllib.parse.quote(safe="/").
export function quote(value) {
  let out = "";
  for (const byte of new TextEncoder().encode(String(value))) {
    const ch = String.fromCharCode(byte);
    out += /[A-Za-z0-9_.\-~/]/.test(ch) ? ch : "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

const label = (state) => Object.fromEntries(TABS)[state];

export function groups(rows) {
  const out = [];
  for (const item of rows) {
    const name = item.features.join(", ") || "기능 구분 없음";
    if (!out.length || out.at(-1)[0] !== name) out.push([name, []]);
    out.at(-1)[1].push(item);
  }
  return out;
}

export const stat = (title, value, sub, attr = "") => `<div class="st"${attr}><span>${esc(title)}</span><b>${esc(value)}</b><span>${esc(sub)}</span></div>`;

// copyButton(file) → 경로 복사 버튼 HTML(실제 경로 칸이 비면 빈 문자열).
const planLink = (plan, copyButton) =>
  `<span class="doc-entry"><a href="view.html#${esc(quote(plan.file))}">${esc(plan.title)}</a>${copyButton(plan.file)}</span>`;

const rowAttrs = (plan) => {
  const text = [plan.title, label(plan.state), ...plan.features].join(" ").toLowerCase();
  return `data-features="${esc(plan.features.join("|"))}" data-text="${esc(text)}"`;
};

const progress = (plan) => {
  const value = plan.progress;
  const bar = value ? `<i class="pct" style="flex:0 0 ${value}%"></i>` : "";
  return `<div class="prog"><div class="pbar">${bar}</div><span class="pn">${value === null ? "-" : `${value}%`}</span></div>`;
};

const check = (plan) => {
  if (!plan.total) return '<td class="ck">-</td>';
  const text = `${plan.checked}/${plan.total}`;
  if (plan.mismatch) return `<td class="ck warn" title="상태는 완료인데 체크 안 된 항목 ${plan.total - plan.checked}개">${text} ⚠</td>`;
  return `<td class="ck">${text}</td>`;
};

const planTable = (rows, copyButton) => {
  const body = rows.map((p) => `<tr ${rowAttrs(p)}><td class="doc">${planLink(p, copyButton)}</td>`
    + `<td><span class="badge ${p.state}">${esc(label(p.state))}</span></td>`
    + `<td>${progress(p)}</td>${check(p)}<td class="mono">${esc(p.updated)}</td><td class="mono">${esc(p.date)}</td></tr>`).join("");
  return '<table class="pl-t"><thead><tr><th>계획</th><th>상태</th><th>진행률</th><th>체크</th>'
    + `<th class="mono">최종 갱신</th><th class="mono">작성일</th></tr></thead><tbody>${body}</tbody></table>`;
};

const refTable = (rows, copyButton) => {
  const body = rows.map((p) => `<tr ${rowAttrs(p)}><td class="doc">${planLink(p, copyButton)}</td><td class="mono">${esc(p.date)}</td></tr>`).join("");
  return `<table class="ref-t"><thead><tr><th>계획</th><th class="mono">작성일</th></tr></thead><tbody>${body}</tbody></table>`;
};

const panel = (key, text, rows, copyButton) => {
  const table = key === "ref" ? refTable : planTable;
  const note = key === "ref" ? '<p class="dim note">frontmatter <code>status</code>가 없는 인계·메모·매핑 문서다.</p>' : "";
  const body = groups(rows).map(([name, items]) =>
    `<section class="grp"><div class="mhd"><b>${esc(name)}</b><span class="sub">${items.length}건</span></div>${table(items, copyButton)}</section>`).join("");
  return `<div class="panel" data-key="${key}" role="tabpanel" hidden>`
    + `<h2 class="ph" hidden>${esc(text)} <span class="cnt"></span></h2>${note}${body}`
    + '<p class="empty" hidden>조건에 맞는 계획이 없다.</p></div>';
};

// 화면 조각 {stats, tabs, chips, panels}. plans_index_html.render_html 의 STATS·TABS·CHIPS·PANELS 와 같다.
export function renderParts(sections, copyButton = () => "") {
  const doing = sections.doing;
  const known = doing.map((p) => p.progress).filter((value) => value !== null);
  const average = known.length ? `평균 진행률 ${roundHalfEven(known.reduce((a, b) => a + b, 0) / known.length)}%` : "진행률 없음";
  const plans = Object.values(sections).flat();
  const mismatch = plans.filter((p) => p.mismatch).length;
  const stats = [
    stat("할 일", `${sections.todo.length}건`, "착수 전"),
    stat("진행 중", `${doing.length}건`, average),
    stat("완료", `${sections.done.length}건`, `참고 ${sections.ref.length}건 별도`),
    stat("체크 어긋남", `${mismatch}건`, "완료인데 [ ] 남음"),
    stat("동기화", "—", "정적 파일", ' id="syncstat"'),
  ].join("");
  const tabs = TABS.map(([key, text]) =>
    `<button class="tab" role="tab" data-tab="${key}">${esc(text)} <span class="cnt" data-total="${sections[key].length}">${sections[key].length}</span></button>`).join("");
  const features = [...new Set(plans.flatMap((p) => p.features))].sort(cmp);
  const chips = '<button class="f" data-feature="">전체</button>'
    + features.map((f) => `<button class="f" data-feature="${esc(f)}">${esc(f)}</button>`).join("");
  const panels = TABS.map(([key, text]) => panel(key, text, sections[key], copyButton)).join("");
  return { stats, tabs, chips, panels };
}
