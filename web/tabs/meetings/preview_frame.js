// 회의 자료 미리보기의 격리 규칙(bun 테스트 대상). meetings.js renderPreview 가 쓴다.
// PR #21(assets) web/tabs/assets/doc_frame.js 와 같은 규칙이다(코드는 따로). 머지 뒤 공용 모듈로 합친다(후속).
//
// 미리보기 파일은 사용자의 Vault 파일이다. 이 대시보드 출처에는 Vault 핸들(IndexedDB)과 Jira token(localStorage)이 있어,
// Vault 의 HTML·SVG 가 이 출처에서 돌거나 sandbox 밖 탭으로 나가지 못하게 막는 겹을 다섯 둔다.
// 1. 주소를 만들지 않는다. HTML 은 정제한 글을 iframe.srcdoc 으로 넣는다(문서 주소 about:srcdoc). 예전처럼 blob: 주소를
//    iframe src 로 쓰면 그 주소가 살아 있는 동안(삽입 뒤 load 전, 큰 문서면 수 초) Cmd+클릭·우클릭 '새 탭에서 열기'·탭 줄로
//    끌기로 sandbox 없는 대시보드 출처 탭이 열렸다(PR #23 2회차 재리뷰). 그림·SVG 는 data: 주소의 <img> 다(스크립트 문맥이
//    없고, 새 탭으로 열어도 data: 는 출처가 없다). PDF 만 브라우저 PDF 뷰어 때문에 blob 주소 iframe 이고 미리보기를 바꾸거나
//    닫을 때 거둔다(application/pdf 로만 열린다).
// 2. sandbox: allow-same-origin 하나만 준다. 스크립트·폼 제출·새 창(popup)·위쪽 창 이동·모달이 모두 막힌다.
//    allow-same-origin 은 부모가 문서 안 링크 클릭을 가로채려고만 준다(스크립트가 없으니 문서가 저장소를 읽을 길이 없다).
//    allow-scripts 를 같이 주면 문서가 sandbox 를 스스로 풀 수 있고, allow-popups(-to-escape-sandbox) 를 주면 target 달린
//    링크 하나로 sandbox 없는 탭이 열린다. 그래서 둘 다 주지 않는다(tests/js/meetings_web/preview_frame.test.js).
// 3. 문서 CSP: 정제한 문서 head 맨 앞에 DOC_CSP 를 넣는다(네트워크 요청 0, 그림·글꼴·미디어는 data: 만). 상대 주소가
//    about:srcdoc 이 아닌 부모(meetings.html) 기준으로 풀려도 서버로 요청이 가지 않는다. 셸의 CSP 도 함께 물려받는다.
// 4. 정제(sanitize): DROP 요소(script·base·link·iframe·frame·object·embed 등, 안쪽은 정제·처리기가 닿지 않는다,
//    SVG SMIL set·animate·animateMotion·animateTransform·discard)와
//    meta refresh 를 지우고, 모든 on*·target·formtarget·srcdoc·ping 속성과 href·xlink:href 를 지운다. 링크(a·area·SVG a)의
//    주소는 LINK_ATTR 로 옮긴다: 문서 안에 진짜 href 가 없으니 load 전·처리기 없이도 Cmd+클릭·끌기로 열 주소가 없다.
//    파서 왕복으로 모양이 바뀌는 HTML(mXSS: form 중첩 + math mglyph style 등)은 정제 → 직렬화 → 다시 파싱을 결과가 바뀌지
//    않을 때까지(MAX_ROUNDS) 되풀이하고, 마지막 글을 다시 파싱해 남은 것(leftovers)이 하나라도 있으면 띄우지 않는다.
//    DOM 은 원형 메서드로만 만진다(domAdapter): <form> 안 name="removeAttribute" 같은 이름이 메서드를 덮어도 흔들리지 않게.
// 5. 부모 가로채기: 문서 안 링크의 click·auxclick·Enter 는 모두 부모가 받아 처리한다(handleLink, composedPath 로 shadow DOM
//    안도). #앵커는 문서 안 스크롤, 바깥 http·https·mailto 는 window.open(noopener,noreferrer), 그 밖은 열지 않고 알린다.
export const SANDBOX = "allow-same-origin";
export const LINK_ATTR = "data-meetings-href";
export const DOC_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:";
// 옮긴 링크를 링크처럼 보이게. :where() 로 감싸 특이도 0 이라 문서의 a{color…} 가 이긴다.
export const LINK_STYLE = `:where(a[${LINK_ATTR}],area[${LINK_ATTR}]){cursor:pointer}:where(a[${LINK_ATTR}]){color:LinkText;text-decoration:underline}`;
export const MAX_ROUNDS = 5;
export const UNSAFE = "이 HTML 은 안전하게 정리되지 않아 미리보기로 띄우지 않는다. Obsidian에서 연다.";

const EXTERNAL = new Set(["http", "https", "mailto"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
// 통째로 지우는 요소: 실행(script), 주소 기준(base), 바깥 자원(link), 다른 문서를 품는 것(안쪽은 정제·처리기가 닿지 않는다),
// SVG SMIL 애니메이션(<set attributeName="href" to="…">·<animate> 류는 정제가 끝난 뒤에 링크 주소를 만들어 낸다).
const DROP = new Set(["script", "base", "link", "iframe", "frame", "frameset", "object", "embed", "portal", "fencedframe", "applet",
  "set", "animate", "animatemotion", "animatetransform", "discard"]);
const DROP_ATTRS = new Set(["target", "formtarget", "srcdoc", "ping", "href", "xlink:href"]);
const isLink = (tag) => tag === "a" || tag === "area";
const isRefresh = (dom, el) => /^\s*refresh\s*$/i.test(dom.getAttr(el, "http-equiv") ?? "");

// 미리보기 형식 → 그리는 방식. "text"(md·txt 를 글로), "html"(sandbox srcdoc iframe), "image"(data: <img>), "pdf"(iframe).
export function previewKind(ext) {
  const name = String(ext).toLowerCase();
  if (name === ".md" || name === ".txt") return "text";
  if (name === ".html" || name === ".htm") return "html";
  if (name === ".pdf") return "pdf";
  return IMAGE_EXT.has(name) ? "image" : "none";
}

// 문서 안 링크를 어떻게 다룰지. 브라우저가 무시하는 scheme 앞뒤 공백·제어 문자를 지우고 본다.
// {kind: "anchor", id} 문서 안 #앵커(빈 주소는 id "") · {kind: "external"} 새 탭 · {kind: "blocked", why} 그 밖.
export function linkKind(href) {
  const url = String(href ?? "").replace(/[\x00-\x20\x7f]+/g, "");
  if (url === "") return { kind: "anchor", id: "" };
  if (url.startsWith("#")) {
    let id = url.slice(1);
    try { id = decodeURIComponent(id); } catch { /* 그대로 */ }
    return { kind: "anchor", id };
  }
  const scheme = url.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme) return EXTERNAL.has(scheme[1].toLowerCase()) ? { kind: "external" } : { kind: "blocked", why: `${scheme[1]}: 주소는 열지 않는다` };
  if (url.startsWith("//")) return { kind: "external" };
  return { kind: "blocked", why: "미리보기 안의 상대 경로 링크는 열지 않는다. Obsidian에서 연다" };
}

// 브라우저 DOM 을 원형 메서드로만 만지는 어댑터. win 은 DOMParser 문서를 만든 창(같은 realm).
// form 안 <input name="removeAttribute">·문서의 <img name="documentElement"> 같은 이름 덮어쓰기(clobbering)에 흔들리지 않는다.
export function domAdapter(win = globalThis) {
  const get = (Ctor, name) => Object.getOwnPropertyDescriptor(Ctor.prototype, name).get;
  const childNodes = get(win.Node, "childNodes");
  const nodeType = get(win.Node, "nodeType");
  const localName = get(win.Element, "localName");
  const content = get(win.HTMLTemplateElement, "content");
  const documentElement = get(win.Document, "documentElement");
  const doctype = get(win.Document, "doctype");
  const head = get(win.Document, "head");
  const outerHTML = get(win.Element, "outerHTML");
  const E = win.Element.prototype;
  const D = win.Document.prototype;
  const N = win.Node.prototype;
  return {
    root: (doc) => documentElement.call(doc),
    children: (node) => [...childNodes.call(node)].filter((child) => nodeType.call(child) === 1),
    tag: (el) => String(localName.call(el)).toLowerCase(),
    attrNames: (el) => E.getAttributeNames.call(el),
    getAttr: (el, name) => E.getAttribute.call(el, name),
    setAttr: (el, name, value) => E.setAttribute.call(el, name, value),
    removeAttr: (el, name) => E.removeAttribute.call(el, name),
    remove: (el) => E.remove.call(el),
    content: (el) => content.call(el),
    // head 맨 앞에 요소를 넣는다.
    prepend: (doc, tag, attrs, text) => {
      const el = D.createElement.call(doc, tag);
      for (const [name, value] of Object.entries(attrs)) E.setAttribute.call(el, name, value);
      if (text) N.appendChild.call(el, D.createTextNode.call(doc, text));
      const box = head.call(doc);
      N.insertBefore.call(box, el, childNodes.call(box)[0] ?? null);
    },
    serialize: (doc) => (doctype.call(doc) ? "<!doctype html>\n" : "") + outerHTML.call(documentElement.call(doc)),
  };
}

// 정제 한 번(제자리). template 안(선언적 shadow DOM 이 될 것)도 정제하고, shadowrootmode 는 open 으로 바꿔
// 부모 처리기가 composedPath 로 그 안 링크를 볼 수 있게 한다.
export function cleanDoc(doc, dom) {
  const walk = (node) => {
    for (const el of dom.children(node)) {
      const tag = dom.tag(el);
      if (DROP.has(tag) || (tag === "meta" && isRefresh(dom, el))) { dom.remove(el); continue; }
      const names = dom.attrNames(el);
      const lower = (name) => name.toLowerCase();
      if (isLink(tag)) {
        const href = names.find((n) => lower(n) === "href") ?? names.find((n) => lower(n) === "xlink:href");
        if (href !== undefined) {
          dom.setAttr(el, LINK_ATTR, dom.getAttr(el, href) ?? "");
          if (!names.some((n) => lower(n) === "tabindex")) dom.setAttr(el, "tabindex", "0");
        }
      } else if (names.includes(LINK_ATTR)) {
        dom.removeAttr(el, LINK_ATTR);
      }
      for (const name of names) if (DROP_ATTRS.has(lower(name)) || lower(name).startsWith("on")) dom.removeAttr(el, name);
      if (tag === "template") {
        if (names.some((n) => lower(n) === "shadowrootmode")) dom.setAttr(el, "shadowrootmode", "open");
        walk(dom.content(el));
      }
      walk(el);
    }
  };
  walk(doc);
}

// 정제한 문서에 남으면 안 되는 것의 수(DROP 요소·meta refresh·on*·target·formtarget·srcdoc·ping·href·xlink:href).
export function leftovers(doc, dom) {
  let count = 0;
  const walk = (node) => {
    for (const el of dom.children(node)) {
      const tag = dom.tag(el);
      if (DROP.has(tag) || (tag === "meta" && isRefresh(dom, el))) count++;
      for (const name of dom.attrNames(el)) {
        const lower = name.toLowerCase();
        if (DROP_ATTRS.has(lower) || lower.startsWith("on")) count++;
      }
      if (tag === "template") walk(dom.content(el));
      walk(el);
    }
  };
  walk(doc);
  return count;
}

// HTML 글 → srcdoc 에 넣을 정제한 글. parse(text) → Document(실행·로드 없음, DOMParser), dom 은 domAdapter.
// 결과가 바뀌지 않을 때까지 되풀이하고, CSP·링크 모양을 넣은 마지막 글을 다시 파싱해 남은 것이 0 일 때만 {html}. 아니면 {error}.
export function sanitizeHtml(text, parse, dom) {
  let html = String(text);
  let stable = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const doc = parse(html);
    cleanDoc(doc, dom);
    const next = dom.serialize(doc);
    if (next === html) { stable = true; break; }
    html = next;
  }
  if (!stable) return { error: UNSAFE };
  const doc = parse(html);
  dom.prepend(doc, "style", {}, LINK_STYLE);
  dom.prepend(doc, "meta", { "http-equiv": "Content-Security-Policy", content: DOC_CSP });
  const final = dom.serialize(doc);
  if (leftovers(parse(final), dom) !== 0) return { error: UNSAFE };
  return { html: final };
}

// 이벤트 경로(composedPath, 안쪽부터)에서 링크(a·area, SVG a)와 그 주소를 찾는다. 정제로 옮긴 LINK_ATTR 를 먼저 본다.
// shadow DOM 안 링크는 event.target 이 host 로 바뀌어도 경로에 있다. 문서 안 노드는 다른 창 것이라 localName 으로 본다.
export function findLink(event) {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  for (const el of path) {
    if (!el || el.nodeType !== 1) continue;
    const tag = String(el.localName || "").toLowerCase();
    if (!isLink(tag)) continue;
    const href = el.getAttribute?.(LINK_ATTR) ?? el.getAttribute?.("href") ?? null;
    if (href !== null) return { el, href };
  }
  return null;
}

// 문서 안 click·auxclick(가운데 클릭)·keydown(Enter) 처리. 링크면 언제나 기본 동작을 막고 부모가 한다.
// actions: {scrollTo(id), openExternal(href), note(text)}. 처리한 링크 종류를 돌려준다.
export function handleLink(event, actions) {
  if (event.type === "auxclick" && event.button !== 1) return null;
  if (event.type === "keydown" && event.key !== "Enter") return null;
  const found = findLink(event);
  if (!found) return null;
  event.preventDefault();
  const kind = linkKind(found.href);
  if (kind.kind === "anchor") actions.scrollTo(kind.id);
  else if (kind.kind === "external") actions.openExternal(found.href.trim());
  else actions.note(`링크를 열지 않았다: ${found.href} — ${kind.why}.`);
  return kind.kind;
}

// kind("html"·"image"·"pdf") 의 미리보기 요소. source 는 html 이면 정제한 글, image 면 data: 주소, pdf 면 blob: 주소.
// html 은 sandbox 를 srcdoc 보다 먼저 붙이고, load 때 onFrame(iframe) 으로 링크 처리기를 붙이게 한다.
export function previewNode(doc, kind, source, name, { onFrame = () => {} } = {}) {
  if (kind === "image") {
    const img = doc.createElement("img");
    img.alt = name;
    img.style.cssText = "display:block;max-width:calc(100% - 44px);height:auto;margin:16px 22px;background:#fff";
    img.src = source;
    return img;
  }
  const frame = doc.createElement("iframe");
  frame.className = "frame";
  frame.title = name;
  if (kind === "html") {
    frame.setAttribute("sandbox", SANDBOX);
    frame.onload = () => onFrame(frame);
    frame.srcdoc = source;
  } else {
    frame.src = source;
  }
  return frame;
}
