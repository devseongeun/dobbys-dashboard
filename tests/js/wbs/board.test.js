import { expect, test } from "bun:test";
import { groupByStatus, renderBoard } from "../../../tabs/wbs/js/board.js";

const rows = [
  { key: "A", name: "a", status: "진행", spentSeconds: 7200 },
  { key: "B", name: "b", status: "할 일", spentSeconds: 0 },
  { key: "C", name: "c", status: "완료", spentSeconds: 3600 },
  { key: "D", name: "d", status: "진행", spentSeconds: 1800 },
  { key: "E", name: "e", status: null, spentSeconds: 0 },
];

test("컬럼 순서는 할 일·진행·완료·취소·기타로 고정", () => {
  expect(groupByStatus(rows).map((c) => c.status))
    .toEqual(["할 일", "진행", "완료", "취소", "기타"]);
});

test("컬럼별 누적 시간이 합산된다", () => {
  const 진행 = groupByStatus(rows).find((c) => c.status === "진행");
  expect(진행.rows).toHaveLength(2);
  expect(진행.seconds).toBe(9000);
});

test("상태가 없는 행은 기타 컬럼", () => {
  expect(groupByStatus(rows).find((c) => c.status === "기타").rows).toHaveLength(1);
});

test("카드에 키와 누적 시간이 표시된다", () => {
  const html = renderBoard(rows);
  expect(html).toContain('data-key="A"');
  expect(html).toContain("2.0h");
});
