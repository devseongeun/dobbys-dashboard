// 같은 예제 엑셀·Jira 응답을 로컬판 Python(tests/js/wbs_web/fixture.py)과 웹 JS 에 넣어 결과가 같은지 본다.
// bun 에는 DecompressionStream·DOMParser 가 없어 node:zlib inflateRawSync 와 테스트 전용 XML 파서를 넣는다.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { adfToText, buildJql, buildKeyJql, FIELDS, LOOKUP_FIELDS } from "../../../web/tabs/wbs/js/jira.js";
import { matchKeys } from "../../../web/tabs/wbs/js/matching.js";
import { normalizeIssue, normalizeWorklog } from "../../../web/tabs/wbs/js/service.js";
import { readWbs, toDate, toNumber, WbsSource, XlsxError } from "../../../web/tabs/wbs/js/xlsx.js";
import { parseXml } from "./xml_dom.js";

const REPO = join(import.meta.dir, "../../..");
export const io = { inflate: async (bytes) => new Uint8Array(inflateRawSync(bytes)), parseXml };
let dir;
let expected;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "wbs-parity-"));
  const run = Bun.spawnSync(["python3", "tests/js/wbs_web/fixture.py", dir], { cwd: REPO });
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const outcome = async (fn) => {
  try {
    return { ok: await fn() };
  } catch (err) {
    if (err instanceof XlsxError) return { error: { field: err.field, message: err.message } };
    return { error: err.message };
  }
};

describe("엑셀 해석은 로컬판 read_wbs 와 같다", () => {
  test("예제 엑셀 전부(저장·deflate 압축, 머리글 이동, 휴일 없음, 담당자·시트 오류, 깨진 파일)", async () => {
    expect(expected.wbs.length).toBeGreaterThan(15);
    for (const c of expected.wbs) {
      const bytes = new Uint8Array(readFileSync(join(dir, c.file)));
      const got = await outcome(() => readWbs(bytes, c.sheet, c.owner, io));
      const want = c.ok ? { ok: c.ok } : { error: c.error };
      expect({ file: c.file, owner: c.owner, ...got }).toEqual({ file: c.file, owner: c.owner, ...want });
    }
  });

  test("deflate 로 압축된 엑셀은 inflate 를 거친다", async () => {
    let calls = 0;
    const counting = { ...io, inflate: (b) => { calls++; return io.inflate(b); } };
    await readWbs(new Uint8Array(readFileSync(join(dir, "basic-deflate.xlsx"))), expected.sheet, "홍길동", counting);
    expect(calls).toBeGreaterThan(0);
  });

  test("숫자·날짜 변환 경계(Python float·date 와 같은 규칙)", () => {
    expect(toNumber("1_000")).toBe(1000);
    expect(toNumber(" 12 ")).toBe(12);
    expect(toNumber("0x10")).toBeNull();
    expect(toNumber("1e3")).toBe(1000);
    expect(toDate("46282")).toBe("2026-09-17");
    expect(toDate("46282.9")).toBe("2026-09-17");
    expect(toDate("99999999")).toBeNull();
    expect(toDate("inf")).toBeNull();
    expect(toDate("2026-01-02")).toBe("2026-01-02");
  });
});

describe("WbsSource 는 파일이 바뀔 때(lastModified·size)만 다시 읽는다", () => {
  const handle = (files) => {
    let i = 0;
    return {
      reads: 0,
      async getFile() {
        const f = files[Math.min(i++, files.length - 1)];
        return { lastModified: f.lastModified, size: f.bytes.length, arrayBuffer: async () => { this.reads++; return f.bytes.buffer.slice(0); } };
      },
    };
  };

  test("같은 파일이면 같은 결과 객체, 바뀌면 다시 읽는다", async () => {
    const one = new Uint8Array(readFileSync(join(dir, "shifted.xlsx")));
    const many = new Uint8Array(readFileSync(join(dir, "basic.xlsx")));
    const h = handle([{ lastModified: 1, bytes: one }, { lastModified: 1, bytes: one }, { lastModified: 2, bytes: many }]);
    const source = new WbsSource(h, expected.sheet, "홍길동", io);
    const first = await source.load();
    expect(await source.load()).toBe(first);
    expect(h.reads).toBe(1);
    expect((await source.load()).tasks.length).toBe(5);
    expect(h.reads).toBe(2);
  });

  test("권한이 없으면 getFile 오류가 그대로 올라온다", async () => {
    const err = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    const source = new WbsSource({ getFile: async () => { throw err; } }, expected.sheet, "홍길동", io);
    await expect(source.load()).rejects.toBe(err);
  });
});

test("자동·수동 연결은 로컬판 match_keys 와 같다", () => {
  for (const c of expected.match) expect(matchKeys(c.tasks, c.issues, c.links)).toEqual(c.ok);
});

test("JQL 과 오류 문구는 로컬판 build_jql·build_key_jql 과 같다", async () => {
  expect(FIELDS).toBe(expected.fields);
  expect(LOOKUP_FIELDS).toBe(expected.lookupFields);
  for (const c of expected.jql) {
    const got = await outcome(() => buildJql(...c.args));
    expect(got).toEqual(c.ok !== undefined ? { ok: c.ok } : { error: c.error });
  }
  for (const c of expected.keyJql) {
    const got = await outcome(() => buildKeyJql(c.keys));
    expect(got).toEqual(c.ok !== undefined ? { ok: c.ok } : { error: c.error });
  }
});

test("ADF 평문화와 이슈·워크로그 정규화는 로컬판과 같다", () => {
  for (const c of expected.adf) expect(adfToText(c.node)).toBe(c.text);
  for (const c of expected.issues) expect(normalizeIssue(c.raw)).toEqual(c.ok);
  for (const c of expected.worklogs) expect(normalizeWorklog("PROJ-1", c.raw)).toEqual(c.ok);
});
