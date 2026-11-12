// 회의 자료 미리보기의 격리 규칙(DOM 은 받은 document 로만 만든다, bun 테스트 대상). meetings.js renderPreview 가 쓴다.
// PR #21(assets) web/tabs/assets/doc_frame.js 와 같은 규칙이다. 머지 뒤 공용 모듈로 합친다(후속).
//
// 미리보기 파일은 사용자의 Vault 파일이다. 웹판은 그것을 blob: 주소로 띄우는데, blob: 문서는 만든 페이지의 출처를 물려받고,
// 그 주소를 새 탭에서 직접 열면(탭 줄로 끌기·주소 붙여 넣기) sandbox 도 CSP 도 없이 이 대시보드 출처에서 돈다.
// 이 출처에는 Vault 핸들(IndexedDB)과 Jira token(localStorage)이 있다. 그래서 막는 겹을 넷 둔다.
// 1. HTML 은 iframe sandbox 에 allow-same-origin 하나만 준다. 스크립트·폼 제출·새 창(popup)·위쪽 창 이동이 모두 막힌다.
//    allow-same-origin 은 부모가 문서 안 링크 클릭을 가로채려고만 준다(스크립트가 없으니 문서가 저장소를 읽을 길이 없다).
//    allow-scripts 를 같이 주면 문서가 sandbox 를 스스로 풀 수 있고, allow-popups(-to-escape-sandbox) 를 주면 target 달린
//    링크 하나로 문서가 sandbox 없는 탭으로 열린다. 그래서 둘 다 주지 않는다(tests/js/meetings_web/preview_frame.test.js).
// 2. 문서 안 링크(a·area·SVG a)의 click·auxclick 은 모두 부모가 받는다(handleLink). #앵커는 스크롤, 바깥 http·https·mailto 는
//    부모가 window.open(noopener,noreferrer) 으로, 그 밖(상대 경로·javascript: 등)은 열지 않고 알린다.
//    문서의 <base>·target·meta refresh 는 띄우기 전에 지운다(cleanHtml).
// 3. SVG·그림은 <img> 로 그린다(스크립트 문맥이 없다).
// 4. HTML·SVG·그림의 blob: 주소는 다 읽으면(load) 바로 거둔다. 같은 주소를 다른 탭에서 다시 열 수 없다.
//    PDF 는 브라우저 PDF 뷰어가 sandbox 안에서 열리지 않아 sandbox 없이 두고, 미리보기를 바꾸거나 닫을 때 거둔다.
export const SANDBOX = "allow-same-origin";

const EXTERNAL = new Set(["http", "https", "mailto"]);
const XLINK = "http://www.w3.org/1999/xlink";
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);

// 미리보기 형식 → 그리는 방식. "text"(md·txt 를 글로), "html"(sandbox iframe), "image"(<img>), "pdf"(sandbox 없는 iframe).
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

// 이벤트 대상에서 위로 올라가며 링크 요소(HTML a·area, SVG a)와 그 주소를 찾는다. 없으면 null.
// 문서 안 노드는 다른 창(iframe) 것이라 instanceof 대신 localName 으로 본다.
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

// 문서 안 click·auxclick(가운데 클릭) 처리. 링크면 언제나 기본 동작을 막고(이동·새 창은 문서가 하지 않는다) 부모가 한다.
// actions: {scrollTo(id), openExternal(href), note(text)}. 처리한 링크 종류를 돌려준다.
export function handleLink(event, actions) {
  if (event.type === "auxclick" && event.button !== 1) return null;
  const found = findLink(event.target);
  if (!found) return null;
  event.preventDefault();
  const kind = linkKind(found.href);
  if (kind.kind === "anchor") actions.scrollTo(kind.id);
  else if (kind.kind === "external") actions.openExternal(found.href.trim());
  else actions.note(`링크를 열지 않았다: ${found.href} — ${kind.why}.`);
  return kind.kind;
}

// HTML 을 실행·로드 없이 파싱해(DOMParser) <base>·모든 target·meta refresh 를 지운 글로. parser 는 DOMParser 인스턴스.
export function cleanHtml(text, parser) {
  const doc = parser.parseFromString(String(text), "text/html");
  doc.querySelectorAll("base").forEach((el) => el.remove());
  doc.querySelectorAll("[target]").forEach((el) => el.removeAttribute("target"));
  doc.querySelectorAll("meta[http-equiv]").forEach((el) => {
    if (/^\s*refresh\s*$/i.test(el.getAttribute("http-equiv") ?? "")) el.remove();
  });
  return (doc.doctype ? "<!doctype html>\n" : "") + doc.documentElement.outerHTML;
}

// kind("html"·"image"·"pdf") 의 미리보기 요소. url 은 blob: 주소다.
// html·image 는 load(그림은 error 도) 때 revoke(url) 로 주소를 거두고, html 은 onFrame(iframe) 으로 링크를 붙이게 한다.
export function previewNode(doc, kind, url, name, { revoke, onFrame = () => {} }) {
  if (kind === "image") {
    const img = doc.createElement("img");
    img.alt = name;
    img.style.cssText = "display:block;max-width:calc(100% - 44px);height:auto;margin:16px 22px;background:#fff";
    img.onload = img.onerror = () => revoke(url);
    img.src = url;
    return img;
  }
  const frame = doc.createElement("iframe");
  frame.className = "frame";
  frame.title = name;
  if (kind === "html") {
    frame.setAttribute("sandbox", SANDBOX);
    frame.onload = () => {
      revoke(url);
      onFrame(frame);
    };
  }
  frame.src = url;
  return frame;
}
