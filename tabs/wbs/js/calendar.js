import { isEditable } from "./plan.js";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const DOMAIN_CLASS = { "공통": "com", "티켓": "tck", "테스트": "tst", "시스템 관리": "sys" };
const DAY_MS = 86400000;

const pd = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const ds = (dt) =>
  dt.getFullYear() +
  "-" + String(dt.getMonth() + 1).padStart(2, "0") +
  "-" + String(dt.getDate()).padStart(2, "0");
const addDays = (dt, n) => {
  const copy = new Date(dt);
  copy.setDate(copy.getDate() + n);
  return copy;
};
const esc = (value) =>
  String(value == null ? "" : value).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function assignLanes(items) {
  const ends = [];
  const sorted = items.slice().sort((a, b) =>
    a.s - b.s || b.e - a.e || String(a.row.key).localeCompare(String(b.row.key)));
  for (const item of sorted) {
    let lane = 0;
    while (ends[lane] !== undefined && ends[lane] >= item.s) lane++;
    ends[lane] = item.e;
    item.lane = lane;
  }
  return sorted;
}

// 일정 조정 탭에서 날짜가 바뀐 행은 변경 전 일정을 점선 막대(ghost)로 함께 그린다.
const hasGhost = (r) => Boolean(r.dateChanged && r.orig.start && r.orig.end);

export function monthKeys(rows, today) {
  const dated = rows.filter((r) => r.schedulable);
  // 원래 달 섹션도 그려야 기존 막대(점선)가 보인다.
  const starts = dated.flatMap((r) => (hasGhost(r) ? [r.start, r.orig.start] : [r.start])).concat(today);
  const ends = dated.flatMap((r) => (hasGhost(r) ? [r.end, r.orig.end] : [r.end])).concat(today);
  const from = starts.reduce((a, b) => (b < a ? b : a)).slice(0, 7);
  const to = ends.reduce((a, b) => (b > a ? b : a)).slice(0, 7);
  const keys = [];
  for (let d = pd(from + "-01"); ds(d).slice(0, 7) <= to; d.setMonth(d.getMonth() + 1)) {
    keys.push(ds(d).slice(0, 7));
  }
  return keys;
}

function barClass(row) {
  const parts = ["bar", DOMAIN_CLASS[row.domain] || "etc"];
  if (row.status === "취소") parts.push("is-cancelled");
  else if (row.statusCategory === "완료") parts.push("is-done");
  else if (row.status === "개발완료") parts.push("is-devdone");
  if (row.overdue) parts.push("is-overdue");
  return parts.join(" ");
}

// 마감 배지는 아직 손이 가야 하는 작업에만 붙인다. D-2 이하·기한 초과는 urgent.
function ddayBadge(row) {
  if (row.dday === null || row.dday === undefined) return null;
  if (row.statusCategory === "완료" || row.status === "개발완료") return null;
  const text = row.dday > 0 ? `D-${row.dday}` : row.dday === 0 ? "D-day" : `D+${-row.dday}`;
  return { text, urgent: row.dday <= 2 };
}

// months: { from, to } ("YYYY-MM", null 이면 제한 없음). 기간 필터가 이전 달 섹션을 잘라낸다.
// edit: 일정 조정 탭 전용. 칸에 data-date, 편집 가능한 막대에 양 끝 손잡이, 변경 전 일정은 점선 막대로 그린다.
export function renderCalendar(rows, holidays, today, months = {}, { edit = false } = {}) {
  const dated = rows.filter((r) => r.schedulable);
  if (!dated.length) return '<div class="empty">조건에 해당하는 작업이 없다.</div>';

  const keys = monthKeys(dated, today).filter((k) =>
    (!months.from || k >= months.from) && (!months.to || k <= months.to));
  return keys.map((monthKey) => {
    const [year, month] = monthKey.split("-").map(Number);
    const first = new Date(year, month - 1, 1);
    const last = new Date(year, month, 0);
    const overlaps = (r) => r.start <= ds(last) && r.end >= ds(first);
    const inMonth = dated.filter(overlaps);
    const gridStart = addDays(first, -first.getDay());
    const gridEnd = addDays(last, 6 - last.getDay());
    const lastIndex = Math.round((gridEnd - gridStart) / DAY_MS);
    const index = (iso) => Math.round((pd(iso) - gridStart) / DAY_MS);
    const place = (row, range, ghost) => ({
      row,
      ghost,
      s: Math.max(index(range.start), 0),
      e: Math.min(index(range.end), lastIndex),
      preL: index(range.start) < 0,
      postR: index(range.end) > lastIndex,
    });
    const ghosts = edit ? dated.filter((r) => hasGhost(r) && overlaps(r.orig)) : [];

    const items = assignLanes(inMonth.map((row) => place(row, row, false))
      .concat(ghosts.map((row) => place(row, row.orig, true))));

    const weeks = [];
    const weekCount = Math.round((gridEnd - gridStart) / DAY_MS + 1) / 7;
    for (let w = 0; w < weekCount; w++) {
      const wStart = w * 7;
      const wEnd = wStart + 6;
      let cells = "";
      let nums = "";
      for (let i = 0; i < 7; i++) {
        const day = addDays(gridStart, wStart + i);
        const iso = ds(day);
        const outside = day.getMonth() !== month - 1;
        const off = i === 0 || i === 6 || holidays[iso];
        cells += `<div class="cellbg${outside ? " out" : off ? " off" : ""}" style="grid-column:${i + 1}"` +
          `${edit ? ` data-date="${iso}"` : ""}></div>`;
        const holiday = holidays[iso] ? `<span class="hn">${esc(holidays[iso])}</span>` : "";
        const todayBadge = iso === today && !outside ? '<span class="dnum today">오늘</span>' : "";
        const tone = outside ? "out" : i === 0 ? "sun" : i === 6 ? "sat" : "";
        nums += `<div class="dnum ${tone}" style="grid-column:${i + 1}">${day.getDate()}${holiday}${todayBadge}</div>`;
      }

      let bars = "";
      let maxLane = -1;
      for (const item of items) {
        if (item.e < wStart || item.s > wEnd) continue;
        const s = Math.max(item.s, wStart);
        const e = Math.min(item.e, wEnd);
        const head = item.s >= wStart && !item.preL;
        const cut = item.e > wEnd || (item.e === wEnd && item.postR);
        const tail = item.e <= wEnd && !item.postR;
        maxLane = Math.max(maxLane, item.lane);
        const row = item.row;
        const pos = `grid-column:${s - wStart + 1}/span ${e - s + 1};grid-row:${item.lane + 2}`;
        if (item.ghost) {
          bars += `<div class="bar ghost${head ? "" : " mid"}${cut ? " cut" : ""}" style="${pos}"` +
            ` title="기존 ${esc(row.key)} (${row.orig.start} ~ ${row.orig.end})">` +
            `<span class="jk">${head ? esc(row.key) : "‹"}</span><span class="nm">기존 일정</span></div>`;
          continue;
        }
        const badge = tail ? ddayBadge(item.row) : null;
        // [확인]한 변경안은 잠근다(목록에서 확인을 풀어야 다시 끌 수 있다).
        const editable = edit && isEditable(row) && !row.confirmedAt;
        const handover = edit && row.changed && row.assignee !== row.orig.assignee;
        const label =
          (editable && head ? '<span class="hd l" data-edge="start"></span>' : "") +
          (head ? `<span class="jk">${esc(row.key)}</span>` : '<span class="co">‹</span>') +
          (head && handover ? `<span class="ho">${esc(row.orig.assignee || "미지정")}→${esc(row.assignee)}</span>` : "") +
          `<span class="nm">${esc(row.name)}</span>` +
          (cut ? '<span class="co">›</span>' : "") +
          (badge ? `<span class="dd">${badge.text}</span>` : "") +
          (editable && tail ? '<span class="hd r" data-edge="end"></span>' : "");
        const tailClass = tail ? " tail" + (badge?.urgent ? " urgent" : "") : "";
        const editClass = (editable ? " editable" : "") + (row.changed ? " is-draft" : "") +
          (row.confirmedAt ? " is-confirmed" : "");
        bars += `<div class="${barClass(row)}${head ? "" : " mid"}${cut ? " cut" : ""}${tailClass}${editClass}"` +
          ` style="${pos}"` +
          ` data-key="${esc(row.key)}" title="${esc(row.key)} ${esc(row.name)} (${row.start} ~ ${row.end})">` +
          `${label}</div>`;
      }
      const rowsStyle = maxLane >= 0 ? `grid-template-rows:auto repeat(${maxLane + 1},19px)` : "";
      weeks.push(`<div class="week" style="${rowsStyle}">${cells}${nums}${bars}</div>`);
    }

    const head = `<div class="mhd"><b>${year}년 ${month}월</b>` +
      `<span class="sub">작업 ${inMonth.length}건</span></div>` +
      `<div class="dow">${DOW.map((d) => `<div>${d}</div>`).join("")}</div>`;
    return `<section class="month" id="m-${monthKey}">${head}${weeks.join("")}</section>`;
  }).join("");
}
