import { expect, test } from "bun:test";
import { dateRangeText, domainsOf, hoursText, jiraUrl, joinRows, recentWorklogs } from "../../../tabs/wbs/js/model.js";

const WBS = [
  {
    id: "TRBQ-CHM-029", d1: "티켓", d2: "워크플로우 템플릿 관리", d3: null,
    name: "워크플로우 템플릿 관리 목록", screen: "TCK-0300-01", people: 1,
    start: "2026-09-18", end: "2026-09-22", md: 3, detail: "구현 대상: ...",
    jira: "PROJ-1156",
  },
];

const ISSUES = [
  {
    key: "PROJ-1156", summary: "티켓 - 워크플로우 템플릿 관리 등록", status: "진행",
    statusCategory: "진행 중", planStart: "2026-09-18", actualStart: "2026-09-22",
    actualEnd: null, duedate: "2026-10-01", timeSpentSeconds: 14400,
  },
  {
    key: "PROJ-1400", summary: "공통 - 기타 요청", status: "할 일",
    statusCategory: "해야 할 일", planStart: "2026-09-25", actualStart: null,
    actualEnd: null, duedate: "2026-09-26", timeSpentSeconds: 0,
  },
  {
    key: "PROJ-1500", summary: "일정 없는 이슈", status: "할 일",
    statusCategory: "해야 할 일", planStart: null, actualStart: null,
    actualEnd: null, duedate: null, timeSpentSeconds: 0,
  },
];

test("WBS가 있어도 이름·기간은 Jira 값이 우선하고 WBS 메타는 보탠다", () => {
  const row = joinRows(WBS, ISSUES, "2026-09-28").find((r) => r.key === "PROJ-1156");
  expect(row.name).toBe("티켓 - 워크플로우 템플릿 관리 등록");
  expect(row.domain).toBe("티켓");
  expect(row.screen).toBe("TCK-0300-01");
  expect(row.start).toBe("2026-09-18");
  expect(row.end).toBe("2026-10-01");
  expect(row.md).toBe(3);
  expect(row.spentHours).toBe(4);
});

test("Jira 일정이 비어 있으면 WBS 기간으로 채운다", () => {
  const blank = { ...ISSUES[0], planStart: null, duedate: null };
  const row = joinRows(WBS, [blank], "2026-09-28").find((r) => r.key === "PROJ-1156");
  expect(row.start).toBe("2026-09-18");
  expect(row.end).toBe("2026-09-22");
});

test("WBS가 없는 이슈는 Jira 계획시작일~기한을 쓴다", () => {
  const row = joinRows(WBS, ISSUES, "2026-09-28").find((r) => r.key === "PROJ-1400");
  expect(row.name).toBe("공통 - 기타 요청");
  expect(row.domain).toBe(null);
  expect(row.md).toBe(null);
  expect(row.start).toBe("2026-09-25");
  expect(row.end).toBe("2026-09-26");
});

test("기간을 못 만드는 이슈는 schedulable=false", () => {
  const row = joinRows(WBS, ISSUES, "2026-09-28").find((r) => r.key === "PROJ-1500");
  expect(row.schedulable).toBe(false);
  expect(row.start).toBe(null);
});

test("기한 초과 + 미완료만 overdue", () => {
  const rows = joinRows(WBS, ISSUES, "2026-09-28");
  expect(rows.find((r) => r.key === "PROJ-1400").overdue).toBe(true);
  expect(rows.find((r) => r.key === "PROJ-1156").overdue).toBe(false);

  const done = joinRows(WBS, [{ ...ISSUES[1], statusCategory: "완료", status: "완료" }],
    "2026-09-28");
  expect(done.find((r) => r.key === "PROJ-1400").overdue).toBe(false);

  const devDone = joinRows(WBS, [{ ...ISSUES[1], statusCategory: "진행 중", status: "개발완료" }],
    "2026-09-28");
  expect(devDone.find((r) => r.key === "PROJ-1400").overdue).toBe(false);
});

test("dday는 오늘 기준 남은 일수", () => {
  const rows = joinRows(WBS, ISSUES, "2026-09-28");
  expect(rows.find((r) => r.key === "PROJ-1156").dday).toBe(3);
  expect(rows.find((r) => r.key === "PROJ-1400").dday).toBe(-2);
  expect(rows.find((r) => r.key === "PROJ-1500").dday).toBe(null);
});

test("Jira에서 사라진 WBS 항목도 행으로 남는다", () => {
  const rows = joinRows(WBS, [], "2026-09-28");
  expect(rows).toHaveLength(1);
  expect(rows[0].key).toBe("PROJ-1156");
  expect(rows[0].status).toBe(null);
});

test("표시 헬퍼", () => {
  expect(hoursText(14400)).toBe("4.0h");
  expect(hoursText(0)).toBe("—");
  expect(dateRangeText("2026-09-18", "2026-09-22")).toBe("09.18 ~ 09.22");
  expect(dateRangeText(null, null)).toBe("—");
});

test("jiraUrl 은 도메인의 Jira 이슈 브라우즈 링크", () => {
  expect(jiraUrl("team.atlassian.net", "PROJ-1")).toBe("https://team.atlassian.net/browse/PROJ-1");
});

test("recentWorklogs 는 최신순 n건을 준다", () => {
  const logs = [
    { issueKey: "PROJ-1", startedAt: "2026-09-01T09:00:00.000+0900", seconds: 3600 },
    { issueKey: "PROJ-1", startedAt: "2026-09-20T09:00:00.000+0900", seconds: 3600 },
    { issueKey: "PROJ-2", startedAt: "2026-09-25T09:00:00.000+0900", seconds: 3600 },
    { issueKey: "PROJ-1", startedAt: "2026-09-10T09:00:00.000+0900", seconds: 3600 },
    { issueKey: "PROJ-1", startedAt: "2026-09-15T09:00:00.000+0900", seconds: 3600 },
  ];
  const picked = recentWorklogs(logs, "PROJ-1", 3);
  expect(picked.map((l) => l.startedAt.slice(0, 10)))
    .toEqual(["2026-09-20", "2026-09-15", "2026-09-10"]);
});

test("담당자가 행에 담긴다", () => {
  const rows = joinRows(WBS, [{ ...ISSUES[0], assignee: "김철수" }], "2026-09-28");
  expect(rows[0].assignee).toBe("김철수");
});

test("Jira 키가 없는 WBS 행은 요구사항ID 가 행 키고 jiraKey 는 null", () => {
  const [row] = joinRows([{ id: "TRBQ-COM-1", d1: "공통", name: "대시보드", jira: null, start: "2026-11-02", end: "2026-11-06" }], [], "2026-11-05");
  expect([row.key, row.jiraKey, row.taskId, row.start]).toEqual(["TRBQ-COM-1", null, "TRBQ-COM-1", "2026-11-02"]);
});

test("domainsOf 는 WBS 1Depth 를 처음 나온 순서로 모은다", () => {
  expect(domainsOf([{ d1: "CI/CD" }, { d1: "공통" }, { d1: "CI/CD" }, { d1: null }])).toEqual(["CI/CD", "공통"]);
});
