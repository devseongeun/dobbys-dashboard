import { expect, test } from "bun:test";
import { frameUrl, parseShellHash, pickInitial, toShellHash } from "../../shell/route.js";

const ITEMS = ["wbs", "assets", "plans", "comments", "meetings", "weekly"].map((id) => ({ id, label: id, icon: "•", src: `/${id}/` }));
const wbs = ITEMS[0];

test("항목 id 와 앱 해시를 나눈다", () => {
  expect(parseShellHash("#wbs/tab=plan&per=fromThis", ITEMS)).toEqual({ id: "wbs", inner: "tab=plan&per=fromThis" });
});

test("앱 해시가 없거나 비면 inner 는 빈 문자열", () => {
  expect(parseShellHash("#weekly", ITEMS)).toEqual({ id: "weekly", inner: "" });
  expect(parseShellHash("#weekly/", ITEMS)).toEqual({ id: "weekly", inner: "" });
});

test("모르는 id·빈 해시는 id 가 null", () => {
  expect(parseShellHash("#nope/tab=x", ITEMS)).toEqual({ id: null, inner: "" });
  expect(parseShellHash("", ITEMS)).toEqual({ id: null, inner: "" });
  expect(parseShellHash("#", ITEMS)).toEqual({ id: null, inner: "" });
});

test("앱 해시 안의 / · # · 퍼센트 인코딩 한글은 그대로 왕복한다", () => {
  for (const inner of ["a/b#c", "tab=open&f=%EA%B2%B0%EC%9E%AC"]) {
    const hash = toShellHash("assets", inner);
    expect(parseShellHash(hash, ITEMS)).toEqual({ id: "assets", inner });
  }
});

test("toShellHash 는 inner 앞 # 을 떼고, 비면 id 만 남긴다", () => {
  expect(toShellHash("wbs", "#tab=cal")).toBe("#wbs/tab=cal");
  expect(toShellHash("wbs", "")).toBe("#wbs");
});

test("frameUrl 은 대상 경로에 앱 해시를 붙인다", () => {
  expect(frameUrl(wbs, "tab=plan")).toBe("/wbs/#tab=plan");
  expect(frameUrl(wbs, "")).toBe("/wbs/");
});

test("pickInitial 은 해시 → 마지막 항목 → 첫 항목 순", () => {
  expect(pickInitial("#weekly", "assets", ITEMS)).toBe("weekly");
  expect(pickInitial("", "assets", ITEMS)).toBe("assets");
  expect(pickInitial("", "gone", ITEMS)).toBe("wbs");
  expect(pickInitial("#nope", null, ITEMS)).toBe("wbs");
});

test("pickInitial 은 사라진 탭·빈 목록을 처리한다", () => {
  const two = ITEMS.filter((item) => item.id === "meetings" || item.id === "weekly");
  expect(pickInitial("#wbs/tab=cal", "wbs", two)).toBe("meetings");
  expect(pickInitial("", null, [])).toBeNull();
});
