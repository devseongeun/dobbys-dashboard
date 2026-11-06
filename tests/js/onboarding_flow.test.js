import { expect, test } from "bun:test";
import { buildPayload, buildSteps, initialAnswers, initialDraft, mergePicked, pickStart } from "../../shell/onboarding_flow.js";

const field = (key, extra = {}) => ({ key, label: key, kind: "text", required: false, default: "", help: "", ...extra });
const TABS = [
  { id: "wbs", label: "WBS", icon: "•", fields: [field("owner"), field("sheet", { default: "WBS" })] },
  { id: "assets", label: "의사결정", icon: "•", fields: [field("folder", { kind: "dir" })] },
  { id: "weekly", label: "주간", icon: "•", fields: [field("folders", { kind: "dirs" })] },
];
const STEPS = buildSteps(TABS);

test("단계는 프로젝트 → 탭 순서대로 질문 → 확인", () => {
  expect(STEPS.map((step) => step.kind === "question" ? step.tab.id : step.kind))
    .toEqual(["project", "wbs", "assets", "weekly", "confirm"]);
});

test("예인 탭만 보내고, 아니요로 바꾼 탭의 남은 입력은 뺀다", () => {
  const draft = { wbs: { owner: "김도비", sheet: "" }, assets: { folder: "~/a" }, weekly: { folders: "~/w" } };
  const payload = buildPayload("TRB", TABS, { wbs: true, assets: false }, draft);
  expect(payload).toEqual({ project: "TRB", tabs: { wbs: { owner: "김도비", sheet: "" } } });
});

test("draft 에 없는 필드는 기본값으로 채운다", () => {
  expect(buildPayload("TRB", TABS, { wbs: true }, {}).tabs.wbs).toEqual({ owner: "", sheet: "WBS" });
});

test("첫 실행은 아무 답도 없고, 옛 config 는 켠 탭 예·나머지 아니요", () => {
  expect(initialAnswers({ tabs: TABS, enabled: [], values: {} })).toEqual({});
  expect(initialAnswers({ tabs: TABS, enabled: ["assets"], values: {} })).toEqual({ wbs: false, assets: true, weekly: false });
});

test("옛 config 값으로 입력을 미리 채우고 dirs 배열은 줄바꿈으로 잇는다", () => {
  const draft = initialDraft({ tabs: TABS, enabled: ["weekly"], values: { weekly: { folders: ["/a", "/b"] } } });
  expect(draft).toEqual({ wbs: { owner: "", sheet: "WBS" }, assets: { folder: "" }, weekly: { folders: "/a\n/b" } });
});

test("선택 창 결과: 한 경로 칸은 바꾸고 취소·빈 결과면 그대로, 여러 폴더 칸은 중복 없이 뒤에 붙인다", () => {
  expect(mergePicked("dir", "/a", ["/b"])).toBe("/b");
  expect(mergePicked("file", "/a/x.xlsx", [])).toBe("/a/x.xlsx");
  expect(mergePicked("dirs", "/a\n\n/b ", ["/b", "/c", "/c"])).toBe("/a\n/b\n/c");
  expect(mergePicked("dirs", "", ["/c"])).toBe("/c");
});

test("선택 창은 지금 값 근처에서 연다: 여러 폴더 칸은 마지막 줄, 비면 빈 값", () => {
  expect(pickStart("dir", " /a ")).toBe("/a");
  expect(pickStart("dirs", "/a\n/b\n")).toBe("/b");
  expect(pickStart("dirs", "")).toBe("");
});
