// 의사결정 문서 뷰어의 순수 규칙(DOM 을 만들지 않음, bun 테스트 대상). view.js 가 쓴다.
//
// 문서는 사용자의 Vault HTML 이다. 웹판은 그것을 blob: URL 로 만들어 화면 안 iframe 에 띄우는데, blob: 문서는 만든 페이지의 출처와
// CSP(script-src 'self' 등)를 물려받는다. 막는 겹은 셋이다.
// 1. CSP: 문서 안 <script>(인라인·cdnjs 등 바깥 주소)·on* 속성, 바깥 그림·글꼴·스타일시트를 막는다.
// 2. sandbox: allow-same-origin 하나만 준다. 스크립트·폼 제출·새 창(popup)·위쪽 창 이동·모달이 모두 막힌다.
//    allow-same-origin 은 부모가 문서 안 링크 클릭을 가로채려고만 준다. 스크립트가 없으니 같은 출처여도 문서가
//    IndexedDB·localStorage(비밀값)를 읽을 길이 없다. allow-scripts 와 함께 주면 문서가 sandbox 를 스스로 풀 수 있고,
//    allow-popups(-to-escape-sandbox) 를 주면 target 달린 링크 하나로 문서가 sandbox 없는 같은 출처 탭으로 열린다.
//    그래서 둘 다 주지 않는다(tests/js/web/assets_view.test.js 가 막는다).
// 3. 부모 가로채기: 문서 안 링크(a·area·SVG a)의 click·auxclick 은 모두 부모가 받아 처리한다(handleLink).
//    바깥 링크는 부모가 window.open(noopener) 으로 연다. 문서의 <base>·target 은 띄우기 전에 지운다.
//    문서 blob: 주소는 iframe 이 다 읽으면 바로 거둬(revoke) 다른 곳에서 다시 열 수 없게 한다.
export const SANDBOX = "allow-same-origin";

// 문서 안 그림으로 바꿔 넣을 같은 폴더 그림 형식.
export const IMAGE_TYPES = {
  ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
};
// 문서 안 링크로 내려받게 하는 같은 폴더 파일(로컬판 assets_serve.py 가 주던 형식 중 HTML 이 아닌 것).
export const FILE_TYPES = { ".pdf": "application/pdf", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const EXTERNAL = new Set(["http", "https", "mailto"]);
const XLINK = "http://www.w3.org/1999/xlink";

// 뷰어가 여는 문서 이름. 로컬판 assets_serve.py _resolve 와 같다: 폴더 바로 아래, 숨김(.)·경로 구분자 없음, .html.
export const docName = (name) => Boolean(name) && !name.startsWith(".") && !name.includes("/") && !name.includes("\\") && name.endsWith(".html");

const extension = (name) => {
  const at = name.lastIndexOf(".");
  return at > 0 ? name.slice(at).toLowerCase() : "";
};

// 상대 주소 → 같은 폴더 파일 이름(쿼리·#조각 제거, %디코드, ./ 허용). 하위·상위 폴더나 못 읽는 주소는 null.
export function sameFolderName(href) {
  const path = String(href).trim().replace(/[?#].*$/s, "").replace(/^\.\//, "");
  if (!path) return null;
  let name;
  try {
    name = decodeURIComponent(path);
  } catch {
    return null;
  }
  return name && !name.includes("/") && !name.includes("\\") && name !== "." && name !== ".." ? name : null;
}

// 문서 안 링크를 어떻게 다룰지. 브라우저가 무시하는 scheme 앞뒤 공백·제어 문자를 지우고 본다.
// {kind: "anchor", id} 문서 안 #앵커(빈 주소는 id "") · {kind: "external"} 새 탭 · {kind: "doc", file} 같은 폴더 문서(뷰어로)
// {kind: "file", file} 같은 폴더 pdf·그림·json(내려받기) · {kind: "blocked", why} 그 밖(하위 폴더·다른 형식·javascript: 등)
export function linkKind(href) {
  const raw = String(href ?? "");
  const url = raw.replace(/[\x00-\x20\x7f]+/g, "");
  if (url === "") return { kind: "anchor", id: "" };
  if (url.startsWith("#")) {
    let id = url.slice(1);
    try { id = decodeURIComponent(id); } catch { /* 그대로 */ }
    return { kind: "anchor", id };
  }
  const scheme = url.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme) {
    return EXTERNAL.has(scheme[1].toLowerCase()) ? { kind: "external" } : { kind: "blocked", why: `${scheme[1]}: 주소는 열지 않는다` };
  }
  if (url.startsWith("//")) return { kind: "external" };
  const name = sameFolderName(raw);
  if (name && docName(name)) return { kind: "doc", file: name };
  if (name && !name.startsWith(".") && Object.hasOwn(FILE_TYPES, extension(name))) return { kind: "file", file: name };
  return { kind: "blocked", why: "웹 화면은 의사결정 폴더 바로 아래 HTML 문서와 pdf·그림만 연다" };
}

// <img src> → 같은 폴더 그림 파일 이름(바꿔 넣을 것) 또는 null(그대로 둔다).
export function imageName(src) {
  const raw = String(src ?? "");
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw.trim()) || raw.trim().startsWith("//")) return null;
  const name = sameFolderName(raw);
  return name && !name.startsWith(".") && Object.hasOwn(IMAGE_TYPES, extension(name)) ? name : null;
}

export const imageType = (name) => IMAGE_TYPES[extension(name)];
export const fileType = (name) => FILE_TYPES[extension(name)] ?? "application/octet-stream";

// 바깥 주소인지(CSP 가 막는 그림·스타일시트 셈에 쓴다). 같은 폴더·data:·blob: 은 아니다.
export const isExternalUrl = (value) => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(String(value ?? "").trim()) && !/^(?:data|blob):/i.test(String(value).trim());

// 이벤트 대상에서 위로 올라가며 링크 요소(HTML a·area, SVG a)와 그 주소를 찾는다. 없으면 null.
// SVG a 는 href 또는 xlink:href 를 쓴다. 문서 안 노드는 다른 창(iframe) 것이라 instanceof 대신 localName 으로 본다.
export function findLink(node) {
  for (let el = node; el; el = el.parentNode) {
    if (el.nodeType !== 1) continue;
    const tag = String(el.localName || "").toLowerCase();
    if (tag !== "a" && tag !== "area") continue;
    const href = el.getAttribute?.("href") ?? el.getAttributeNS?.(XLINK, "href") ?? null;
    if (href !== null) return { el, href };
  }
  return null;
}

// 문서 안 click·auxclick(가운데 클릭) 처리. 링크면 언제나 기본 동작을 막고(새 창·이동은 문서가 하지 않는다) 부모가 한다.
// actions: {scrollTo(id), openExternal(href), openDoc(file), openFile(file), note(text)}. 처리한 링크 종류를 돌려준다.
export function handleLink(event, actions) {
  if (event.type === "auxclick" && event.button !== 1) return null;
  const found = findLink(event.target);
  if (!found) return null;
  event.preventDefault();
  const kind = linkKind(found.href);
  if (kind.kind === "anchor") actions.scrollTo(kind.id);
  else if (kind.kind === "external") actions.openExternal(found.href.trim());
  else if (kind.kind === "doc") actions.openDoc(kind.file);
  else if (kind.kind === "file") actions.openFile(kind.file);
  else actions.note(`링크를 열지 않았다: ${found.href} — ${kind.why}.`);
  return kind.kind;
}

// 화면 위 안내 문구. 아무것도 막히지 않았으면 "".
export function blockedNotice({ scripts = 0, handlers = 0, images = 0, styles = 0 }) {
  const parts = [];
  if (scripts || handlers) {
    parts.push(`이 문서의 스크립트 ${scripts}개${handlers ? `·이벤트 속성 ${handlers}곳` : ""}은 웹 화면에서 실행하지 않는다(보안). `
      + "스크립트로 그리는 그림·차트·버튼은 비거나 움직이지 않는다.");
  }
  if (images || styles) {
    parts.push(`바깥 주소의 ${[images ? `그림 ${images}개` : "", styles ? `스타일시트·글꼴 ${styles}개` : ""].filter(Boolean).join("·")}도 `
      + "보안 정책으로 불러오지 않아 빈 그림·기본 글꼴로 보인다.");
  }
  if (!parts.length) return "";
  return parts.join(" ") + " 원본을 내려받아 열거나, ← 목록의 경로 복사로 Vault 에서 연다.";
}
