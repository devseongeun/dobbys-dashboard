import { expect, test } from "bun:test";
import { groupByStatus, renderBoard } from "../../../tabs/wbs/js/board.js";

const rows = [
  { key: "A", name: "a", status: "진행", spentSeconds: 7200 },
  { key: "B", name: "b", status: "할 일", spentSeconds: 0 },
  { key: "C", name: "c", status: "완료", spentSeconds: 3600 },
  { key: "D", name: "d", status: "진행", spentSeconds: 1800 },
  { key: "E", name: "e", status: null, spentSeconds: 0 },
];

test("컬럼 순서는 할 일·진행·개발완료·완료·취소·기타로 고정", () => {
  expect(groupByStatus(rows).map((c) => c.status))
    .toEqual(["할 일", "진행", "개발완료", "완료", "취소", "기타"]);
});

test("진행 흐름과 취소·기타 칸 사이만 구분선 칸(split)이다", () => {
  const split = [...renderBoard(rows).matchAll(/<section class="col( split)?"><header><b>([^<]+)/g)]
    .filter((m) => m[1]).map((m) => m[2]);
  expect(split).toEqual(["취소", "기타"]);
});

test("컬럼별 누적 시간이 합산된다", () => {
  const 진행 = groupByStatus(rows).find((c) => c.status === "진행");
  expect(진행.rows).toHaveLength(2);
  expect(진행.seconds).toBe(9000);
});

test("상태가 없는 행은 기타 컬럼", () => {
  expect(groupByStatus(rows).find((c) => c.status === "기타").rows).toHaveLength(1);
});

test("기타 행은 지정한 칸으로 가고, Jira 상태가 보드 칸이면 지정보다 Jira 가 우선한다", () => {
  const columns = groupByStatus([
    { key: "X", status: "검토", assigned: "개발완료" },
    { key: "Y", status: "완료", assigned: "진행" },
    { key: "Z", status: "검토", assigned: null },
  ]);
  const keysOf = (s) => columns.find((c) => c.status === s).rows.map((r) => r.key);
  expect([keysOf("개발완료"), keysOf("완료"), keysOf("기타")]).toEqual([["X"], ["Y"], ["Z"]]);
});

test("칸 지정 select 는 Jira 상태가 보드 칸이 아닌 카드에만, 현재 지정값이 선택된 채로 나온다", () => {
  const html = renderBoard([
    { key: "X", name: "x", status: "검토", assigned: "진행" },
    { key: "Y", name: "y", status: "개발완료" },
  ]);
  expect(html).toContain('data-assign="X"');
  expect(html).not.toContain('data-assign="Y"');
  expect(html).toContain('<option value="진행" selected>');
});

test("카드에 키와 누적 시간이 표시된다", () => {
  const html = renderBoard(rows);
  expect(html).toContain('data-key="A"');
  expect(html).toContain("2.0h");
});
