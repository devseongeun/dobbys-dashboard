// 웹 회의 자료 화면은 로컬판 화면을 그대로 쓴다. HTML·CSS·순수 함수(meetings_lib.js)·md 렌더러는 web_serve.py SHARED_FILES 로
// 로컬판 파일을 열고, 화면 스크립트 meetings.js 만 웹 것이다. 웹 meetings.js 는 로컬판에서 서버 호출·md 정제·미리보기·시작
// 부분만 바꿨다. 둘이 갈라지면 로컬판 화면 수정이 웹에 빠지니, 나머지 맨 위 문장(함수·상수·이벤트 연결)이 같은지 본다.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MEETINGS_TAB } from "../../../web/tabs/meetings/tab.js";
import { REPO, python } from "../web/support.js";

const read = (path) => readFileSync(join(REPO, path), "utf8");

// 맨 위 문장 단위로 자른다. 바로 앞 주석 줄은 그 문장에 붙인다(구역 머리줄 `// ──` 은 뺀다). 키는 첫 코드 줄.
function chunks(source) {
  const out = [];
  let comments = [];
  let current = null;
  for (const line of source.split("\n")) {
    if (line.startsWith("// ──")) continue; // 구역 머리줄은 문장에 붙이지 않는다
    const top = line !== "" && !/^[\s})\]]/.test(line);
    if (top && line.startsWith("//")) {
      if (current) { out.push(current); current = null; }
      comments.push(line);
      continue;
    }
    if (top) {
      if (current) out.push(current);
      current = { key: line, lines: [...comments, line] };
      comments = [];
      continue;
    }
    if (current) current.lines.push(line);
    else if (line !== "") comments.push(line);
  }
  if (current) out.push(current);
  return out.map((c) => ({ key: c.key, body: c.lines.join("\n").trimEnd() }));
}

// 로컬판에서 웹판이 바꾼(또는 뺀) 문장, 웹판에만 있는 문장.
const CHANGED = [/^import /, /^} from /, /^const EDITOR /, /^async function getJson\(/, /^async function postJson\(/, /^function getJson\(/,
  /^function postJson\(/, /^function renderMarkdown\(/, /^async function renderPreview\(/, /^await refreshList\(\);/, /^ensureSelection\(\);$/,
  /^renderTree\(\);$/, /^sync\(\);$/];
const WEB_ONLY = [/^let backend /, /^let previewUrl /, /^function setPreviewUrl\(/, /^function wirePreviewLinks\(/, /^const readDataUrl /, /^function showBlocked\(/, /^async function connect\(/,
  /^if \(await connect\(\)\) \{/];
const keep = (patterns) => (chunk) => !patterns.some((re) => re.test(chunk.key));

test("웹 meetings.js 는 서버 호출·md 정제·미리보기·시작 말고는 로컬판과 같은 문장이다", () => {
  const local = chunks(read("tabs/meetings/meetings.js")).filter(keep(CHANGED));
  const web = chunks(read("web/tabs/meetings/meetings.js")).filter(keep([...CHANGED, ...WEB_ONLY]));
  expect(local.length).toBeGreaterThan(50);
  expect(web.map((c) => c.key)).toEqual(local.map((c) => c.key));
  for (let i = 0; i < local.length; i++) expect(web[i].body).toBe(local[i].body);
});

test("웹 화면은 서버에 파일을 묻지 않는다(fetch·XHR 없음), md 는 plans 와 같은 sanitize 를 거친다", () => {
  for (const name of ["meetings", "backend", "meetings_canvas", "meetings_edit", "vault_tree", "tab", "preview_frame"]) {
    const calls = read(`web/tabs/meetings/${name}.js`).match(/(^|[^.\w])fetch\(|XMLHttpRequest|sendBeacon/gm) ?? [];
    expect({ name, calls }).toEqual({ name, calls: [] });
  }
  const screen = read("web/tabs/meetings/meetings.js");
  expect(screen).toContain('import { sanitize } from "../plans/sanitize.js";');
  expect(screen).not.toMatch(/target\.innerHTML = /);
});

test("로컬판 화면 파일은 복사하지 않고 SHARED_FILES 로 연다", () => {
  const shared = python(`
import json, web_serve
print(json.dumps({k: str(v.relative_to(web_serve.REPO_ROOT)) for k, v in web_serve.SHARED_FILES.items() if k.startswith("tabs/meetings/")}))`);
  expect(shared).toEqual({
    "tabs/meetings/meetings.html": "tabs/meetings/meetings.html",
    "tabs/meetings/meetings.css": "tabs/meetings/meetings.css",
    "tabs/meetings/meetings_lib.js": "tabs/meetings/meetings_lib.js",
    "tabs/meetings/marked.umd.js": "tabs/_common/vendor/marked.umd.js",
  });
  expect(MEETINGS_TAB.src).toBe("tabs/meetings/meetings.html");
  for (const name of ["meetings.html", "meetings.css", "meetings_lib.js", "marked.umd.js", "index.html"]) {
    expect({ name, copied: (() => { try { read(`web/tabs/meetings/${name}`); return true; } catch { return false; } })() }).toEqual({ name, copied: false });
  }
});

test("탭 항목은 로컬판 TAB.describe() 와 같은 문구이고, 폴더 칸만 Vault(읽기)·회의 폴더(읽기·쓰기) 둘이다", () => {
  const local = python(`
import json
from tabs.meetings import TAB
print(json.dumps(TAB.describe(), ensure_ascii=False))`);
  for (const key of ["id", "label", "icon", "question", "summary", "experimental", "templates"]) expect(MEETINGS_TAB[key]).toEqual(local[key]);
  expect(MEETINGS_TAB.fields.map((f) => [f.key, f.kind, f.required, f.mode])).toEqual([["vault", "dir", true, "read"], ["folder", "dir", true, "readwrite"]]);
  const [folder] = local.fields;
  expect(MEETINGS_TAB.fields[1].label).toBe(folder.label);
});
