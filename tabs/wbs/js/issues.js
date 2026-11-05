import { dateRangeText, hoursText, jiraUrl } from "./model.js";

const esc = (v) => String(v == null ? "" : v)
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const linkButton = (row, jira, label, title) => jira.connected && row.taskId
  ? `<button class="copy" data-link="${esc(row.taskId)}" title="${title}">${label}</button>` : "";

function keyCell(row, jira) {
  if (!row.jiraKey) {
    return `<span class="dim">${esc(row.taskId || row.key)}</span>` + linkButton(row, jira, "이슈 연결", "Jira 이슈 연결");
  }
  const url = jiraUrl(jira.domain, row.jiraKey);
  return `<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(row.jiraKey)}</a>` +
    `<button class="copy" data-copy="${esc(row.jiraKey)}" title="이슈키 복사">⧉</button>` +
    `<button class="copy" data-copy="${esc(url)}" title="링크 복사">🔗</button>` +
    linkButton(row, jira, "✎", "연결 바꾸기");
}

const ACCESSOR = {
  status: (r) => r.status,
  key: (r) => r.key,
  name: (r) => r.name,
  start: (r) => r.start,
  duedate: (r) => r.duedate,
  md: (r) => r.md,
  spent: (r) => r.spentSeconds,
};

export function sortRows(rows, key, dir) {
  const get = ACCESSOR[key] || ACCESSOR.duedate;
  return rows.slice().sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    const aEmpty = av === null || av === undefined || av === "";
    const bEmpty = bv === null || bv === undefined || bv === "";
    if (aEmpty && bEmpty) return String(a.key).localeCompare(String(b.key));
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    if (av === bv) return String(a.key).localeCompare(String(b.key));
    return (av > bv ? 1 : -1) * dir;
  });
}

const COLUMNS = [
  ["status", "상태"], ["key", "이슈키"], ["name", "이름"],
  ["", "도메인"], ["", "화면ID"], ["start", "계획기간"],
  ["duedate", "기한"], ["", "D-day"], ["md", "계획 M/D"], ["spent", "누적시간"],
];

export function renderIssues(rows, sort, jira = { domain: null, connected: false }) {
  if (!rows.length) return '<div class="empty">조건에 해당하는 작업이 없다.</div>';

  const head = COLUMNS.map(([key, label]) => {
    if (!key) return `<th>${label}</th>`;
    const active = sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : "";
    return `<th class="sortable" data-sort="${key}">${label}${active}</th>`;
  }).join("");

  const body = sortRows(rows, sort.key, sort.dir).map((row) =>
    `<tr class="row${row.overdue ? " is-overdue" : ""}${row.status === "개발완료" ? " is-devdone" : ""}"` +
    ` data-key="${esc(row.key)}">` +
    `<td><span class="sdot s-${esc(row.status || "none")}"></span>${esc(row.status || "—")}</td>` +
    `<td class="mono">${keyCell(row, jira)}</td>` +
    `<td>${esc(row.name)}</td>` +
    `<td>${esc(row.domain || "—")}</td>` +
    `<td class="mono">${esc(row.screen || "—")}</td>` +
    `<td class="mono">${dateRangeText(row.start, row.end)}</td>` +
    `<td class="mono">${esc(row.duedate || "—")}</td>` +
    `<td class="mono">${row.dday === null ? "—" : `D${row.dday >= 0 ? "-" : "+"}${Math.abs(row.dday)}`}</td>` +
    `<td class="mono">${row.md === null ? "—" : row.md + " M/D"}</td>` +
    `<td class="mono">${hoursText(row.spentSeconds)}</td></tr>`).join("");

  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
