// 셸 해시 규약: #<항목 id> 또는 #<항목 id>/<앱 해시에서 # 을 뺀 문자열>. 앱 해시는 손대지 않고 그대로 옮긴다.
// items 는 서버 설정(/_dashboard/config)의 켜진 탭이다: { id, label, icon, src }.
const strip = (value) => String(value || "").replace(/^#/, "");

export function parseShellHash(hash, items) {
  const raw = strip(hash);
  const slash = raw.indexOf("/");
  const id = slash < 0 ? raw : raw.slice(0, slash);
  if (!items.some((item) => item.id === id)) return { id: null, inner: "" };
  return { id, inner: slash < 0 ? "" : raw.slice(slash + 1) };
}

export function toShellHash(id, inner) {
  const rest = strip(inner);
  return "#" + id + (rest ? "/" + rest : "");
}

export function frameUrl(item, inner) {
  const rest = strip(inner);
  return item.src + (rest ? "#" + rest : "");
}

export function pickInitial(hash, last, items) {
  if (!items.length) return null;
  const { id } = parseShellHash(hash, items);
  if (id) return id;
  if (items.some((item) => item.id === last)) return last;
  return items[0].id;
}
