// 일정 조정 탭. Jira 일정(rows)은 읽기만 하고, 변경안은 브라우저 안의 초안(drafts)에만 둔다.
// drafts: { [issueKey]: { start, end, assignee } }. start/end 는 "YYYY-MM-DD"(원래 일정이 없으면 null),
// end 가 곧 변경 마감일이다. assignee 는 바꿀 담당자 이름, 그대로면 null.
const DAY_MS = 86400000;
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /[A-Z][A-Z0-9]*-\d+/g;

const pd = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const ds = (dt) =>
  dt.getFullYear() +
  "-" + String(dt.getMonth() + 1).padStart(2, "0") +
  "-" + String(dt.getDate()).padStart(2, "0");
const esc = (v) => String(v == null ? "" : v)
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function addDaysISO(iso, n) {
  const dt = pd(iso);
  dt.setDate(dt.getDate() + n);
  return ds(dt);
}

export const daysBetween = (from, to) => Math.round((pd(to) - pd(from)) / DAY_MS);

// "proj-1131, PROJ-1132 …" 처럼 붙여 넣은 문자열에서 이슈키만 뽑는다.
export const parseKeys = (text) => [...new Set(String(text || "").toUpperCase().match(KEY) || [])];

// mode: move(기간 통째 이동) | start(시작일만) | end(마감일만). 시작이 마감을 넘지 않게 막는다.
export function shiftRange(range, mode, delta) {
  if (mode === "move") {
    return { start: addDaysISO(range.start, delta), end: addDaysISO(range.end, delta) };
  }
  if (mode === "start") {
    const start = addDaysISO(range.start, delta);
    return { start: start > range.end ? range.end : start, end: range.end };
  }
  const end = addDaysISO(range.end, delta);
  return { start: range.start, end: end < range.start ? range.start : end };
}

// 날짜 칸 직접 입력. 시작을 마감 뒤로 옮기면 마감이, 마감을 시작 앞으로 옮기면 시작이 따라온다.
export function editRange(range, field, value) {
  if (!ISO.test(value || "")) return range;
  if (field === "start") {
    return { start: value, end: range.end && range.end >= value ? range.end : value };
  }
  return { start: range.start && range.start <= value ? range.start : value, end: value };
}

// 끝난 작업은 일정 변경 요청 대상이 아니다.
export function isEditable(row) {
  return Boolean(row.schedulable) && row.statusCategory !== "완료" && row.status !== "개발완료";
}

const isChanged = (row, d) => Boolean(d) &&
  (d.start !== row.start || d.end !== row.end || Boolean(d.assignee && d.assignee !== row.assignee));

// patch 를 현재 초안(없으면 Jira 값)에 덮는다. Jira 값과 같아지면 초안을 지운다.
// 내용이 바뀌면 확인 표시는 풀린다(확인한 것과 다른 일정이 되므로).
export function setDraft(drafts, row, patch) {
  const base = drafts[row.key] || { start: row.start, end: row.end, assignee: null };
  const draft = { ...base, ...patch, confirmedAt: null };
  if (row.taskId) draft.taskId = row.taskId;
  if (draft.assignee === row.assignee) draft.assignee = null;
  const next = { ...drafts };
  if (isChanged(row, draft)) next[row.key] = draft;
  else delete next[row.key];
  return next;
}

// [확인] 토글(전체). Jira 에 반영한 게 아니라 '내가 이 변경안 묶음을 검토했다'는 표시이며, 확인한 행은 잠긴다.
// keys(목록에 보이는 변경안)가 모두 확인된 상태면 전부 풀고, 하나라도 안 된 게 있으면(확인 뒤 추가·변경)
// 전부 지금 시각으로 확인한다.
export function toggleConfirmAll(drafts, keys, at) {
  const listed = keys.filter((key) => drafts[key]);
  const allConfirmed = listed.length > 0 && listed.every((key) => drafts[key].confirmedAt);
  const next = { ...drafts };
  for (const key of listed) next[key] = { ...drafts[key], confirmedAt: allConfirmed ? null : at };
  return next;
}

// WBS 행 키(task.jira || task.id)는 로그인·연결에 따라 바뀐다. taskId 를 가진 초안을 현재 행 키로 옮긴다.
// 옮길 키에 이미 초안이 있으면 덮지 않고 그대로 둔다.
export function rekeyDrafts(drafts, rows) {
  const keyOf = new Map(rows.filter((row) => row.taskId).map((row) => [row.taskId, row.key]));
  const next = { ...drafts };
  let moved = false;
  for (const [key, draft] of Object.entries(drafts)) {
    const target = draft.taskId && keyOf.get(draft.taskId);
    if (!target || target === key || next[target]) continue;
    next[target] = draft;
    delete next[key];
    moved = true;
  }
  return { drafts: next, moved };
}

export function parseDrafts(text) {
  try {
    const raw = JSON.parse(text || "{}");
    const out = {};
    for (const [key, v] of Object.entries(raw || {})) {
      if (!v) continue;
      const dated = ISO.test(v.start) && ISO.test(v.end) && v.start <= v.end;
      const undated = v.start == null && v.end == null;
      const assignee = typeof v.assignee === "string" && v.assignee ? v.assignee : null;
      const confirmedAt = typeof v.confirmedAt === "string" && v.confirmedAt ? v.confirmedAt : null;
      if (dated || (undated && assignee)) {
        out[key] = { start: v.start ?? null, end: v.end ?? null, assignee, confirmedAt };
        if (typeof v.taskId === "string" && v.taskId) out[key].taskId = v.taskId;
      }
    }
    return out;
  } catch {
    return {};
  }
}

// 초안을 덮은 사본을 만든다. 원본 rows 객체는 바꾸지 않는다. orig 에 Jira 기준 값을 남긴다.
export function applyDrafts(rows, drafts, today) {
  return rows.map((row) => {
    const d = drafts[row.key];
    if (!isChanged(row, d)) return row;
    const dateChanged = d.start !== row.start || d.end !== row.end;
    return {
      ...row,
      start: d.start,
      end: d.end,
      assignee: d.assignee || row.assignee,
      orig: { start: row.start, end: row.end, assignee: row.assignee },
      changed: true,
      dateChanged,
      confirmedAt: d.confirmedAt || null,
      schedulable: Boolean(d.start && d.end),
      dday: dateChanged && d.end ? daysBetween(today, d.end) : row.dday,
      overdue: dateChanged ? Boolean(d.end && d.end < today && row.statusCategory !== "완료") : row.overdue,
    };
  });
}

// 기간 필터가 잘라낸 월이라도 변경 전·후 일정이 걸친 달은 보여준다.
export function widenMonths(months, rows) {
  let { from = null, to = null } = months;
  for (const r of rows) {
    if (!r.changed) continue;
    const dates = [r.start, r.end, r.orig.start, r.orig.end].filter(Boolean).sort();
    if (!dates.length) continue;
    const lo = dates[0].slice(0, 7);
    const hi = dates[dates.length - 1].slice(0, 7);
    if (from && lo < from) from = lo;
    if (to && hi > to) to = hi;
  }
  return { from, to };
}

export function changeList(rows, drafts) {
  return applyDrafts(rows, drafts, "1970-01-01")
    .filter((r) => r.changed)
    .map((r) => ({
      key: r.key,
      name: r.name,
      from: r.orig,
      to: { start: r.start, end: r.end, assignee: r.assignee },
      confirmedAt: r.confirmedAt,
    }))
    .sort((a, b) => (a.from.start || "9999").localeCompare(b.from.start || "9999") ||
      a.key.localeCompare(b.key));
}

const md = (iso) => iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}(${DOW[pd(iso).getDay()]})` : "미정";
const span = (r) => (r.start || r.end ? `${md(r.start)} ~ ${md(r.end)}` : "미정");
const diff = (label, a, b) => (a === b ? `   ${label}: ${a} (변경 없음)` : `   ${label}: ${a} → ${b}`);

// PM 전달용 평문. 담당자·작업 기간·마감일은 바뀌지 않아도 명시해 기존→변경을 한눈에 대조하게 한다.
// 메신저에 붙여 넣었을 때 건이 뭉치지 않도록 제목 뒤와 건 사이에 빈 줄을 둔다.
export function formatChanges(changes, today) {
  if (!changes.length) return "";
  const lines = [`[일정 변경 요청] ${today} 기준 · ${changes.length}건`];
  changes.forEach((c, i) => {
    lines.push("", `${i + 1}. ${c.key} ${c.name}`);
    lines.push(diff("담당자", c.from.assignee || "미지정", c.to.assignee || "미지정"));
    lines.push(diff("작업 기간", span(c.from), span(c.to)));
    lines.push(diff("마감일", md(c.from.end), md(c.to.end)));
  });
  return lines.join("\n");
}

// people: 담당자 입력 자동완성 후보, me: 기본 대상(나).
export function renderChanges(changes, today, { notice = "", people = [], me = "" } = {}) {
  const head = `<div class="phd"><b>일정 조정 초안</b>` +
    `<span class="dim">Jira 에 반영되지 않는다 · 막대 몸통 드래그=기간 이동, 양 끝=시작일·마감일, 아래 날짜·담당자 칸으로 직접 입력</span></div>`;
  const datalist = `<datalist id="people">${people.map((p) => `<option value="${esc(p)}">`).join("")}</datalist>`;
  const importer = `<div class="pimp">` +
    `<input id="pkeys" placeholder="담당 변경 이슈키 (예: PROJ-1112, PROJ-1131)">` +
    `<span class="dim">→</span><input id="pto" list="people" value="${esc(me)}" placeholder="새 담당자">` +
    `<button class="f" data-import="1">담당 변경 추가</button>` +
    (notice ? `<span class="dim">${esc(notice)}</span>` : "") + `</div>` + datalist;
  if (!changes.length) {
    return `<div class="plan">${head}${importer}` +
      `<p class="empty">변경 없음. 캘린더 막대를 드래그하거나 이슈키로 담당 변경을 추가한다.</p></div>`;
  }
  // 확인한 행은 입력 칸 대신 글자로 보여 잠근다(비활성 date 칸은 값이 안 보이는 브라우저가 있다).
  // 고치려면 [확인]을 다시 눌러 푼다.
  const date = (c, field) =>
    `<input type="date" data-field="${field}" data-draft="${esc(c.key)}" value="${esc(c.to[field] || "")}">`;
  const handed = (c) => c.from.assignee !== c.to.assignee;
  const assignee = (c) => c.confirmedAt
    ? `<b class="${handed(c) ? "to" : ""}">${esc(c.to.assignee || "미지정")}</b>`
    : `<input class="pto${handed(c) ? " on" : ""}" list="people"` +
      ` data-field="assignee" data-draft="${esc(c.key)}" value="${esc(c.to.assignee || "")}">`;
  const period = (c) => c.confirmedAt
    ? `<b class="mono">${esc(span(c.to))}</b>`
    : `${date(c, "start")}<span class="dim">~</span>${date(c, "end")}`;
  const done = changes.filter((c) => c.confirmedAt);
  const allDone = done.length === changes.length;
  const last = done.map((c) => c.confirmedAt).sort().pop();
  const items = changes.map((c) =>
    `<div class="prow${c.confirmedAt ? " is-confirmed" : ""}"><span class="mono">${esc(c.key)}</span>` +
    `<span class="pn" title="${esc(c.name)}">${esc(c.name)}</span>` +
    `<span class="pa"><span class="${handed(c) ? "was" : ""}">${esc(c.from.assignee || "미지정")}</span>` +
    `<span class="dim">→</span>${assignee(c)}</span>` +
    `<span class="mono">${esc(span(c.from))}</span>` +
    `<span class="pd">${period(c)}</span>` +
    `<button class="copy" data-revert="${esc(c.key)}" title="되돌리기"${c.confirmedAt ? " disabled" : ""}>↺</button></div>`).join("");
  const cols = `<div class="prow ph"><span>이슈키</span><span>이슈명</span><span>담당자</span>` +
    `<span>기존 기간</span><span>변경 기간(시작 ~ 마감)</span><span></span></div>`;
  const status = allDone
    ? `확인함 ${esc(stamp(last))} · 다시 누르면 확인을 풀고 편집한다`
    : done.length
      ? `확인 이후 추가·변경 ${changes.length - done.length}건 · 다시 확인이 필요하다`
      : "확인 전";
  const actions = `<div class="pact">` +
    `<button class="f on" data-copy="${esc(formatChanges(changes, today))}">클립보드 복사 (${changes.length}건)</button>` +
    `<button class="f" data-reset="1">모두 되돌리기</button>` +
    `<button class="f pck${allDone ? " done" : ""}" data-confirm="all"` +
    ` title="Jira 반영 아님 · 내가 이 변경안을 검토했다는 표시">${allDone ? "✓ 확인됨" : "확인"}</button>` +
    `<span class="dim">${status} · Jira 에는 반영되지 않음</span></div>`;
  return `<div class="plan">${head}${importer}${cols}${items}${actions}</div>`;
}

// "2026-10-30T11:10" → "10/30 11:10"
const stamp = (at) => `${at.slice(5, 7)}/${at.slice(8, 10)} ${at.slice(11, 16)}`;
