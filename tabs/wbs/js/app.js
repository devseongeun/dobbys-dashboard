import { renderBoard } from "./board.js";
import { renderCalendar } from "./calendar.js";
import { renderIssues } from "./issues.js";
import { dateRangeText, hoursText, jiraUrl, joinRows, recentWorklogs } from "./model.js";
import {
  applyDrafts, changeList, daysBetween, editRange, parseDrafts, parseKeys, renderChanges, setDraft,
  shiftRange, toggleConfirmAll, widenMonths,
} from "./plan.js";
import { DOMAINS, STATUSES, TABS, matches, parseHash, periodMonths, toHash } from "./state.js";
import { aggregate, filterByRange, mineOnly, presetRange, renderWorklog } from "./worklog.js";

const esc = (v) => String(v == null ? "" : v)
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const todayISO = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0");
};
// 일정 조정 초안은 서버가 로컬 파일(~/Library/Application Support/trb-wbs-jira/plan-drafts.json)에
// 저장한다. 서버·브라우저를 재기동해도 남는다. Jira 로는 절대 보내지 않는다.
// 예전 버전은 localStorage 에 두었다. 첫 로드 때 파일로 옮기고 지운다.
const LEGACY_STORE = "trb-wbs-jira:plan-drafts";
let saving = Promise.resolve(true);

// 저장 순서를 지키도록 PUT 을 줄 세운다. 불러오기 전에는 저장하지 않는다(빈 초안으로 파일을 덮지 않게).
function saveDrafts() {
  if (!app.draftsReady) return Promise.resolve(false);
  const body = JSON.stringify(app.drafts);
  saving = saving.then(() => fetch("api/drafts", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body,
  })).then((r) => {
    if (!r.ok) throw new Error(r.status === 405 ? "서버가 예전 버전이다. serve.py 를 재시작해야 한다" : "HTTP " + r.status);
    return true;
  }).catch((err) => {
    app.notice = "초안 저장 실패: " + err.message;
    render();
    return false;
  });
  return saving;
}

async function loadDrafts() {
  try {
    const res = await fetch("api/drafts");
    if (!res.ok) throw new Error(res.status === 404 ? "서버가 예전 버전이다. serve.py 를 재시작해야 한다" : "HTTP " + res.status);
    const saved = parseDrafts(await res.text());
    const legacy = parseDrafts(localStorage.getItem(LEGACY_STORE));
    app.drafts = { ...legacy, ...saved };
    app.draftsReady = true;
    if (Object.keys(legacy).length && await saveDrafts()) localStorage.removeItem(LEGACY_STORE);
  } catch (err) {
    app.notice = "초안 불러오기 실패(저장 중지): " + err.message;
  }
}

const app = {
  state: parseHash(location.hash),
  wbs: { tasks: [], holidays: {} },
  board: { issues: [], worklogs: [], fetchedAt: null, stale: false, error: null },
  rows: [],
  sort: { key: "duedate", dir: 1 },
  preset: "week",
  range: null,
  drafts: {},
  draftsReady: false,
  // 내 담당이 아닌 이슈(담당 변경 요청 대상). 일정 조정 탭에서만 쓰고 다른 탭에는 섞지 않는다.
  extra: [],
  notice: "",
  drag: null,
};

const planRows = () => app.rows.concat(app.extra);

// 읽기 전용 키 조회(GET /api/issues). 담당자와 무관하게 이슈 정보를 가져온다.
// 404 는 이 엔드포인트가 생기기 전에 띄운 serve.py 가 아직 돌고 있다는 뜻이다.
const lookupIssues = (keys) =>
  fetch("api/issues?keys=" + encodeURIComponent(keys.join(","))).then((r) => {
    if (r.status === 404) throw new Error("서버가 예전 버전이다. serve.py 를 재시작해야 한다");
    return r.json();
  });

function addExtra(issues) {
  const known = new Set(planRows().map((r) => r.key));
  const fresh = issues.filter((issue) => !known.has(issue.key));
  const keys = new Set(fresh.map((issue) => issue.key));
  app.extra = app.extra.concat(
    joinRows(app.wbs.tasks.filter((t) => keys.has(t.jira)), fresh, todayISO()));
}

async function load(refresh) {
  if (!app.draftsReady) await loadDrafts();
  try {
    const [wbs, board] = await Promise.all([
      fetch("wbs.json").then((r) => r.json()),
      fetch("api/board" + (refresh ? "?refresh=1" : "")).then((r) => r.json()),
    ]);
    app.wbs = wbs;
    app.board = board;
    app.rows = joinRows(wbs.tasks, board.issues, todayISO());
    app.extra = [];
    const known = new Set(app.rows.map((r) => r.key));
    const missing = Object.keys(app.drafts).filter((key) => !known.has(key));
    if (missing.length) {
      // 담당 변경 이슈 조회 실패는 보드 자체 실패가 아니다. 일정 조정 탭 안내로만 띄운다.
      try {
        const found = await lookupIssues(missing);
        addExtra(found.issues || []);
        if (found.error) app.notice = "담당 변경 이슈 조회 실패: " + found.error;
      } catch (err) {
        app.notice = "담당 변경 이슈 조회 실패: " + err.message;
      }
    }
  } catch (err) {
    app.board = { ...app.board, stale: true, error: "서버 응답 실패: " + err.message };
  }
  render();
}

// 붙여 넣은 이슈키를 조회해 일정 조정 탭에 올리고 '현재 담당자 → target' 변경안을 만든다.
// 내 이슈를 남에게 넘기는 경우(target=박지수)와 남의 이슈를 받는 경우(target=나) 모두 같은 경로다.
async function importKeys(text, target) {
  const keys = parseKeys(text);
  target = String(target || "").trim();
  app.target = target;
  if (!keys.length || !target) {
    app.notice = !keys.length ? "이슈키를 찾지 못했다 (예: PROJ-1112)" : "새 담당자를 입력한다";
    render();
    return;
  }
  try {
    const res = await lookupIssues(keys);
    if (res.error) throw new Error(res.error);
    addExtra(res.issues);
    const found = new Set(res.issues.map((issue) => issue.key));
    const already = [];
    for (const row of planRows()) {
      if (!found.has(row.key)) continue;
      if (row.assignee === target) already.push(row.key);
      else app.drafts = setDraft(app.drafts, row, { assignee: target });
    }
    saveDrafts();
    const missed = keys.filter((key) => !found.has(key));
    app.notice = `${found.size - already.length}건 → ${target}` +
      (already.length ? ` · 이미 ${target} 담당: ${already.join(", ")}` : "") +
      (missed.length ? ` · 못 찾음: ${missed.join(", ")}` : "");
  } catch (err) {
    app.notice = "조회 실패: " + err.message;
  }
  render();
}

// 담당자 입력 자동완성 후보: 화면에 올라온 이슈의 담당자 + 나.
const people = () => [...new Set(planRows().map((r) => r.assignee)
  .concat(app.board.me?.displayName).filter(Boolean))].sort();

function renderFilters() {
  const chip = (label, on, attr) =>
    `<button class="f${on ? " on" : ""}" ${attr}>${esc(label)}</button>`;
  document.getElementById("filters").innerHTML =
    DOMAINS.map((d) => chip(d, app.state.doms.has(d), `data-dom="${esc(d)}"`)).join("") +
    '<span class="sep"></span>' +
    STATUSES.map((s) => chip(s, app.state.statuses.has(s), `data-st="${esc(s)}"`)).join("") +
    '<span class="sep"></span>' +
    chip("단독 담당만", app.state.soloOnly, 'data-flag="soloOnly"') +
    // 워크로그 탭은 자체 기간 컨트롤을 쓰므로 기간 칩을 감춘다.
    (app.state.tab === "log" ? "" :
      '<span class="sep"></span>' +
      chip("이전 달 제외", app.state.period === "fromThis", 'data-per="fromThis"') +
      chip("이번 달만", app.state.period === "thisOnly", 'data-per="thisOnly"'));
}

function renderStats(rows) {
  const done = rows.filter((r) => r.statusCategory === "완료").length;
  const md = rows.reduce((a, r) => a + (r.md || 0), 0);
  const spent = rows.reduce((a, r) => a + r.spentSeconds, 0);
  const late = rows.filter((r) => r.overdue).length;
  const cells = [
    ["이슈", rows.length + "건", `완료 ${done}건`],
    ["기한 초과", late + "건", "미완료 기준"],
    ["계획 M/D", md + " M/D", "WBS 매칭 건 합"],
    ["누적 기록", hoursText(spent), "Jira timespent"],
    ["동기화", app.board.fetchedAt ? app.board.fetchedAt.slice(11, 16) : "—",
      app.board.stale ? "캐시 표시 중" : "최신"],
  ];
  document.getElementById("stats").innerHTML = cells.map(([t, b, s]) =>
    `<div class="st"><span>${esc(t)}</span><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join("");
  document.getElementById("synced").textContent =
    app.board.fetchedAt ? "마지막 동기화 " + app.board.fetchedAt.slice(11, 16) : "";
  const banner = document.getElementById("banner");
  banner.classList.toggle("hidden", !app.board.error);
  banner.textContent = app.board.error ? "Jira 오류: " + app.board.error : "";
}

function scrollToToday(behavior) {
  const section = document.getElementById("m-" + todayISO().slice(0, 7));
  if (section) section.scrollIntoView({ behavior, block: "start" });
}

function render() {
  const today = todayISO();
  const visible = app.rows.filter((r) => matches(r, app.state, today));
  renderFilters();
  renderStats(visible);
  document.querySelectorAll(".tab").forEach((btn) =>
    btn.setAttribute("aria-selected", String(btn.dataset.tab === app.state.tab)));
  document.getElementById("logctl").classList.toggle("hidden", app.state.tab !== "log");
  document.getElementById("calctl").classList.toggle("hidden",
    app.state.tab !== "cal" && app.state.tab !== "plan");

  const panel = document.getElementById("panel");
  if (app.state.tab === "cal") {
    panel.innerHTML = renderCalendar(visible, app.wbs.holidays, today,
      periodMonths(app.state.period, today));
    if (!app.calScrolled) {
      app.calScrolled = true;
      scrollToToday("instant");
    }
  } else if (app.state.tab === "plan") {
    // 초안이 있는 이슈는 필터와 무관하게 항상 보인다(변경안을 놓치지 않게).
    const shown = planRows().filter((r) => matches(r, app.state, today) || app.drafts[r.key]);
    const planned = applyDrafts(shown, app.drafts, today);
    const me = app.board.me?.displayName || "";
    panel.innerHTML = renderChanges(changeList(planRows(), app.drafts), today,
      { notice: app.notice, people: people(), me: app.target ?? me }) +
      renderCalendar(planned, app.wbs.holidays, today,
        widenMonths(periodMonths(app.state.period, today), planned), { edit: true });
    if (!app.calScrolled) {
      app.calScrolled = true;
      scrollToToday("instant");
    }
  } else if (app.state.tab === "board") {
    panel.innerHTML = renderBoard(visible);
  } else if (app.state.tab === "issues") {
    panel.innerHTML = renderIssues(visible, app.sort);
  } else {
    const range = app.range || presetRange(app.preset, today);
    // 워크로그는 자체 기간으로 자르므로 기간 필터를 적용하지 않는다(월초 '지난 주' 누락 방지).
    const allPeriod = { ...app.state, period: "all" };
    const keys = new Set(app.rows.filter((r) => matches(r, allPeriod, today)).map((r) => r.key));
    const logs = mineOnly(
      app.board.worklogs.filter((l) => keys.has(l.issueKey)),
      app.board.me?.accountId);
    panel.innerHTML = renderWorklog(
      aggregate(logs, range.from, range.to),
      filterByRange(logs, range.from, range.to));
  }
  history.replaceState(null, "", location.pathname + toHash(app.state));
}

function openModal(key) {
  const row = planRows().find((r) => r.key === key);
  if (!row) return;
  const logs = recentWorklogs(app.board.worklogs, key, 3);
  document.getElementById("modal").innerHTML =
    `<button class="close" id="mclose">×</button><h3>${esc(row.name)}</h3>` +
    `<div class="dim">${esc([row.domain, row.menu].filter(Boolean).join(" › "))}</div>` +
    `<dl class="kv">` +
    `<dt>Jira</dt><dd><a href="${esc(jiraUrl(row.key))}" target="_blank" rel="noreferrer">${esc(row.key)}</a>` +
    `<button class="copy" data-copy="${esc(jiraUrl(row.key))}" title="링크 복사">🔗</button> · ${esc(row.status || "상태 없음")}</dd>` +
    `<dt>계획 기간</dt><dd>${dateRangeText(row.start, row.end)}${row.md ? ` (${row.md} M/D)` : ""}</dd>` +
    `<dt>담당자</dt><dd>${esc(row.assignee || "—")}</dd>` +
    `<dt>계획/실제 시작</dt><dd>${esc(row.planStart || "—")} / ${esc(row.actualStart || "—")}</dd>` +
    `<dt>기한 / 완료</dt><dd>${esc(row.duedate || "—")} / ${esc(row.actualEnd || "—")}</dd>` +
    `<dt>누적 시간</dt><dd>${hoursText(row.spentSeconds)}</dd>` +
    `<dt>화면ID</dt><dd>${esc(row.screen || "—")}</dd></dl>` +
    (logs.length
      ? `<div class="lgroup"><h4>최근 워크로그</h4>` + logs.map((l) =>
          `<div class="lrow"><span class="mono">${esc(l.started)}</span>` +
          `<span class="mono">${hoursText(l.seconds)}</span>` +
          `<span class="lc">${esc(l.author || "")} · ${esc((l.comment || "").split("\n")[0])}</span></div>`).join("") +
        "</div>"
      : "") +
    `<div class="det">${esc(row.detail || "WBS 상세기능 없음")}</div>`;
  document.getElementById("ovl").classList.add("on");
  document.getElementById("mclose").onclick = closeModal;
}
const closeModal = () => document.getElementById("ovl").classList.remove("on");

document.querySelectorAll(".tab").forEach((btn) => {
  btn.onclick = () => {
    app.state.tab = btn.dataset.tab;
    if (app.state.tab === "cal" || app.state.tab === "plan") app.calScrolled = false;
    render();
  };
});
document.getElementById("filters").onclick = (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.dom) {
    const d = target.dataset.dom;
    app.state.doms.has(d) ? app.state.doms.delete(d) : app.state.doms.add(d);
  } else if (target.dataset.st) {
    const s = target.dataset.st;
    app.state.statuses.has(s) ? app.state.statuses.delete(s) : app.state.statuses.add(s);
  } else if (target.dataset.flag) {
    app.state[target.dataset.flag] = !app.state[target.dataset.flag];
  } else if (target.dataset.per) {
    // 두 기간 칩은 배타적이다. 켜진 칩을 다시 누르면 전체 기간으로 돌아간다.
    const p = target.dataset.per;
    app.state.period = app.state.period === p ? "all" : p;
  }
  render();
};
document.getElementById("gotoday").onclick = () => scrollToToday("smooth");
document.getElementById("logctl").onclick = (event) => {
  const target = event.target.closest("[data-preset]");
  if (!target) return;
  app.preset = target.dataset.preset;
  app.range = null;
  document.querySelectorAll("[data-preset]").forEach((b) =>
    b.classList.toggle("on", b === target));
  render();
};
for (const id of ["from", "to"]) {
  document.getElementById(id).onchange = () => {
    const from = document.getElementById("from").value;
    const to = document.getElementById("to").value;
    if (from && to) {
      app.range = { from, to };
      document.querySelectorAll("[data-preset]").forEach((b) => b.classList.remove("on"));
      render();
    }
  };
}
document.getElementById("refresh").onclick = () => load(true);
// 복사 버튼은 패널(이슈 표)과 모달(ovl) 양쪽에 있어 문서 캡처 단계에서 한 번만 처리한다.
document.addEventListener("click", (event) => {
  const copyBtn = event.target.closest("[data-copy]");
  if (!copyBtn) return;
  event.stopPropagation();
  navigator.clipboard?.writeText(copyBtn.dataset.copy);
  const glyph = copyBtn.textContent;
  copyBtn.textContent = "✓";
  setTimeout(() => { copyBtn.textContent = glyph; }, 1200);
}, true);
document.getElementById("panel").onclick = (event) => {
  // 드래그 직후 따라오는 click 은 모달을 열지 않는다.
  if (app.suppressClick) { app.suppressClick = false; return; }
  const revert = event.target.closest("[data-revert]");
  if (revert) {
    const { [revert.dataset.revert]: _, ...rest } = app.drafts;
    app.drafts = rest;
    saveDrafts();
    render();
    return;
  }
  const check = event.target.closest("[data-confirm]");
  if (check) {
    // 로컬 시각 "YYYY-MM-DDTHH:mm". Jira 반영이 아니라 검토 기록이다.
    const d = new Date();
    const at = todayISO() + "T" + String(d.getHours()).padStart(2, "0") + ":" +
      String(d.getMinutes()).padStart(2, "0");
    const keys = changeList(planRows(), app.drafts).map((c) => c.key);
    app.drafts = toggleConfirmAll(app.drafts, keys, at);
    saveDrafts();
    render();
    return;
  }
  if (event.target.closest("[data-import]")) {
    importKeys(document.getElementById("pkeys").value, document.getElementById("pto").value);
    return;
  }
  if (event.target.closest("[data-reset]")) {
    const confirmed = Object.values(app.drafts).filter((d) => d.confirmedAt).length;
    const note = confirmed ? ` (확인한 ${confirmed}건 포함)` : "";
    if (confirm(`변경안 ${Object.keys(app.drafts).length}건을 모두 되돌릴까?${note}`)) {
      app.drafts = {};
      saveDrafts();
      render();
    }
    return;
  }
  const sorter = event.target.closest("[data-sort]");
  if (sorter) {
    const key = sorter.dataset.sort;
    app.sort = { key, dir: app.sort.key === key ? -app.sort.dir : 1 };
    render();
    return;
  }
  const item = event.target.closest("[data-key]");
  if (item) openModal(item.dataset.key);
};

// 일정 조정 탭 드래그. 막대 몸통=기간 이동, 왼쪽 끝=시작일, 오른쪽 끝=마감일.
// 날짜는 포인터 아래 캘린더 칸(data-date)에서 읽는다. 바뀌는 건 app.drafts 뿐이다.
const dateAt = (x, y) =>
  document.elementsFromPoint(x, y).find((el) => el.dataset?.date)?.dataset.date || null;
document.getElementById("panel").addEventListener("pointerdown", (event) => {
  if (app.state.tab !== "plan" || event.button !== 0) return;
  const bar = event.target.closest(".bar.editable");
  const anchor = bar && dateAt(event.clientX, event.clientY);
  if (!anchor) return;
  const row = planRows().find((r) => r.key === bar.dataset.key);
  if (!row) return;
  event.preventDefault();
  app.drag = {
    row,
    mode: event.target.closest("[data-edge]")?.dataset.edge || "move",
    anchor,
    last: anchor,
    base: app.drafts[row.key] || { start: row.start, end: row.end },
    moved: false,
  };
  document.body.classList.add("dragging");
});
// 창 밖에서 버튼을 놓으면 pointerup 이 안 올 수 있다. 버튼이 떨어진 채 움직이면 드래그를 끝낸다.
function endDrag() {
  if (!app.drag) return;
  if (app.drag.moved) {
    app.suppressClick = true;
    setTimeout(() => { app.suppressClick = false; }, 0);
  }
  app.drag = null;
  document.body.classList.remove("dragging");
}
document.addEventListener("pointermove", (event) => {
  const drag = app.drag;
  if (!drag) return;
  if (event.buttons === 0) { endDrag(); return; }
  const date = dateAt(event.clientX, event.clientY);
  if (!date || date === drag.last) return;
  drag.last = date;
  drag.moved = true;
  app.drafts = setDraft(app.drafts, drag.row,
    shiftRange(drag.base, drag.mode, daysBetween(drag.anchor, date)));
  saveDrafts();
  render();
});
document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);

// 변경 목록의 날짜 칸 직접 입력. 연도를 치는 도중에도 change 가 나므로 값만 저장하고,
// 다시 그리기는 칸을 벗어날 때 한다(입력 중 칸이 사라지지 않게).
document.getElementById("panel").addEventListener("change", (event) => {
  const input = event.target.closest("[data-draft]");
  const row = input && planRows().find((r) => r.key === input.dataset.draft);
  if (!row) return;
  if (input.dataset.field === "assignee") {
    // 비우면 담당 변경 취소(원래 담당자 유지).
    app.drafts = setDraft(app.drafts, row, { assignee: input.value.trim() || null });
  } else {
    const current = app.drafts[row.key] || { start: row.start, end: row.end };
    app.drafts = setDraft(app.drafts, row, editRange(current, input.dataset.field, input.value));
  }
  saveDrafts();
  app.draftDirty = true;
});
document.getElementById("panel").addEventListener("focusout", (event) => {
  if (!event.target.closest("[data-draft]") || !app.draftDirty) return;
  app.draftDirty = false;
  render();
});
document.getElementById("panel").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  if (event.target.id === "pkeys" || event.target.id === "pto") {
    importKeys(document.getElementById("pkeys").value, document.getElementById("pto").value);
  } else if (event.target.closest("[data-draft]")) {
    event.target.blur();
  }
});
document.getElementById("ovl").onclick = (e) => { if (e.target.id === "ovl") closeModal(); };
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeModal(); return; }
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  if (!document.activeElement?.classList.contains("tab")) return;
  e.preventDefault();
  const step = e.key === "ArrowRight" ? 1 : -1;
  const next = TABS[(TABS.indexOf(app.state.tab) + step + TABS.length) % TABS.length];
  app.state.tab = next;
  if (next === "cal" || next === "plan") app.calScrolled = false;
  render();
  document.querySelector(`.tab[data-tab="${next}"]`).focus();
});

load(false);
