import { expect, test } from "bun:test";
import { confirmMessage, restarted, updateLink, versionLine } from "../../shell/update_flow.js";

const base = { ok: true, behind: 0, ahead: 0, dirty: false, titles: [], current: "10ac8f8", currentDate: "2026-11-06 10:38",
  upstream: "origin/main", startedAt: "2026-11-06T10:38:57" };

test("뒤처진 게 없거나 git 이 아니면 링크를 숨긴다", () => {
  expect(updateLink(base).visible).toBe(false);
  expect(updateLink({ ...base, ok: false, error: "git 저장소가 아니다" }).visible).toBe(false);
  expect(updateLink(null).visible).toBe(false);
});

test("뒤처지면 건수와 제목 목록을 보이고, 막힌 이유를 따로 준다", () => {
  const state = { ...base, behind: 2, titles: ["둘째", "첫째"] };
  expect(updateLink(state)).toEqual({ visible: true, label: "업데이트 2건", title: "업데이트 2건\n· 둘째\n· 첫째", blocked: "" });
  expect(updateLink({ ...state, dirty: true }).blocked).toContain("커밋하지 않은 변경");
  expect(updateLink({ ...state, ahead: 1 }).blocked).toContain("origin/main 보다 1건 앞서");
  expect(updateLink({ ...state, dirty: true }).title.startsWith("업데이트 2건 — ")).toBe(true);
});

test("버전 줄은 짧은 커밋과 커밋 시각, git 이 아니면 빈 문자열", () => {
  expect(versionLine(base)).toBe("10ac8f8 · 2026-11-06 10:38");
  expect(versionLine({ ...base, ok: false })).toBe("");
});

test("확인 문구에 제목이 들어간다", () => {
  expect(confirmMessage({ ...base, behind: 1, titles: ["둘째"] })).toBe("업데이트 1건을 받고 대시보드를 다시 시작할까요?\n\n· 둘째");
});

test("재시작은 startedAt 이 바뀌어야 끝난 것이다", () => {
  expect(restarted(base, { ...base, current: "deadbee" })).toBe(false);
  expect(restarted(base, { ...base, startedAt: "2026-11-06T11:00:00" })).toBe(true);
  expect(restarted(base, null)).toBe(false);
});
