import { hoursText } from "./model.js";

const ORDER = ["할 일", "진행", "완료", "취소"];
const esc = (v) => String(v == null ? "" : v)
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function groupByStatus(rows) {
  const buckets = new Map(ORDER.map((status) => [status, []]));
  buckets.set("기타", []);
  for (const row of rows) {
    const key = ORDER.includes(row.status) ? row.status : "기타";
    buckets.get(key).push(row);
  }
  return [...buckets].map(([status, items]) => ({
    status,
    rows: items,
    seconds: items.reduce((sum, r) => sum + (r.spentSeconds || 0), 0),
  }));
}

export function renderBoard(rows) {
  return '<div class="board">' + groupByStatus(rows).map((column) => {
    const cards = column.rows.map((row) =>
      `<article class="card${row.overdue ? " is-overdue" : ""}${row.status === "개발완료" ? " is-devdone" : ""}"` +
      ` data-key="${esc(row.key)}">` +
      `<div class="ck">${esc(row.key)}</div>` +
      `<div class="cn">${esc(row.name)}</div>` +
      `<div class="cm"><span>${esc(row.duedate || "기한 없음")}</span>` +
      `<span>${hoursText(row.spentSeconds)}</span></div></article>`).join("");
    return `<section class="col"><header><b>${esc(column.status)}</b>` +
      `<span>${column.rows.length}건 · ${hoursText(column.seconds)}</span></header>` +
      `<div class="cards">${cards || '<p class="empty">없음</p>'}</div></section>`;
  }).join("") + "</div>";
}
