// 로컬판 tests/test_report_parser.py 의 입력·기대값을 web/tabs/weekly/report_parser.js 로 옮겼다.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DETAIL_LABELS, isReportFile, loadReports, parseReport, readFolders, reportSubtitle, reportTitle } from "../../../web/tabs/weekly/report_parser.js";
import { REPO, tempFolder, write } from "./support.js";
import { statHandle } from "./weekly_support.js";

const REPORT = ({ date, start, end, title }) => `# ${date} 주간 진행 상황 업데이트 초안

## 보고 기간
- 조회 기간: ${start} ~ ${end}

## 이번 주 핵심 업무
- ${title}
`;

const load = async (paths) => {
  const read = await readFolders(paths.map(statHandle));
  return loadReports(read.files).reports;
};
const file = (name, text) => ({ name, folder: "", text, mtime: 0, size: text.length });

describe("MultiSourceReportTest", () => {
  test("설정한 폴더 여러 개에서 모두 읽는다", async () => {
    const legacy = tempFolder("legacy");
    const current = tempFolder("current");
    try {
      write(legacy.folder, "2026-08-26 주간 진행 상황 업데이트 초안.md", REPORT({ date: "2026-08-26", start: "2026-08-17", end: "2026-08-23", title: "기존 보고서" }));
      write(current.folder, "2026-09-09 주간 진행 상황 업데이트 초안.md", REPORT({ date: "2026-09-09", start: "2026-08-31", end: "2026-09-06", title: "새 보고서" }));
      const reports = await load([current.folder, legacy.folder]);
      expect(reports.map(reportTitle)).toEqual(["새 보고서", "기존 보고서"]);
      expect(new Set(reports.map((r) => r.source.folder))).toEqual(new Set(["current", "legacy"]));
    } finally {
      legacy.cleanup();
      current.cleanup();
    }
  });

  test("새 형식의 PPT 처리 상태를 읽는다", () => {
    const report = parseReport(file("2026-09-09 주간 진행 상황 업데이트 초안.md",
      REPORT({ date: "2026-09-09", start: "2026-08-31", end: "2026-09-06", title: "새 보고서" })
      + "\n## PPT 처리\n- 사용자가 직접 제작하므로 PPT 파일을 생성·수정하지 않음\n"));
    expect(report).not.toBeNull();
    expect(report.approval).toBe("- 사용자가 직접 제작하므로 PPT 파일을 생성·수정하지 않음");
  });

  test("스킬 출력 파일명을 알아보고 보고서가 아닌 파일은 건너뛴다", () => {
    expect(isReportFile("2026-09-07~ 2026-09-13-weekly-report.md")).toBe(true);
    expect(isReportFile("weekly-report-2026-06-08 ~ 2026-06-14.md")).toBe(true);
    expect(isReportFile("2026-09-02 주간 진행 상황 업데이트 초안.md")).toBe(true);
    expect(isReportFile("HANDOFF-weekly-report-automation.md")).toBe(false);
    expect(isReportFile("#task-1.md")).toBe(false);
    expect(isReportFile("2026-09-07~ 2026-09-13-weekly-report.pptx")).toBe(false);
  });

  test("스킬 출력 파일명으로 저장한 보고서를 읽는다", async () => {
    const current = tempFolder("current");
    try {
      write(current.folder, "2026-09-07~ 2026-09-13-weekly-report.md", REPORT({ date: "2026-09-16", start: "2026-09-07", end: "2026-09-13", title: "새 규칙 보고서" }));
      write(current.folder, "HANDOFF-weekly-report-automation.md", "# Handoff\n\n본문\n");
      expect((await load([current.folder])).map(reportTitle)).toEqual(["새 규칙 보고서"]);
    } finally {
      current.cleanup();
    }
  });
});

const FLAG_REPORT = `# 2026-09-09 주간 진행 상황 업데이트 초안

## 보고 기간
- 조회 기간: 2026-08-31 ~ 2026-09-06

## 이번 주 핵심 업무
- 플래그 보고서

## 업무별 상세 내용

### 1. 배포 점검
- 확인 결과:
  - 배포 로그 \`확인 필요\`
  - 릴리즈 노트 검증 결과 N/A
  - 롤백 절차 \`미검증\`
  - 스테이징 배포 완료

## 이슈 및 기타 사항
- 모니터링 알림 임계값 \`확인 필요\`
`;

describe("FlagParsingTest", () => {
  test("초안 문장에서 미해결 표시 종류·출처를 모은다", () => {
    const report = parseReport(file("2026-09-09 주간 진행 상황 업데이트 초안.md", FLAG_REPORT));
    expect(report).not.toBeNull();
    expect(report.flags.map((f) => [f.kind, f.origin])).toEqual([
      ["need", "배포 점검"], ["na", "배포 점검"], ["unver", "배포 점검"], ["need", "이슈 및 기타 사항"],
    ]);
    expect(report.flags[0].text).toContain("배포 로그");
    // 확인 단위는 회차 전체이므로 flag 항목에 식별자가 붙지 않는다
    expect(new Set(report.flags.flatMap((f) => Object.keys(f)))).toEqual(new Set(["kind", "origin", "text"]));
  });
});

// TAB.template("0") 의 본문 = 웹이 SHARED_FILES 로 주는 같은 템플릿 파일.
const TEMPLATE_NAME = "YYYY-MM-DD 주간 보고.md";
const TEMPLATE = readFileSync(join(REPO, "tabs/weekly/templates", TEMPLATE_NAME), "utf-8");

describe("TemplateTest", () => {
  test("날짜를 넣은 템플릿은 모든 섹션을 갖춘 표준 초안으로 읽힌다", async () => {
    const folder = tempFolder("weekly");
    try {
      write(folder.folder, TEMPLATE_NAME.replace("YYYY-MM-DD", "2026-11-09"), TEMPLATE);
      const [report, ...rest] = await load([folder.folder]);
      expect(rest).toEqual([]);
      expect(report.standard).toBe(true);
      expect([report.date, reportTitle(report), reportSubtitle(report)]).toEqual(["2026-11-09", "가장 중요한 업무 한 줄", "두 번째 업무 한 줄"]);
      expect(report.tasks.map((t) => t.title)).toEqual(["가장 중요한 업무", "두 번째 업무"]);
      expect(report.tasks[0].rows.map((r) => r.label)).toEqual(DETAIL_LABELS);
      expect([report.tally.total, report.tally.parts.map((p) => p.value)]).toEqual([3, [2, 1]]);
      expect([report.period_version, report.approval]).toEqual(["프로젝트 버전", "미처리"]);
      for (const filled of [report.period_scope, report.metrics, report.this_week, report.next_week, report.issues, report.sources]) {
        expect(filled.length).toBeGreaterThan(0);
      }
      expect(report.ppt).toBeTruthy();
      // 자리표시 문장이 미해결 항목으로 잡히지 않는다.
      expect(report.flags).toEqual([]);
    } finally {
      folder.cleanup();
    }
  });

  test("자리표시 이름 그대로 둔 템플릿은 보고서가 아니다", async () => {
    const folder = tempFolder("weekly");
    try {
      write(folder.folder, TEMPLATE_NAME, TEMPLATE);
      expect(await load([folder.folder])).toEqual([]);
    } finally {
      folder.cleanup();
    }
  });
});

describe("웹 폴더 읽기(readFolders)", () => {
  test("같은 폴더를 두 번 골라도 한 번만 읽고, 하위 폴더·다른 확장자는 읽지 않는다", async () => {
    const folder = tempFolder("weekly");
    try {
      write(folder.folder, "2026-09-09 주간 보고.md", REPORT({ date: "2026-09-09", start: "2026-08-31", end: "2026-09-06", title: "하나" }));
      write(folder.folder, "하위/2026-09-16 주간 보고.md", REPORT({ date: "2026-09-16", start: "2026-09-07", end: "2026-09-13", title: "하위" }));
      write(folder.folder, "2026-09-16 주간 보고.txt", "x");
      const read = await readFolders([statHandle(folder.folder), statHandle(folder.folder)]);
      expect(read.files.map((f) => f.name)).toEqual(["2026-09-09 주간 보고.md"]);
      expect(read.warnings).toEqual([]);
    } finally {
      folder.cleanup();
    }
  });

  test("읽지 못한 폴더는 건너뛰고 경고를 남긴다", async () => {
    const gone = { kind: "directory", name: "사라진 폴더", async *entries() { throw Object.assign(new Error("gone"), { name: "NotFoundError" }); }, async isSameEntry() { return false; } };
    const read = await readFolders([gone]);
    expect(read.files).toEqual([]);
    expect(read.warnings).toEqual(["폴더 사라진 폴더 를 읽지 못했다: 폴더를 찾을 수 없다(옮겨졌거나 지워졌다)"]);
  });
});
