import { renderBoard } from "./board.js";
import { renderCalendar } from "./calendar.js";
import { renderIssues } from "./issues.js";
import { dateRangeText, domainsOf, hoursText, jiraUrl, joinRows, recentWorklogs } from "./model.js";
import {
  applyDrafts, changeList, daysBetween, editRange, parseDrafts, parseKeys, rekeyDrafts, renderChanges, setDraft,
  shiftRange, toggleConfirmAll, widenMonths,
} from "./plan.js";
import { TABS, matches, parseHash, periodMonths, shownStatuses, toHash } from "./state.js";
import { aggregate, filterByRange, mineOnly, presetRange, renderWorklog } from "./worklog.js";

const esc = (v) => String(v == null ? "" : v)
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const todayISO = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0");
};
// 일정 조정 초안은 서버가 개인 상태 폴더(plan-drafts.json)에 저장한다. Jira 로는 절대 보내지 않는다.
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
    app.drafts = saved;
    app.draftsReady = true;
  } catch (err) {
    app.notice = "초안 불러오기 실패(저장 중지): " + err.message;
  }
}

const app = {
  state: parseHash(location.hash, []),
  domains: [],
  jira: { domain: null, connected: false },
  jiraNotice: "",
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
  // 행 키 → 보드 칸. Jira 상태가 보드 칸이 아닌(기타) 행에만 쓰인다(state.js columnOf). 서버 status-assign.json 에 저장한다.
  assigned: {},
  notice: "",
  drag: null,
};

const planRows = () => app.rows.concat(app.extra);

function applyAssigned() {
  for (const row of planRows()) row.assigned = app.assigned[row.key] || null;
}

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
  applyAssigned();
}

async function load(refresh) {
  if (!app.draftsReady) await loadDrafts();
  try {
    const [wbs, board] = await Promise.all([
      fetch("api/wbs").then((r) => r.json()),
      fetch("api/board" + (refresh ? "?refresh=1" : "")).then((r) => r.json()),
    ]);
    const links = board.links || {};
    const tasks = wbs.tasks.map((task) => ({ ...task, jira: links[task.id] || null }));
    app.wbs = { ...wbs, tasks };
    app.board = board;
    app.assigned = board.assigned || {};
    app.jira = { domain: board.domain, connected: Boolean(board.connected), mode: board.mode || "wbs" };
    const domains = domainsOf(tasks);
    if (domains.join("|") !== app.domains.join("|")) {
      app.domains = domains;
      app.state = parseHash(location.hash, domains);
    }
    app.rows = joinRows(tasks, board.issues, todayISO());
    app.extra = [];
    applyAssigned();
    const rekeyed = rekeyDrafts(app.drafts, app.rows);
    if (rekeyed.moved) {
      app.drafts = rekeyed.drafts;
      saveDrafts();
    }
    const known = new Set(app.rows.map((r) => r.key));
    // 요구사항ID(미연결 WBS 행) 초안은 Jira 조회 대상이 아니다. Jira 키 모양만 조회한다.
    const missing = Object.keys(app.drafts).filter((key) => !known.has(key) && /^[A-Z][A-Z0-9]*-\d+$/.test(key));
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
  renderJira();
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
    app.domains.map((d) => chip(d, app.state.doms.has(d), `data-dom="${esc(d)}"`)).join("") +
    '<span class="sep"></span>' +
    shownStatuses(app.rows).map((s) => chip(s, app.state.statuses.has(s), `data-st="${esc(s)}"`)).join("") +
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
    // Jira 기준에는 WBS 행이 없어 계획 M/D 가 늘 0 이다.
    ...(app.jira.mode === "jira" ? [] : [["계획 M/D", md + " M/D", "WBS 매칭 건 합"]]),
    ["누적 기록", hoursText(spent), "Jira timespent"],
    ["동기화", app.board.fetchedAt ? app.board.fetchedAt.slice(11, 16) : "—",
      app.board.stale ? "캐시 표시 중" : "최신"],
  ];
  document.getElementById("stats").innerHTML = cells.map(([t, b, s]) =>
    `<div class="st"><span>${esc(t)}</span><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join("");
  document.getElementById("synced").textContent =
    app.board.fetchedAt ? "마지막 동기화 " + app.board.fetchedAt.slice(11, 16) : "";
  const banner = document.getElementById("banner");
  const errors = [app.wbs.error && "WBS 오류: " + app.wbs.error, app.board.error && !app.board.authError && "Jira 오류: " + app.board.error].filter(Boolean);
  banner.classList.toggle("hidden", !errors.length);
  banner.textContent = errors.join(" · ");
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
    panel.innerHTML = renderBoard(visible, shownStatuses(app.rows));
  } else if (app.state.tab === "issues") {
    panel.innerHTML = renderIssues(visible, app.sort, app.jira);
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
  history.replaceState(null, "", location.pathname + toHash(app.state, app.domains));
}

function openModal(key) {
  const row = planRows().find((r) => r.key === key);
  if (!row) return;
  const logs = recentWorklogs(app.board.worklogs, key, 3);
  document.getElementById("modal").innerHTML =
    `<button class="close" id="mclose">×</button><h3>${esc(row.name)}</h3>` +
    `<div class="dim">${esc([row.domain, row.menu].filter(Boolean).join(" › "))}</div>` +
    `<dl class="kv">` +
    `<dt>Jira</dt><dd>${row.jiraKey
      ? `<a href="${esc(jiraUrl(app.jira.domain, row.jiraKey))}" target="_blank" rel="noreferrer">${esc(row.jiraKey)}</a>` +
        `<button class="copy" data-copy="${esc(jiraUrl(app.jira.domain, row.jiraKey))}" title="링크 복사">🔗</button> · ${esc(row.status || "상태 없음")}`
      : "미연결"}` +
    `${app.jira.connected && row.taskId ? ` <button class="copy" data-link="${esc(row.taskId)}">이슈 연결</button>` : ""}</dd>` +
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
  const link = event.target.closest("[data-link]");
  if (link) { linkIssue(link.dataset.link); return; }
  // 카드 안의 칸 지정 select 를 누를 때는 모달을 열지 않는다(값 반영은 change 에서).
  if (event.target.closest("[data-assign]")) return;
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
  const pick = event.target.closest("[data-assign]");
  if (pick) { assignStatus(pick.dataset.assign, pick.value || null); return; }
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

// Jira 연동은 선택이다. 로그인 폼은 load() 뒤에만 다시 그린다(입력 중인 값을 지우지 않게 render() 와 분리).
function renderJira() {
  const box = document.getElementById("jira");
  const who = document.getElementById("jirawho");
  if (app.jira.connected) {
    box.classList.add("hidden");
    who.innerHTML = `Jira ${esc(app.board.me?.displayName || "")} · <button class="f" id="jiraout">로그아웃</button>`;
    return;
  }
  who.textContent = "";
  box.classList.remove("hidden");
  box.innerHTML = (app.board.authError
    ? "<b>Jira 인증이 만료됐다. 다시 로그인한다.</b> "
    : app.jira.mode === "jira"
      ? "Jira 기준 — 로그인하면 내 담당 이슈로 일정·보드·워크로그를 보여 준다. "
      : "Jira 연동(선택) — 로그인하면 Jira 일정·상태가 WBS보다 우선한다. ") +
    '<input id="jemail" type="email" placeholder="Jira 이메일" autocomplete="username">' +
    '<input id="jtoken" type="password" placeholder="API token" autocomplete="current-password">' +
    '<button class="f" id="jiralogin">로그인</button> ' +
    '<a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer">API token 만들기</a>' +
    (app.jiraNotice ? ` <span class="err">${esc(app.jiraNotice)}</span>` : "");
}

async function postJson(url, body, method = "POST") {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
  return data;
}

let jiraLoginPending = false;

async function jiraLogin() {
  // 버튼 클릭과 토큰 칸 Enter 가 각각 부르므로, 진행 중이면 다시 보내지 않는다(키체인 동시 생성 → 「이미 존재」 실패).
  if (jiraLoginPending) return;
  const email = document.getElementById("jemail").value.trim();
  const token = document.getElementById("jtoken").value.trim();
  if (!email || !token) { app.jiraNotice = "이메일과 API token 을 입력한다"; renderJira(); return; }
  jiraLoginPending = true;
  document.getElementById("jiralogin").disabled = true;
  try {
    await postJson("api/login", { email, token });
    app.jiraNotice = "";
    await load(true);
  } catch (err) {
    app.jiraNotice = err.message;
    renderJira();
    // 다시 그리면 입력칸이 비므로, 입력하던 값을 되살린다.
    document.getElementById("jemail").value = email;
    document.getElementById("jtoken").value = token;
  } finally {
    jiraLoginPending = false;
  }
}

async function linkIssue(taskId) {
  const current = app.wbs.tasks.find((t) => t.id === taskId)?.jira || "";
  const input = prompt(`${taskId} 에 연결할 Jira 이슈키 (예: PROJ-1234). 비우면 연결을 해제한다.`, current);
  if (input === null) return;
  try {
    await postJson("api/links", { task: taskId, key: input.trim().toUpperCase() || null }, "PUT");
    closeModal();
    await load(true);
  } catch (err) {
    alert("연결 실패: " + err.message);
  }
}

async function assignStatus(key, status) {
  try {
    app.assigned = (await postJson("api/assign", { key, status }, "PUT")).assigned;
    applyAssigned();
  } catch (err) {
    alert("상태 지정 실패: " + err.message);
  }
  // 실패해도 다시 그려 select 를 저장된 값으로 되돌린다.
  render();
}

document.addEventListener("click", (event) => {
  if (event.target.id === "jiralogin") jiraLogin();
  else if (event.target.id === "jiraout") postJson("api/logout", {}).then(() => load(true));
});
document.getElementById("jira").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.id === "jtoken") jiraLogin();
});
document.getElementById("modal").addEventListener("click", (event) => {
  const link = event.target.closest("[data-link]");
  if (link) linkIssue(link.dataset.link);
});

load(false);
