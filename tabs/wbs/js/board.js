import { hoursText } from "./model.js";
import { OTHER, STATUSES, columnOf } from "./state.js";

const esc = (v) => String(v == null ? "" : v)
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function groupByStatus(rows) {
  const buckets = new Map(STATUSES.concat(OTHER).map((status) => [status, []]));
  for (const row of rows) buckets.get(columnOf(row)).push(row);
  return [...buckets].map(([status, items]) => ({
    status,
    rows: items,
    seconds: items.reduce((sum, r) => sum + (r.spentSeconds || 0), 0),
  }));
}

// Jira 상태가 보드 칸이 아닌 카드만 칸을 고를 수 있다. 지정한 뒤에도 고른 칸에서 다시 바꾸거나 기타로 되돌린다.
function assignControl(row) {
  if (STATUSES.includes(row.status)) return "";
  const options = [["", OTHER]].concat(STATUSES.map((s) => [s, s])).map(([value, label]) =>
    `<option value="${esc(value)}"${(row.assigned || "") === value ? " selected" : ""}>${esc(label)}</option>`).join("");
  return `<div class="ca"><span title="Jira 상태">${esc(row.status || "상태 없음")}</span>` +
    `<select data-assign="${esc(row.key)}" aria-label="보드 칸 지정">${options}</select></div>`;
}

// 진행 흐름 칸과 취소·기타 칸 사이를 띄운다.
const SPLIT = new Set(["취소", OTHER]);

export function renderBoard(rows) {
  return '<div class="board">' + groupByStatus(rows).map((column) => {
    const cards = column.rows.map((row) =>
      `<article class="card${row.overdue ? " is-overdue" : ""}${row.status === "개발완료" ? " is-devdone" : ""}"` +
      ` data-key="${esc(row.key)}">` +
      `<div class="ck">${esc(row.key)}</div>` +
      `<div class="cn">${esc(row.name)}</div>` +
      `<div class="cm"><span>${esc(row.duedate || "기한 없음")}</span>` +
      `<span>${hoursText(row.spentSeconds)}</span></div>${assignControl(row)}</article>`).join("");
    return `<section class="col${SPLIT.has(column.status) ? " split" : ""}"><header><b>${esc(column.status)}</b>` +
      `<span>${column.rows.length}건 · ${hoursText(column.seconds)}</span></header>` +
      `<div class="cards">${cards || '<p class="empty">없음</p>'}</div></section>`;
  }).join("") + "</div>";
}
