// 웹 설정 검증·순서·상태(web/lib/config.js). 로컬판 tests/test_config.py NormalizeTest·tests/test_app.py 의 입력·기대값을 옮겼다.
// 경로 칸은 웹에서 문자열 대신 FSA 핸들이라, 경로 문자열 입력은 핸들 입력으로 바꿨다(S35·S41).
import { describe as group, expect, test } from "bun:test";
import {
  apply, describe, initialDraft, normalize, ordered, projectError, reorder, tabStatus, templateBody, withRealPaths,
} from "../../../web/lib/config.js";
import { WEB_TABS } from "../../../web/tabs/manifest.js";
import { python } from "./support.js";

const dir = (name) => ({ kind: "directory", name, isSameEntry: async (o) => o?.name === name, queryPermission: async () => "granted" });
const file = (name) => ({ kind: "file", name, isSameEntry: async (o) => o?.name === name, queryPermission: async () => "granted" });

const field = (key, label, kind, extra = {}) => ({ key, label, kind, required: false, default: "", help: "", options: [], when: null, ...extra });
const tab = (id, fields, extra = {}) => ({ id, label: id, icon: "•", src: `tabs/${id}/`, question: "", summary: "", experimental: false, fields, templates: [], ...extra });

const TABS = [
  tab("m", [field("folder", "폴더", "dir", { required: true, realPath: true })]),
  tab("w", [field("book", "파일", "file", { required: true }), field("sheet", "시트", "text", { default: "기본" })]),
  tab("k", [field("folders", "폴더들", "dirs", { required: true })]),
  tab("o", [field("out", "내보낼 폴더", "dir")]),
];
const errorsOf = async (submitted, tabs = TABS) => (await normalize(tabs, submitted)).errors;
const meetings = dir("meetings");
const book = file("wbs.xlsx");

group("normalize — test_config.py NormalizeTest", () => {
  test("탭을 하나 이상 골라야 한다(S26)", async () => {
    expect(await normalize(TABS, { tabs: {} })).toEqual({ config: null, errors: { _: { tabs: "탭을 하나 이상 고르세요" } } });
    expect(await errorsOf(null)).toEqual({ _: { tabs: "탭을 하나 이상 고르세요" } });
  });

  test("모르는 탭은 거절", async () => {
    expect(await errorsOf({ project: "P", tabs: { nope: {} } })).toEqual({ _: { tabs: "알 수 없는 탭입니다: nope" } });
  });

  test("필수 경로 칸이 비면 필수 항목, 종류가 틀린 핸들은 다시 고르라고 한다(S34·S41)", async () => {
    expect(await errorsOf({ project: "P", tabs: { m: { folder: " " } } })).toEqual({ m: { folder: "필수 항목입니다" } });
    expect(await errorsOf({ project: "P", tabs: { m: { folder: null } } })).toEqual({ m: { folder: "필수 항목입니다" } });
    expect(await errorsOf({ project: "P", tabs: { m: { folder: "/Users/me/x" } } })).toEqual({ m: { folder: "폴더를 다시 고르세요" } });
    expect(await errorsOf({ project: "P", tabs: { w: { book: meetings } } })).toEqual({ w: { book: "파일을 다시 고르세요" } });
  });

  test("텍스트 기본값이 들어가고 선택 폴더 칸은 비어도 된다(S34)", async () => {
    const { config, errors } = await normalize(TABS, { project: "P", tabs: { w: { book }, o: { out: "" } } });
    expect(errors).toEqual({});
    expect(config.tabs.w).toEqual({ book, sheet: "기본" });
    expect(config.tabs.o).toEqual({ out: null });
  });

  test("여러 폴더 칸은 핸들 배열이고 하나 이상", async () => {
    const other = dir("other");
    const { config } = await normalize(TABS, { project: "P", tabs: { k: { folders: [meetings, other] } } });
    expect(config.tabs.k.folders).toEqual([meetings, other]);
    expect(await errorsOf({ project: "P", tabs: { k: { folders: [] } } })).toEqual({ k: { folders: "폴더를 하나 이상 고르세요" } });
    expect(await errorsOf({ project: "P", tabs: { k: { folders: [book] } } })).toEqual({ k: { folders: "폴더를 다시 고르세요" } });
  });

  test("탭 고유 검사는 칸 검사를 통과한 뒤에만 돈다(S42)", async () => {
    const calls = [];
    const tabs = [tab("m", [field("folder", "폴더", "dir", { required: true })], { validate: async (s) => { calls.push(s); return { folder: "Vault 밖이다" }; } })];
    expect(await errorsOf({ project: "P", tabs: { m: { folder: "" } } }, tabs)).toEqual({ m: { folder: "필수 항목입니다" } });
    expect(calls).toEqual([]);
    expect(await errorsOf({ project: "P", tabs: { m: { folder: meetings } } }, tabs)).toEqual({ m: { folder: "Vault 밖이다" } });
    expect(calls).toEqual([{ folder: meetings }]);
  });

  test("보낸 탭만 남기고, 실제 경로 칸은 다듬어 <key>RealPath 로 저장한다(S27·P1)", async () => {
    const { config, errors } = await normalize(TABS, { project: "P", tabs: { m: { folder: meetings, folderRealPath: "  /Users/me/meetings  " } } });
    expect(errors).toEqual({});
    expect(config).toEqual({ project: "P", tabs: { m: { folder: meetings, folderRealPath: "/Users/me/meetings" } } });
    const blank = await normalize(TABS, { project: "P", tabs: { m: { folder: meetings } } });
    expect(blank.config.tabs.m.folderRealPath).toBe("");
  });

  test("고르기 값에 따라 조건 칸만 필수·저장(S28)", async () => {
    const tabs = [tab("w", [
      field("mode", "기준", "choice", { default: "file", options: [["file", "파일"], ["remote", "원격"]] }),
      field("book", "파일", "file", { required: true, when: ["mode", "file"] }),
      field("host", "주소", "text", { required: true }),
    ])];
    expect(await errorsOf({ project: "P", tabs: { w: { host: "h" } } }, tabs)).toEqual({ w: { book: "필수 항목입니다" } });
    const { config, errors } = await normalize(tabs, { project: "P", tabs: { w: { mode: "remote", host: "h", book } } });
    expect([errors, config.tabs]).toEqual([{}, { w: { mode: "remote", host: "h" } }]);
    expect(await errorsOf({ project: "P", tabs: { w: { mode: "ftp", host: "h", book } } }, tabs)).toEqual({ w: { mode: "목록에 있는 값을 고르세요" } });
  });

  test("프로젝트 이름 규칙(S33)", async () => {
    const ok = { tabs: { m: { folder: meetings } } };
    expect(await errorsOf(ok)).toEqual({ _: { project: "프로젝트 이름을 입력하세요" } });
    expect(await errorsOf({ project: "  ", ...ok })).toEqual({ _: { project: "프로젝트 이름을 입력하세요" } });
    for (const bad of ["a/b", "a\\b", ".hidden", "..", "a\0b", "x".repeat(65), "m"]) {
      expect(Object.keys((await errorsOf({ project: bad, ...ok }))._ ?? {})).toContain("project");
    }
    expect(projectError("가".repeat(64), [])[1]).toBeNull();  // 글자 수는 코드 포인트로 센다
    const { config, errors } = await normalize(TABS, { project: " TRB 4.0.0 ", ...ok });
    expect([errors, config.project]).toEqual([{}, "TRB 4.0.0"]);
  });

  test("프로젝트 오류와 탭 오류를 함께 알린다(S30)", async () => {
    expect(await errorsOf({ project: "", tabs: { m: { folder: "" }, nope: {} } }))
      .toEqual({ _: { project: "프로젝트 이름을 입력하세요", tabs: "알 수 없는 탭입니다: nope" }, m: { folder: "필수 항목입니다" } });
  });
});

group("순서·describe — test_app.py", () => {
  const ABC = [tab("a", []), tab("b", []), tab("bad", [])];
  const all = { a: {}, b: {}, bad: {} };

  test("켜진 탭만 등록 순서로(S4)", () => {
    const desc = describe({ project: "P", tabs: { b: {}, a: {} }, order: [] }, ABC);
    expect([desc.configured, desc.project, desc.enabled]).toEqual([true, "P", ["a", "b"]]);
    expect(describe(null, ABC)).toEqual({ configured: false, project: "", tabs: ABC, enabled: [], values: {} });
  });

  test("끌어 바꾼 순서: 모르는 id·중복은 버리고 빠진 탭은 뒤에, 다시 저장해도 유지(S14·S16)", async () => {
    const saved = reorder({ project: "P", tabs: all, order: [] }, ABC, ["bad", "b", "nope", "b"]);
    expect(describe(saved, ABC).enabled).toEqual(["bad", "b", "a"]);
    const { config } = await apply(ABC, saved, { project: "P", tabs: { a: {}, b: {} } });
    expect(describe(config, ABC).enabled).toEqual(["b", "a"]);
    const { config: more } = await apply(ABC, config, { project: "P", tabs: { a: {}, b: {}, bad: {} } });
    expect(describe(more, ABC).enabled).toEqual(["b", "a", "bad"]);  // 새로 켠 탭은 뒤에
  });

  test("잘못된 순서 요청·설정 전 순서 요청은 거절(S16)", () => {
    expect(() => reorder(null, ABC, ["a"])).toThrow("설정이 먼저다");
    expect(() => reorder({ project: "P", tabs: all }, ABC, "a")).toThrow("order 는 탭 id 목록이다");
    expect(ordered(ABC, all, "a")).toEqual(["a", "b", "bad"]);
  });

  test("검증 오류면 설정을 돌려주지 않는다(S30)", async () => {
    const { config, errors } = await apply(TABS, { project: "P", tabs: { o: {} }, order: ["o"] }, { project: "P", tabs: { m: {} } });
    expect(config).toBeNull();
    expect(errors).toEqual({ m: { folder: "필수 항목입니다" } });
  });
});

group("편집 화면 값", () => {
  test("저장된 핸들·실제 경로가 처음 값이 된다(S43)", () => {
    const desc = describe({ project: "P", tabs: { m: { folder: meetings, folderRealPath: "/x/meetings" }, w: { book, sheet: "S" } } }, TABS);
    expect(initialDraft(desc)).toEqual({
      m: { folder: meetings, folderRealPath: "/x/meetings" },
      w: { book, sheet: "S" },
      k: { folders: [] },
      o: { out: null },
    });
  });

  test("보내는 값에 보이는 폴더 칸의 실제 경로를 붙인다(P1)", () => {
    const payload = { project: "P", tabs: { m: { folder: meetings }, w: { book, sheet: "기본" } } };
    const draft = { m: { folder: meetings, folderRealPath: "/x" }, w: {} };
    expect(withRealPaths(payload, TABS, draft).tabs).toEqual({ m: { folder: meetings, folderRealPath: "/x" }, w: { book, sheet: "기본" } });
  });

  test("템플릿 {{TODAY}} 는 로컬 날짜로 모두 바뀐다(S52)", () => {
    expect(templateBody("a {{TODAY}} b {{TODAY}}", new Date(2026, 0, 5, 23, 59))).toBe("a 2026-01-05 b 2026-01-05");
  });
});

group("탭 상태(S17·S18·폴더 다시 연결)", () => {
  const desc = (values) => describe({ project: "P", tabs: values }, TABS);
  const fsa = (perm, supported = true) => ({ supported: () => supported, permission: async (h) => perm[h.name] ?? "granted" });

  test("권한이 prompt 면 pending, denied 면 그 탭만 실패", async () => {
    const statuses = await tabStatus(desc({ m: { folder: meetings }, w: { book, sheet: "S" } }), fsa({ meetings: "prompt", "wbs.xlsx": "denied" }));
    expect(statuses.map(({ id, ok }) => [id, ok])).toEqual([["m", true], ["w", false]]);
    expect(statuses[0].pending.map((p) => [p.tab, p.key, p.label, p.handle])).toEqual([["m", "folder", "폴더", meetings]]);
    expect(statuses[1].error).toBe("파일 권한이 거부됐다(⚙ 설정에서 다시 고른다)");
  });

  test("가져온 설정처럼 핸들이 비면 다시 고르라고 한다", async () => {
    const [status] = await tabStatus(desc({ m: { folder: null } }), fsa({}));
    expect([status.ok, status.error]).toEqual([false, "폴더을(를) 다시 고른다(⚙ 설정)"]);
  });

  test("미지원 브라우저면 파일 탭은 실패, 경로 칸 없는 탭은 그대로", async () => {
    const tabs = [...TABS, tab("t", [field("name", "이름", "text")])];
    const statuses = await tabStatus(describe({ project: "P", tabs: { m: { folder: meetings }, t: { name: "x" } } }, tabs), fsa({}, false));
    expect(statuses.map(({ id, ok }) => [id, ok])).toEqual([["m", false], ["t", true]]);
  });
});

group("manifest", () => {
  test("plans 항목은 로컬판 Tab.describe() 와 같고 src·템플릿 주소만 상대 경로다(P1·P2·S52)", () => {
    const local = python(`import json; from tabs.plans import TAB; print(json.dumps(TAB.describe(), ensure_ascii=False))`);
    const web = WEB_TABS.find((item) => item.id === "plans");
    const strip = ({ src, templates, fields, ...rest }) => ({ ...rest, fields: fields.map(({ realPath, ...f }) => f), templates: templates.map(({ url, ...t }) => t) });
    expect(strip(web)).toEqual(strip(local));
    expect(web.src).toBe("tabs/plans/");
    expect(web.templates[0].url).toBe("tabs/plans/templates/YYYY-MM-DD 계획 제목.md");
    expect(web.fields[0].realPath).toBe(true);
  });
});
