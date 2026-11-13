// 의사결정 문서 뷰어 규칙(doc_frame.js)과 view.html 의 sandbox 확인.
// 문서 안 스크립트가 부모 출처(IndexedDB·비밀값)에 닿지 않도록 allow-scripts 를 주지 않는다는 것을 여기서 막는다.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DOC_CSP, LINK_ATTR, LINK_STYLE, SANDBOX, blockedNotice, cleanDoc, decorate, docName, findLink, findLinkInPath, handleLink, imageName,
  isExternalUrl, leftovers, linkKind, sameFolderName, sanitize,
} from "../../../web/tabs/assets/doc_frame.js";
import { REPO } from "./support.js";

const VIEW = readFileSync(join(REPO, "web/tabs/assets/view.html"), "utf-8");
const VIEW_JS = readFileSync(join(REPO, "web/tabs/assets/view.js"), "utf-8");
const code = (text) => text.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
const tokens = (value) => value.trim().split(/\s+/).sort();

describe("sandbox", () => {
  test("view.html iframe 의 sandbox 는 doc_frame.js SANDBOX 와 같다", () => {
    const iframes = [...VIEW.matchAll(/<iframe\b[^>]*>/g)].map((m) => m[0]);
    expect(iframes.length).toBe(1);
    const attr = iframes[0].match(/\bsandbox="([^"]*)"/);
    expect(attr).not.toBeNull();
    expect(tokens(attr[1])).toEqual(tokens(SANDBOX));
  });

  test("allow-same-origin 하나만: 스크립트·새 창(popup)·sandbox 밖 popup·폼·위쪽 창 이동·모달을 주지 않는다", () => {
    expect(tokens(SANDBOX)).toEqual(["allow-same-origin"]);
    const set = new Set(tokens(SANDBOX));
    for (const banned of ["allow-scripts", "allow-popups", "allow-popups-to-escape-sandbox", "allow-forms", "allow-top-navigation",
      "allow-top-navigation-by-user-activation", "allow-modals", "allow-downloads"]) {
      expect(set.has(banned)).toBe(false);
    }
  });
});

describe("srcdoc 으로 띄운다(문서용 blob: 주소 없음)", () => {
  test("view.js 는 문서를 iframe.srcdoc 으로 넣고 src·text/html blob 을 쓰지 않는다, sandbox 를 srcdoc 보다 먼저 붙인다", () => {
    const js = code(VIEW_JS);
    expect(js).toContain("fresh.srcdoc = html");
    expect(js).not.toMatch(/\.src\s*=(?!=)/);
    expect(js).not.toContain("revokeObjectURL(docUrl");
    // createObjectURL 은 내려받기(octet-stream) 한 곳뿐
    expect([...js.matchAll(/createObjectURL\(/g)].length).toBe(1);
    expect([...js.matchAll(/blobUrl\(\[[^\]]*\], "([^"]+)"\)/g)].map((m) => m[1])).toEqual(["application/octet-stream", "application/octet-stream"]);
    const sandboxAt = js.indexOf('fresh.setAttribute("sandbox", SANDBOX)');
    expect(sandboxAt).toBeGreaterThan(-1);
    expect(sandboxAt).toBeLessThan(js.indexOf("fresh.srcdoc = html"));
    expect(js.indexOf("fresh.srcdoc = html")).toBeLessThan(js.indexOf("frame.replaceWith(fresh)"));
  });

  test("view.html iframe 에 src 가 없다", () => {
    const iframe = VIEW.match(/<iframe\b[^>]*>/)[0];
    expect(iframe).not.toMatch(/\ssrc=/);
  });

  test("문서 CSP 는 네트워크 요청을 하나도 허락하지 않는다(그림·글꼴·미디어는 data: 만)", () => {
    const rules = Object.fromEntries(DOC_CSP.split(";").map((part) => part.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
    expect(rules).toEqual({
      "default-src": ["'none'"], "img-src": ["data:"], "style-src": ["'unsafe-inline'"], "font-src": ["data:"], "media-src": ["data:"],
    });
  });
});

describe("문서 이름(로컬판 assets_serve._resolve 와 같은 규칙)", () => {
  test("폴더 바로 아래, 숨김이 아닌 .html 만 연다", () => {
    expect(docName("TRB_4.0.0_결재_정책.html")).toBe(true);
    for (const name of ["", ".숨김.html", "부속/a.html", "..\\a.html", "a.HTML", "a.pdf", "00_목록.md"]) expect(docName(name)).toBe(false);
  });
});

describe("문서 안 링크", () => {
  test("#앵커는 문서 안 스크롤, http·https·mailto·// 는 새 탭", () => {
    expect(linkKind("#detail")).toEqual({ kind: "anchor", id: "detail" });
    expect(linkKind("#%EC%84%B8%EB%B6%80")).toEqual({ kind: "anchor", id: "세부" });
    expect(linkKind("")).toEqual({ kind: "anchor", id: "" });
    for (const href of ["https://example.com/a", "HTTP://x", "mailto:a@b.c", "//cdn.example.com/x", " https://x"]) expect(linkKind(href).kind).toBe("external");
  });

  test("같은 폴더 HTML 은 뷰어로(./·%인코딩·쿼리·#조각 허용)", () => {
    expect(linkKind("DEMO_1.0.0_PG사_문의.html")).toEqual({ kind: "doc", file: "DEMO_1.0.0_PG사_문의.html" });
    expect(linkKind("./a%20b.html#sec")).toEqual({ kind: "doc", file: "a b.html" });
    expect(linkKind("a.html?x=1")).toEqual({ kind: "doc", file: "a.html" });
  });

  test("같은 폴더 pdf·그림·json 은 내려받기(로컬판은 서버가 그대로 줬다)", () => {
    expect(linkKind("회의록.pdf")).toEqual({ kind: "file", file: "회의록.pdf" });
    expect(linkKind("./그림.SVG")).toEqual({ kind: "file", file: "그림.SVG" });
  });

  test("하위·상위 폴더, 숨김, 다른 형식, javascript:·data:·file: 은 막는다", () => {
    for (const href of ["부속/메모.html", "../a.html", ".숨김.html", ".a.pdf", "a.docx", "javascript:alert(1)", "java\tscript:alert(1)", "data:text/html,x", "file:///etc/hosts", "%E0%A4%A.html"]) {
      expect(linkKind(href).kind).toBe("blocked");
    }
  });

  test("같은 폴더 이름 풀기", () => {
    expect(sameFolderName("./%EA%B7%B8%EB%A6%BC.svg?v=2")).toBe("그림.svg");
    expect(sameFolderName("a/b.svg")).toBeNull();
    expect(sameFolderName("..")).toBeNull();
  });
});

describe("문서 안 그림", () => {
  test("같은 폴더 그림만 바꿔 넣는다", () => {
    expect(imageName("결재선.svg")).toBe("결재선.svg");
    expect(imageName("./a.PNG")).toBe("a.PNG");
    for (const src of ["https://x/a.png", "//x/a.png", "data:image/png;base64,AA", "부속/a.png", ".a.png", "a.html", "a"]) expect(imageName(src)).toBeNull();
  });
});

// 문서 iframe 안 노드 흉내: localName·nodeType·parentNode·getAttribute(NS).
const XLINK = "http://www.w3.org/1999/xlink";

// 정제용 작은 가짜 DOM. doc_frame.js 는 DOM 을 원형 메서드·getter 로만 다루므로(safeCall·safeGet) 메서드를 클래스에 둔다.
// querySelectorAll("*")(문서 순서, template 안은 보지 않음)·속성(이름공간 포함)·remove·prepend·template.content.
// 글로 만들기(outerHTML)는 JSON 이고, 다시 파싱(fakeParse)할 수 있다.
class FakeNode {
  constructor(tag, attrs = {}, children = [], { xlink = {}, text = "" } = {}) {
    this._tag = tag;
    this._text = text;
    this._parent = null;
    this.children = [];
    this.attrList = [
      ...Object.entries(attrs).map(([name, value]) => ({ ns: null, name, local: name, value })),
      ...Object.entries(xlink).map(([local, value]) => ({ ns: XLINK, name: `xlink:${local}`, local, value })),
    ];
    if (tag === "template") {
      this._content = new FakeNode("#fragment", {}, children);
    } else {
      children.forEach((child) => { child._parent = this; this.children.push(child); });
    }
  }
  get nodeType() { return this._tag === "#document" ? 9 : this._tag === "#fragment" ? 11 : 1; }
  get localName() { return this._tag; }
  get content() { return this._content ?? null; }
  get textContent() { return this._text; }
  set textContent(value) { this._text = String(value); }
  get head() { return this.querySelectorAll("*").find((el) => el._tag === "head"); }
  get documentElement() { return this.children[0]; }
  get doctype() { return null; }
  get outerHTML() { return JSON.stringify(toJson(this)); }
  getAttribute(name) { return this.attrList.find((a) => a.name === name)?.value ?? null; }
  getAttributeNS(ns, local) { return this.attrList.find((a) => a.ns === ns && a.local === local)?.value ?? null; }
  getAttributeNames() { return this.attrList.map((a) => a.name); }
  hasAttribute(name) { return this.attrList.some((a) => a.name === name); }
  setAttribute(name, value) {
    const found = this.attrList.find((a) => a.name === name);
    if (found) found.value = String(value);
    else this.attrList.push({ ns: null, name, local: name, value: String(value) });
  }
  removeAttribute(name) { this.attrList = this.attrList.filter((a) => a.name !== name); }
  removeAttributeNS(ns, local) { this.attrList = this.attrList.filter((a) => !(a.ns === ns && a.local === local)); }
  remove() { if (this._parent) this._parent.children = this._parent.children.filter((c) => c !== this); this._parent = null; }
  prepend(...nodes) { nodes.forEach((n) => { n._parent = this; }); this.children.unshift(...nodes); }
  createElement(tag) { return new FakeNode(tag); }
  querySelectorAll(selector) {
    expect(selector).toBe("*");
    const out = [];
    const walk = (node) => node.children.forEach((child) => { out.push(child); walk(child); });
    walk(this);
    return out;
  }
}
const fakeEl = (...args) => new FakeNode(...args);
function fakeDoc(headChildren, bodyChildren) {
  return new FakeNode("#document", {}, [new FakeNode("html", {}, [new FakeNode("head", {}, headChildren), new FakeNode("body", {}, bodyChildren)])]);
}
function toJson(node) {
  return { t: node._tag, a: node.attrList.map(({ ns, name, local, value }) => [ns, name, local, value]), x: node._text,
    c: (node._content ?? node).children.map(toJson) };
}
// 가짜 파서. 실제 HTML 파서처럼 '파싱 → 글 → 파싱' 이 같은 트리를 주지 않는 경우를 흉내 낸다:
// 원본 글의 <style> 이 "MXSS1:" + 요소 JSON 이면 첫 파싱에서는 글("MXSS:" + JSON)로 남고, 그 글을 다시 파싱하면 그 자리에
// 진짜 요소로 살아난다(중첩 form + MathML <style> mXSS 흉내).
function fakeParse(text) {
  const build = (j, revive) => {
    if (revive && j.t === "style" && j.x.startsWith("MXSS:")) return build(JSON.parse(j.x.slice(5)), false);
    if (j.t === "style" && j.x.startsWith("MXSS1:")) return new FakeNode("style", {}, [], { text: "MXSS:" + j.x.slice(6) });
    const node = new FakeNode(j.t, {}, j.t === "template" ? [] : j.c.map((c) => build(c, revive)), { text: j.x });
    node.attrList = j.a.map(([ns, name, local, value]) => ({ ns, name, local, value }));
    if (j.t === "template") node._content = new FakeNode("#fragment", {}, j.c.map((c) => build(c, revive)));
    return node;
  };
  const html = build(JSON.parse(text), true);
  const doc = new FakeNode("#document");
  html._parent = doc;
  doc.children.push(html);
  return doc;
}
const docText = (doc) => doc.documentElement.outerHTML;
// 문서와 template 안까지 모든 요소.
function everything(root) {
  const out = [];
  for (const el of root.querySelectorAll("*")) {
    out.push(el);
    if (el.content) out.push(...everything(el.content));
  }
  return out;
}
function node(localName, attrs = {}, parent = null, xlink = {}) {
  return {
    nodeType: 1, localName, parentNode: parent,
    getAttribute: (name) => (Object.hasOwn(attrs, name) ? attrs[name] : null),
    getAttributeNS: (ns, name) => (ns === XLINK && Object.hasOwn(xlink, name) ? xlink[name] : null),
  };
}
const text = (parent) => ({ nodeType: 3, parentNode: parent });
function run(type, target, button = 0) {
  const calls = [];
  const event = { type, target, button, prevented: false, preventDefault() { this.prevented = true; } };
  const actions = Object.fromEntries(["scrollTo", "openExternal", "openDoc", "openFile", "note"].map((k) => [k, (v) => calls.push([k, v])]));
  const kind = handleLink(event, actions);
  return { kind, prevented: event.prevented, calls };
}

describe("문서 안 링크 가로채기(handleLink)", () => {
  test("a·area·SVG a(href·xlink:href)를 찾는다, 링크 안 글자·자식에서 눌러도 찾는다", () => {
    const a = node("a", { href: "#x", target: "_blank" });
    expect(findLink(text(node("b", {}, a))).href).toBe("#x");
    expect(findLink(node("area", { href: "https://x" })).href).toBe("https://x");
    expect(findLink(node("a", {}, null, { href: "#svg" })).href).toBe("#svg");
    expect(findLink(node("a", { href: "b.html" }, null, { href: "#svg" })).href).toBe("b.html");
    expect(findLink(node("a", {}))).toBeNull();  // href 없는 a 는 링크가 아니다
    expect(findLink(node("div", { href: "x" }))).toBeNull();
  });

  test("target 달린 #앵커도 기본 동작을 막고 부모가 스크롤만 한다(새 탭으로 나가지 않음)", () => {
    const r = run("click", node("a", { href: "#x", target: "_blank" }));
    expect([r.kind, r.prevented, r.calls]).toEqual(["anchor", true, [["scrollTo", "x"]]]);
  });

  test("바깥 링크는 막고 부모가 새 탭(noopener)으로, 같은 폴더 문서는 뷰어로, pdf 는 내려받기, 그 밖은 안내", () => {
    expect(run("click", node("area", { href: " https://example.com/a " })).calls).toEqual([["openExternal", "https://example.com/a"]]);
    expect(run("click", node("a", {}, null, { href: "다른_문서.html" })).calls).toEqual([["openDoc", "다른_문서.html"]]);
    expect(run("click", node("a", { href: "회의록.pdf" })).calls).toEqual([["openFile", "회의록.pdf"]]);
    const blocked = run("click", node("a", { href: "javascript:alert(1)", target: "w" }));
    expect([blocked.prevented, blocked.calls[0][0]]).toEqual([true, "note"]);
  });

  test("가운데 클릭(auxclick button 1)도 같은 처리, 오른쪽 클릭(button 2)은 건드리지 않는다", () => {
    const middle = run("auxclick", node("a", { href: "#x", target: "_blank" }), 1);
    expect([middle.prevented, middle.calls]).toEqual([true, [["scrollTo", "x"]]]);
    const right = run("auxclick", node("a", { href: "#x" }), 2);
    expect([right.kind, right.prevented]).toEqual([null, false]);
  });

  test("링크가 아닌 곳의 클릭은 그대로 둔다", () => {
    expect(run("click", node("p", {})).prevented).toBe(false);
  });

  test("정제로 옮긴 LINK_ATTR 주소를 먼저 읽는다", () => {
    expect(findLink(node("a", { [LINK_ATTR]: "#y" })).href).toBe("#y");
    expect(run("click", node("a", { [LINK_ATTR]: "https://example.com" })).calls).toEqual([["openExternal", "https://example.com"]]);
  });

  test("composedPath 로 shadow DOM 안 링크를 찾는다(event.target 이 host 로 바뀌어도), parentNode 를 따라가지 않는다", () => {
    const inShadow = node("a", { [LINK_ATTR]: "https://example.com/in" });
    const host = node("div", {});
    const calls = [];
    const event = {
      type: "click", button: 0, target: host, prevented: false, preventDefault() { this.prevented = true; },
      composedPath: () => [node("span", {}, inShadow), inShadow, { nodeType: 11 }, host],
    };
    const actions = { openExternal: (v) => calls.push(v) };
    expect(handleLink(event, actions)).toBe("external");
    expect([event.prevented, calls]).toEqual([true, ["https://example.com/in"]]);
    // <form name="parentNode"> 처럼 parentNode 가 가려진 요소도 경로만 본다
    const clobbered = { nodeType: 1, localName: "form", get parentNode() { throw new Error("parentNode 를 따라가면 안 된다"); }, getAttribute: () => null };
    expect(findLinkInPath([clobbered, inShadow]).href).toBe("https://example.com/in");
  });

  test("Enter 키는 클릭과 같이 처리하고 다른 키는 건드리지 않는다", () => {
    const calls = [];
    const make = (key) => ({ type: "keydown", key, target: node("a", { [LINK_ATTR]: "#x" }), prevented: false, preventDefault() { this.prevented = true; } });
    const enter = make("Enter");
    expect(handleLink(enter, { scrollTo: (id) => calls.push(id) })).toBe("anchor");
    expect([enter.prevented, calls]).toEqual([true, ["x"]]);
    const tab = make("Tab");
    expect([handleLink(tab, {}), tab.prevented]).toEqual([null, false]);
  });
});

describe("문서 정제(cleanDoc)", () => {
  function sample() {
    return fakeDoc(
      [
        fakeEl("base", { href: "https://evil.example/", target: "_blank" }),
        fakeEl("meta", { "http-equiv": " Refresh ", content: "0;url=https://x" }),
        fakeEl("meta", { charset: "utf-8" }),
        fakeEl("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2" }),
        fakeEl("style", {}, [], { text: "@import url('https://x/a.css'); body{background:url(//cdn/x.png)}" }),
        fakeEl("script", { src: "/lib/secrets.js", type: "module" }),
      ],
      [
        fakeEl("a", { href: "#end", target: "_blank", onclick: "x()" }, [fakeEl("b")]),
        fakeEl("a", { name: "앵커" }),  // href 없는 a 는 그대로
        fakeEl("area", { href: "https://example.com/", target: "w" }),
        fakeEl("svg", {}, [fakeEl("a", {}, [], { xlink: { href: "다른_문서.html" } })]),
        fakeEl("a", { href: "회의록.pdf", tabindex: "-1" }),
        fakeEl("form", { action: "/__form_probe", target: "_blank" }, [fakeEl("button", { formtarget: "_top" })]),
        fakeEl("img", { src: "결재선.svg", onerror: "y()" }),
        fakeEl("img", { src: "https://x/a.png" }),
        fakeEl("img", { src: "부속/a.png" }),
        fakeEl("template", { shadowrootmode: "closed" }, [
          fakeEl("a", { href: "https://inside.example/", target: "_top" }),
          fakeEl("meta", { "http-equiv": "refresh", content: "0" }),
          fakeEl("script", {}),
        ]),
        fakeEl("script", {}, [], { text: "alert(1)" }),
      ],
    );
  }

  test("실제 href·xlink:href·target·formtarget·on* 가 문서 어디에도(template 안 포함) 남지 않고, 링크 주소는 LINK_ATTR 로 옮긴다", () => {
    const doc = sample();
    cleanDoc(doc);
    const all = everything(doc);
    for (const el of all) {
      const names = el.attrList.map((a) => a.name);
      expect({ tag: el.localName, bad: names.filter((n) => ["target", "formtarget", "xlink:href"].includes(n) || /^on/i.test(n)) }).toEqual({ tag: el.localName, bad: [] });
      if (el.localName === "a" || el.localName === "area") expect(el.getAttribute("href")).toBeNull();
    }
    const links = all.filter((el) => el.hasAttribute(LINK_ATTR)).map((el) => [el.localName, el.getAttribute(LINK_ATTR), el.getAttribute("tabindex")]);
    expect(links).toEqual([
      ["a", "#end", "0"], ["area", "https://example.com/", "0"], ["a", "다른_문서.html", "0"], ["a", "회의록.pdf", "-1"], ["a", "https://inside.example/", "0"],
    ]);
  });

  test("<base>·<script>·meta refresh 는 지운다(template 안도), 선언적 shadow DOM 은 open 으로", () => {
    const doc = sample();
    cleanDoc(doc);
    const tags = everything(doc).map((el) => el.localName);
    expect(tags).not.toContain("base");
    expect(tags).not.toContain("script");
    expect(everything(doc).filter((el) => el.localName === "meta").map((el) => el.getAttribute("http-equiv") ?? el.getAttribute("charset"))).toEqual(["utf-8"]);
    expect(everything(doc).find((el) => el.localName === "template").getAttribute("shadowrootmode")).toBe("open");
  });

  test("다른 문서를 품는 iframe·frame·object·embed 는 지우고, 어느 요소든 srcdoc 속성은 지운다(중첩 iframe srcdoc 안은 정제·처리기가 닿지 않는다)", () => {
    const doc = fakeDoc([], [
      fakeEl("iframe", { srcdoc: "<a href=https://example.org/nested>n</a>" }),
      fakeEl("frame", { src: "x.html" }),
      fakeEl("object", { data: "x.html" }, [fakeEl("embed", { src: "x.html" })]),
      fakeEl("div", { srcdoc: "x", SrcDoc: "y" }),
      fakeEl("template", { shadowrootmode: "open" }, [fakeEl("iframe", { srcdoc: "<a href=x>" })]),
    ]);
    cleanDoc(doc);
    expect(everything(doc).map((el) => [el.localName, el.getAttributeNames()])).toEqual([["html", []], ["head", []], ["body", []], ["div", []], ["template", ["shadowrootmode"]]]);
    expect(leftovers(doc)).toEqual([]);
  });

  test("SVG 애니메이션(set·animate 류·discard)은 지운다: 정제 뒤에 링크의 href 를 다시 만들 수 있다", () => {
    const doc = fakeDoc([], [fakeEl("svg", {}, [
      fakeEl("a", {}, [
        fakeEl("set", { attributeName: "href", to: "https://example.org/smil" }),
        fakeEl("animate", { attributeName: "href", values: "https://example.org/a" }),
        fakeEl("text", {}, [], { text: "SMIL" }),
      ]),
      fakeEl("animateMotion", {}), fakeEl("animateTransform", {}), fakeEl("discard", {}),
    ])]);
    cleanDoc(doc);
    expect(everything(doc).map((el) => el.localName)).toEqual(["html", "head", "body", "svg", "a", "text"]);
    expect(leftovers(fakeDoc([], [fakeEl("svg", {}, [fakeEl("set", { attributeName: "href" })])]))).toEqual(["<set>"]);
  });

  test("문서의 DOM clobbering(form 의 removeAttribute·attributes·getAttributeNames 를 가린 이름)에 흔들리지 않는다", () => {
    const form = fakeEl("form", { onsubmit: "x()", target: "_blank" }, [fakeEl("input", { name: "removeAttribute" }), fakeEl("input", { name: "attributes" })]);
    // 실제 DOM 에서 form 의 이름 속성은 인스턴스에서 메서드를 가린다. 가짜에서도 인스턴스에 같은 이름을 둔다.
    for (const [name, value] of Object.entries({ removeAttribute: form.children[0], getAttributeNames: form.children[1], attributes: [form.children[1]], localName: "a", remove: null })) {
      Object.defineProperty(form, name, { value, configurable: true });
    }
    const doc = fakeDoc([], [form]);
    const { counts } = cleanDoc(doc);
    expect([FakeNode.prototype.getAttributeNames.call(form), counts.handlers]).toEqual([[], 1]);
  });

  test("decorate: head 맨 앞에 문서 CSP 와 링크 모양 style, shadow DOM 이 될 template 안에도 링크 모양 style", () => {
    const doc = sample();
    cleanDoc(doc);
    decorate(doc);
    const [meta, style] = doc.head.children;
    expect([meta.localName, meta.getAttribute("http-equiv"), meta.getAttribute("content")]).toEqual(["meta", "Content-Security-Policy", DOC_CSP]);
    expect([style.localName, style.textContent]).toEqual(["style", LINK_STYLE]);
    const content = everything(doc).find((el) => el.localName === "template").content;
    expect([content.children[0].localName, content.children[0].textContent]).toEqual(["style", LINK_STYLE]);
  });

  test("막히는 것의 수와 바꿔 넣을 같은 폴더 그림", () => {
    const { counts, images } = cleanDoc(sample());
    expect(counts).toEqual({ scripts: 3, handlers: 2, images: 1, styles: 3 });
    expect(images.map(({ el, name }) => [el.getAttribute("src"), name])).toEqual([["결재선.svg", "결재선.svg"]]);
  });
});

describe("고정점 정제(sanitize)와 마지막 검사(leftovers)", () => {
  // 첫 파싱 때는 <style> 글이던 링크·refresh 가 다시 파싱하면 진짜 요소가 되는 문서(mXSS 흉내).
  const hidden = (el) => fakeEl("style", {}, [], { text: "MXSS1:" + JSON.stringify(toJson(el)) });
  const mxss = () => docText(fakeDoc([hidden(fakeEl("meta", { "http-equiv": "refresh", content: "0;url=https://x" }))], [
    fakeEl("form", { id: "a" }, [fakeEl("math", {}, [hidden(fakeEl("a", { href: "https://example.org/mx", target: "_blank" }))])]),
  ]));

  test("mXSS: 한 번 정제한 글을 다시 파싱하면 진짜 <a href> 가 살아나는 문서도 되풀이 정제로 href 0 이 된다", () => {
    const once = fakeParse(mxss());
    cleanDoc(once);
    expect(leftovers(fakeParse(docText(once))).sort()).toEqual(["<a href>", "<a target>", "<meta>"]);  // 한 번만 정제하면 남는다
    const result = sanitize(mxss(), fakeParse);
    expect(result).not.toBeNull();
    expect(leftovers(fakeParse(docText(result.doc)))).toEqual([]);
    const a = everything(result.doc).find((el) => el.localName === "a");
    expect([a.getAttribute("href"), a.getAttribute(LINK_ATTR)]).toEqual([null, "https://example.org/mx"]);
  });

  test("다시 파싱해도 결과가 정해지지 않는 문서는 null(띄우지 않는다), 상한 횟수만큼만 파싱한다", () => {
    let calls = 0;
    const drifting = (text) => {
      calls += 1;
      const doc = fakeParse(text);
      doc.head.prepend(fakeEl("p", { "data-n": String(calls) }));  // 파싱할 때마다 달라진다
      return doc;
    };
    expect(sanitize(docText(fakeDoc([], [])), drifting, 4)).toBeNull();
    expect(calls).toBe(4);
  });

  test("보통 문서는 두 번째 파싱에서 멈추고 스크립트 수는 처음 것 그대로", () => {
    let calls = 0;
    const counting = (text) => { calls += 1; return fakeParse(text); };
    const result = sanitize(docText(fakeDoc([fakeEl("script", {})], [fakeEl("a", { href: "#x", onclick: "y()" })])), counting);
    expect([calls, result.counts.scripts, result.counts.handlers]).toEqual([2, 1, 1]);
  });

  test("leftovers 는 링크 href·xlink:href, iframe 류, srcdoc·target·on*, script·base·meta refresh 를 찾는다", () => {
    const doc = fakeDoc([fakeEl("base", {}), fakeEl("meta", { "http-equiv": "REFRESH" })], [
      fakeEl("a", { href: "x" }), fakeEl("svg", {}, [fakeEl("a", {}, [], { xlink: { href: "y" } })]), fakeEl("iframe", {}),
      fakeEl("div", { srcdoc: "z", onclick: "w" }), fakeEl("a", { target: "_blank" }), fakeEl("script", {}),
      fakeEl("template", {}, [fakeEl("area", { href: "q" })]),
      fakeEl("link", { rel: "stylesheet", href: "https://x/a.css" }), fakeEl("img", { src: "data:image/png;base64,AA" }),
    ]);
    expect(leftovers(doc)).toEqual(["<base>", "<meta>", "<a href>", "<a href>", "<iframe>", "<div srcdoc>", "<div onclick>", "<a target>", "<script>", "<area href>"]);
  });
});

describe("막힘 안내", () => {
  test("스크립트·바깥 그림·스타일시트와 글꼴을 함께 알린다, 없으면 빈 문구", () => {
    expect(blockedNotice({})).toBe("");
    const text = blockedNotice({ scripts: 3, handlers: 1, images: 2, styles: 1 });
    for (const part of ["스크립트 3개", "이벤트 속성 1곳", "그림 2개", "스타일시트·글꼴 1개", "원본을 내려받아"]) expect(text).toContain(part);
    expect(blockedNotice({ images: 1 })).toContain("그림 1개");
    expect(blockedNotice({ scripts: 2 })).toContain("스크립트 2개는 ");
    expect(blockedNotice({ handlers: 1 })).toContain("이 문서의 이벤트 속성 1곳은 ");
  });

  test("바깥 주소 판별", () => {
    for (const v of ["https://x/a.png", "//cdn/x.css", "HTTP://x"]) expect(isExternalUrl(v)).toBe(true);
    for (const v of ["a.png", "./a.png", "data:image/png;base64,AA", "blob:http://x/1", "#x"]) expect(isExternalUrl(v)).toBe(false);
  });
});
