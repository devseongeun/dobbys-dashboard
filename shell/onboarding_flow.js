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

// 조건(when: [다른 필드 key, 값])이 맞는 필드만 보인다. 값이 없으면 그 필드의 기본값으로 본다(서버 config.normalize 와 같은 규칙).
export function shownFields(tab, values) {
  const current = (key) => values?.[key] ?? tab.fields.find((field) => field.key === key)?.default ?? "";
  return tab.fields.filter((field) => !field.when || current(field.when[0]) === field.when[1]);
}

// 예라고 답한 탭만, 그 탭에서 지금 보이는 필드만 보낸다. 아니요로 바꾼 탭·숨은 필드의 입력값은 draft 에 남아 있어도 보내지 않는다.
export function buildPayload(project, tabs, answers, draft) {
  const picked = {};
  for (const tab of tabs) {
    if (answers[tab.id] !== true) continue;
    const value = (field) => draft[tab.id]?.[field.key] ?? field.default ?? "";
    picked[tab.id] = Object.fromEntries(shownFields(tab, draft[tab.id]).map((field) => [field.key, value(field)]));
  }
  return { project, tabs: picked };
}

export const hasErrors = (errors, tabId) => Object.keys(errors?.[tabId] ?? {}).length > 0;

const lines = (text) => text.split("\n").map((line) => line.trim()).filter(Boolean);

// Finder 선택 창을 열 위치로 보낼 지금 값. 여러 폴더 칸은 마지막 줄(가장 최근에 고른 폴더) 근처에서 연다.
export const pickStart = (kind, value) => (kind === "dirs" ? lines(value).at(-1) : value.trim()) ?? "";

// 선택 창 결과를 칸 값으로. 한 경로 칸은 바꾸고, 여러 폴더 칸은 뒤에 붙이되 이미 있는 폴더는 다시 넣지 않는다.
export function mergePicked(kind, value, picked) {
  if (kind !== "dirs") return picked[0] ?? value;
  return [...new Set([...lines(value), ...picked])].join("\n");
}
