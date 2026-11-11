// md 뷰어 HTML 정제(허용 목록). marked 는 md 안의 원시 HTML 을 그대로 내보낸다.
// CSP(script-src 'self')가 스크립트는 막지만 form·iframe·object·embed·javascript: 링크·화면을 덮는 style 은 남으므로,
// 뷰어는 marked 결과를 <template> 에 넣고(실행·로드 없음) 이 규칙으로 걸러 낸 뒤에 화면에 붙인다(view.js).
// 규칙(tagPolicy·keepAttr·safeUrl)은 DOM 이 없는 순수 함수이고, sanitize() 는 그 규칙으로 노드 트리를 걷는다.

// 그대로 두는 태그. marked 출력 + 문서에 흔히 쓰는 무해한 서식 태그.
const KEEP = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "a", "img", "em", "strong", "b", "i", "u", "s", "del", "ins",
  "code", "pre", "blockquote", "hr", "br", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "span", "div", "sup", "sub", "kbd", "mark", "small", "abbr", "q", "cite", "var", "samp", "dl", "dt", "dd",
  "details", "summary", "figure", "figcaption", "input",
]);
// 내용째 버리는 태그. 실행·삽입·입력·외부 로드를 하는 것들.
const DROP = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "button", "select", "textarea",
  "option", "optgroup", "datalist", "link", "meta", "base", "template", "noscript", "svg", "math", "audio", "video", "source",
  "track", "canvas", "portal", "dialog", "fencedframe", "title", "head",
]);
// 모든 허용 태그에 둘 수 있는 속성. id·name·style·on* 은 두지 않는다(화면 요소 가로채기·덮어 그리기·스크립트).
const GLOBAL_ATTRS = new Set(["title", "class", "lang", "dir"]);
const TAG_ATTRS = {
  a: new Set(["href"]),
  img: new Set(["src", "alt", "width", "height"]),
  input: new Set(["type", "checked", "disabled"]),
  ol: new Set(["start", "reversed"]),
  th: new Set(["align", "colspan", "rowspan"]),
  td: new Set(["align", "colspan", "rowspan"]),
  col: new Set(["span"]),
  colgroup: new Set(["span"]),
  details: new Set(["open"]),
};
const URL_ATTRS = new Set(["href", "src"]);
const LINK_SCHEMES = new Set(["http", "https", "mailto"]);
const IMAGE_SCHEMES = new Set(["http", "https"]);
const DATA_IMAGE = /^data:image\/(png|gif|jpeg|webp|avif);/;

// "keep" | "unwrap"(태그만 벗기고 내용은 남김) | "drop"(내용째 버림). 체크박스가 아닌 input 은 버린다.
export function tagPolicy(tag, type = "") {
  const name = String(tag).toLowerCase();
  if (name === "input") return String(type).trim().toLowerCase() === "checkbox" ? "keep" : "drop";
  if (DROP.has(name)) return "drop";
  return KEEP.has(name) ? "keep" : "unwrap";
}

// 링크·이미지 주소. 상대 주소·#앵커와 허용한 scheme 만 통과한다.
// 브라우저는 scheme 안의 탭·줄바꿈·앞쪽 제어 문자를 무시하므로(java\tscript:) 그것들을 지운 뒤에 본다.
export function safeUrl(value, tag = "a") {
  const url = String(value).replace(/[\x00-\x20\x7f]+/g, "").toLowerCase();
  const scheme = url.match(/^([a-z][a-z0-9+.-]*):/);
  if (!scheme) return !/^[^/?#]*:/.test(url);  // ":" 가 경로보다 앞이면 scheme 으로 읽힐 수 있다
  if (tag === "img") return IMAGE_SCHEMES.has(scheme[1]) || DATA_IMAGE.test(url);
  return LINK_SCHEMES.has(scheme[1]);
}

export function keepAttr(tag, name, value) {
  const attr = String(name).toLowerCase();
  if (!GLOBAL_ATTRS.has(attr) && !TAG_ATTRS[tag]?.has(attr)) return false;
  if (URL_ATTRS.has(attr)) return safeUrl(value, tag);
  return true;
}

// root(DocumentFragment·Element) 의 자식을 제자리에서 정제한다. 주석·처리 명령은 지운다.
export function sanitize(root) {
  for (const node of [...root.childNodes]) {
    if (node.nodeType === 3) continue;  // 글자
    if (node.nodeType !== 1) { node.remove(); continue; }
    const tag = String(node.localName || node.tagName).toLowerCase();
    const policy = tagPolicy(tag, node.getAttribute("type") ?? "");
    if (policy === "drop") { node.remove(); continue; }
    sanitize(node);
    if (policy === "unwrap") { node.replaceWith(...node.childNodes); continue; }
    for (const { name, value } of [...node.attributes]) if (!keepAttr(tag, name, value)) node.removeAttribute(name);
  }
  return root;
}
