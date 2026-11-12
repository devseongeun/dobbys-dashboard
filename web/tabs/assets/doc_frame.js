// 의사결정 문서 뷰어의 순수 규칙(DOM 을 만들지 않음, bun 테스트 대상). view.js 가 쓴다.
//
// 문서는 사용자의 Vault HTML 이다. 웹판은 그것을 정제한 글을 화면 안 iframe 의 srcdoc 으로 띄운다(문서 주소 about:srcdoc).
// blob: 주소를 iframe src 로 쓰지 않는다: blob 문서는 만든 페이지(대시보드)의 출처를 물려받고, 그 주소가 살아 있는 동안
// (iframe 삽입 뒤 load 전, 큰 문서면 수 초) Cmd+클릭·우클릭 '새 탭에서 열기'·탭 줄로 끌기로 sandbox 없는 대시보드 출처 탭으로
// 열렸다(meetings PR #23 2회차 재리뷰). srcdoc 에는 새 탭으로 열 주소가 없다. 막는 겹은 넷이다.
// 1. CSP: 셸의 CSP 를 srcdoc 문서가 물려받는다. 여기에 정제 때 문서 head 맨 앞에 더 좁은 CSP(DOC_CSP, 네트워크 요청 0)를 넣는다.
//    문서 안 <script>(인라인·cdnjs 등 바깥 주소)·on* 속성, 바깥·상대 주소의 그림·글꼴·스타일시트를 불러오지 않는다.
// 2. sandbox: allow-same-origin 하나만 준다. 스크립트·폼 제출·새 창(popup)·위쪽 창 이동·모달이 모두 막힌다.
//    allow-same-origin 은 부모가 문서 안 링크 클릭을 가로채려고만 준다. 스크립트가 없으니 같은 출처여도 문서가
//    IndexedDB·localStorage(비밀값)를 읽을 길이 없다. allow-scripts 와 함께 주면 문서가 sandbox 를 스스로 풀 수 있고,
//    allow-popups(-to-escape-sandbox) 를 주면 target 달린 링크 하나로 문서가 sandbox 없는 같은 출처 탭으로 열린다.
//    그래서 둘 다 주지 않는다(tests/js/web/assets_view.test.js 가 막는다).
// 3. 정제(cleanDoc): <base>·<script>·meta refresh·target·on* 를 지우고, 링크(a·area·SVG a)의 href·xlink:href 를
//    LINK_ATTR 로 옮긴다. 문서 안에 실제 href 가 없으니 링크 처리기가 붙기 전(load 전)에도 Cmd+클릭·끌기로 열 주소가 없다.
//    <template>(선언적 shadow DOM) 안도 같이 고친다.
// 4. 부모 가로채기: 문서 안 링크의 click·auxclick·Enter 는 모두 부모가 받아 처리한다(handleLink, composedPath 로 shadow DOM 안도).
//    바깥 링크는 부모가 window.open(noopener) 으로 연다.
export const SANDBOX = "allow-same-origin";

// 문서 안 그림으로 바꿔 넣을 같은 폴더 그림 형식.
export const IMAGE_TYPES = {
  ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
};
// 문서 안 링크로 내려받게 하는 같은 폴더 파일(로컬판 assets_serve.py 가 주던 형식 중 HTML 이 아닌 것).
export const FILE_TYPES = { ".pdf": "application/pdf", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const EXTERNAL = new Set(["http", "https", "mailto"]);
const XLINK = "http://www.w3.org/1999/xlink";

// 정제 때 링크 주소를 옮겨 두는 속성. 부모 처리기만 읽는다.
export const LINK_ATTR = "data-dashboard-href";
// 문서 head 맨 앞에 넣는 CSP. 셸 CSP 위에 겹쳐 더 좁힐 뿐이다(web_serve.py 의 CSP 는 그대로). 네트워크 요청을 하나도 내지 않고
// 그림·글꼴·미디어는 data: 만, 스타일은 문서 안 것만 쓴다. 상대 주소가 about:srcdoc 이 아닌 부모(view.html) 기준으로 풀려도
// 서버에 요청이 가지 않는다.
export const DOC_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src data:";
// href 를 옮긴 링크가 링크처럼 보이게(문서 CSS 가 이기도록 :where 로 우선순위 0).
export const LINK_STYLE = `:where(a,area)[${LINK_ATTR}]{cursor:pointer}:where(a)[${LINK_ATTR}]{color:LinkText;text-decoration:underline}`;

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

// 링크 요소(HTML a·area, SVG a)면 그 주소(LINK_ATTR, 없으면 href·xlink:href), 아니면 null.
// 문서 안 노드는 다른 창(iframe) 것이라 instanceof 대신 localName 으로 본다.
function linkHref(el) {
  if (el?.nodeType !== 1) return null;
  const tag = String(el.localName || "").toLowerCase();
  if (tag !== "a" && tag !== "area") return null;
  return el.getAttribute?.(LINK_ATTR) ?? el.getAttribute?.("href") ?? el.getAttributeNS?.(XLINK, "href") ?? null;
}

// 이벤트 대상에서 위로 올라가며 링크 요소와 그 주소를 찾는다. 없으면 null.
export function findLink(node) {
  for (let el = node; el; el = el.parentNode) {
    const href = linkHref(el);
    if (href !== null) return { el, href };
  }
  return null;
}

// 이벤트 경로(composedPath, 안쪽부터)에서 링크를 찾는다. shadow DOM 안 링크는 event.target 이 host 로 바뀌어도 여기에 있다.
// parentNode 를 따라가지 않으니 문서의 <form name="parentNode"> 같은 DOM clobbering 에도 흔들리지 않는다.
export function findLinkInPath(path) {
  for (const el of path) {
    const href = linkHref(el);
    if (href !== null) return { el, href };
  }
  return null;
}

// 문서 안 click·auxclick(가운데 클릭)·keydown(Enter) 처리. 링크면 언제나 기본 동작을 막고(새 창·이동은 문서가 하지 않는다) 부모가 한다.
// actions: {scrollTo(id), openExternal(href), openDoc(file), openFile(file), note(text)}. 처리한 링크 종류를 돌려준다.
export function handleLink(event, actions) {
  if (event.type === "auxclick" && event.button !== 1) return null;
  if (event.type === "keydown" && event.key !== "Enter") return null;
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  const found = path.length ? findLinkInPath(path) : findLink(event.target);
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

// root 아래 모든 요소. <template> 의 내용(선언적 shadow DOM 이 될 것)도 들어간다. querySelectorAll 은 그 안을 보지 않는다.
function* elements(root) {
  for (const el of root.querySelectorAll("*")) {
    yield el;
    if (String(el.localName).toLowerCase() === "template" && el.content) yield* elements(el.content);
  }
}

const STYLE_URL = /(?:@import\s+(?:url\()?|url\()\s*["']?(?:https?:)?\/\//gi;

// DOMParser 로 실행·로드 없이 파싱한 문서 doc 을 띄울 수 있게 고친다(그 자리에서 바꾼다).
// - <base>·<script>·<meta http-equiv=refresh> 를 지우고, 모든 target·formtarget·on* 속성을 지운다.
// - a·area·SVG a 의 href·xlink:href 를 LINK_ATTR 로 옮기고(실제 href 는 남기지 않는다) 키보드로 닿게 tabindex 를 준다.
// - 선언적 shadow DOM 은 open 으로 바꿔 부모 처리기가 composedPath 로 그 안 링크를 볼 수 있게 한다.
// - head 맨 앞에 DOC_CSP 와 LINK_STYLE 을 넣는다(LINK_STYLE 은 shadow DOM 이 될 template 안에도).
// 돌려주는 것: counts(막히는 스크립트·이벤트 속성·바깥 그림·바깥 스타일시트와 글꼴 수), images(같은 폴더 그림 [{el, name}],
// view.js 가 data: 로 바꿔 넣는다).
export function cleanDoc(doc) {
  const counts = { scripts: 0, handlers: 0, images: 0, styles: 0 };
  const images = [];
  const shadows = [];
  for (const el of [...elements(doc)]) {
    const tag = String(el.localName).toLowerCase();
    if (tag === "base") { el.remove(); continue; }
    if (tag === "script") { counts.scripts += 1; el.remove(); continue; }
    if (tag === "meta" && /^\s*refresh\s*$/i.test(el.getAttribute("http-equiv") ?? "")) { el.remove(); continue; }
    el.removeAttribute("target");
    el.removeAttribute("formtarget");
    const handlers = [...el.attributes].map((attr) => attr.name).filter((name) => /^on/i.test(name));
    if (handlers.length) {
      counts.handlers += 1;
      handlers.forEach((name) => el.removeAttribute(name));
    }
    if (tag === "template" && el.hasAttribute("shadowrootmode")) {
      el.setAttribute("shadowrootmode", "open");
      shadows.push(el.content);
    }
    if (tag === "a" || tag === "area") {
      const href = el.getAttribute("href") ?? el.getAttributeNS(XLINK, "href");
      el.removeAttribute("href");
      el.removeAttributeNS(XLINK, "href");
      if (href !== null) {
        el.setAttribute(LINK_ATTR, href);
        if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
      }
    }
    if (tag === "img" && el.hasAttribute("src")) {
      const src = el.getAttribute("src");
      const name = imageName(src);
      if (name) images.push({ el, name });
      else if (isExternalUrl(src)) counts.images += 1;
    }
    if (tag === "link" && /(^|\s)stylesheet(\s|$)/i.test(el.getAttribute("rel") ?? "") && isExternalUrl(el.getAttribute("href"))) counts.styles += 1;
    if (tag === "style") counts.styles += (String(el.textContent).match(STYLE_URL) ?? []).length;
  }
  const meta = doc.createElement("meta");
  meta.setAttribute("http-equiv", "Content-Security-Policy");
  meta.setAttribute("content", DOC_CSP);
  const linkStyle = () => Object.assign(doc.createElement("style"), { textContent: LINK_STYLE });
  doc.head.prepend(meta, linkStyle());
  shadows.forEach((content) => content.prepend(linkStyle()));  // 문서 style 은 shadow 안에 닿지 않는다
  return { counts, images };
}

// 화면 위 안내 문구. 아무것도 막히지 않았으면 "".
export function blockedNotice({ scripts = 0, handlers = 0, images = 0, styles = 0 }) {
  const parts = [];
  if (scripts || handlers) {
    parts.push(`이 문서의 스크립트 ${scripts}개${handlers ? `·이벤트 속성 ${handlers}곳은` : "는"} 웹 화면에서 실행하지 않는다(보안). `
      + "스크립트로 그리는 그림·차트·버튼은 비거나 움직이지 않는다.");
  }
  if (images || styles) {
    parts.push(`바깥 주소의 ${[images ? `그림 ${images}개` : "", styles ? `스타일시트·글꼴 ${styles}개` : ""].filter(Boolean).join("·")}도 `
      + "보안 정책으로 불러오지 않아 빈 그림·기본 글꼴로 보인다.");
  }
  if (!parts.length) return "";
  return parts.join(" ") + " 원본을 내려받아 열거나, ← 목록의 경로 복사로 Vault 에서 연다.";
}
