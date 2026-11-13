// 주간 보고(weekly) 이식 확인. 같은 초안 폴더 여러 개를 로컬판 tabs/weekly/report_parser.py load_reports·generate_viewer.py
// viewer_payload 와 web/tabs/weekly/*.js 에 넣어 회차 목록·보고서 모델·AI 브리핑·초안 원문 마크업이 같은지 맞춘다.
// 예제: scripts/demo/mock_data.py 가 만드는 80-weekly(weekly_md 모양) + 갈림 경우를 모은 80-weekly-old + 빈 폴더 + 같은 폴더 두 번.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, readFileSync, readdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { loadReports, readFolders } from "../../../web/tabs/weekly/report_parser.js";
import { guideDialog, viewerPayload } from "../../../web/tabs/weekly/viewer_html.js";
import { REPO, python, tempFolder, write } from "./support.js";
import { statHandle } from "./weekly_support.js";

const TEMPLATE = readFileSync(join(REPO, "tabs/weekly/templates/YYYY-MM-DD 주간 보고.md"), "utf-8");

// 표준 형식 + 인라인 마크업·미해결 표시·유니코드 공백/숫자·들여쓰기 탭·front matter 를 한 초안에 모은다.
const RICH = `---
author: 도비
tags: [weekly]
---
# 2026-09-14 주간 보고

## 보고 기간
- **조회 기간**: 2026-09-07 ~ 2026-09-13
- 차주 범위: 2026-09-14 ~ 2026-09-20
- 버전 : \`TRB 4.0.0\`
- 실제 확인 범위:
  - Jira 이슈 12건
  - 커밋 <b>34</b>건 & 리뷰
\t- 탭 들여쓰기 항목

## 이번 주 핵심 업무
1. **결제 모듈** 리팩터링 [설계 문서](https://wiki.example.com/a?b=1&c="x") 반영
2) 배포 파이프라인 \`확인 필요\` 정리
3. 🚀
- 모니터링 대시보드 *정비*
- 롤백 절차 미검증
- 여섯 번째는 잘린다

## 업무별 상세 내용

### 1. 결제 모듈 리팩터링
- **수행 내용:** 결제 승인 흐름 분리
  - 승인·취소 서비스 분리
    - 손자 항목도 옮긴다
- 확인 결과:
  - 스테이징 정상 동작
  - 응답 시간 측정 N/A
- 의사결정/원인：전각 콜론 라벨
- 다음 단계:
  - 운영 배포
- 라벨 없는 메모 줄
  - 그 아래 항목

### 2) 배포 파이프라인
- 수행 내용:
  - 파이프라인 단계 정리 \`확인 필요\`
이어지는 줄은 앞 항목에 붙는다

## 정량 지표
- 커밋: 34건
- 리뷰 \`미확인\` 2건

### 이슈 처리 현황
- 전체 ５건
  - 완료 ３건
  - 진행 2건
  - 보류 0건
Jira 담당 이슈 기준
보조 설명 한 줄

## 금주 주요 사항 (2026-09-07 ~ 2026-09-13)
- 결제 모듈 리팩터링
### 1. 묶음 제목
- 묶음 안 항목

## 차주 주요 사항
- 운영 배포

## 이슈 및 기타 사항
- 외부 연동 일정 \`확인 필요\`
- 미확인 사항 하나

## PPT 붙여넣기용
금주
결제 모듈 리팩터링

### 차주
운영 배포

## 출처 및 검증
- Jira·커밋 대조

## PPT 처리
- 사용자가 직접 제작
- **두 번째 줄**

#### 네 단계 헤딩은 문단이다
---
1) 괄호 번호 목록
`;

// 표준 섹션이 빠진 초안: 핵심 업무·보고 기간 없이 금주 주요 사항(기간 괄호)의 ### 묶음만, 승인 상태.
const MISSING = `# 주간 진행 상황 업데이트 초안

## 금주 주요 사항 (2026-08-17 ~ 2026-08-21)
### 1. 주문 취소 정책 정리
- 정책 문서 초안
### 2. 환불 API 연동

## 승인 상태
승인 대기
`;

// 섹션이 하나도 없는 옛 초안(front matter + 불릿). 압축 날짜 파일명.
const LEGACY = `---
title: 옛 보고
---
제목: **옛 보고** 2026-08-10
- 첫 줄 업무
  - 하위 업무
- 두 번째 업무
그냥 문단
`;

const TITLE_DATED = `# 2026-07-27 주간 정리

## 이번 주 작업 요약
### 첫 묶음
### 두 번째 묶음
`;

const week = (start, end, title, extra = "") => `# 주간 보고\n\n## 보고 기간\n- 조회 기간: ${start} ~ ${end}\n\n## 이번 주 핵심 업무\n- ${title}\n${extra}`;
const STANDARD = "\n## 업무별 상세 내용\n\n### 1. 표준 업무\n- 수행 내용:\n  - 한 일\n";

const OLD = {
  "2026-09-07~ 2026-09-13-weekly-report.md": RICH,
  "2026-08-26 주간 진행 상황 업데이트 초안.md": MISSING,
  "weekly-report-20260810.md": LEGACY,
  "주간 정리.md": TITLE_DATED,
  "주간 메모.md": "# 메모\n\n- 날짜가 없다\n",
  "HANDOFF-weekly-report-automation.md": "# Handoff\n\n본문\n",
  "#task-1.md": week("2026-09-07", "2026-09-13", "해시 파일"),
  "notes.txt": "x",
  "2026-09-07~ 2026-09-13-weekly-report.pptx": "x",
  "부속/2026-09-01 주간 보고.md": week("2026-08-24", "2026-08-30", "하위 폴더는 읽지 않는다"),
  // 같은 주(06-08~14): 이 폴더의 표준 형식 초안이 다른 폴더의 더 새 비표준 초안을 이긴다.
  "2026-06-12 주간 보고 v2.md": week("2026-06-08", "2026-06-14", "표준 형식 초안", STANDARD),
  // 같은 주(06-01~07), 둘 다 비표준: 더 최근에 고친 쪽.
  "2026-06-05 주간 B.md": week("2026-06-01", "2026-06-07", "더 새 초안"),
  // 같은 주(05-25~31), 표준·수정 시각이 같으면 큰 파일.
  "2026-05-29 주간 큰.md": week("2026-05-25", "2026-05-31", "큰 초안", "\n- 덧붙인 줄로 더 크다\n"),
  // 같은 날짜, 다른 주(늦게 낸 보고) → slug 2026-07-03-2. 파일 이름도 다른 폴더와 같다.
  "2026-07-03 주간 보고.md": week("2026-06-22", "2026-06-28", "늦게 낸 지난주 보고"),
  "2026-05-15 주간 crlf.md": week("2026-05-11", "2026-05-17", "CRLF 초안", "\r\n## PPT 처리\r\n완료\r\n").replace(/\n/g, "\r\n"),
  "2026-05-08 주간 bom.md": "﻿---\nx: 1\n---\n" + week("2026-05-04", "2026-05-10", "BOM 초안"),
};

const NEW = {
  "2026-06-12 주간 보고.md": week("2026-06-08", "2026-06-14", "더 새 비표준 초안"),
  "2026-06-05 주간 A.md": week("2026-06-01", "2026-06-07", "옛 초안"),
  "2026-05-29 주간 작은.md": week("2026-05-25", "2026-05-31", "작은 초안"),
  "2026-07-03 주간 보고.md": week("2026-06-29", "2026-07-05", "이번 주 보고"),
};

const PY = `
import json, sys
from pathlib import Path
from tabs.weekly import report_parser, generate_viewer
tree = lambda nodes: [{"text": n.text, "kids": tree(n.kids)} for n in nodes]
sec = lambda s: {"name": s.name, "lines": s.lines, "subs": [sec(x) for x in s.subs]}
reports = report_parser.load_reports([Path(p) for p in sys.argv[1:]])
model = [{
    "date": r.date, "slug": r.slug, "source": {"name": r.source.name, "folder": r.source.parent.name}, "raw": r.raw,
    "doc_title": r.doc_title, "sections": [sec(s) for s in r.sections],
    "period_range": r.period_range, "period_next": r.period_next, "period_version": r.period_version,
    "period_scope": r.period_scope, "week_start": r.week_start, "week_end": r.week_end,
    "core": r.core, "core_origin": r.core_origin, "tasks": r.tasks, "metrics": tree(r.metrics), "tally": r.tally,
    "this_week": tree(r.this_week), "next_week": tree(r.next_week), "issues": tree(r.issues), "ppt": r.ppt,
    "sources": tree(r.sources), "approval": r.approval, "flags": r.flags, "body": tree(r.body), "standard": r.standard,
} for r in reports]
print(json.dumps({"model": model, "payload": generate_viewer.viewer_payload(reports)}, ensure_ascii=False))
`;

const MODEL_KEYS = ["date", "slug", "source", "raw", "doc_title", "sections", "period_range", "period_next", "period_version",
  "period_scope", "week_start", "week_end", "core", "core_origin", "tasks", "metrics", "tally", "this_week", "next_week",
  "issues", "ppt", "sources", "approval", "flags", "body", "standard"];
const pick = (report) => Object.fromEntries(MODEL_KEYS.map((key) => [key, report[key]]));

describe("로컬판 load_reports·viewer_payload 와 같은 폴더 여러 개 비교", () => {
  let fixture;
  let folders;
  let expected;
  let actual;
  beforeAll(async () => {
    fixture = tempFolder("80-weekly");
    const base = join(fixture.folder, "..");
    // mock_data.py 의 주간 보고 두 회차(weekly_md)를 같은 상위 폴더로 옮긴다(로컬판의 경로 순서와 맞추려고).
    const run = Bun.spawnSync(["python3", "scripts/demo/mock_data.py", join(base, "mock")], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
    if (run.exitCode !== 0) throw new Error(run.stderr.toString());
    const mockWeekly = join(base, "mock", "DemoVault", "DEMO_100", "80-weekly");
    for (const name of readdirSync(mockWeekly)) cpSync(join(mockWeekly, name), join(fixture.folder, name));
    for (const [name, text] of Object.entries(NEW)) write(fixture.folder, name, text);
    const old = join(base, "80-weekly-old");
    mkdirSync(old);
    for (const [name, text] of Object.entries(OLD)) write(old, name, text);
    write(old, "2026-05-01 주간 깨짐.md", Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]));
    const empty = join(base, "빈 폴더");
    mkdirSync(empty);

    // 수정 시각: 모두 같게 두고, 고르기 규칙이 갈리는 초안만 바꾼다.
    const at = (path, seconds) => utimesSync(path, seconds, seconds);
    for (const dir of [fixture.folder, old]) for (const name of readdirSync(dir)) at(join(dir, name), 1_790_000_000);
    at(join(fixture.folder, "2026-06-12 주간 보고.md"), 1_790_000_500); // 더 새 비표준 < 표준
    at(join(fixture.folder, "2026-06-05 주간 A.md"), 1_790_000_100);
    at(join(old, "2026-06-05 주간 B.md"), 1_790_000_200); // 더 새 쪽

    folders = [fixture.folder, old, empty, old];
    expected = python(PY, folders);
    const read = await readFolders(folders.map(statHandle));
    actual = { ...loadReports(read.files), readWarnings: read.warnings };
  });
  afterAll(() => fixture.cleanup());

  test("회차 목록: 같은 회차·순서·slug(같은 주 고르기, 같은 날짜 -2)", () => {
    const rows = (list) => list.map((r) => [r.slug, r.source.folder, r.source.name]);
    expect(rows(actual.reports)).toEqual(rows(expected.model));
    const slugs = actual.reports.map((r) => r.slug);
    expect(slugs).toContain("2026-07-03-2");
    const names = actual.reports.map((r) => r.source.name);
    expect(names).toContain("2026-06-12 주간 보고 v2.md");
    expect(names).toContain("2026-06-05 주간 B.md");
    expect(names).toContain("2026-05-29 주간 큰.md");
    expect(names.filter((n) => /HANDOFF|#task|pptx|메모|부속/.test(n))).toEqual([]);
  });

  test("보고서 모델(섹션·핵심 업무·업무 카드·지표·미해결·원문)이 같다", () => {
    expect(actual.reports.length).toBe(expected.model.length);
    actual.reports.forEach((report, i) => expect(pick(report)).toEqual(expected.model[i]));
  });

  test("화면 자료(회차 목록 칸·AI 브리핑·초안 원문 HTML)가 같은 마크업이다", () => {
    const payload = viewerPayload(actual.reports);
    expect(payload.length).toBe(expected.payload.length);
    payload.forEach((item, i) => {
      const want = expected.payload[i];
      for (const key of Object.keys(want)) expect([item.slug, key, item[key]]).toEqual([want.slug, key, want[key]]);
      expect(Object.keys(item).sort()).toEqual(Object.keys(want).sort());
    });
  });

  test("mock_data 회차와 갈림 경우가 모두 들어 있다", () => {
    const payload = viewerPayload(actual.reports);
    const mock = payload.filter((item) => item.file.endsWith(" 주간 보고.md") && item.briefing.includes("PG사 결제창 연동"));
    expect(mock.length).toBe(2);
    const rich = payload.find((item) => item.file.startsWith("2026-09-07~"));
    expect(rich.briefing).toContain('<span class="mk need">확인 필요</span>');
    expect(rich.briefing).toContain('<div class="stat"><span class="big">5</span>');
    expect(rich.document).toContain('<a href="#보고-기간">보고 기간</a>');
    const missing = payload.find((item) => item.file.startsWith("2026-08-26"));
    expect([missing.title, missing.origin, missing.approval]).toEqual(["주문 취소 정책 정리", "금주 주요 사항", "승인 대기"]);
    const legacy = payload.find((item) => item.file === "weekly-report-20260810.md");
    expect(legacy.origin).toBe("초안 본문");
  });

  test("깨진 파일은 건너뛰고 경고로 남긴다(로컬판은 터미널에 '건너뜀:')", () => {
    expect(actual.warnings).toEqual(["건너뜀: 2026-05-01 주간 깨짐.md (UTF-8 로 읽지 못함)"]);
    expect(actual.readWarnings).toEqual([]);
  });
});

describe("로컬판과 같은 화면 틀", () => {
  test("표준 섹션 안내 창이 guide_dialog() 와 같다(템플릿은 같은 파일)", () => {
    const want = python("import json; from tabs.weekly.viewer_guide import guide_dialog; print(json.dumps(guide_dialog(), ensure_ascii=False))");
    expect(guideDialog(TEMPLATE)).toBe(want);
  });

  test("weekly.css 가 로컬판 뷰어 CSS 문자열과 같다", () => {
    const want = python(`import json
from tabs.weekly import generate_viewer as g, viewer_review, viewer_cite, viewer_refresh, viewer_guide
print(json.dumps(g.BASE_CSS + g.VIEWER_CSS + viewer_review.CSS + viewer_cite.CSS + viewer_refresh.CSS + viewer_guide.CSS, ensure_ascii=False))`);
    const css = readFileSync(join(REPO, "web/tabs/weekly/weekly.css"), "utf-8");
    expect(css.slice(css.indexOf("*/\n") + 3)).toBe(want);
  });

  test("뷰어 화면 틀(index.html)이 로컬판 viewer_page 의 상단바·회차 목록·본문 자리를 그대로 쓴다", () => {
    const html = readFileSync(join(REPO, "web/tabs/weekly/index.html"), "utf-8");
    for (const id of ['id="rail"', 'id="pane"', 'id="q"', 'id="qclear"', 'id="refreshBtn"', 'id="themeBtn"', 'class="app"', 'class="top"']) {
      expect(html).toContain(id);
    }
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/); // 인라인 스크립트 없음(CSP script-src 'self')
    expect(html).not.toContain("fonts.googleapis.com");
  });
});

describe("로컬판이 뷰어를 만들지 못하는 날짜", () => {
  test("strptime 이 못 읽는 날짜(2026-13-40)는 로컬판은 생성 실패, 웹은 그 초안만 건너뛴다", async () => {
    const fixture = tempFolder("80-weekly");
    try {
      write(fixture.folder, "2026-13-40 주간 보고.md", week("2026-13-34", "2026-13-40", "잘못된 날짜"));
      write(fixture.folder, "2026-09-09 주간 보고.md", week("2026-08-31", "2026-09-06", "정상 보고"));
      const failed = python(`import json, sys
from pathlib import Path
from tabs.weekly import report_parser, generate_viewer
try:
    generate_viewer.viewer_payload(report_parser.load_reports([Path(sys.argv[1])]))
    print(json.dumps("ok"))
except ValueError as error:
    print(json.dumps(type(error).__name__))`, [fixture.folder]);
      expect(failed).toBe("ValueError");
      const read = await readFolders([statHandle(fixture.folder)]);
      const { reports, warnings } = loadReports(read.files);
      expect(reports.map((r) => r.slug)).toEqual(["2026-09-09"]);
      expect(warnings).toEqual(["건너뜀: 2026-13-40 주간 보고.md (날짜 2026-13-40 를 읽지 못함)"]);
    } finally {
      fixture.cleanup();
    }
  });
});
