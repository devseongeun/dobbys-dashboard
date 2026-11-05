import { expect, test } from "bun:test";
import { renderCalendar } from "../../../tabs/wbs/js/calendar.js";
import {
  applyDrafts, changeList, editRange, formatChanges, parseDrafts, parseKeys, rekeyDrafts, renderChanges, setDraft,
  shiftRange, toggleConfirmAll, widenMonths,
} from "../../../tabs/wbs/js/plan.js";

const ROW = {
  key: "PROJ-1131", name: "티켓 - 티켓 관리 - 단위 테스트", domain: "티켓", status: "할 일",
  statusCategory: "해야 할 일", assignee: "이영희", start: "2026-11-09", end: "2026-11-11",
  duedate: "2026-11-11", schedulable: true, overdue: false, people: 1, dday: 12,
};
const MINE = {
  ...ROW, key: "PROJ-1392", name: "티켓 - 티켓 관리 - 외부 결재", status: "진행",
  statusCategory: "진행 중", assignee: "홍길동", start: "2026-10-26", end: "2026-10-30",
};
const T = "2026-10-30";

test("shiftRange: 몸통은 기간을 통째로, 끝은 한쪽만 옮기고 시작이 마감을 넘지 않는다", () => {
  const r = { start: "2026-10-29", end: "2026-11-02" };
  expect(shiftRange(r, "move", 3)).toEqual({ start: "2026-11-01", end: "2026-11-05" });
  expect(shiftRange(r, "start", -2)).toEqual({ start: "2026-10-27", end: "2026-11-02" });
  expect(shiftRange(r, "start", 10)).toEqual({ start: "2026-11-02", end: "2026-11-02" });
  expect(shiftRange(r, "end", 4)).toEqual({ start: "2026-10-29", end: "2026-11-06" });
  expect(shiftRange(r, "end", -10)).toEqual({ start: "2026-10-29", end: "2026-10-29" });
});

test("editRange: 날짜 직접 입력은 반대쪽 끝을 밀어 시작 ≤ 마감을 지키고, 잘못된 값은 무시한다", () => {
  const r = { start: "2026-11-09", end: "2026-11-11" };
  expect(editRange(r, "start", "2026-11-10")).toEqual({ start: "2026-11-10", end: "2026-11-11" });
  expect(editRange(r, "start", "2026-11-14")).toEqual({ start: "2026-11-14", end: "2026-11-14" });
  expect(editRange(r, "end", "2026-11-05")).toEqual({ start: "2026-11-05", end: "2026-11-05" });
  expect(editRange(r, "end", "")).toBe(r);
  expect(editRange({ start: null, end: null }, "end", "2026-11-20")).toEqual({ start: "2026-11-20", end: "2026-11-20" });
});

test("원래 일정·담당자로 되돌리면 초안이 사라지고, 담당만 바꿔도 초안이 남는다", () => {
  const moved = setDraft({}, ROW, { start: "2026-11-12", end: "2026-11-16" });
  expect(moved).toEqual({ "PROJ-1131": { start: "2026-11-12", end: "2026-11-16", assignee: null, confirmedAt: null } });
  expect(setDraft(moved, ROW, { start: ROW.start, end: ROW.end })).toEqual({});

  const handed = setDraft({}, ROW, { assignee: "홍길동" });
  expect(handed["PROJ-1131"]).toEqual({ start: ROW.start, end: ROW.end, assignee: "홍길동", confirmedAt: null });
  const handedAndMoved = setDraft(handed, ROW, { start: "2026-11-12", end: "2026-11-16" });
  expect(handedAndMoved["PROJ-1131"].assignee).toBe("홍길동");
  expect(setDraft(handed, ROW, { assignee: "이영희" })).toEqual({});
});

test("[확인]은 목록 전체에 시각을 남기고, 다시 누르면 전부 풀리며, 확인 뒤 추가·변경분이 있으면 전부 다시 확인한다", () => {
  const two = setDraft(setDraft({}, ROW, { start: "2026-11-12", end: "2026-11-16" }), MINE, { assignee: "이영희" });
  const keys = ["PROJ-1131", "PROJ-1392"];
  const checked = toggleConfirmAll(two, keys, "2026-10-30T11:10");
  expect(keys.map((k) => checked[k].confirmedAt)).toEqual(["2026-10-30T11:10", "2026-10-30T11:10"]);
  expect(two["PROJ-1131"].confirmedAt).toBeNull();
  expect(keys.map((k) => toggleConfirmAll(checked, keys, "2026-10-30T11:20")[k].confirmedAt)).toEqual([null, null]);

  const edited = setDraft(checked, ROW, { end: "2026-11-17" });
  expect(edited["PROJ-1131"].confirmedAt).toBeNull();
  expect(keys.map((k) => toggleConfirmAll(edited, keys, "2026-10-30T11:30")[k].confirmedAt))
    .toEqual(["2026-10-30T11:30", "2026-10-30T11:30"]);

  const orphan = { ...checked, "PROJ-9999": { start: "2026-11-01", end: "2026-11-02", assignee: null, confirmedAt: null } };
  expect(toggleConfirmAll(orphan, keys, "x")["PROJ-9999"].confirmedAt).toBeNull();
  expect(parseDrafts(JSON.stringify(checked))).toEqual(checked);
});

test("확인 버튼은 클립보드 복사·모두 되돌리기 뒤에 하나만 있고, 확인하면 행 입력과 캘린더 드래그가 잠긴다", () => {
  const draft = setDraft({}, ROW, { start: "2026-11-12", end: "2026-11-16" });
  const before = renderChanges(changeList([ROW], draft), T);
  expect(before.match(/data-confirm=/g)).toHaveLength(1);
  const order = ["data-copy=", "data-reset=", "data-confirm="].map((s) => before.indexOf(s));
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(before).toContain("확인 전");

  const drafts = toggleConfirmAll(draft, ["PROJ-1131"], "2026-10-30T11:10");
  const list = renderChanges(changeList([ROW], drafts), T);
  expect(list).not.toContain("data-draft=");
  expect(list).toContain('<b class="mono">11/12(목) ~ 11/16(월)</b>');
  expect(list).toContain('data-revert="PROJ-1131" title="되돌리기" disabled');
  expect(list).toContain("✓ 확인됨");
  expect(list).toContain("확인함 10/30 11:10");
  const cal = renderCalendar(applyDrafts([ROW], drafts, T), {}, T, {}, { edit: true });
  expect(cal).toContain("is-confirmed");
  expect(cal).not.toContain("editable");
  expect(cal).not.toContain("data-edge");
});

test("applyDrafts 는 Jira 원본 행을 바꾸지 않고 변경 전 일정·담당자를 orig 에 남긴다", () => {
  const rows = [ROW];
  const [planned] = applyDrafts(rows,
    { "PROJ-1131": { start: "2026-11-12", end: "2026-11-16", assignee: "홍길동" } }, T);
  expect(planned.orig).toEqual({ start: "2026-11-09", end: "2026-11-11", assignee: "이영희" });
  expect(planned.assignee).toBe("홍길동");
  expect(planned.dday).toBe(17);
  expect(rows[0]).toBe(ROW);
  expect(ROW.assignee).toBe("이영희");
  expect(ROW.start).toBe("2026-11-09");

  const [handOnly] = applyDrafts(rows, { "PROJ-1131": { start: ROW.start, end: ROW.end, assignee: "홍길동" } }, T);
  expect(handOnly.changed).toBe(true);
  expect(handOnly.dateChanged).toBe(false);
  expect(handOnly.dday).toBe(12);
});

test("클립보드 문구는 담당자·작업 기간·마감일을 기존→변경으로, 그대로인 항목은 (변경 없음)으로 적는다", () => {
  const drafts = {
    "PROJ-1131": { start: "2026-11-12", end: "2026-11-16", assignee: "홍길동" },
    "PROJ-1392": { start: "2026-10-26", end: "2026-11-02", assignee: null },
    "PROJ-9999": { start: "2026-11-01", end: "2026-11-02", assignee: null },
  };
  expect(formatChanges(changeList([ROW, MINE], drafts), T)).toBe([
    "[일정 변경 요청] 2026-10-30 기준 · 2건",
    "",
    "1. PROJ-1392 티켓 - 티켓 관리 - 외부 결재",
    "   담당자: 홍길동 (변경 없음)",
    "   작업 기간: 10/26(월) ~ 10/30(금) → 10/26(월) ~ 11/02(월)",
    "   마감일: 10/30(금) → 11/02(월)",
    "",
    "2. PROJ-1131 티켓 - 티켓 관리 - 단위 테스트",
    "   담당자: 이영희 → 홍길동",
    "   작업 기간: 11/09(월) ~ 11/11(수) → 11/12(목) ~ 11/16(월)",
    "   마감일: 11/11(수) → 11/16(월)",
  ].join("\n"));

  const handOnly = changeList([ROW], { "PROJ-1131": { start: ROW.start, end: ROW.end, assignee: "홍길동" } });
  expect(formatChanges(handOnly, T)).toContain("   작업 기간: 11/09(월) ~ 11/11(수) (변경 없음)");
  expect(formatChanges([], T)).toBe("");
});

test("변경 목록은 담당 변경과 날짜 입력 칸을 보여준다", () => {
  const html = renderChanges(changeList([ROW], { "PROJ-1131": { start: ROW.start, end: ROW.end, assignee: "홍길동" } }), T);
  expect(html).toContain('<span class="was">이영희</span>');
  expect(html).toContain('data-field="assignee" data-draft="PROJ-1131" value="홍길동"');
  expect(html).toContain('data-field="start" data-draft="PROJ-1131" value="2026-11-09"');
  expect(html).toContain('data-field="end" data-draft="PROJ-1131" value="2026-11-11"');
});

test("내 이슈를 남에게 넘기는 변경도 같은 형식으로 적힌다", () => {
  const mine = { ...MINE, key: "PROJ-1112", name: "공통 - 헤더 영역 - 나의 할 일 - 티켓 진행 이력", start: "2026-11-23", end: "2026-11-24" };
  const drafts = setDraft({}, mine, { assignee: "이영희" });
  expect(formatChanges(changeList([mine], drafts), T)).toBe([
    "[일정 변경 요청] 2026-10-30 기준 · 1건",
    "",
    "1. PROJ-1112 공통 - 헤더 영역 - 나의 할 일 - 티켓 진행 이력",
    "   담당자: 홍길동 → 이영희",
    "   작업 기간: 11/23(월) ~ 11/24(화) (변경 없음)",
    "   마감일: 11/24(화) (변경 없음)",
  ].join("\n"));
  expect(setDraft(drafts, mine, { assignee: null })).toEqual({});
});

test("붙여 넣은 문자열에서 이슈키만 중복 없이 뽑는다", () => {
  expect(parseKeys("proj-1131, PROJ-1132\nPROJ-1131 / 외부 결재 PROJ-1392")).toEqual(["PROJ-1131", "PROJ-1132", "PROJ-1392"]);
  expect(parseKeys("없음")).toEqual([]);
});

test("저장된 초안 중 형식이 깨진 항목은 버린다", () => {
  expect(parseDrafts(JSON.stringify({
    A: { start: "2026-11-01", end: "2026-11-03" },
    B: { start: "2026-11-05", end: "2026-11-01" },
    C: { start: "x", end: "y" },
    D: { start: null, end: null, assignee: "홍길동" },
    E: { start: null, end: null, assignee: null },
  }))).toEqual({
    A: { start: "2026-11-01", end: "2026-11-03", assignee: null, confirmedAt: null },
    D: { start: null, end: null, assignee: "홍길동", confirmedAt: null },
  });
  expect(parseDrafts("not json")).toEqual({});
  expect(parseDrafts(null)).toEqual({});
});

test("기간 필터가 잘라낸 달이라도 변경 전·후 일정이 걸치면 보여준다", () => {
  const planned = applyDrafts([{ ...ROW, start: "2026-10-28", end: "2026-10-30" }],
    { "PROJ-1131": { start: "2026-11-02", end: "2026-11-04", assignee: null } }, T);
  expect(widenMonths({ from: "2026-10", to: "2026-10" }, planned)).toEqual({ from: "2026-10", to: "2026-11" });
  expect(widenMonths({ from: null, to: null }, planned)).toEqual({ from: null, to: null });
  const handOnly = applyDrafts([ROW], { "PROJ-1131": { start: ROW.start, end: ROW.end, assignee: "홍길동" } }, T);
  expect(widenMonths({ from: "2026-10", to: "2026-10" }, handOnly)).toEqual({ from: "2026-10", to: "2026-11" });
});

test("기존 캘린더 탭 출력에는 편집 손잡이·날짜 칸·기존 일정 막대가 없다", () => {
  const html = renderCalendar([ROW], {}, T);
  expect(html).not.toContain("data-date");
  expect(html).not.toContain("data-edge");
  expect(html).not.toContain("editable");
  expect(html).not.toContain("ghost");
});

test("일정 조정 탭은 변경 막대·점선 기존 막대·담당 변경 표시를 그리고, 끝난 작업은 잠근다", () => {
  const done = { ...ROW, key: "PROJ-1104", status: "개발완료", statusCategory: "진행 중" };
  const planned = applyDrafts([ROW, done],
    { "PROJ-1131": { start: "2026-11-12", end: "2026-11-16", assignee: "홍길동" } }, T);
  const html = renderCalendar(planned, {}, T, {}, { edit: true });
  expect(html).toContain('data-date="2026-11-12"');
  expect(html).toContain("bar ghost");
  expect(html).toContain('<span class="ho">이영희→홍길동</span>');
  expect(html).toMatch(/editable is-draft" style="[^"]*" data-key="PROJ-1131"/);
  expect(html).not.toMatch(/editable[^"]*" style="[^"]*" data-key="PROJ-1104"/);

  const handOnly = applyDrafts([ROW], { "PROJ-1131": { start: ROW.start, end: ROW.end, assignee: "홍길동" } }, T);
  const html2 = renderCalendar(handOnly, {}, T, {}, { edit: true });
  expect(html2).not.toContain("bar ghost");
  expect(html2).toContain('<span class="ho">이영희→홍길동</span>');
});

test("setDraft 는 WBS 행의 taskId 를 초안에 남기고 parseDrafts 가 보존한다", () => {
  const row = { key: "TRBQ-CHM-029", taskId: "TRBQ-CHM-029", start: "2026-11-02", end: "2026-11-06", assignee: null };
  const drafts = setDraft({}, row, { end: "2026-11-09" });
  expect(drafts["TRBQ-CHM-029"].taskId).toBe("TRBQ-CHM-029");
  expect(parseDrafts(JSON.stringify(drafts))["TRBQ-CHM-029"].taskId).toBe("TRBQ-CHM-029");
  expect(setDraft(drafts, row, { end: "2026-11-06" })).toEqual({});
});

test("rekeyDrafts 는 taskId 초안을 현재 행 키로 옮기고 되돌린다", () => {
  const draft = { start: "2026-11-02", end: "2026-11-09", assignee: null, confirmedAt: null, taskId: "TRBQ-CHM-029" };
  const linked = rekeyDrafts({ "TRBQ-CHM-029": draft }, [{ key: "PROJ-1154", taskId: "TRBQ-CHM-029" }]);
  expect(linked).toEqual({ drafts: { "PROJ-1154": draft }, moved: true });
  const back = rekeyDrafts(linked.drafts, [{ key: "TRBQ-CHM-029", taskId: "TRBQ-CHM-029" }]);
  expect(back).toEqual({ drafts: { "TRBQ-CHM-029": draft }, moved: true });
});

test("rekeyDrafts 는 taskId 없는 초안을 건드리지 않는다", () => {
  const drafts = { "PROJ-1": { start: "2026-11-02", end: "2026-11-03", assignee: null, confirmedAt: null } };
  expect(rekeyDrafts(drafts, [{ key: "PROJ-2", taskId: "PROJ-1" }])).toEqual({ drafts, moved: false });
});

test("rekeyDrafts 는 대상 키에 초안이 있으면 덮지 않는다", () => {
  const old = { start: "2026-11-02", end: "2026-11-09", assignee: null, confirmedAt: null, taskId: "TRBQ-1" };
  const cur = { start: "2026-11-03", end: "2026-11-04", assignee: null, confirmedAt: null };
  const drafts = { "TRBQ-1": old, "PROJ-9": cur };
  expect(rekeyDrafts(drafts, [{ key: "PROJ-9", taskId: "TRBQ-1" }])).toEqual({ drafts, moved: false });
});
