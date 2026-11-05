// 질문형 온보딩의 상태 계산. DOM 을 모르는 순수 함수만 둔다(tests/js/onboarding_flow.test.js).
// 단계: 0 프로젝트 → 1..N 탭마다 질문(사이드바 순서) → N+1 확인.

export const buildSteps = (tabs) => [
  { kind: "project" },
  ...tabs.map((tab) => ({ kind: "question", tab })),
  { kind: "confirm" },
];

export const questionText = (tab) => tab.question || `${tab.icon} ${tab.label} 탭을 쓸까요?`;

// 저장된 값(dirs 는 배열) → 입력란 문자열. 없으면 필드 기본값.
export function valueOf(config, tab, field) {
  const saved = config.values?.[tab.id]?.[field.key];
  if (Array.isArray(saved)) return saved.join("\n");
  return saved ?? field.default ?? "";
}

// {tabId: true|false}. 답하지 않은 탭은 키가 없다.
// 프로젝트 이름이 없는 옛 config 는 켜 둔 탭이 있으니, 켠 탭은 예·나머지는 아니요로 미리 채운다.
export function initialAnswers(config) {
  const enabled = new Set(config.enabled ?? []);
  if (!enabled.size) return {};
  return Object.fromEntries(config.tabs.map((tab) => [tab.id, enabled.has(tab.id)]));
}

export const initialDraft = (config) => Object.fromEntries(config.tabs.map((tab) => [
  tab.id, Object.fromEntries(tab.fields.map((field) => [field.key, valueOf(config, tab, field)])),
]));

// 예라고 답한 탭만 보낸다. 아니요로 바꾼 탭의 입력값은 draft 에 남아 있어도 보내지 않는다.
export function buildPayload(project, tabs, answers, draft) {
  const picked = {};
  for (const tab of tabs) {
    if (answers[tab.id] !== true) continue;
    picked[tab.id] = Object.fromEntries(tab.fields.map((field) => [field.key, draft[tab.id]?.[field.key] ?? field.default ?? ""]));
  }
  return { project, tabs: picked };
}

export const hasErrors = (errors, tabId) => Object.keys(errors?.[tabId] ?? {}).length > 0;

// 422 오류를 받고 이동할 단계. 프로젝트 → 탭 고르기(첫 질문) → 오류 난 탭 중 가장 앞. 맞는 게 없으면 null.
export function firstErrorStep(errors, steps) {
  if (errors?._?.project) return 0;
  const firstQuestion = steps.findIndex((step) => step.kind === "question");
  if (errors?._?.tabs) return firstQuestion < 0 ? null : firstQuestion;
  const index = steps.findIndex((step) => step.kind === "question" && hasErrors(errors, step.tab.id));
  return index < 0 ? null : index;
}
