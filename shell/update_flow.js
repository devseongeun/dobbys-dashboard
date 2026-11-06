// 업데이트 표시의 순수 계산. /_dashboard/update 응답 → 사이드바 링크·버전 줄·확인 문구. DOM·fetch 는 shell.js 가 한다.

export const CHECK_INTERVAL_MS = 30 * 60 * 1000;
export const RESTART_POLL_MS = 1000;
export const RESTART_TIMEOUT_MS = 60 * 1000;

// 링크를 보일지와 문구. ok 가 아니거나(git 아님 등) 뒤처진 게 없으면 숨긴다.
export function updateLink(state) {
  if (!state || !state.ok || !state.behind) return { visible: false, label: "", title: "", blocked: "" };
  const label = `업데이트 ${state.behind}건`;
  const list = state.titles.map((t) => `· ${t}`).join("\n");
  let blocked = "";
  if (state.dirty) blocked = "로컬에 커밋하지 않은 변경이 있어 자동 업데이트를 못 한다";
  else if (state.ahead) blocked = `로컬이 ${state.upstream} 보다 ${state.ahead}건 앞서 있어 fast-forward 할 수 없다`;
  const title = blocked ? `${label} — ${blocked}\n${list}` : `${label}\n${list}`;
  return { visible: true, label, title, blocked };
}

// 사이드바 아래 버전 줄. 체크아웃이 git 이 아니면 비운다.
export function versionLine(state) {
  if (!state || !state.ok) return "";
  return `${state.current} · ${state.currentDate}`;
}

export function confirmMessage(state) {
  const head = `업데이트 ${state.behind}건을 받고 대시보드를 다시 시작할까요?`;
  const list = state.titles.map((t) => `· ${t}`).join("\n");
  return list ? `${head}\n\n${list}` : head;
}

// 재시작이 끝났는지: 새 프로세스는 startedAt 이 다르다. 같은 프로세스가 pull 뒤 답해도 current 만 바뀌므로 그걸로는 모른다.
export function restarted(before, after) {
  return Boolean(after && after.startedAt && before && after.startedAt !== before.startedAt);
}
