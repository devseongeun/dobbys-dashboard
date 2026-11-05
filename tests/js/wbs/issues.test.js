import { expect, test } from "bun:test";
import { renderIssues, sortRows } from "../../../tabs/wbs/js/issues.js";

const J = { domain: "team.atlassian.net", connected: true };

const rows = [
  { key: "PROJ-2", jiraKey: "PROJ-2", name: "b", status: "진행", duedate: "2026-10-01", md: 3,
    spentSeconds: 7200, start: "2026-09-18", end: "2026-09-22",
    dday: 3, overdue: false, screen: "TCK-0300-01", domain: "티켓" },
  { key: "PROJ-1", jiraKey: "PROJ-1", name: "a", status: "할 일", duedate: null, md: null,
    spentSeconds: 0, start: null, end: null,
    dday: null, overdue: false, screen: null, domain: null },
  { key: "PROJ-3", jiraKey: "PROJ-3", name: "c", status: "완료", duedate: "2026-09-20", md: 1,
    spentSeconds: 3600, start: "2026-09-19", end: "2026-09-20",
    dday: -8, overdue: false, screen: "TST-0100-01", domain: "테스트" },
];

test("기한 오름차순 정렬에서 null은 뒤로 간다", () => {
  expect(sortRows(rows, "duedate", 1).map((r) => r.key))
    .toEqual(["PROJ-3", "PROJ-2", "PROJ-1"]);
});

test("기한 내림차순에서도 null은 뒤로 간다", () => {
  expect(sortRows(rows, "duedate", -1).map((r) => r.key))
    .toEqual(["PROJ-2", "PROJ-3", "PROJ-1"]);
});

test("누적 시간 정렬은 숫자 기준", () => {
  expect(sortRows(rows, "spent", -1).map((r) => r.key))
    .toEqual(["PROJ-2", "PROJ-3", "PROJ-1"]);
});

test("원본 배열을 변형하지 않는다", () => {
  const before = rows.map((r) => r.key);
  sortRows(rows, "key", -1);
  expect(rows.map((r) => r.key)).toEqual(before);
});

test("WBS 없는 행은 도메인·화면ID·계획 M/D가 대시", () => {
  const html = renderIssues(rows, { key: "duedate", dir: 1 }, J);
  expect(html).toContain("PROJ-1");
  expect((html.match(/—/g) || []).length).toBeGreaterThanOrEqual(3);
});

test("기한 초과 행에 경고 클래스가 붙는다", () => {
  const html = renderIssues(
    [{ ...rows[0], overdue: true }], { key: "duedate", dir: 1 }, J);
  expect(html).toContain("is-overdue");
});

test("상태 셀에 상태별 색 점이 붙는다", () => {
  const html = renderIssues(rows, { key: "duedate", dir: 1 }, J);
  expect(html).toContain('class="sdot s-진행"');
  expect(html).toContain('class="sdot s-완료"');
});

test("이슈키 셀에 복사 버튼이 있다", () => {
  const html = renderIssues(rows, { key: "duedate", dir: 1 }, J);
  expect(html).toContain('data-copy="PROJ-2"');
});

test("연결 안 된 행은 Jira 링크 없이 요구사항ID 와(연동 시) 이슈 연결 버튼을 보인다", () => {
  const row = { key: "TRBQ-1", jiraKey: null, taskId: "TRBQ-1", name: "n", status: null, start: null, end: null,
    duedate: null, dday: null, md: null, spentSeconds: 0, overdue: false };
  const on = renderIssues([row], { key: "duedate", dir: 1 }, { domain: "team.atlassian.net", connected: true });
  expect(on).not.toContain("/browse/");
  expect(on).toContain('data-link="TRBQ-1"');
  const off = renderIssues([row], { key: "duedate", dir: 1 }, { domain: "team.atlassian.net", connected: false });
  expect(off).not.toContain("data-link");
});
