// 사이드바 드래그 순서 계산. DOM·fetch 는 shell.js 가 한다.

// fromId 를 toId 의 앞(after=false) 또는 뒤(after=true)로 옮긴 새 배열. 모르는 id·같은 자리는 원본 그대로.
export function moveItem(order, fromId, toId, after) {
  const from = order.indexOf(fromId);
  const to = order.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return order.slice();
  const rest = order.filter((id) => id !== fromId);
  const anchor = rest.indexOf(toId);
  rest.splice(after ? anchor + 1 : anchor, 0, fromId);
  return rest;
}

// 포인터가 대상 요소의 아래 절반이면 뒤에 놓는다.
export function dropAfter(clientY, rect) {
  return clientY > rect.top + rect.height / 2;
}

export function sameOrder(a, b) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
