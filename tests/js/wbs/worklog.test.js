import { expect, test } from "bun:test";
import { aggregate, filterByRange, mineOnly, presetRange, renderWorklog } from "../../../tabs/wbs/js/worklog.js";

const LOGS = [
  { id: "1", issueKey: "PROJ-1156", started: "2026-09-21", startedAt: "2026-09-21T09:00:00.000+0900", seconds: 7200, comment: "설계" },
  { id: "2", issueKey: "PROJ-1156", started: "2026-09-22", startedAt: "2026-09-22T14:00:00.000+0900", seconds: 3600, comment: "구현" },
  { id: "3", issueKey: "PROJ-1326", started: "2026-09-28", startedAt: "2026-09-28T23:30:00.000+0900", seconds: 1800, comment: "" },
  { id: "4", issueKey: "PROJ-1157", started: "2026-08-31", startedAt: "2026-08-31T10:00:00.000+0900", seconds: 3600, comment: "지난달" },
];

test("이번 주는 월요일부터 일요일", () => {
  expect(presetRange("week", "2026-09-28")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
  expect(presetRange("week", "2026-10-04")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
});

test("지난 주와 이번 달 범위", () => {
  expect(presetRange("lastWeek", "2026-09-28")).toEqual({ from: "2026-09-21", to: "2026-09-27" });
  expect(presetRange("month", "2026-09-28")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
});

test("범위 필터는 양끝을 포함한다", () => {
  const picked = filterByRange(LOGS, "2026-09-21", "2026-09-28");
  expect(picked.map((l) => l.id)).toEqual(["1", "2", "3"]);
});

test("늦은 밤 기록도 당일 버킷에 들어간다", () => {
  const agg = aggregate(LOGS, "2026-09-28", "2026-09-28");
  expect(agg.byDate).toEqual([{ date: "2026-09-28", seconds: 1800 }]);
  expect(agg.totalSeconds).toBe(1800);
});

test("집계는 총합·기록일수·이슈수를 낸다", () => {
  const agg = aggregate(LOGS, "2026-09-01", "2026-09-30");
  expect(agg.totalSeconds).toBe(12600);
  expect(agg.dayCount).toBe(3);
  expect(agg.issueCount).toBe(2);
  expect(agg.byIssue[0]).toEqual({ key: "PROJ-1156", count: 2, seconds: 10800 });
});

test("기록이 없으면 0으로 떨어진다", () => {
  const agg = aggregate(LOGS, "2026-07-01", "2026-07-31");
  expect(agg).toEqual({ totalSeconds: 0, dayCount: 0, issueCount: 0, byDate: [], byIssue: [] });
  expect(renderWorklog(agg, [])).toContain("기록이 없다");
});

test("렌더에 날짜·이슈키·시간이 포함된다", () => {
  const agg = aggregate(LOGS, "2026-09-01", "2026-09-30");
  const html = renderWorklog(agg, filterByRange(LOGS, "2026-09-01", "2026-09-30"));
  expect(html).toContain("2026-09-21");
  expect(html).toContain("PROJ-1156");
  expect(html).toContain("3.5h");
});

test("내 기록만 남긴다 — 타인 워크로그는 집계에서 빠진다", () => {
  const mixed = [
    { id: "1", issueKey: "PROJ-1102", authorId: "6396a581f7f0ee492fce5049", started: "2026-09-21", startedAt: "2026-09-21T09:00:00.000+0900", seconds: 3600, comment: "" },
    { id: "2", issueKey: "PROJ-1102", authorId: "other-account-id", started: "2026-09-21", startedAt: "2026-09-21T10:00:00.000+0900", seconds: 7200, comment: "" },
  ];
  const mine = mineOnly(mixed, "6396a581f7f0ee492fce5049");
  expect(mine.map((l) => l.id)).toEqual(["1"]);
  expect(aggregate(mine, "2026-09-01", "2026-09-30").totalSeconds).toBe(3600);
});

test("내 accountId를 모르면 전부 남긴다", () => {
  const logs = [{ id: "1", issueKey: "A", authorId: "x", started: "2026-09-21", seconds: 60 }];
  expect(mineOnly(logs, null)).toHaveLength(1);
});
