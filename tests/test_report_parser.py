import tempfile
import unittest
from pathlib import Path

from tabs.weekly import TAB, report_parser


REPORT = """# {date} 주간 진행 상황 업데이트 초안

## 보고 기간
- 조회 기간: {start} ~ {end}

## 이번 주 핵심 업무
- {title}
"""


class MultiSourceReportTest(unittest.TestCase):
    def test_loads_reports_from_all_configured_source_directories(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            legacy = root / "legacy"
            current = root / "current"
            legacy.mkdir()
            current.mkdir()
            (legacy / "2026-08-26 주간 진행 상황 업데이트 초안.md").write_text(
                REPORT.format(date="2026-08-26", start="2026-08-17", end="2026-08-23", title="기존 보고서"),
                encoding="utf-8",
            )
            (current / "2026-09-09 주간 진행 상황 업데이트 초안.md").write_text(
                REPORT.format(date="2026-09-09", start="2026-08-31", end="2026-09-06", title="새 보고서"),
                encoding="utf-8",
            )

            reports = report_parser.load_reports((current, legacy))

            self.assertEqual([report.title for report in reports], ["새 보고서", "기존 보고서"])
            self.assertEqual(
                {report.source.parent for report in reports},
                {current.resolve(), legacy.resolve()},
            )

    def test_reads_ppt_handling_status_from_new_report_format(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "2026-09-09 주간 진행 상황 업데이트 초안.md"
            source.write_text(
                REPORT.format(
                    date="2026-09-09",
                    start="2026-08-31",
                    end="2026-09-06",
                    title="새 보고서",
                )
                + "\n## PPT 처리\n- 사용자가 직접 제작하므로 PPT 파일을 생성·수정하지 않음\n",
                encoding="utf-8",
            )

            report = report_parser.parse_report(source)

            self.assertIsNotNone(report)
            self.assertEqual(
                report.approval,
                "- 사용자가 직접 제작하므로 PPT 파일을 생성·수정하지 않음",
            )

    def test_recognizes_skill_output_filename_and_skips_non_reports(self):
        # 스킬 Step 5 저장 규칙: `{금주시작일}~ {금주종료일}-weekly-report.md`
        self.assertTrue(report_parser.is_report_file("2026-09-07~ 2026-09-13-weekly-report.md"))
        self.assertTrue(report_parser.is_report_file("weekly-report-2026-06-08 ~ 2026-06-14.md"))
        self.assertTrue(report_parser.is_report_file("2026-09-02 주간 진행 상황 업데이트 초안.md"))
        self.assertFalse(report_parser.is_report_file("HANDOFF-weekly-report-automation.md"))
        self.assertFalse(report_parser.is_report_file("#task-1.md"))
        self.assertFalse(report_parser.is_report_file("2026-09-07~ 2026-09-13-weekly-report.pptx"))

    def test_loads_report_saved_with_skill_output_filename(self):
        with tempfile.TemporaryDirectory() as temp:
            current = Path(temp)
            (current / "2026-09-07~ 2026-09-13-weekly-report.md").write_text(
                REPORT.format(date="2026-09-16", start="2026-09-07", end="2026-09-13", title="새 규칙 보고서"),
                encoding="utf-8",
            )
            (current / "HANDOFF-weekly-report-automation.md").write_text(
                "# Handoff\n\n본문\n", encoding="utf-8"
            )

            reports = report_parser.load_reports((current,))

            self.assertEqual([report.title for report in reports], ["새 규칙 보고서"])


FLAG_REPORT = """# 2026-09-09 주간 진행 상황 업데이트 초안

## 보고 기간
- 조회 기간: 2026-08-31 ~ 2026-09-06

## 이번 주 핵심 업무
- 플래그 보고서

## 업무별 상세 내용

### 1. 배포 점검
- 확인 결과:
  - 배포 로그 `확인 필요`
  - 릴리즈 노트 검증 결과 N/A
  - 롤백 절차 `미검증`
  - 스테이징 배포 완료

## 이슈 및 기타 사항
- 모니터링 알림 임계값 `확인 필요`
"""


class FlagParsingTest(unittest.TestCase):
    def test_collects_flag_kind_and_origin_from_draft_sentences(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "2026-09-09 주간 진행 상황 업데이트 초안.md"
            source.write_text(FLAG_REPORT, encoding="utf-8")

            report = report_parser.parse_report(source)

        self.assertIsNotNone(report)
        # 확인 필요 / N/A / 미검증 문구만 뽑히고, 플래그 없는 문장은 빠진다
        self.assertEqual(
            [(flag["kind"], flag["origin"]) for flag in report.flags],
            [
                ("need", "배포 점검"),
                ("na", "배포 점검"),
                ("unver", "배포 점검"),
                ("need", "이슈 및 기타 사항"),
            ],
        )
        self.assertIn("배포 로그", report.flags[0]["text"])
        # 확인 단위는 회차 전체이므로 flag 항목에 식별자가 붙지 않는다
        self.assertEqual({key for flag in report.flags for key in flag}, {"kind", "origin", "text"})


class TemplateTest(unittest.TestCase):
    def write(self, folder: Path, name: str) -> None:
        _, body = TAB.template("0")
        (folder / name).write_bytes(body)

    def test_dated_template_reads_as_standard_report_with_every_section(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            name, _ = TAB.template("0")
            self.write(folder, name.replace("YYYY-MM-DD", "2026-11-09"))
            [report] = report_parser.load_reports([folder])
        self.assertTrue(report.standard)
        self.assertEqual((report.date, report.title, report.subtitle),
                         ("2026-11-09", "가장 중요한 업무 한 줄", "두 번째 업무 한 줄"))
        self.assertEqual([task["title"] for task in report.tasks], ["가장 중요한 업무", "두 번째 업무"])
        self.assertEqual([row["label"] for row in report.tasks[0]["rows"]], report_parser.DETAIL_LABELS)
        self.assertEqual((report.tally["total"], [p["value"] for p in report.tally["parts"]]), (3, [2, 1]))
        self.assertEqual([report.period_version, report.approval], ["프로젝트 버전", "미처리"])
        for filled in (report.period_scope, report.metrics, report.this_week, report.next_week,
                       report.issues, report.ppt, report.sources):
            self.assertTrue(filled)
        # 자리표시 문장이 미해결 항목으로 잡히지 않는다.
        self.assertEqual(report.flags, [])

    def test_template_left_with_placeholder_name_is_not_a_report(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            self.write(folder, TAB.template("0")[0])
            self.assertEqual(report_parser.load_reports([folder]), [])


if __name__ == "__main__":
    unittest.main()
