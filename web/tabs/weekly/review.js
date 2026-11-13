// 초안(회차) 단위 '확인 완료' 기록. 로컬판은 개인 상태 폴더의 reviewed.json(GET/PUT /api/reviewed, file:// 이면 localStorage)이고,
// 웹은 IndexedDB 의 tabState("weekly") 이름 "reviewed" 다. 모양은 로컬판과 같은 { "<slug>": "<ISO8601>" }.
export const REVIEWED = "reviewed";

// 저장값을 맵으로. 없거나 모양이 틀리면 빈 맵(로컬판 load_reviewed 처럼 문자열 키·값만 남긴다).
export function cleanReviewed(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, at]) => typeof key === "string" && typeof at === "string" && at));
}

export async function loadReviewed(state) {
  return cleanReviewed(await state.get(REVIEWED));
}

// 한 회차를 확인 완료(done=true, 지금 시각) 또는 해제한 새 맵.
export function toggled(map, slug, done, now = new Date()) {
  const next = { ...map };
  if (done) next[slug] = now.toISOString();
  else delete next[slug];
  return next;
}

// 확인한 회차가 하나도 없으면 빈 {} 를 남기지 않고 지운다(로컬판 localStorage 모드와 같다).
export async function saveReviewed(state, map) {
  if (!Object.keys(map).length) await state.remove(REVIEWED);
  else await state.set(REVIEWED, map);
}
