import { expect, test } from "bun:test";
import { defaultState, matches, monthBounds, parseHash, periodMonths, toHash } from "../../../tabs/wbs/js/state.js";

const DOMS = ["공통", "티켓", "테스트", "시스템 관리"];

const T = "2026-10-30";

test("기본 상태는 캘린더 탭과 전체 필터", () => {
  const s = defaultState(DOMS);
  expect(s.tab).toBe("cal");
  expect(s.doms.size).toBe(4);
  expect(s.statuses).toEqual(new Set(["할 일", "진행", "개발완료", "완료", "취소"]));
  expect(s.soloOnly).toBe(false);
  expect(s.period).toBe("thisOnly");
});

test("해시를 왕복해도 상태가 보존된다", () => {
  const s = defaultState(DOMS);
  s.tab = "log";
  s.doms = new Set(["티켓", "테스트"]);
  s.statuses = new Set(["진행"]);
  s.period = "fromThis";
  const back = parseHash(toHash(s, DOMS), DOMS);
  expect(back.tab).toBe("log");
  expect([...back.doms].sort()).toEqual(["테스트", "티켓"]);
  expect([...back.statuses]).toEqual(["진행"]);
  expect(back.soloOnly).toBe(false);
  expect(back.period).toBe("fromThis");
});

test("알 수 없는 탭은 기본값으로 떨어진다", () => {
  expect(parseHash("#tab=hacked", DOMS).tab).toBe("cal");
});

test("빈 해시는 기본 상태", () => {
  expect(parseHash("", DOMS).doms.size).toBe(4);
});

test("matches 는 도메인·상태·단독 필터를 적용한다", () => {
  const row = {
    domain: "티켓",
    status: "진행",
    people: 1,
  };
  const s = defaultState(DOMS);
  expect(matches(row, s, T)).toBe(true);

  s.doms = new Set(["공통"]);
  expect(matches(row, s, T)).toBe(false);

  s.doms = new Set(["티켓"]);
  s.statuses = new Set(["완료"]);
  expect(matches(row, s, T)).toBe(false);

  s.statuses = new Set(["진행"]);
  s.soloOnly = true;
  expect(matches({ ...row, people: 5 }, s, T)).toBe(false);
});

test("WBS 없는 Jira 단독 행은 기본 필터를 통과한다", () => {
  const s = defaultState(DOMS);
  expect(matches({ domain: null, status: "할 일", people: 1 }, s, T)).toBe(true);
});

test("예전 북마크의 wbs=1 해시는 Jira 단독 이슈를 숨기지 않는다", () => {
  const s = parseHash("#tab=cal&wbs=1", DOMS);
  expect(matches({ domain: null, status: "진행", people: 1 }, s, T)).toBe(true);
  expect(toHash(s, DOMS)).toBe("#tab=cal");
});

test("4종 밖의 Jira 상태를 가진 이슈는 필터를 통과한다", () => {
  const s = defaultState(DOMS);
  const unknown = { domain: "티켓", status: "검토", people: 1 };
  expect(matches(unknown, s, T)).toBe(true);

  s.statuses = new Set(["진행"]);
  expect(matches(unknown, s, T)).toBe(true);
});

test("기타 상태에 칸을 지정한 이슈는 그 칸의 상태 칩을 따른다", () => {
  const s = defaultState(DOMS);
  const assigned = { domain: "티켓", status: "검토", assigned: "완료", people: 1 };
  s.statuses = new Set(["진행"]);
  expect(matches(assigned, s, T)).toBe(false);
  s.statuses = new Set(["완료"]);
  expect(matches(assigned, s, T)).toBe(true);
});

test("기간 필터: 이번 달만은 이번 달과 겹치는 일정만, 이전 달 제외는 지난 일정만 뺀다", () => {
  const base = { domain: "티켓", status: "진행", people: 1 };
  const lastMonth = { ...base, start: "2026-09-20", end: "2026-09-30" };
  const spanning = { ...base, start: "2026-09-28", end: "2026-10-02" };
  const thisMonth = { ...base, start: "2026-10-26", end: "2026-10-30" };
  const nextMonth = { ...base, start: "2026-11-02", end: "2026-11-06" };
  const s = defaultState(DOMS);

  const shown = () => [lastMonth, spanning, thisMonth, nextMonth].map((r) => matches(r, s, T));
  expect(shown()).toEqual([false, true, true, false]);
  s.period = "fromThis";
  expect(shown()).toEqual([false, true, true, true]);
  s.period = "all";
  expect(shown()).toEqual([true, true, true, true]);
});

test("기간 필터는 일정 없는 Jira 이슈를 숨기지 않는다", () => {
  const s = defaultState(DOMS);
  expect(matches({ domain: null, status: "할 일", people: 1, start: null, end: null }, s, T)).toBe(true);
});

test("월 경계 계산", () => {
  expect(monthBounds("2026-02-10")).toEqual({ month: "2026-02", first: "2026-02-01", last: "2026-02-28" });
  expect(periodMonths("thisOnly", T)).toEqual({ from: "2026-10", to: "2026-10" });
  expect(periodMonths("fromThis", T)).toEqual({ from: "2026-10", to: null });
  expect(parseHash("#tab=cal&per=bogus", DOMS).period).toBe("thisOnly");
});

test("고정 목록 밖 도메인도 기본 선택되고 해시를 왕복한다", () => {
  const doms = ["CI/CD", "공통"];
  const state = parseHash("", doms);
  expect(matches({ domain: "CI/CD", start: null, end: null }, state, "2026-11-05")).toBe(true);
  state.doms.delete("공통");
  expect(parseHash(toHash(state, doms), doms).doms).toEqual(new Set(["CI/CD"]));
  expect(toHash(parseHash("", doms), doms)).toBe("#tab=cal");
});
