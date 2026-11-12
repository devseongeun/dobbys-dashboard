// 회의 자료 미리보기 격리(preview_frame.js). Vault 의 HTML·SVG 가 이 대시보드 출처(Vault 핸들·Jira token 이 있는 곳)에서
// 스크립트를 돌릴 길을 막는다: sandbox 에 allow-scripts·allow-popups 없음, 링크는 부모가 처리, HTML·그림 blob 은 다 읽으면 거둠.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SANDBOX, findLink, handleLink, linkKind, previewKind, previewNode } from "../../../web/tabs/meetings/preview_frame.js";
import { childDir, fileIn } from "../../../web/tabs/meetings/meetings_canvas.js";
import { REPO } from "../web/support.js";

const read = (path) => readFileSync(join(REPO, path), "utf8");

test("HTML 미리보기 sandbox 는 allow-same-origin 하나뿐이다(allow-scripts·allow-popups·top-navigation·forms 없음)", () => {
  expect(SANDBOX.split(/\s+/)).toEqual(["allow-same-origin"]);
  for (const token of ["allow-scripts", "allow-popups", "allow-popups-to-escape-sandbox", "allow-top-navigation", "allow-forms", "allow-modals"]) {
    expect(SANDBOX).not.toContain(token);
  }
  // 웹 회의 자료 코드 어디에도 sandbox 를 넓히는 값이 없고, sandbox 는 preview_frame.js 의 SANDBOX 로만 붙인다.
  for (const name of ["meetings", "backend", "preview_frame", "meetings_canvas", "meetings_edit", "vault_tree", "tab"]) {
    const code = read(`web/tabs/meetings/${name}.js`).split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    expect({ name, popups: /allow-(popups|scripts|top-navigation)/.test(code) }).toEqual({ name, popups: false });
  }
  expect(read("web/tabs/meetings/meetings.js")).not.toContain('setAttribute("sandbox"');
});

test("형식별 그리는 방식: md·txt 는 글, HTML 은 sandbox iframe, SVG·그림은 <img>, PDF 는 iframe", () => {
  expect([".md", ".TXT", ".html", ".htm", ".svg", ".png", ".JPG", ".jpeg", ".gif", ".webp", ".pdf", ".json"].map(previewKind))
    .toEqual(["text", "text", "html", "html", "image", "image", "image", "image", "image", "image", "pdf", "none"]);
});

// 가짜 document: 만든 요소의 속성·순서를 남긴다.
function fakeDocument() {
  const log = [];
  return {
    log,
    createElement(tag) {
      const node = { tag, style: {}, attrs: {}, setAttribute(name, value) { this.attrs[name] = value; log.push(["attr", name]); } };
      return new Proxy(node, { set(target, key, value) { if (key === "src") log.push(["src", value]); target[key] = value; return true; } });
    },
  };
}

test("HTML: sandbox 를 src 보다 먼저 붙이고, 다 읽으면(load) blob 주소를 거둔 뒤 링크를 붙인다", () => {
  const doc = fakeDocument();
  const revoked = [];
  const framed = [];
  const node = previewNode(doc, "html", "blob:x/1", "조사.html", { revoke: (u) => revoked.push(u), onFrame: (f) => framed.push(f) });
  expect([node.tag, node.attrs.sandbox, node.src, node.title]).toEqual(["iframe", SANDBOX, "blob:x/1", "조사.html"]);
  expect(doc.log).toEqual([["attr", "sandbox"], ["src", "blob:x/1"]]);
  expect(revoked).toEqual([]);
  node.onload();
  expect(revoked).toEqual(["blob:x/1"]);
  expect(framed).toEqual([node]);
});

test("SVG·그림: <img> 로 그리고(스크립트 문맥 없음) load·error 때 blob 주소를 거둔다", () => {
  for (const event of ["onload", "onerror"]) {
    const revoked = [];
    const node = previewNode(fakeDocument(), "image", "blob:x/2", "그림.svg", { revoke: (u) => revoked.push(u) });
    expect([node.tag, node.src, node.alt, node.attrs.sandbox]).toEqual(["img", "blob:x/2", "그림.svg", undefined]);
    node[event]();
    expect(revoked).toEqual(["blob:x/2"]);
  }
});

test("PDF: 브라우저 PDF 뷰어용 iframe(sandbox 없음). 주소는 미리보기를 바꾸거나 닫을 때 화면이 거둔다", () => {
  const revoked = [];
  const node = previewNode(fakeDocument(), "pdf", "blob:x/3", "한 쪽.pdf", { revoke: (u) => revoked.push(u) });
  expect([node.tag, node.attrs.sandbox, node.onload, revoked]).toEqual(["iframe", undefined, undefined, []]);
  const screen = read("web/tabs/meetings/meetings.js");
  expect(screen).toContain('previewKey = ""; setPreviewUrl("");'); // 닫을 때
  expect(screen).toMatch(/body\.replaceChildren\(\);\n {2}setPreviewUrl\(""\);/); // 다른 파일로 바꿀 때
});

test("링크 종류: #앵커는 스크롤, 바깥 http·https·mailto·// 는 새 탭, 상대 경로·javascript: 등은 막는다", () => {
  expect(linkKind("#목차")).toEqual({ kind: "anchor", id: "목차" });
  expect(linkKind("")).toEqual({ kind: "anchor", id: "" });
  for (const href of ["https://example.com/a", " HTTP://x", "mailto:a@b.c", "//cdn.example.com/x"]) expect(linkKind(href).kind).toBe("external");
  for (const href of ["java\tscript:alert(1)", "blob:http://127.0.0.1/x", "data:text/html,x", "../밖.html", "tabs/meetings/meetings.html", "a.pdf"]) {
    expect({ href, kind: linkKind(href).kind }).toEqual({ href, kind: "blocked" });
  }
});

test("문서 안 클릭은 링크면 늘 기본 동작을 막고 부모가 처리한다(가운데 클릭 포함, 오른쪽 클릭은 그대로)", () => {
  const anchor = (href) => ({ nodeType: 1, localName: "a", getAttribute: (n) => (n === "href" ? href : null), parentNode: null });
  const svgA = { nodeType: 1, localName: "a", getAttribute: () => null, getAttributeNS: () => "https://svg.example", parentNode: null };
  const calls = [];
  const actions = { scrollTo: (id) => calls.push(["scroll", id]), openExternal: (h) => calls.push(["open", h]), note: (t) => calls.push(["note", t]) };
  const fire = (type, target, button = 0) => {
    const event = { type, target, button, prevented: false, preventDefault() { this.prevented = true; } };
    return [handleLink(event, actions), event.prevented];
  };
  const text = { nodeType: 3, parentNode: anchor("#x") };
  expect(fire("click", text)).toEqual(["anchor", true]);
  expect(fire("click", anchor(" https://example.com "))).toEqual(["external", true]);
  expect(fire("auxclick", anchor("https://example.com"), 1)).toEqual(["external", true]);
  expect(fire("auxclick", anchor("https://example.com"), 2)).toEqual([null, false]);
  expect(fire("click", svgA)).toEqual(["external", true]);
  expect(fire("click", anchor("javascript:alert(1)"))).toEqual(["blocked", true]);
  expect(fire("click", { nodeType: 1, localName: "p", getAttribute: () => null, parentNode: null })).toEqual([null, false]);
  expect(calls.map((c) => c[0])).toEqual(["scroll", "open", "open", "open", "note"]);
  expect(findLink(null)).toBe(null);
});

test("화면은 HTML 을 cleanHtml 로 고친 blob 으로만 띄우고, 바깥 링크는 noopener·noreferrer 새 탭으로 연다", () => {
  const screen = read("web/tabs/meetings/meetings.js");
  expect(screen).toContain("cleanHtml(await blob.text(), new DOMParser())");
  expect(screen).toContain('window.open(new URL(href, location.href).href, "_blank", "noopener,noreferrer")');
  expect(screen).toContain("previewNode(document, kind, previewUrl, view.name, { revoke, onFrame: wirePreviewLinks })");
});

test("없는 파일만 '없음'(null)이고, 이름 거절·코드 실수의 TypeError 는 삼키지 않는다", async () => {
  const dir = (error) => ({ async getFileHandle() { throw error; }, async getDirectoryHandle() { throw error; } });
  const notFound = Object.assign(new Error("x"), { name: "NotFoundError" });
  expect(await fileIn(dir(notFound), "a.md")).toBe(null);
  expect(await childDir(dir(notFound), ["a"])).toBe(null);
  await expect(fileIn(dir(new TypeError("Name is not allowed.")), "a.md")).rejects.toThrow("Name is not allowed.");
  await expect(childDir(dir(new TypeError("x is not a function")), ["a"])).rejects.toThrow("not a function");
  // 브라우저가 TypeError 로 거절할 이름은 묻기 전에 '없음'으로 본다.
  for (const name of ["", ".", "..", "a/b", "a\\b", "a\0"]) expect(await fileIn(dir(new TypeError("불리면 안 된다")), name)).toBe(null);
});
