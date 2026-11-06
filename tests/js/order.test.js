import { expect, test } from "bun:test";
import { dropAfter, moveItem, sameOrder } from "../../shell/order.js";

const ORDER = ["wbs", "assets", "plans", "comments"];

test("앞으로·뒤로 옮긴다", () => {
  expect(moveItem(ORDER, "comments", "wbs", false)).toEqual(["comments", "wbs", "assets", "plans"]);
  expect(moveItem(ORDER, "wbs", "plans", true)).toEqual(["assets", "plans", "wbs", "comments"]);
  expect(moveItem(ORDER, "wbs", "plans", false)).toEqual(["assets", "wbs", "plans", "comments"]);
});

test("모르는 id·같은 자리는 그대로이고 원본을 바꾸지 않는다", () => {
  expect(moveItem(ORDER, "nope", "wbs", false)).toEqual(ORDER);
  expect(moveItem(ORDER, "wbs", "wbs", true)).toEqual(ORDER);
  const copy = moveItem(ORDER, "assets", "wbs", false);
  expect(copy).not.toBe(ORDER);
  expect(ORDER).toEqual(["wbs", "assets", "plans", "comments"]);
});

test("바로 옆으로 놓으면 순서가 같아 저장하지 않는다", () => {
  expect(sameOrder(moveItem(ORDER, "wbs", "assets", false), ORDER)).toBe(true);
  expect(sameOrder(moveItem(ORDER, "wbs", "assets", true), ORDER)).toBe(false);
});

test("대상의 아래 절반이면 뒤에 놓는다", () => {
  const rect = { top: 100, height: 40 };
  expect(dropAfter(119, rect)).toBe(false);
  expect(dropAfter(121, rect)).toBe(true);
});
