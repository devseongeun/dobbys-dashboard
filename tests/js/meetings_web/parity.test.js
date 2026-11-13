// 회의 자료 이식 확인(c1). 같은 예제 Vault(scripts/demo/mock_data.py + 경계 사례, fixture.py build)를 로컬판
// meetings_canvas.py·meetings_edit.py·vault_tree.py 와 웹 meetings_canvas.js·meetings_edit.js·vault_tree.js 에 넣어 결과를 맞춘다.
// - 읽기: 업무 목록·상세(회의 블록·파일/링크/메모 카드·version)·Vault 트리·검색·미리보기 판정이 같다.
// - 쓰기: 같은 연산 순서(업무·회의 블록·카드 추가·이동·순서·삭제, 업무 이름 바꾸기·휴지통, 오류)를 Vault 사본 둘에 각각 돌려
//   연산마다 결과·상세가 같고, 끝난 뒤 Vault 전체 파일(.canvas·.order·.trash 포함)이 바이트 단위로 같다.
//   새 노드 id 는 양쪽 다 차례 번호, 휴지통 시각은 고정값이다.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as canvas from "../../../web/tabs/meetings/meetings_canvas.js";
import * as edit from "../../../web/tabs/meetings/meetings_edit.js";
import { listDir, search } from "../../../web/tabs/meetings/vault_tree.js";
import { createBackend } from "../../../web/tabs/meetings/backend.js";
import { REPO, dirHandle } from "../web/support.js";

const ROOT_PARTS = ["DEMO_100", "70-meetings"];
const fixture = (...args) => {
  const run = Bun.spawnSync(["python3", "tests/js/meetings_web/fixture.py", ...args], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  return JSON.parse(run.stdout.toString());
};
// Python json 오류 문구(“Expecting …: line 1 column 2”)는 브라우저 JSON 파서 문구와 다르다. 앞부분만 맞춘다.
const PARSE = "Canvas JSON을 읽지 못했다:";
const normalize = (value) => JSON.parse(JSON.stringify(value, (key, v) =>
  (typeof v === "string" && v.startsWith(PARSE) ? PARSE : v)));
const b64 = (buffer) => Buffer.from(buffer).toString("base64");

let base;
let built;
beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "meetings-parity-"));
  built = fixture("build", join(base, "src"));
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

function copy(name) {
  const vault = join(base, name, "DemoVault");
  cpSync(built.vault, vault, { recursive: true });
  return { vault, root: join(vault, ...ROOT_PARTS) };
}

describe("읽기: 같은 예제 Vault 를 로컬판과 같게 읽는다", () => {
  let expected;
  let vault;
  let root;
  beforeAll(() => {
    expected = fixture("read", built.vault, built.root);
    vault = dirHandle(built.vault);
    root = dirHandle(built.root, vault);
  });

  test("업무 목록: 날짜 최신순·이름순, 숨김·하위 폴더·폴더·다른 확장자 제외, 깨진 Canvas 는 오류(mtime 포함)", async () => {
    const meetings = await canvas.listMeetings(root);
    expect(meetings.length).toBeGreaterThan(10);
    expect(normalize(meetings)).toEqual(normalize(expected.meetings));
  });

  test("업무 상세: 회의 블록(그룹)·파일/링크/메모 카드·순서 파일·색·이름·version 이 같다", async () => {
    for (const [id, want] of Object.entries(expected.details)) {
      let got;
      try {
        got = { ok: await canvas.readMeeting(root, vault, ROOT_PARTS, id) };
      } catch (error) {
        if (!(error instanceof canvas.CanvasError)) throw error;
        got = { error: error.message, version: await canvas.versionOf(root, await canvas.resolveMeeting(root, id), id) };
      }
      expect({ id, ...normalize(got) }).toEqual({ id, ...normalize(want) });
    }
    const mock = expected.details["결제 연동"].ok;
    expect(mock.blocks.map((b) => b.items.length)).toEqual([3, 2]); // mock_data.py 의 두 회의
  });

  test("Vault 트리 한 단계: 폴더 먼저·이름순, 숨김 제외, 잘못된 경로는 없음(null)", async () => {
    for (const [rel, want] of Object.entries(expected.trees)) expect({ rel, got: await listDir(vault, rel) }).toEqual({ rel, got: want });
  });

  test("파일 검색: 대소문자 무시·NFC·경로순·50건 제한", async () => {
    for (const [q, want] of Object.entries(expected.searches)) {
      const got = q === "limit" ? await search(vault, ".", 3) : await search(vault, q);
      expect({ q, got }).toEqual({ q, got: want });
    }
  });

  test("미리보기(/file): Vault 안의 미리보기 형식만, 형식·내용이 같다", async () => {
    const backend = createBackend({ root, vault, rootParts: ROOT_PARTS });
    for (const [rel, want] of Object.entries(expected.files)) {
      let got;
      try {
        const blob = await backend.file(rel);
        got = { type: blob.type, body: b64(await blob.arrayBuffer()) };
      } catch (error) {
        expect(error.status).toBe(404);
        got = { type: null, body: null };
      }
      expect({ rel, ...got }).toEqual({ rel, ...want });
    }
  });
});

// 연산 순서. version 은 "current"(그 순간 Canvas·순서 파일 해시) 또는 그대로 넘길 값.
const BLOCK1 = "0000000000000001";
const BLOCK2 = "0000000000000002";
const FILE = "DEMO_100/docs/결제 흐름 정리.md";
const OPS = [
  { fn: "create_meeting", args: { date: "2026-11-20", title: " 새 업무 " } },
  { fn: "create_meeting", args: { date: "2026-11-20", title: "새 업무" } },
  ...[["", "a/b"], ["", ".x"], ["", ""], ["2026-02-30", "x"], ["2026-13-01", "x"], ["20261120", "x"], [3, "x"], ["", null],
    ["２０２６-１１-２０", "x"], ["0000-01-01", "x"], ["", "x".repeat(121)], ["", "줄\n바꿈"], ["", "a:b"]]
    .map(([date, title]) => ({ fn: "create_meeting", args: { date, title } })),
  { fn: "create_meeting", args: { date: null, title: "결제 연동" } },
  { fn: "add_block", meeting: "2026-11-20 새 업무", args: { label: " 2026-11-20 킥오프 " } },
  { fn: "add_block", meeting: "2026-11-20 새 업무", args: { label: "2026-11-21 둘째" } },
  { fn: "add_block", meeting: "2026-11-20 새 업무", args: { label: "   " } },
  { fn: "add_item", meeting: "2026-11-20 새 업무", args: { block: BLOCK1, payload: { kind: "file", path: FILE } } },
  { fn: "add_item", meeting: "2026-11-20 새 업무", args: { block: BLOCK1, payload: { kind: "link", url: " https://example.com/a ", index: 0 } } },
  { fn: "add_item", meeting: "2026-11-20 새 업무", args: { block: BLOCK1, payload: { kind: "file", path: FILE } } },
  { fn: "add_item", meeting: "2026-11-20 새 업무", args: { block: BLOCK1, payload: { kind: "file", path: "DEMO_100/docs/PG사 비교표.md", index: -5 } } },
  ...["http://[x", "https://", "javascript:alert(1)", "ftp://a.b", "http://[::1]", "http://[v1.x]", "http://[1.2.3.4]", "http://a[b]@c",
    "https://ｅｘａｍｐｌｅ.com", "https://ex℀ample.com", "http://user@[::1]:80/x", "http://[::1]x", "http://[fe80::1%eth0]",
    "http://[1::2::3]", "http://[::ffff:1.2.3.4]", "http://[::ffff:1.2.3.04]", "HTTPS://Example.com", "https://a.b/\u0007", "http://@",
    "https://" + "a".repeat(2050), "  ", 5, null]
    .map((url) => ({ fn: "add_item", meeting: "2026-11-20 새 업무", args: { block: BLOCK2, payload: { kind: "link", url } } })),
  ...[{ kind: "file", path: "../밖.md" }, { kind: "file", path: ".obsidian/app.json" }, { kind: "file", path: "DEMO_100/docs/없음.md" },
    { kind: "file", path: "DEMO_100/docs" }, { kind: "file", path: 3 }, { kind: "text", text: "x" }, "문자열",
    { kind: "link", url: "https://a.b", index: "1" }, { kind: "link", url: "https://a.b", index: true }, { kind: "link", url: "https://a.b", index: 1.5 }]
    .map((payload) => ({ fn: "add_item", meeting: "2026-11-20 새 업무", args: { block: BLOCK2, payload } })),
  { fn: "add_item", meeting: "2026-11-20 새 업무", args: { block: "_ungrouped", payload: { kind: "link", url: "https://a.b" } } },
  { fn: "add_item", meeting: "2026-11-20 새 업무", args: { block: "없음", payload: { kind: "link", url: "https://a.b" } } },
  { fn: "add_item", meeting: "2026-11-20 새 업무", args: { block: BLOCK1, payload: { kind: "link", url: "https://a.b" } }, version: "stale" },
  { fn: "add_item", meeting: "없는 업무", args: { block: BLOCK1, payload: { kind: "link", url: "https://a.b" } } },
  { fn: "move_item", meeting: "2026-11-20 새 업무", args: { item: "0000000000000004", block: BLOCK1, index: 0 } },
  { fn: "move_item", meeting: "2026-11-20 새 업무", args: { item: "0000000000000004", block: BLOCK1, index: 99 } },
  { fn: "move_item", meeting: "2026-11-20 새 업무", args: { item: "0000000000000003", block: BLOCK2, index: 0 } },
  { fn: "move_item", meeting: "2026-11-20 새 업무", args: { item: BLOCK1, block: BLOCK2, index: 0 } },
  { fn: "move_item", meeting: "2026-11-20 새 업무", args: { item: "없음", block: BLOCK2, index: 0 } },
  { fn: "move_item", meeting: "2026-11-20 새 업무", args: { item: "0000000000000003", block: null, index: 0 } },
  { fn: "move_item", meeting: "2026-11-20 새 업무", args: { item: "0000000000000003", block: BLOCK1, index: 1.5 } },
  { fn: "move_item", meeting: "2026-11-20 새 업무", args: { item: "0000000000000003", block: "_ungrouped", index: 0 } },
  { fn: "rename_block", meeting: "2026-11-20 새 업무", args: { block: BLOCK2, label: "2026-11-22 이름 바뀐 회의" } },
  { fn: "rename_block", meeting: "2026-11-20 새 업무", args: { block: BLOCK2, label: "" } },
  { fn: "rename_block", meeting: "2026-11-20 새 업무", args: { block: "0000000000000004", label: "카드" } },
  { fn: "delete_item", meeting: "2026-11-20 새 업무", args: { item: "0000000000000004" } },
  { fn: "delete_item", meeting: "2026-11-20 새 업무", args: { item: BLOCK1 } },
  { fn: "delete_block", meeting: "2026-11-20 새 업무", args: { block: BLOCK2 } },
  { fn: "delete_block", meeting: "2026-11-20 새 업무", args: { block: "_ungrouped" } },
  { fn: "rename_meeting", meeting: "2026-11-20 새 업무", args: { date: "2026-11-23", title: "바뀐 업무" } },
  { fn: "rename_meeting", meeting: "2026-11-23 바뀐 업무", args: { date: "", title: "결제 연동" } },
  { fn: "rename_meeting", meeting: "2026-11-23 바뀐 업무", args: { date: "", title: "폴더" } },
  { fn: "rename_meeting", meeting: "2026-11-23 바뀐 업무", args: { date: "2026-11-23", title: "바뀐 업무" } },
  { fn: "rename_meeting", meeting: "2026-11-01 깨짐", args: { date: "", title: "고친 이름" } },
  // mock_data.py Canvas: 위 회의 블록에 카드를 넣으면 그룹이 늘고 아래 회의 블록이 밀린다.
  { fn: "add_item", meeting: "결제 연동", args: { block: "group-0-0", payload: { kind: "file", path: "DEMO_100/docs/알림톡 템플릿 초안.md" } } },
  { fn: "add_item", meeting: "결제 연동", args: { block: "group-0-0", payload: { kind: "link", url: "https://example.com/pg/2", index: 1 } } },
  { fn: "move_item", meeting: "결제 연동", args: { item: "text-20-580", block: "group-0-0", index: 0 } },
  { fn: "add_block", meeting: "결제 연동", args: { label: "2026-11-30 다음 회의" } },
  // 경계 사례 Canvas: 중첩 그룹 늘리기, 다른 블록으로 옮기기, edges·순서 파일 정리, 모르는 필드·숫자 id·문자열 노드 보존.
  { fn: "add_item", meeting: "2026-11-05 경계", args: { block: "group-50-50", payload: { kind: "link", url: "https://1drv.ms/x" } } },
  { fn: "add_item", meeting: "2026-11-05 경계", args: { block: "group-1200-0", payload: { kind: "file", path: "DEMO_100/docs/메모.txt" } } },
  { fn: "move_item", meeting: "2026-11-05 경계", args: { item: "text-600-600", block: "group-50-50", index: 0 } },
  { fn: "move_item", meeting: "2026-11-05 경계", args: { item: "text-980-20", block: "_ungrouped", index: 0 } },
  { fn: "move_item", meeting: "2026-11-05 경계", args: { item: "float", block: "group-0-1200", index: 1 } },
  { fn: "move_item", meeting: "2026-11-05 경계", args: { item: "no-rect", block: "group-0-0", index: 0 } },
  { fn: "delete_item", meeting: "2026-11-05 경계", args: { item: "text-60-60" } },
  { fn: "delete_block", meeting: "2026-11-05 경계", args: { block: "group-50-50" } },
  { fn: "rename_block", meeting: "2026-11-05 경계", args: { block: "group-1200-0", label: "2026-11-04 이름만" } },
  { fn: "add_block", meeting: "빈", args: { label: "첫 회의" } },
  { fn: "add_block", meeting: "edges 없음", args: { label: "둘째" } },
  { fn: "delete_block", meeting: "edges 없음", args: { block: "group-0-0" } },
  { fn: "add_block", meeting: "2026-11-01 깨짐", args: { label: "x" } },
  { fn: "add_block", meeting: "배열", args: { label: "x" } },
  { fn: "add_block", meeting: "노드아님", args: { label: "x" } },
  { fn: "add_block", meeting: "BOM", args: { label: "x" } },
  // 업무 삭제: Canvas·순서 파일을 .trash/<시각>/ 로. 같은 시각에 또 지우면 -2. 깨진 Canvas 도 지운다.
  { fn: "delete_meeting", meeting: "2026-11-23 바뀐 업무", version: "stale" },
  { fn: "delete_meeting", meeting: "2026-11-23 바뀐 업무" },
  { fn: "delete_meeting", meeting: "2026-11-05 경계" },
  { fn: "delete_meeting", meeting: "2026-11-01 깨짐" },
  { fn: "delete_meeting", meeting: "2026-11-01 깨짐" },
  { fn: "delete_meeting", meeting: ".trash" },
  { fn: "create_meeting", args: { date: "", title: "다시 만든 업무" } },
  { fn: "add_block", meeting: "다시 만든 업무", args: { label: "x" }, version: null },
];

const CALL = {
  create_meeting: (env, m, a) => edit.createMeeting(env.root, a.date, a.title),
  rename_meeting: (env, m, a, v) => edit.renameMeeting(env.root, m, a.date, a.title, v),
  delete_meeting: (env, m, a, v) => edit.deleteMeeting(env.root, m, v),
  add_block: (env, m, a, v) => edit.addBlock(env.root, m, a.label, v),
  rename_block: (env, m, a, v) => edit.renameBlock(env.root, m, a.block, a.label, v),
  delete_block: (env, m, a, v) => edit.deleteBlock(env.root, m, a.block, v),
  add_item: (env, m, a, v) => edit.addItem(env.root, env.vault, m, a.block, a.payload, v),
  move_item: (env, m, a, v) => edit.moveItem(env.root, env.vault, m, a.item, a.block, a.index, v),
  delete_item: (env, m, a, v) => edit.deleteItem(env.root, m, a.item, v),
};

async function runJs(env) {
  let n = 0;
  const saved = { ...edit.hooks };
  edit.hooks.newId = () => (++n).toString(16).padStart(16, "0");
  edit.hooks.now = () => new Date(2026, 10, 12, 10, 30, 0);
  const results = [];
  try {
    for (const op of OPS) {
      const meeting = op.meeting;
      let version = op.version === undefined ? "current" : op.version;
      if (version === "current") {
        const handle = typeof meeting === "string" ? await canvas.resolveMeeting(env.root, meeting) : null;
        version = handle ? await canvas.versionOf(env.root, handle, meeting) : "missing";
      }
      const args = JSON.parse(JSON.stringify(op.args ?? {}));
      let result;
      let value;
      try {
        value = await CALL[op.fn](env, meeting, args, version);
        result = { ok: value };
      } catch (error) {
        if (!(error instanceof edit.EditError)) throw error;
        result = { error: [error.status, error.message, error.version] };
      }
      const shown = "ok" in result && op.fn !== "delete_meeting" ? value : meeting;
      try {
        result.detail = typeof shown === "string" ? await canvas.readMeeting(env.root, env.vault, ROOT_PARTS, shown) : null;
      } catch (error) {
        if (!(error instanceof canvas.CanvasError)) throw error;
        result.detail = { canvasError: error.message };
      }
      results.push(result);
    }
  } finally {
    Object.assign(edit.hooks, saved);
  }
  return results;
}

describe("쓰기: 같은 연산을 돌린 Canvas·순서 파일·휴지통이 로컬판과 같다", () => {
  let expected;
  let actual;
  let actualFiles;
  beforeAll(async () => {
    const py = copy("py");
    writeFileSync(join(base, "ops.json"), JSON.stringify(OPS));
    expected = fixture("run", py.vault, py.root, join(base, "ops.json"));
    const js = copy("js");
    const vault = dirHandle(js.vault);
    actual = await runJs({ vault, root: dirHandle(js.root, vault) });
    actualFiles = fixture("snapshot", js.vault);
  });

  test("연산마다 결과(바뀐 업무 id·오류 상태 코드·문구·409 의 현재 version)와 바뀐 뒤 상세가 같다", () => {
    expect(actual.length).toBe(OPS.length);
    for (let i = 0; i < OPS.length; i++) {
      expect({ i, op: OPS[i], ...normalize(actual[i]) }).toEqual({ i, op: OPS[i], ...normalize(expected.results[i]) });
    }
  });

  test("예상한 연산이 실제로 성공·실패했다(테스트가 빈 비교가 되지 않게)", () => {
    const outcome = (i) => (expected.results[i].ok !== undefined ? "ok" : expected.results[i].error[0]);
    const count = (status) => OPS.filter((_, i) => outcome(i) === status).length;
    expect(count("ok")).toBeGreaterThan(25);
    for (const status of [400, 404, 409, 422]) expect(count(status)).toBeGreaterThan(0);
  });

  test("끝난 뒤 Vault 전체 파일이 바이트 단위로 같다(.canvas·.order·.trash, 남은 swap 파일 없음)", () => {
    expect(Object.keys(actualFiles)).toEqual(Object.keys(expected.files));
    for (const path of Object.keys(expected.files)) expect({ path, body: actualFiles[path] }).toEqual({ path, body: expected.files[path] });
    const trash = Object.keys(expected.files).filter((p) => p.includes("/.trash/"));
    expect(trash).toContain("DEMO_100/70-meetings/.trash/2026-11-12 103000/2026-11-23 바뀐 업무.canvas");
    expect(trash).toContain("DEMO_100/70-meetings/.trash/2026-11-12 103000-2/.order/2026-11-05 경계.json");
    expect(Object.keys(actualFiles).some((p) => p.endsWith(".crswap") || p.endsWith(".tmp"))).toBe(false);
  });
});
