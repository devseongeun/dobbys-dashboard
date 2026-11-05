import { expect, test } from "bun:test";
import { assignLanes, monthKeys, renderCalendar } from "../../../tabs/wbs/js/calendar.js";

test("겹치는 막대는 다른 레인으로 간다", () => {
  const laid = assignLanes([
    { row: { key: "A" }, s: 0, e: 3 },
    { row: { key: "B" }, s: 2, e: 5 },
    { row: { key: "C" }, s: 6, e: 7 },
  ]);
  const lane = (k) => laid.find((i) => i.row.key === k).lane;
  expect(lane("A")).toBe(0);
  expect(lane("B")).toBe(1);
  expect(lane("C")).toBe(0);
});

test("monthKeys는 계획 구간과 오늘을 모두 덮는다", () => {
  const rows = [
    { start: "2026-09-17", end: "2026-09-22", schedulable: true },
    { start: "2026-11-02", end: "2026-11-06", schedulable: true },
  ];
  expect(monthKeys(rows, "2026-10-15")).toEqual(["2026-09", "2026-10", "2026-11"]);
});

test("일정 없는 행은 캘린더에서 무시된다", () => {
  const rows = [{ key: "PROJ-1500", start: null, end: null, schedulable: false }];
  const html = renderCalendar(rows, {}, "2026-09-28");
  expect(html).not.toContain("PROJ-1500");
  expect(html).not.toContain("NaN");
});

test("막대에 상태 클래스와 이슈키가 들어간다", () => {
  const rows = [
    {
      key: "PROJ-1156", name: "템플릿 목록", domain: "티켓", status: "진행",
      statusCategory: "진행 중", start: "2026-09-18", end: "2026-09-22",
      schedulable: true, overdue: false, people: 1,
    },
  ];
  const html = renderCalendar(rows, { "2026-09-25": "추석" }, "2026-09-28");
  expect(html).toContain("PROJ-1156");
  expect(html).toContain("템플릿 목록");
  expect(html).toContain("추석");
  expect(html).toContain('data-key="PROJ-1156"');
});

test("마감일이 있는 마지막 조각에만 끝 캡과 D-day 배지가 붙는다", () => {
  const base = {
    key: "PROJ-1", name: "x", domain: "티켓", status: "진행", statusCategory: "진행 중",
    start: "2026-10-08", end: "2026-10-15", schedulable: true, overdue: false, people: 1,
  };
  const tails = (html) => (html.match(/ tail/g) || []).length;

  const spanning = renderCalendar([{ ...base, dday: 5 }], {}, "2026-10-10");
  expect(tails(spanning)).toBe(1);
  expect(spanning).toContain('<span class="dd">D-5</span>');
  expect(spanning).not.toContain("urgent");

  expect(renderCalendar([{ ...base, dday: 2 }], {}, "2026-10-13")).toContain("tail urgent");
  expect(renderCalendar([{ ...base, dday: 0 }], {}, "2026-10-15")).toContain(">D-day<");
  const late = renderCalendar([{ ...base, dday: -3, overdue: true }], {}, "2026-10-18");
  expect(late).toContain(">D+3<");
  expect(late).toContain("tail urgent");

  for (const status of [{ status: "완료", statusCategory: "완료" }, { status: "개발완료", statusCategory: "진행 중" }]) {
    const html = renderCalendar([{ ...base, ...status, dday: 1 }], {}, "2026-10-14");
    expect(tails(html)).toBe(1);
    expect(html).not.toContain('class="dd"');
  }
});

test("다음 달로 넘어가는 막대는 이번 달에서 끝 캡을 받지 않는다", () => {
  const row = {
    key: "PROJ-2", name: "y", domain: "공통", status: "진행", statusCategory: "진행 중",
    start: "2026-09-28", end: "2026-10-20", schedulable: true, overdue: false, people: 1, dday: 6,
  };
  const html = renderCalendar([row], {}, "2026-10-14");
  const [sep, oct] = html.split('id="m-2026-10"');
  expect(sep).not.toContain(" tail");
  expect(oct).toContain(" tail");
});

test("months 범위 밖의 월 섹션은 그리지 않는다", () => {
  const row = {
    key: "PROJ-2", name: "y", domain: "공통", status: "진행", statusCategory: "진행 중",
    start: "2026-09-28", end: "2026-10-20", schedulable: true, overdue: false, people: 1, dday: 6,
  };
  const html = renderCalendar([row], {}, "2026-10-14", { from: "2026-10", to: "2026-10" });
  expect(html).not.toContain('id="m-2026-09"');
  expect(html).toContain('id="m-2026-10"');
  expect(html).toContain('data-key="PROJ-2"');
});

test("완료·취소·초과 상태가 클래스로 구분된다", () => {
  const base = {
    key: "PROJ-1", name: "x", domain: "공통", start: "2026-09-18",
    end: "2026-09-19", schedulable: true, people: 1,
  };
  const done = renderCalendar([{ ...base, status: "완료", statusCategory: "완료", overdue: false }], {}, "2026-09-28");
  expect(done).toContain("is-done");
  const cancelled = renderCalendar([{ ...base, status: "취소", statusCategory: "완료", overdue: false }], {}, "2026-09-28");
  expect(cancelled).toContain("is-cancelled");
  const devDone = renderCalendar([{ ...base, status: "개발완료", statusCategory: "진행 중", overdue: false }], {}, "2026-09-28");
  expect(devDone).toContain("is-devdone");
  expect(devDone).not.toContain("is-done");
  const late = renderCalendar([{ ...base, status: "진행", statusCategory: "진행 중", overdue: true }], {}, "2026-09-28");
  expect(late).toContain("is-overdue");
});
