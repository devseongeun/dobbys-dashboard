// 웹 wbs 탭은 로컬판 화면 모듈을 그대로 쓴다(사본). 둘이 갈라지면 로컬판 bun 테스트(tests/js/wbs)가 웹판을 지키지 못하니
// 내용이 같아야 한다. 바뀌어도 되는 것은 app.js(서버 API 대신 backend.js)·style.css 끝 웹 전용 줄뿐이다.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dir, "../../..");
const read = (path) => readFileSync(join(REPO, path), "utf8");

test("웹 wbs 탭의 화면 모듈은 로컬판과 같다", () => {
  for (const name of ["board", "calendar", "issues", "model", "plan", "state", "worklog"]) {
    expect({ name, body: read(`web/tabs/wbs/js/${name}.js`) }).toEqual({ name, body: read(`tabs/wbs/js/${name}.js`) });
  }
  expect(read("web/tabs/wbs/index.html")).toBe(read("tabs/wbs/index.html"));
  expect(read("web/tabs/wbs/style.css").startsWith(read("tabs/wbs/style.css"))).toBe(true);
});

test("웹 wbs 탭은 서버 api/* 대신 backend.js 를 부르고 프록시 외 서버 호출이 없다", () => {
  const app = read("web/tabs/wbs/js/app.js");
  expect(app).not.toMatch(/(^|[^.\w])fetch\(/m);
  expect(app).not.toContain("서버가 예전 버전이다");
  for (const name of ["xlsx", "jira", "matching", "service", "stores", "session", "backend"]) {
    expect(read(`web/tabs/wbs/js/${name}.js`)).not.toMatch(/(^|[^.\w])fetch\(|XMLHttpRequest|sendBeacon/m);
  }
});
