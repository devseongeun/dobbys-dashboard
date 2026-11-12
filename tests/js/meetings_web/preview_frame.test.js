// 회의 자료 미리보기 격리(preview_frame.js). Vault 의 HTML·SVG 가 이 대시보드 출처(Vault 핸들·Jira token 이 있는 곳)에서
// 돌거나 sandbox 밖 탭으로 나갈 길을 막는다: blob 주소 없이 srcdoc·data:, sandbox 에 allow-scripts·allow-popups 없음,
// 정제(고정점까지 되풀이 + 남은 것 검사, 링크 주소는 data- 속성으로), 링크는 부모가 composedPath 로 처리.
// bun 에는 DOMParser 가 없어, 원형에 getter·메서드를 둔 작은 가짜 DOM 을 만들어 실제 domAdapter 로 정제를 돌린다.
// 가짜 직렬화는 JSON 이고, 파서 왕복 때 모양이 바뀌는 mXSS 를 흉내 내는 표시(REVIVE·GROW·LATE)를 둔다.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DOC_CSP, LINK_ATTR, LINK_STYLE, MAX_ROUNDS, SANDBOX, UNSAFE, domAdapter, findLink, handleLink, leftovers, linkKind, previewKind,
  previewNode, sanitizeHtml,
} from "../../../web/tabs/meetings/preview_frame.js";
import { childDir, fileIn } from "../../../web/tabs/meetings/meetings_canvas.js";
import { REPO } from "../web/support.js";

const read = (path) => readFileSync(join(REPO, path), "utf8");

// ── 가짜 DOM ────────────────────────────────────────────
// 진짜 DOM 처럼 getter 는 원형 하나이고 노드 안쪽 값(_type 등)을 읽는다(domAdapter 가 원형 getter 를 부른다).
class Node {
  constructor(type = 1) { this._kids = []; this._parent = null; this._type = type; }
  get childNodes() { return [...this._kids]; }
  get nodeType() { return this._type; }
  appendChild(child) { child._parent = this; this._kids.push(child); return child; }
  insertBefore(child, ref) {
    child._parent = this;
    const at = ref ? this._kids.indexOf(ref) : -1;
    if (at < 0) this._kids.push(child); else this._kids.splice(at, 0, child);
    return child;
  }
}
class Text extends Node {
  constructor(text) { super(3); this.data = text; }
}
class Element extends Node {
  constructor(tag, attrs = {}) { super(); this._tag = tag; this._attrs = new Map(Object.entries(attrs)); }
  get localName() { return this._tag; }
  getAttributeNames() { return [...this._attrs.keys()]; }
  getAttribute(name) { return this._attrs.has(name) ? this._attrs.get(name) : null; }
  setAttribute(name, value) { this._attrs.set(name, String(value)); }
  removeAttribute(name) { this._attrs.delete(name); }
  remove() { if (this._parent) this._parent._kids = this._parent._kids.filter((k) => k !== this); this._parent = null; }
  get outerHTML() { return JSON.stringify(toJson(this)); }
}
class HTMLTemplateElement extends Element {
  constructor(attrs) { super("template", attrs); this._content = new Node(11); }
  get content() { return this._content; }
}
class Document extends Node {
  constructor(doctype) { super(9); this._doctype = doctype; }
  get documentElement() { return this._kids[0]; }
  get doctype() { return this._doctype; }
  get head() { return this._kids[0]._kids.find((k) => k._tag === "head"); }
  createElement(tag) { return tag === "template" ? new HTMLTemplateElement({}) : new Element(tag); }
  createTextNode(text) { return new Text(text); }
}
const WIN = { Node, Element, HTMLTemplateElement, Document };
const dom = domAdapter(WIN);

function toJson(node) {
  if (node instanceof Text) return { text: node.data };
  const out = { t: node._tag, a: Object.fromEntries(node._attrs), c: node._kids.map(toJson) };
  if (node instanceof HTMLTemplateElement) out.content = node._content._kids.map(toJson);
  return out;
}

// 가짜 파서. 표시가 든 style 글은 다시 파싱할 때 모양이 바뀐다(실제 mXSS 처럼 직렬화 → 파싱 왕복에서 요소가 살아난다).
// HIDE:<json> 첫 파싱에는 글로 남고 직렬화하면 REVIVE:<json> 이 된다 · REVIVE:<json> 그 파싱에서 요소로 살아난다
// GROW 파싱할 때마다 새 요소가 붙어 고정점이 없다 · LATE:<json> 문서 CSP 가 들어간 뒤에만 살아난다.
function parse(text) {
  const raw = String(text);
  const doctype = raw.startsWith("<!doctype html>\n");
  const doc = new Document(doctype);
  const hasCsp = raw.includes("Content-Security-Policy");
  const build = (j) => {
    if (j.text !== undefined) return new Text(j.text);
    const style = j.t === "style" ? (j.c[0]?.text ?? "") : "";
    if (style.startsWith("REVIVE:")) return build(JSON.parse(style.slice(7)));
    if (style.startsWith("HIDE:")) {
      const hidden = new Element("style");
      hidden.appendChild(new Text("REVIVE:" + style.slice(5)));
      return hidden;
    }
    if (style.startsWith("LATE:") && hasCsp) return build(JSON.parse(style.slice(5)));
    const el = j.t === "template" ? new HTMLTemplateElement(j.a) : new Element(j.t, j.a);
    for (const child of j.c) el.appendChild(build(child));
    if (style === "GROW") el.appendChild(new Text(String(Math.random())));
    if (j.content) for (const child of j.content) el.content.appendChild(build(child));
    return el;
  };
  doc.appendChild(build(JSON.parse(doctype ? raw.slice(16) : raw)));
  return doc;
}
const E = (t, a = {}, c = []) => ({ t, a, c });
const T = (text) => ({ text });
const page = (head, body) => "<!doctype html>\n" + JSON.stringify(E("html", {}, [E("head", {}, head), E("body", {}, body)]));
// 결과 글 안 모든 요소(template 안 포함).
function all(json, out = []) {
  if (json.text !== undefined) return out;
  out.push(json);
  for (const c of json.c) all(c, out);
  for (const c of json.content ?? []) all(c, out);
  return out;
}
const result = (html) => all(JSON.parse(html.slice(16)));

describe("sandbox·주소", () => {
  test("HTML 미리보기 sandbox 는 allow-same-origin 하나뿐이다(allow-scripts·allow-popups·top-navigation·forms 없음)", () => {
    expect(SANDBOX.split(/\s+/)).toEqual(["allow-same-origin"]);
    for (const name of ["meetings", "backend", "preview_frame", "meetings_canvas", "meetings_edit", "vault_tree", "tab"]) {
      const code = read(`web/tabs/meetings/${name}.js`).split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
      expect({ name, widen: /allow-(popups|scripts|top-navigation|forms|modals)/.test(code) }).toEqual({ name, widen: false });
    }
    expect(read("web/tabs/meetings/meetings.js")).not.toContain('setAttribute("sandbox"');
  });

  test("HTML 은 srcdoc 으로 넣고 blob·src 를 쓰지 않는다. sandbox 를 srcdoc 보다 먼저 붙이고, load 때 링크 처리기를 붙인다", () => {
    const log = [];
    const doc = {
      createElement(tag) {
        const node = { tag, style: {}, attrs: {}, setAttribute(n, v) { this.attrs[n] = v; log.push(["attr", n]); } };
        return new Proxy(node, { set(t, k, v) { if (k === "src" || k === "srcdoc") log.push([k]); t[k] = v; return true; } });
      },
    };
    const framed = [];
    const node = previewNode(doc, "html", "<!doctype html>…", "조사.html", { onFrame: (f) => framed.push(f) });
    expect([node.tag, node.attrs.sandbox, node.srcdoc, node.src]).toEqual(["iframe", SANDBOX, "<!doctype html>…", undefined]);
    expect(log).toEqual([["attr", "sandbox"], ["srcdoc"]]);
    node.onload();
    expect(framed).toEqual([node]);
    const screen = read("web/tabs/meetings/meetings.js");
    expect(screen).not.toMatch(/text\/html[^"]*"\s*\}\)/); // text/html Blob 을 만들지 않는다
    expect(screen).toContain('sanitizeHtml(await blob.text(), (text) => parser.parseFromString(text, "text/html"), domAdapter(window))');
  });

  test("SVG·그림은 data: 주소 <img>(blob 주소 없음), PDF 만 blob 주소 iframe(sandbox 없음, 바꾸거나 닫을 때 거둠)", () => {
    const make = (tag) => ({ tag, style: {}, attrs: {}, setAttribute(n, v) { this.attrs[n] = v; } });
    const doc = { createElement: make };
    const img = previewNode(doc, "image", "data:image/svg+xml;base64,PHN2Zy8+", "그림.svg");
    expect([img.tag, img.src, img.alt, img.attrs.sandbox]).toEqual(["img", "data:image/svg+xml;base64,PHN2Zy8+", "그림.svg", undefined]);
    const pdf = previewNode(doc, "pdf", "blob:x/3", "한 쪽.pdf");
    expect([pdf.tag, pdf.src, pdf.attrs.sandbox, pdf.srcdoc]).toEqual(["iframe", "blob:x/3", undefined, undefined]);
    const screen = read("web/tabs/meetings/meetings.js");
    expect(screen).toContain("source = await readDataUrl(blob);");
    expect(screen.match(/URL\.createObjectURL/g)).toEqual(["URL.createObjectURL"]); // PDF 하나뿐
    expect(screen).toContain('previewKey = ""; setPreviewUrl("");');
    expect([".md", ".TXT", ".html", ".htm", ".svg", ".png", ".JPG", ".pdf", ".json"].map(previewKind))
      .toEqual(["text", "text", "html", "html", "image", "image", "image", "pdf", "none"]);
  });
});

describe("정제(sanitizeHtml): 진짜 href·다른 문서·실행이 남지 않는다", () => {
  const RISKY = page(
    [E("base", { href: "https://evil.example/", target: "_blank" }), E("meta", { "http-equiv": " Refresh ", content: "0;url=https://x" }),
      E("meta", { charset: "utf-8" }), E("link", { rel: "stylesheet", href: "https://fonts.example/a.css" }),
      E("script", { src: "/tabs/meetings/meetings.js", type: "module" }), E("style", {}, [T("a{color:red}")])],
    [E("a", { href: "#end", target: "_blank", onclick: "x()" }, [T("앵커")]),
      E("a", { name: "앵커만" }),
      E("area", { href: "https://example.com/", ping: "https://track.example/" }),
      E("svg", {}, [E("a", { "xlink:href": "https://svg.example/" }, [T("svg 링크")])]),
      E("p", { [LINK_ATTR]: "javascript:alert(1)", onmouseover: "y()" }, [T("링크 아닌 요소의 위조 표시")]),
      E("iframe", { srcdoc: page([], [E("a", { href: "https://nested.example/" })]) }),
      E("frame", { src: "https://f.example/" }), E("object", { data: "x.swf" }), E("embed", { src: "y" }),
      E("form", { action: "/probe", target: "_blank" }, [E("button", { formtarget: "_top", formaction: "/p" })]),
      E("template", { shadowrootmode: "closed" }, []),
      E("math", { href: "https://math.example/" }),
      E("img", { src: "그림.png", onerror: "z()" })]);

  test("DROP 요소·meta refresh·on*·target·formtarget·srcdoc·ping·href·xlink:href 를 지우고 링크 주소는 LINK_ATTR 로 옮긴다", () => {
    const { html, error } = sanitizeHtml(RISKY, parse, dom);
    expect(error).toBeUndefined();
    const els = result(html);
    const tags = els.map((e) => e.t);
    for (const tag of ["base", "script", "link", "iframe", "frame", "object", "embed"]) expect({ tag, left: tags.includes(tag) }).toEqual({ tag, left: false });
    expect(els.filter((e) => e.t === "meta" && /refresh/i.test(e.a["http-equiv"] ?? ""))).toEqual([]);
    for (const e of els) {
      for (const name of Object.keys(e.a)) {
        expect({ tag: e.t, name, bad: /^on|^(href|xlink:href|target|formtarget|srcdoc|ping)$/i.test(name) }).toEqual({ tag: e.t, name, bad: false });
      }
    }
    const links = els.filter((e) => e.a[LINK_ATTR] !== undefined);
    expect(links.map((e) => [e.t, e.a[LINK_ATTR], e.a.tabindex])).toEqual([
      ["a", "#end", "0"], ["area", "https://example.com/", "0"], ["a", "https://svg.example/", "0"],
    ]);
    expect(els.find((e) => e.t === "p").a).toEqual({}); // 링크 아닌 요소의 위조 LINK_ATTR 는 지운다
    expect(els.find((e) => e.t === "template").a.shadowrootmode).toBe("open");
    expect(els.find((e) => e.t === "img").a).toEqual({ src: "그림.png" });
    // head 맨 앞에 문서 CSP, 그다음 링크 모양(:where 로 특이도 0)
    const head = JSON.parse(html.slice(16)).c[0].c;
    expect([head[0].a, head[1].c[0].text]).toEqual([{ "http-equiv": "Content-Security-Policy", content: DOC_CSP }, LINK_STYLE]);
    for (const rule of LINK_STYLE.split("}").filter(Boolean)) expect(rule.startsWith(":where(")).toBe(true); // 선택자 전체가 :where()
    expect(DOC_CSP).toContain("default-src 'none'");
    expect(DOC_CSP).not.toMatch(/https?:|'self'/);
    expect(leftovers(parse(html), dom)).toBe(0);
  });

  test("mXSS: 첫 파싱에 안 보이던 <a href>(form 중첩 + math mglyph style 꼴)가 왕복 뒤 살아나도 고정점까지 다시 정제한다", () => {
    const hidden = E("a", { href: "https://example.org/mx", target: "_blank" }, [T("MXSS 링크")]);
    const input = page([], [E("form", { id: "a" }, [E("math", {}, [E("mtext", {}, [])])]), E("form", {}, [E("mglyph", {}, [E("style", {}, [T("HIDE:" + JSON.stringify(hidden))])])])]);
    expect(leftovers(parse(input), dom)).toBe(0); // 첫 파싱에는 링크가 글 속에 숨어 있다
    expect(leftovers(parse(dom.serialize(parse(input))), dom)).toBe(2); // 한 번 왕복하면 href·target 이 살아난다
    const { html, error } = sanitizeHtml(input, parse, dom);
    expect(error).toBeUndefined();
    const mx = result(html).find((e) => e.c.some((c) => c.text === "MXSS 링크"));
    expect(mx.a).toEqual({ [LINK_ATTR]: "https://example.org/mx", tabindex: "0" });
  });

  test("결과가 바뀌기를 멈추지 않으면(MAX_ROUNDS) 띄우지 않는다", () => {
    expect(MAX_ROUNDS).toBeGreaterThanOrEqual(3);
    expect(sanitizeHtml(page([], [E("style", {}, [T("GROW")])]), parse, dom)).toEqual({ error: UNSAFE });
  });

  test("마지막 글을 다시 파싱해 남은 것이 있으면 띄우지 않는다", () => {
    const late = E("a", { href: "https://late.example/" });
    expect(sanitizeHtml(page([], [E("style", {}, [T("LATE:" + JSON.stringify(late))])]), parse, dom)).toEqual({ error: UNSAFE });
  });

  test("SVG SMIL(set·animate·animateMotion·animateTransform·discard)은 지운다: 정제 뒤에 <a> href 를 만들어 내지 못하게", () => {
    const smil = ["set", "animate", "animateMotion", "animateTransform", "discard"].map((tag) => E(tag, { attributeName: "href", to: "https://smil.example/", begin: "0s" }));
    const input = page([], [E("svg", {}, [E("a", { [LINK_ATTR]: "#x" }, [E("text", {}, [T("SMIL 링크")]), ...smil])])]);
    const { html, error } = sanitizeHtml(input, parse, dom);
    expect(error).toBeUndefined();
    expect(html).not.toContain("smil.example");
    expect(result(html).map((e) => e.t)).toEqual(["html", "head", "meta", "style", "body", "svg", "a", "text"]);
  });

  test("중첩 iframe srcdoc 안 링크는 iframe 째 사라진다(안쪽은 정제·처리기가 닿지 않는다)", () => {
    const input = page([], [E("p", {}, [T("앞")]), E("iframe", { srcdoc: page([], [E("a", { href: "https://inner.example/" })]) })]);
    const { html } = sanitizeHtml(input, parse, dom);
    expect(html).not.toContain("inner.example");
    expect(result(html).map((e) => e.t)).toEqual(["html", "head", "meta", "style", "body", "p"]);
  });

  test("form 이름 덮어쓰기(name=removeAttribute·attributes·localName)에 흔들리지 않는다(원형 메서드로 만진다)", () => {
    const doc = parse(page([], [E("form", {}, [E("a", { href: "https://clobber.example/" })])]));
    const form = doc.documentElement._kids[1]._kids[0];
    for (const name of ["removeAttribute", "getAttributeNames", "getAttribute", "setAttribute", "localName", "childNodes", "remove", "attributes"]) {
      Object.defineProperty(form, name, { value: "덮어씀", configurable: true });
    }
    Element.prototype.setAttribute.call(form, "target", "_blank");
    Object.defineProperty(doc, "documentElement", { value: "덮어씀" });
    expect(leftovers(doc, dom)).toBe(2);
    const { html, error } = sanitizeHtml(dom.serialize(doc), parse, dom);
    expect(error).toBeUndefined();
    expect(html).not.toContain("_blank");
    expect(result(html).find((e) => e.t === "a").a).toEqual({ [LINK_ATTR]: "https://clobber.example/", tabindex: "0" });
    const code = read("web/tabs/meetings/preview_frame.js");
    expect(code).toContain("E.removeAttribute.call(el, name)");
    expect(code).toContain("E.getAttributeNames.call(el)");
  });
});

describe("링크 처리(부모)", () => {
  const link = (attrs, tag = "a") => ({ nodeType: 1, localName: tag, getAttribute: (n) => (n in attrs ? attrs[n] : null) });
  const run = (type, path, extra = {}) => {
    const calls = [];
    const actions = { scrollTo: (id) => calls.push(["scroll", id]), openExternal: (h) => calls.push(["open", h]), note: (t) => calls.push(["note", t]) };
    const event = { type, button: 0, ...extra, composedPath: () => path, prevented: false, preventDefault() { this.prevented = true; } };
    return [handleLink(event, actions), event.prevented, calls.map((c) => c.slice(0, 2))];
  };

  test("링크 종류: #앵커는 스크롤, 바깥 http·https·mailto·// 는 새 탭, 상대 경로·javascript:·blob:·data: 는 막는다", () => {
    expect(linkKind("#목차")).toEqual({ kind: "anchor", id: "목차" });
    expect(linkKind("")).toEqual({ kind: "anchor", id: "" });
    for (const href of ["https://example.com/a", " HTTP://x", "mailto:a@b.c", "//cdn.example.com/x"]) expect(linkKind(href).kind).toBe("external");
    for (const href of ["java\tscript:alert(1)", "blob:http://127.0.0.1/x", "data:text/html,x", "../밖.html", "a.pdf"]) {
      expect({ href, kind: linkKind(href).kind }).toEqual({ href, kind: "blocked" });
    }
  });

  test("정제로 옮긴 LINK_ATTR 를 읽고, composedPath(안쪽부터)로 shadow DOM 안 링크도 찾는다", () => {
    const text = { nodeType: 3 };
    const inShadow = link({ [LINK_ATTR]: "https://shadow.example/" });
    const host = { nodeType: 1, localName: "div", getAttribute: () => null };
    expect(run("click", [text, inShadow, host])).toEqual(["external", true, [["open", "https://shadow.example/"]]]);
    expect(run("click", [link({ [LINK_ATTR]: "#end" })])).toEqual(["anchor", true, [["scroll", "end"]]]);
    expect(run("click", [link({ [LINK_ATTR]: "javascript:alert(1)" }, "area")])[0]).toBe("blocked");
    expect(findLink({ composedPath: () => [host] })).toBe(null);
    expect(findLink({})).toBe(null);
  });

  test("가운데 클릭·Enter 도 같은 처리, 오른쪽 클릭·다른 키·링크 아닌 곳은 건드리지 않는다", () => {
    const ext = [link({ [LINK_ATTR]: "https://example.com" })];
    expect(run("auxclick", ext, { button: 1 }).slice(0, 2)).toEqual(["external", true]);
    expect(run("auxclick", ext, { button: 2 }).slice(0, 2)).toEqual([null, false]);
    expect(run("keydown", ext, { key: "Enter" }).slice(0, 2)).toEqual(["external", true]);
    expect(run("keydown", ext, { key: "a" }).slice(0, 2)).toEqual([null, false]);
    expect(run("click", [{ nodeType: 1, localName: "p", getAttribute: () => null }]).slice(0, 2)).toEqual([null, false]);
  });

  test("화면은 문서 쪽 이름 덮어쓰기에 흔들리지 않게 원형 메서드로 처리기를 붙이고, 바깥 링크는 noopener·noreferrer 새 탭", () => {
    const screen = read("web/tabs/meetings/meetings.js");
    expect(screen).toContain("EventTarget.prototype.addEventListener.call(inner, type, (event) => handleLink(event, actions), true)");
    expect(screen).toContain('for (const type of ["click", "auxclick", "keydown"])');
    expect(screen).toContain('window.open(new URL(href, location.href).href, "_blank", "noopener,noreferrer")');
  });
});

test("없는 파일만 '없음'(null)이고, 이름 거절·코드 실수의 TypeError 는 삼키지 않는다", async () => {
  const dir = (error) => ({ async getFileHandle() { throw error; }, async getDirectoryHandle() { throw error; } });
  const notFound = Object.assign(new Error("x"), { name: "NotFoundError" });
  expect(await fileIn(dir(notFound), "a.md")).toBe(null);
  expect(await childDir(dir(notFound), ["a"])).toBe(null);
  await expect(fileIn(dir(new TypeError("Name is not allowed.")), "a.md")).rejects.toThrow("Name is not allowed.");
  await expect(childDir(dir(new TypeError("x is not a function")), ["a"])).rejects.toThrow("not a function");
  for (const name of ["", ".", "..", "a/b", "a\\b", "a\0"]) expect(await fileIn(dir(new TypeError("불리면 안 된다")), name)).toBe(null);
  const { reason } = await import("../../../web/tabs/meetings/backend.js");
  expect(reason(new TypeError("Name is not allowed."))).toContain("받지 않는 파일 이름");
  expect(reason(new TypeError("x.name is not a function"))).toBe("TypeError: x.name is not a function");
});
