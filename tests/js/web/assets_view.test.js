// 의사결정 문서 뷰어 규칙(doc_frame.js)과 view.html 의 sandbox 확인.
// 문서 안 스크립트가 부모 출처(IndexedDB·비밀값)에 닿지 않도록 allow-scripts 를 주지 않는다는 것을 여기서 막는다.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SANDBOX, blockedNotice, docName, findLink, handleLink, imageName, isExternalUrl, linkKind, sameFolderName,
} from "../../../web/tabs/assets/doc_frame.js";
import { REPO } from "./support.js";

const VIEW = readFileSync(join(REPO, "web/tabs/assets/view.html"), "utf-8");
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
});

describe("막힘 안내", () => {
  test("스크립트·바깥 그림·스타일시트와 글꼴을 함께 알린다, 없으면 빈 문구", () => {
    expect(blockedNotice({})).toBe("");
    const text = blockedNotice({ scripts: 3, handlers: 1, images: 2, styles: 1 });
    for (const part of ["스크립트 3개", "이벤트 속성 1곳", "그림 2개", "스타일시트·글꼴 1개", "원본을 내려받아"]) expect(text).toContain(part);
    expect(blockedNotice({ images: 1 })).toContain("그림 1개");
  });

  test("바깥 주소 판별", () => {
    for (const v of ["https://x/a.png", "//cdn/x.css", "HTTP://x"]) expect(isExternalUrl(v)).toBe(true);
    for (const v of ["a.png", "./a.png", "data:image/png;base64,AA", "blob:http://x/1", "#x"]) expect(isExternalUrl(v)).toBe(false);
  });
});
