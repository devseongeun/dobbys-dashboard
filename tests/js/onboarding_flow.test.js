import { expect, test } from "bun:test";
import { buildPayload, buildSteps, firstErrorStep, initialAnswers, initialDraft } from "../../shell/onboarding_flow.js";

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

test("오류 단계는 프로젝트 > 탭 고르기 > 가장 앞 탭 순", () => {
  const tabErrors = { weekly: { folders: "폴더가 없다" }, assets: { folder: "폴더가 없다" } };
  expect(firstErrorStep({ _: { project: "x", tabs: "y" }, ...tabErrors }, STEPS)).toBe(0);
  expect(firstErrorStep({ _: { tabs: "탭을 하나 이상 고른다" }, ...tabErrors }, STEPS)).toBe(1);
  expect(firstErrorStep(tabErrors, STEPS)).toBe(2);
});

test("오류가 없거나 모르는 탭 오류뿐이면 null", () => {
  expect(firstErrorStep({}, STEPS)).toBeNull();
  expect(firstErrorStep({ wbs: {}, gone: { a: "b" } }, STEPS)).toBeNull();
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
