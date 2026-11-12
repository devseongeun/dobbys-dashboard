// 의사결정 문서 뷰어 규칙(doc_frame.js)과 view.html 의 sandbox 확인.
// 문서 안 스크립트가 부모 출처(IndexedDB·비밀값)에 닿지 않도록 allow-scripts 를 주지 않는다는 것을 여기서 막는다.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SANDBOX, docName, imageName, linkKind, sameFolderName } from "../../../web/tabs/assets/doc_frame.js";
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

  test("allow-scripts 는 없고, 폼·위쪽 창 이동·모달도 주지 않는다", () => {
    const set = new Set(tokens(SANDBOX));
    for (const banned of ["allow-scripts", "allow-forms", "allow-top-navigation", "allow-top-navigation-by-user-activation", "allow-modals", "allow-downloads"]) {
      expect(set.has(banned)).toBe(false);
    }
    expect(set.has("allow-same-origin") && set.has("allow-scripts")).toBe(false);
  });
});

describe("문서 이름(로컬판 assets_serve._resolve 와 같은 규칙)", () => {
  test("폴더 바로 아래, 숨김이 아닌 .html 만 연다", () => {
    expect(docName("TRB_4.0.0_결재_정책.html")).toBe(true);
    for (const name of ["", ".숨김.html", "부속/a.html", "..\\a.html", "a.HTML", "a.pdf", "00_목록.md"]) expect(docName(name)).toBe(false);
  });
});

describe("문서 안 링크", () => {
  test("#앵커는 그대로, http·https·mailto·// 는 새 탭", () => {
    expect(linkKind("#detail")).toEqual({ kind: "anchor" });
    expect(linkKind("")).toEqual({ kind: "anchor" });
    for (const href of ["https://example.com/a", "HTTP://x", "mailto:a@b.c", "//cdn.example.com/x", " https://x"]) expect(linkKind(href).kind).toBe("external");
  });

  test("같은 폴더 HTML 은 뷰어로(./·%인코딩·쿼리·#조각 허용)", () => {
    expect(linkKind("DEMO_1.0.0_PG사_문의.html")).toEqual({ kind: "doc", file: "DEMO_1.0.0_PG사_문의.html" });
    expect(linkKind("./a%20b.html#sec")).toEqual({ kind: "doc", file: "a b.html" });
    expect(linkKind("a.html?x=1")).toEqual({ kind: "doc", file: "a.html" });
  });

  test("하위·상위 폴더, 숨김, 다른 형식, javascript:·data:·file: 은 막는다", () => {
    for (const href of ["부속/메모.html", "../a.html", ".숨김.html", "그림.png", "a.pdf", "javascript:alert(1)", "java\tscript:alert(1)", "data:text/html,x", "file:///etc/hosts", "%E0%A4%A.html"]) {
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
