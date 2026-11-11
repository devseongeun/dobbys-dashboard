import { hoursText } from "./model.js";

const esc = (v) => String(v == null ? "" : v)
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const pd = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const ds = (dt) =>
  dt.getFullYear() +
  "-" + String(dt.getMonth() + 1).padStart(2, "0") +
  "-" + String(dt.getDate()).padStart(2, "0");
const shift = (iso, days) => {
  const dt = pd(iso);
  dt.setDate(dt.getDate() + days);
  return ds(dt);
};

export function presetRange(preset, today) {
  const weekday = (pd(today).getDay() + 6) % 7; // 월=0
  const monday = shift(today, -weekday);
  if (preset === "week") return { from: monday, to: shift(monday, 6) };
  if (preset === "lastWeek") {
    const prev = shift(monday, -7);
    return { from: prev, to: shift(prev, 6) };
  }
  const first = today.slice(0, 8) + "01";
  const dt = pd(first);
  const last = new Date(dt.getFullYear(), dt.getMonth() + 1, 0);
  return { from: first, to: ds(last) };
}

export function filterByRange(worklogs, from, to) {
  return worklogs.filter((log) => log.started >= from && log.started <= to);
}

export function mineOnly(worklogs, myAccountId) {
  // union JQL 이 공동작업 이슈를 끌어오므로 타인 기록이 섞인다.
  // 내 실적 집계에 남의 시간이 합산되면 주간보고 숫자가 부풀려진다.
  if (!myAccountId) return worklogs;
  return worklogs.filter((log) => log.authorId === myAccountId);
}

export function aggregate(worklogs, from, to) {
  const picked = filterByRange(worklogs, from, to);
  const dates = new Map();
  const issues = new Map();
  let totalSeconds = 0;

  for (const log of picked) {
    totalSeconds += log.seconds;
    dates.set(log.started, (dates.get(log.started) || 0) + log.seconds);
    const bucket = issues.get(log.issueKey) || { key: log.issueKey, count: 0, seconds: 0 };
    bucket.count += 1;
    bucket.seconds += log.seconds;
    issues.set(log.issueKey, bucket);
  }

  return {
    totalSeconds,
    dayCount: dates.size,
    issueCount: issues.size,
    byDate: [...dates].sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, seconds]) => ({ date, seconds })),
    byIssue: [...issues.values()].sort((a, b) => b.seconds - a.seconds),
  };
}

export function renderWorklog(agg, worklogs) {
  if (!agg.totalSeconds) return '<div class="empty">선택한 기간에 기록이 없다.</div>';

  const avg = agg.dayCount ? agg.totalSeconds / agg.dayCount : 0;
  const peak = Math.max(...agg.byDate.map((d) => d.seconds));
  const summary =
    `<div class="stats">` +
    `<div class="st"><span>총 기록</span><b>${hoursText(agg.totalSeconds)}</b></div>` +
    `<div class="st"><span>기록한 날</span><b>${agg.dayCount}일</b></div>` +
    `<div class="st"><span>일평균</span><b>${hoursText(avg)}</b></div>` +
    `<div class="st"><span>이슈 수</span><b>${agg.issueCount}건</b></div></div>`;

  const chart = '<div class="chart">' + agg.byDate.map((d) =>
    `<div class="crow"><span class="cdate">${esc(d.date)}</span>` +
    `<span class="cbar" style="width:${Math.round((d.seconds / peak) * 100)}%"></span>` +
    `<span class="cval">${hoursText(d.seconds)}</span></div>`).join("") + "</div>";

  const byDate = new Map();
  for (const log of worklogs) {
    if (!byDate.has(log.started)) byDate.set(log.started, []);
    byDate.get(log.started).push(log);
  }
  const groups = [...byDate].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([date, logs]) =>
    `<section class="lgroup"><h4>${esc(date)}</h4>` + logs.map((log) =>
      `<div class="lrow"><span class="mono">${esc(log.issueKey)}</span>` +
      `<span class="mono">${hoursText(log.seconds)}</span>` +
      `<span class="lc">${esc((log.comment || "").split("\n")[0])}</span></div>`).join("") +
    "</section>").join("");

  const table = "<table><thead><tr><th>이슈</th><th>건수</th><th>합계</th><th>비중</th></tr></thead><tbody>" +
    agg.byIssue.map((i) =>
      `<tr><td class="mono">${esc(i.key)}</td><td class="mono">${i.count}</td>` +
      `<td class="mono">${hoursText(i.seconds)}</td>` +
      `<td class="mono">${Math.round((i.seconds / agg.totalSeconds) * 100)}%</td></tr>`).join("") +
    "</tbody></table>";

  return summary + chart + groups + table;
}
