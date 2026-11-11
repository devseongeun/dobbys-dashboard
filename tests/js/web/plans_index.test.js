// plans 파서·목록 렌더 이식 확인. 같은 예제 폴더를 로컬판 tabs/plans/plans_index.py 와 web/tabs/plans/plans_index.js 에 넣어 결과를 맞춘다.
// 로컬판 tests/test_plans_index.py 의 입력·기대값도 그대로 옮겼다.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  byState, checkboxes, featuresOf, frontmatter, isPlanName, pyFloat, readFolder, readPlan, renderParts, roundHalfEven, summarize,
} from "../../../web/tabs/plans/plans_index.js";
import { REPO, dirHandle, python, tempFolder, write } from "./support.js";

const DONE_WITH_OPEN = `---
status: 완료
progress: 100
updated: 2026-11-02
---

# 계획

- [x] 끝난 일
- [ ] 체크 안 한 일
  * [X] 들여쓴 하위 항목

\`\`\`markdown
- [ ] 코드 블록 안 예시는 세지 않는다
\`\`\`
`;
const TEMPLATE = readFileSync(join(REPO, "tabs/plans/templates/YYYY-MM-DD 계획 제목.md"), "utf-8");

// 파서 규칙이 갈릴 만한 경우를 한 폴더에 모은다.
const FIXTURE = {
  "2026-11-01 계획.md": DONE_WITH_OPEN,
  "2026-11-01 진행중.md": "---\nstatus: 진행중\nprogress: 40\nfeature: 외부 결재, 배포\n---\n- [x] a\n- [ ] b\n",
  "2026-11-02 진행 중 띄어쓰기.md": "---\nstatus: 진행 중\nprogress: 12.5%\nfeature: [외부 결재, 배포]\n---\n",
  "2026-11-02 영문.md": "---\nstatus: In Progress\nprogress: 2.5\nfeature: [\"배포\"]\nupdated: 2026-11-08\n---\n",
  "2026-11-03 할일.md": "---\nstatus: 할일\nprogress: 140\nfeature: 'B'\ncreated: 2026-11-04\n---\n",
  "2026-11-03 todo.md": "---\nstatus: TODO\nprogress: -3\nfeature: B\n---\n",
  "2026-11-04 done.md": "---\nstatus: done\nprogress: 1_0\nfeature: A, B\nupdated: 어제\n---\n- [x] 끝\n",
  "2026-11-05 보류.md": "---\nstatus: 보류\nprogress: 반쯤\n---\n",
  "2026-11-05 nan.md": "---\nstatus: 완료\nprogress: nan\nfeature: A\n---\n",
  "2026-11-05 전각 숫자.md": "---\nstatus: 진행중\nprogress: ５０%\nfeature: A\n---\n",
  "2026-11-05 아라비아 숫자.md": "---\nstatus: 진행중\nprogress: \u0663\u0667.\u0665\nfeature: A\n---\n",
  "2026-11-05 전각 퍼센트.md": "---\nstatus: 진행중\nprogress: ５０％\nfeature: A\n---\n",
  "2026-10-19 인계.md": "# 인계\n\n- [ ] 남은 일\n",
  "2026-10-19 열린머리.md": "---\nstatus: 완료\n# 제목\n",
  "2026-10-20 crlf.md": "---\r\nstatus: 완료\r\nfeature: A\r\n---\r\n- [ ] 남음\r\n",
  "2026-10-21 bom.md": "﻿---\nstatus: 완료\n---\n",
  "2026-10-22 따옴표 키.md": "---\n \"status\": 완료\n- status: 완료\nstatus : \"진행중\"\n---\n",
  "2026-11-01 YYYY 템플릿.md": TEMPLATE.replaceAll("{{TODAY}}", "2026-11-09"),
  "날짜 없음.md": "---\nstatus: 완료\nfeature: Z\n---\n",
  "2026-11-06 none.md": "---\nstatus: 완료\n---\n",
  "2026-11-06 ~tilde (괄호)!.md": "---\nstatus: 완료\nfeature: <b>&'\"\n---\n",
  [`2026-11-07 ${"한글 NFD".normalize("NFD")}.md`]: "---\nstatus: 할 일\nfeature: 정규화\n---\n",
  "00_10-plans_목록.md": "---\nstatus: 완료\n---\n",
  ".hidden.md": "---\nstatus: 완료\n---\n",
  "notes.txt": "x",
  "2026-11-01 계획 부속/report.md": "---\nstatus: 완료\nfeature: 배포\n---\n",
};

const PY = `
import json, re, sys
from pathlib import Path
from tabs.plans import plans_index, plans_index_html
folder = Path(sys.argv[1])
warnings = []
plans = [plans_index.read(p, warnings) for p in plans_index.plans_in(folder)]
warnings += [f"기능 구분 없음: {p['file']} → frontmatter에 feature: 를 적는다" for p in plans if p["features"] == [plans_index.UNMAPPED]]
sections = plans_index.by_state(plans)
counts = {k: len(v) for k, v in sections.items()}
counts["mismatch"] = sum(p["mismatch"] for p in plans)
plans_index_html.fill = lambda template, values: values
parts = plans_index_html.render_html(sections, folder)
strip = lambda s: re.sub(r'<button type="button" class="f copy-path"[^>]*>경로 복사</button>', "", s)
print(json.dumps({"sections": sections, "counts": counts, "warnings": warnings,
                  "parts": {k: strip(parts[k]) for k in ("STATS", "TABS", "CHIPS", "PANELS")}}, ensure_ascii=False))
`;

describe("로컬판 plans_index.py 와 같은 예제 폴더 비교", () => {
  let fixture;
  let expected;
  let actual;
  beforeAll(async () => {
    fixture = tempFolder();
    for (const [name, text] of Object.entries(FIXTURE)) write(fixture.folder, name, text);
    write(fixture.folder, "2026-10-23 깨진 바이트 아님.md", Buffer.from("---\nstatus: 완료\nfeature: 바이트\n---\n", "utf-8"));
    expected = python(PY, [fixture.folder]);
    actual = summarize(await readFolder(dirHandle(fixture.folder)));
  });
  afterAll(() => fixture.cleanup());

  test("상태별 구역·순서·각 계획 값이 같다(P4–P14)", () => {
    expect(actual.sections).toEqual(expected.sections);
  });

  test("건수와 경고 문구가 같다(P6·P8·P11·P15)", () => {
    expect(actual.counts).toEqual(expected.counts);
    expect(actual.warnings).toEqual(expected.warnings);
  });

  test("목록 화면 조각(요약 카드·탭·기능 칩·표)이 같은 마크업이다(P15–P22)", () => {
    const parts = renderParts(actual.sections);
    expect(parts.stats).toBe(expected.parts.STATS);
    expect(parts.tabs).toBe(expected.parts.TABS);
    expect(parts.chips).toBe(expected.parts.CHIPS);
    expect(parts.panels).toBe(expected.parts.PANELS);
  });

  test("폴더 바로 아래 md 만, 00_·숨김·하위 폴더·다른 확장자는 뺀다(P4)", () => {
    const files = Object.values(actual.sections).flat().map((p) => p.file);
    expect(files).not.toContain("00_10-plans_목록.md");
    expect(files).not.toContain(".hidden.md");
    expect(files.some((f) => f.includes("report"))).toBe(false);
    expect(files).not.toContain("notes.txt");
    expect(isPlanName("00_x.md") || isPlanName(".x.md") || isPlanName("x.txt")).toBe(false);
  });
});

describe("로컬판 test_plans_index.py 와 같은 입력·기대값", () => {
  const read = (name, text, warnings = []) => readPlan(name, text, warnings);

  test("체크는 펜스 코드 밖만 세고, 완료인데 [ ] 가 남으면 어긋남(P9·P10)", () => {
    const plan = read("2026-11-01 계획.md", DONE_WITH_OPEN);
    expect([plan.checked, plan.total, plan.state, plan.mismatch, plan.updated]).toEqual([2, 3, "done", true, "2026-11-02"]);
  });

  test("status 표기는 한 상태로 모인다(P5)", () => {
    for (const [status, state] of [["진행중", "doing"], ["진행 중", "doing"], ["done", "done"], ["할 일", "todo"]]) {
      const plan = read("2026-11-01 a.md", `---\nstatus: ${status}\n---\n- [ ] x\n`);
      expect([plan.state, plan.mismatch]).toEqual([state, state === "done"]);
    }
  });

  test("frontmatter 가 없으면 참고, 날짜는 파일명에서(P5·P12·P13)", () => {
    const warnings = [];
    const plan = read("2026-10-19 인계.md", "# 인계\n\n- [ ] 남은 일\n", warnings);
    expect([plan.state, plan.progress, plan.date, plan.updated, plan.title]).toEqual(["ref", null, "2026-10-19", "2026-10-19", "인계"]);
    expect(warnings).toEqual([]);
  });

  test("닫는 --- 가 없으면 frontmatter 가 아니다(P7)", () => {
    expect(read("2026-10-19 b.md", "---\nstatus: 완료\n# 제목\n").state).toBe("ref");
    expect(frontmatter("---\nstatus: 완료\n# 제목\n")).toEqual({});
  });

  test("모르는 status·못 읽는 progress 는 경고(P6·P8)", () => {
    const warnings = [];
    const plan = read("2026-10-19 c.md", "---\nstatus: 보류\nprogress: 반쯤\n---\n", warnings);
    expect([plan.state, plan.progress]).toEqual(["ref", null]);
    expect(warnings).toEqual([
      "모르는 status '보류': 2026-10-19 c.md → 할 일·진행중·완료 중 하나로 고친다",
      "progress 값을 읽을 수 없음 '반쯤': 2026-10-19 c.md",
    ]);
  });

  test("progress 는 0–100 으로 자르고 Python 처럼 짝수 반올림한다(P8)", () => {
    expect(read("2026-10-19 d.md", "---\nstatus: 진행중\nprogress: 140\n---\n").progress).toBe(100);
    expect([roundHalfEven(2.5), roundHalfEven(3.5), roundHalfEven(-0.5), roundHalfEven(12.51)]).toEqual([2, 4, 0, 13]);
    expect([pyFloat(" 12 "), pyFloat("1_0"), pyFloat("1e2"), pyFloat(".5")]).toEqual([12, 10, 100, 0.5]);
    expect([pyFloat("nan"), pyFloat("inf"), pyFloat("1__0"), pyFloat("")].every(Number.isNaN)).toBe(true);
    // Python float() 은 유니코드 십진 숫자(전각·아라비아-인도·수학 굵은 숫자)도 읽는다.
    expect([pyFloat("５０"), pyFloat("\u0663\u0667.\u0665"), pyFloat("\u{1D7D7}\u{1D7CE}"), pyFloat("１_０")]).toEqual([50, 37.5, 90, 10]);
    expect(read("2026-10-19 e.md", "---\nstatus: 진행중\nprogress: ５０%\n---\n").progress).toBe(50);
  });

  test("feature 표기는 한 목록으로(P11)", () => {
    for (const raw of ["외부 결재, 배포", "[외부 결재, 배포]", "[\"외부 결재\", \"배포\"]"]) {
      expect(read("2026-10-19 e.md", `---\nfeature: ${raw}\n---\n`).features).toEqual(["외부 결재", "배포"]);
    }
    expect(read("2026-10-19 f.md", "---\nfeature:\n---\n").features).toEqual(["미분류"]);
    expect(featuresOf(" [ 'a' , , \"b\" ] ")).toEqual(["a", "b"]);
  });

  test("내려받은 템플릿은 경고 없이 할 일로 읽힌다(P3)", () => {
    const warnings = [];
    const plan = read("2026-11-01 계획 제목.md", TEMPLATE.replaceAll("{{TODAY}}", "2026-11-09"), warnings);
    expect([plan.title, plan.state, plan.progress, plan.features, plan.date, plan.updated, plan.checked, plan.total])
      .toEqual(["계획 제목", "todo", 0, ["기능 구분 A", "기능 구분 B"], "2026-11-01", "2026-11-09", 0, 2]);
    expect(warnings).toEqual([]);
  });

  test("상태마다 작성일 내림차순, 기능 묶음은 최신 작성일 순, 미분류는 맨 뒤(P14)", () => {
    const files = [
      ["2026-11-03 b-old.md", "---\nstatus: 완료\nfeature: B\nupdated: 2026-11-09\n---\n"],
      ["2026-11-04 a-old.md", "---\nstatus: 완료\nfeature: A\n---\n"],
      ["2026-11-05 a-new.md", "---\nstatus: 완료\nfeature: A\n---\n"],
      ["2026-11-04 b-new.md", "---\nstatus: 완료\nfeature: B\n---\n"],
      ["2026-11-06 none.md", "---\nstatus: 완료\n---\n"],
    ];
    const sections = byState(files.map(([name, text]) => readPlan(name, text, [])));
    expect(sections.done.map((p) => p.file)).toEqual(["2026-11-05 a-new.md", "2026-11-04 a-old.md", "2026-11-04 b-new.md", "2026-11-03 b-old.md", "2026-11-06 none.md"]);
  });

  test("체크박스 기호 -·*·+ 와 x·X 를 센다(P9)", () => {
    expect(checkboxes("- [ ] a\n* [x] b\n+ [X] c\n-[ ] 아님\n- [-] 아님\n")).toEqual([2, 3]);
  });
});

describe("목록 마크업 세부", () => {
  test("경로 복사 버튼은 넘겨준 함수가 만든 것만 들어간다(P32)", () => {
    const sections = byState([readPlan("2026-11-01 a b.md", "---\nstatus: 완료\nfeature: X\n---\n", [])]);
    const without = renderParts(sections).panels;
    expect(without).not.toContain("copy-path");
    expect(without).toContain('href="view.html#2026-11-01%20a%20b.md"');
    const withButton = renderParts(sections, (file) => `<button data-copy-file="${file}">경로 복사</button>`).panels;
    expect(withButton).toContain('<button data-copy-file="2026-11-01 a b.md">경로 복사</button>');
  });
});
