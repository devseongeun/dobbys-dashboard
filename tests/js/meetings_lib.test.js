import { expect, test } from "bun:test";
import {
  BOARD_MIN, clampPane, dropIndex, fileInfo, fileUrl, filterMeetings, isWebUrl, linkLabel, obsidianToMarkdown, obsidianUri,
  parseState, stripFrontmatter, toHash, todayIso,
} from "../../tabs/meetings/meetings_lib.js";

test("업무 검색은 낱말마다 날짜·이름 어딘가에 있으면 남기고, 빈 검색어는 전체다", () => {
  const list = [{ date: "2026-11-05", title: "인프라 Kickoff" }, { date: "2026-10-01", title: "인프라 점검" }, { date: "", title: "메모" }];
  expect(filterMeetings(list, "  ")).toBe(list);
  expect(filterMeetings(list, "인프라 kickoff").map((m) => m.title)).toEqual(["인프라 Kickoff"]);
  expect(filterMeetings(list, "2026-10 인프라").map((m) => m.title)).toEqual(["인프라 점검"]);
  expect(filterMeetings(list, "없는말")).toEqual([]);
});

test("해시는 한글·공백·&·#·+ 가 든 회의 id·경로를 그대로 왕복한다", () => {
  const state = { meeting: "2026-11-05 라이프사이클팀 & 협조", file: "90-assets/TRB #1 + 조사.md" };
  expect(parseState(toHash(state))).toEqual(state);
});

test("회의·파일 중 있는 것만 해시에 붙고, 둘 다 없으면 빈 해시", () => {
  expect(toHash({})).toBe("");
  expect(toHash({ meeting: "회의" })).toBe("#m=%ED%9A%8C%EC%9D%98");
  expect(parseState(toHash({ file: "docs/a.md" }))).toEqual({ meeting: "", file: "docs/a.md" });
  expect(parseState("")).toEqual({ meeting: "", file: "" });
});

test("fileUrl 과 obsidianUri 는 경로의 / 와 공백까지 인코딩한다", () => {
  expect(fileUrl("docs/a b.md")).toBe("file?p=docs%2Fa%20b.md");
  expect(obsidianUri("Obsidian Vault", "projects/a b.canvas"))
    .toBe("obsidian://open?vault=Obsidian%20Vault&file=projects%2Fa%20b.canvas");
});

test("fileInfo 는 마지막 확장자를 소문자로 보고 미리보기 형식만 참", () => {
  expect(fileInfo("docs/회의 자료.PDF")).toEqual({ name: "회의 자료.PDF", ext: ".pdf", preview: true });
  expect(fileInfo("a/b.tar.md")).toEqual({ name: "b.tar.md", ext: ".md", preview: true });
  expect(fileInfo("무제.canvas").preview).toBe(false);
  expect(fileInfo("Makefile")).toEqual({ name: "Makefile", ext: "", preview: false });
});

test("isWebUrl 은 http·https 만 참", () => {
  expect(isWebUrl("https://contoso.sharepoint.com/x")).toBe(true);
  expect(isWebUrl("http://127.0.0.1:8787/")).toBe(true);
  for (const bad of ["javascript:alert(1)", "obsidian://open?x", "file:///etc/hosts", "docs/a.md", ""]) {
    expect(isWebUrl(bad)).toBe(false);
  }
});

test("linkLabel 은 호스트와 마지막 경로 조각을 보여 준다", () => {
  expect(linkLabel("https://1drv.ms/x/s/%EC%9E%90%EB%A3%8C.xlsx")).toBe("1drv.ms · 자료.xlsx");
  expect(linkLabel("https://onedrive.live.com/")).toBe("onedrive.live.com");
  expect(linkLabel("not a url")).toBe("not a url");
});

test("stripFrontmatter 는 맨 앞 --- 블록만 뗀다", () => {
  expect(stripFrontmatter("---\nstatus: 완료\n---\n# 본문")).toBe("# 본문");
  expect(stripFrontmatter("# 본문\n---\nx\n---")).toBe("# 본문\n---\nx\n---");
  expect(stripFrontmatter("---\n닫히지 않음")).toBe("---\n닫히지 않음");
});

test("obsidianToMarkdown 은 위키링크·임베드를 바꾸고 코드 블록은 그대로 둔다", () => {
  const src = "[[a|별칭]] [[b]] ![[그림 <1>.png]]\n```\n[[코드]]\n```";
  expect(obsidianToMarkdown(src))
    .toBe('별칭 b <span class="embed">[이미지: 그림 &lt;1&gt;.png]</span>\n```\n[[코드]]\n```');
});

test("dropIndex 는 포인터보다 위에 있는 항목 중점 개수", () => {
  expect(dropIndex([10, 30, 50], 5)).toBe(0);
  expect(dropIndex([10, 30, 50], 20)).toBe(1);
  expect(dropIndex([10, 30, 50], 60)).toBe(3);
  expect(dropIndex([], 100)).toBe(0);
});

test("todayIso 는 로컬 날짜를 YYYY-MM-DD 로", () => {
  expect(todayIso(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  expect(todayIso(new Date(2026, 10, 30, 0, 0))).toBe("2026-11-30");
});

test("clampPane 은 보드 최소 폭을 남기고, 자리가 모자라면 칸 최소 폭이 이긴다", () => {
  const viewport = 1400;
  expect(clampPane(350.4, { min: 200, viewport })).toBe(350);
  expect(clampPane(120, { min: 200, viewport })).toBe(200);
  expect(clampPane(2000, { min: 200, viewport, others: 400 })).toBe(viewport - 400 - BOARD_MIN);
  expect(clampPane(500, { min: 280, viewport: 600, others: 280 })).toBe(280);
});
