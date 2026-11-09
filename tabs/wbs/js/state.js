export const TABS = ["cal", "plan", "board", "issues", "log"];
// 보드 칸이자 상태 필터 칩. 진행 흐름(할 일 → 진행 → 개발완료 → 완료) 뒤에 취소, 그 밖은 기타(OTHER).
export const STATUSES = ["할 일", "진행", "개발완료", "완료", "취소"];
export const OTHER = "기타";

// 보드 칸. Jira 상태가 STATUSES 중 하나면 그 값이 우선하고, 아니면 사용자가 지정한 칸(row.assigned), 없으면 기타.
export function columnOf(row) {
  if (STATUSES.includes(row.status)) return row.status;
  return STATUSES.includes(row.assigned) ? row.assigned : OTHER;
}

// 기간 필터. 기본은 이번 달만. 해시에는 기본값이 아닐 때만 per=fromThis|all 로 남긴다.
export const PERIODS = ["thisOnly", "fromThis", "all"];

export function defaultState(domains = []) {
  return {
    tab: "cal",
    doms: new Set(domains),
    statuses: new Set(STATUSES),
    soloOnly: false,
    period: "thisOnly",
  };
}

export function monthBounds(today) {
  const [y, m] = today.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const month = today.slice(0, 7);
  return { month, first: month + "-01", last: month + "-" + String(lastDay).padStart(2, "0") };
}

// 캘린더가 그릴 월 범위("YYYY-MM"). 비어 있으면 제한 없음.
export function periodMonths(period, today) {
  const { month } = monthBounds(today);
  if (period === "thisOnly") return { from: month, to: month };
  if (period === "fromThis") return { from: month, to: null };
  return { from: null, to: null };
}

function parseSet(value, allowed) {
  if (!value) return new Set(allowed);
  const picked = value.split(",").map(decodeURIComponent).filter((v) => allowed.includes(v));
  return picked.length ? new Set(picked) : new Set(allowed);
}

export function parseHash(hash, domains = []) {
  const state = defaultState(domains);
  const query = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  const tab = query.get("tab");
  if (TABS.includes(tab)) state.tab = tab;
  state.doms = parseSet(query.get("dom"), domains);
  state.statuses = parseSet(query.get("st"), STATUSES);
  state.soloOnly = query.get("solo") === "1";
  const period = query.get("per");
  if (PERIODS.includes(period)) state.period = period;
  return state;
}

export function toHash(state, domains = []) {
  const parts = [`tab=${state.tab}`];
  if (state.doms.size !== domains.length) {
    parts.push("dom=" + [...state.doms].map(encodeURIComponent).join(","));
  }
  if (state.statuses.size !== STATUSES.length) {
    parts.push("st=" + [...state.statuses].map(encodeURIComponent).join(","));
  }
  if (state.soloOnly) parts.push("solo=1");
  if (state.period !== "thisOnly") parts.push("per=" + state.period);
  return "#" + parts.join("&");
}

export function matches(row, state, today) {
  if (row.domain && !state.doms.has(row.domain)) return false;
  // 상태 칩은 STATUSES 만 렌더된다. 그 밖의 상태(워크플로 변경·하위작업 전용 등)를
  // 걸러내면 사용자가 다시 켤 수단이 없어 이슈가 조용히 사라진다. 통과시킨다.
  // 기타 행에 칸을 지정했으면 그 칸의 칩을 따른다.
  const column = columnOf(row);
  if (column !== OTHER && !state.statuses.has(column)) return false;
  if (state.soloOnly && (row.people || 1) !== 1) return false;
  // 일정이 비어 판단할 수 없는 Jira 이슈는 숨기지 않는다(Jira 최우선).
  if (state.period !== "all") {
    const { first, last } = monthBounds(today);
    if (row.end && row.end < first) return false;
    if (state.period === "thisOnly" && row.start && row.start > last) return false;
  }
  return true;
}
