// 웹 wbs 탭 등록 항목은 로컬판 TAB.describe() 와 같고(src·workbook 핸들 표시만 다름), 설정 검사 문구도 같다.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { validate, WBS_TAB } from "../../../web/tabs/wbs/tab.js";
import { parseXml } from "./xml_dom.js";

const REPO = join(import.meta.dir, "../../..");
const io = { inflate: async (b) => new Uint8Array(inflateRawSync(b)), parseXml };

test("필드·문구는 로컬판 tabs/wbs TAB.describe() 와 같다", () => {
  const run = Bun.spawnSync(["python3", "-c", "import json; from tabs.wbs import TAB; print(json.dumps(TAB.describe(), ensure_ascii=False))"], { cwd: REPO });
  const local = JSON.parse(run.stdout.toString());
  const { validate: _, ...web } = WBS_TAB;
  const strip = (f) => { const { accept, ...rest } = f; return rest; };
  expect({ ...web, fields: web.fields.map(strip) }).toEqual({ ...local, src: "tabs/wbs/" });
  expect(WBS_TAB.fields.find((f) => f.key === "workbook").accept).toBeTruthy();
});

const handleOf = (path) => ({ getFile: async () => new Blob([readFileSync(path)]) });

test("설정 검사: 도메인·프로젝트 키·엑셀 시트·담당자 문구", async () => {
  const dir = Bun.spawnSync(["mktemp", "-d"]).stdout.toString().trim();
  const run = Bun.spawnSync(["python3", "-c",
    `import sys; from pathlib import Path; from tests.support_xlsx import wbs_book; from tests.test_wbs_xlsx import ROW; wbs_book(Path(sys.argv[1]) / "w.xlsx", [ROW])`, dir], { cwd: REPO });
  expect(run.exitCode).toBe(0);
  const base = { mode: "wbs", jira_domain: "https://Team.atlassian.net/", jira_project: "PROJ", owner: "홍길동",
    sheet: "TROMBONE_v4.0.0_WBS(작업)", workbook: handleOf(join(dir, "w.xlsx")) };
  expect(await validate(base, io)).toEqual({});
  expect(await validate({ ...base, jira_domain: "not a domain", jira_project: "proj" }, io)).toEqual({
    jira_domain: "도메인 형식이 아닙니다(예: example.atlassian.net)",
    jira_project: "프로젝트 키는 영문 대문자로 시작합니다(예: PROJ)",
  });
  expect(await validate({ ...base, owner: "이영희" }, io)).toEqual({ owner: "담당자 '이영희' 행이 없습니다" });
  expect((await validate({ ...base, sheet: "없음" }, io)).sheet).toStartWith("'없음' 시트가 없습니다. 있는 시트: ");
  expect(await validate({ ...base, workbook: { getFile: async () => new Blob(["not a zip"]) } }, io)).toEqual({ workbook: "xlsx 파일이 아닙니다" });
  expect(await validate({ mode: "jira", jira_domain: "team.atlassian.net", jira_project: "PROJ" }, io)).toEqual({});
  Bun.spawnSync(["rm", "-rf", dir]);
});
