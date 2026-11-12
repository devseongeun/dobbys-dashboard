// assets 파서·목록 렌더 이식 확인. 같은 예제 HTML 폴더를 로컬판 tabs/assets/assets_index.py(+ assets_index_html.py)와
// web/tabs/assets/assets_index.js 에 넣어 문서 값·순서·경고·목록 md·화면 조각을 맞춘다.
// 로컬판 tests/test_assets_mount.py 의 입력·기대값도 그대로 옮겼다.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  byDate, displayName, isDocName, metaTags, parseMd, readDoc, readFolder, readText, renderParts, summarize,
} from "../../../web/tabs/assets/assets_index.js";
import { WEB_TABS } from "../../../web/tabs/manifest.js";
import { REPO, dirHandle, python, tempFolder, write } from "./support.js";

const TEMPLATE = readFileSync(join(REPO, "tabs/assets/templates/의사결정_문서_제목.html"), "utf-8");
const PROBE = readFileSync(join(REPO, "tests/web_check/assets/DEMO_1.0.0_결재선_흐름_설명.html"), "utf-8");
// tests/test_assets_mount.py 의 입력.
const DOC = '<section class="docst" data-doc="open"></section>'
  + "회신 대상<b>기획</b> 집계<b>미결 1 · 완료 2 · 취소됨 0</b> 최종 갱신<b>2026-11-04</b>";
const TAGGED = '<html><head><meta charset="utf-8"><meta name="feature" content="외부 결재, 배포">'
  + '<meta name="created" content="2026-10-01"></head><body>설명</body></html>';

const head = (feature, created) => `<head><meta name="feature" content="${feature}"><meta name="created" content="${created}"></head>`;
const status = (doc, who, open, done, cancel, updated) => `<section class="docst" data-doc="${doc}">`
  + `<p class="docst-meta"><span>회신 대상<b>${who}</b></span><span>집계<b>미결 ${open} · 완료 ${done} · 취소됨 ${cancel}</b></span>`
  + `<span>최종 갱신<b>${updated}</b></span></p></section>`;
const docinfo = (version) => `<!-- docinfo:begin --><p><span class="scope-label">버전</span><span class="scope-chip">${version}</span></p><!-- docinfo:end -->`;

// 파서 규칙이 갈릴 만한 경우를 한 폴더에 모은다.
const FIXTURE = {
  "TRB_4.0.0_결재_정책.html": DOC,
  "ABC_v2_배포_설명.html": TAGGED,
  "의사결정_문서_제목.html": TEMPLATE.replaceAll("{{TODAY}}", "2026-11-09"),
  "DEMO_1.0.0_결재선_흐름_설명.html": PROBE,
  "TRB_4.0.0_결제_취소_정책.html": head("결제", "2026-11-03") + status("open", "결제팀 정민수", 2, 1, 0, "2026-11-08"),
  "TRB_4.0.0_결제_한도.html": head("결제", "2026-11-03") + status("open", "재무 | 회계", 0, 3, 1, "2026-11-09"),
  "TRB_4.0.0_알림_검수.html": head("알림", "2026-11-07") + status("open", " 운영 박하늘 ", 1, 0, 0, "2026-11-07"),
  "TRB_4.0.0_주문_종결.html": head("주문, 결제", "2026-11-01") + status("closed", "기획", 0, 2, 0, "2026-11-02"),
  "TRB_4.0.0_회원_종결.html": head("회원", "2026-10-20") + status("closed", "기획 이해리", 0, 2, 1, "2026-10-25"),
  "TRB_4.0.0_집계_없음.html": head("주문", "2026-11-02") + '<section class="docst" data-doc="open">집계 줄을 지웠다</section>',
  "TRB_4.0.0_숫자_전각.html": head("주문", "2026-11-05") + status("open", "기획", "١", "０", "1", "２０２６-11-05"),
  "TRB_4.0.0_버전_v1.0.html": head("배포", "2026-10-11") + docinfo("v1.1"),
  "TRB_4.0.0_버전_v1.1.html": head("배포", "2026-10-12") + docinfo("v1.1"),
  "TRB_4.0.0_버전_v2.html": head("배포", "2026-10-13"),
  "EXCN_TYPE_CD_설명.html": head("코드", "2026-10-02"),
  "배포_설명.html": head("배포", "2026-10-03"),
  "같은_이름.html": head("배포", "2026-10-04"),
  "TRB_1.0_같은_이름.html": head("배포", "2026-10-05"),
  "대문자_메타.html": '<HEAD><META NAME="FEATURE" CONTENT=" 대문자 , , 메타 "><Meta Name="created" Content="2026-10-06"></HEAD>',
  "메타_순서_반대.html": '<head><meta content="X" name="feature"><meta name="created" content="2026-10-07"><meta name="created" content="2026-10-08"></head>',
  "특수문자_<b>&'\".html": head("<b>&'\"", "2026-10-09"),
  "괄호 공백 (초안)!.html": head("배포|운영", "2026-10-10") + status("closed", "<i>운영</i>", 0, 1, 0, "2026-10-10"),
  [`${"한글_NFD_문서".normalize("NFD")}.html`]: head("정규화", "2026-10-15"),
  "CRLF.html": "<head>\r\n<meta name=\"feature\" content=\"줄바꿈\">\r\n<meta name=\"created\" content=\"2026-10-16\">\r\n</head>\r\n"
    + status("open", "줄 바꿈 아님", 1, 0, 0, "2026-10-16").replaceAll("</span><span>", "</span>\r\n<span>") + "\r끝\r",
  "BOM.html": "﻿" + head("인코딩", "2026-10-17"),
  ".숨김.html": head("숨김", "2026-10-18"),
  "00_90-assets_목록.html": "목록 화면 자신은 뺀다",
  "00_다른_목록.html": head("빠짐", "2026-10-20"),
  "notes.txt": "x",
  "대문자.HTML": head("빠짐", "2026-10-21"),
  "부속/하위.html": head("빠짐", "2026-10-22"),
};

const PY = `
import json, re, sys
from pathlib import Path
from tabs.assets import assets_index, assets_index_html
folder = Path(sys.argv[1])
paths = [p for p in sorted(folder.glob("*.html")) if not p.name.startswith("00_")]
docs = [assets_index.read(p) for p in paths]
out = {"docs": docs, "sections": {s: assets_index.by_date(docs, s) for s in ("open", "closed", "reference")}}
try:
    result = assets_index.sync(folder, check=True)
    out.update(counts=result["counts"], warnings=result["warnings"], error=None)
except Exception as exc:
    out.update(counts=None, warnings=None, error=f"{type(exc).__name__}: {exc}")
out["md"] = assets_index.render(docs, folder)
if out["error"] is None:
    out["parsed"] = assets_index_html.parse(out["md"])
    assets_index_html.fill = lambda template, values: values
    parts = assets_index_html.render_html(out["md"], folder)
    # 로컬판 링크는 같은 폴더 파일, 웹판은 뷰어(view.html#<파일명>)다. 경로 복사 버튼(절대 경로)은 웹판에서 따로 본다.
    fix = lambda s: re.sub(r'<button type="button" class="f copy-path"[^>]*>경로 복사</button>', "", s).replace(
        '<span class="doc-entry"><a href="', '<span class="doc-entry"><a href="view.html#')
    out["parts"] = {k: fix(parts[k]) for k in ("STATS", "TABS", "CHIPS", "PANELS")}
print(json.dumps(out, ensure_ascii=False))
`;

const fill = (folder, files) => {
  for (const [name, text] of Object.entries(files)) write(folder, name, text);
};
const local = (folder) => python(PY, [folder]);
const web = async (folder) => summarize(await readFolder(dirHandle(folder)), "90-assets");

describe("로컬판 assets_index.py 와 같은 예제 폴더 비교", () => {
  let fixture;
  let expected;
  let actual;
  beforeAll(async () => {
    fixture = tempFolder("90-assets");
    fill(fixture.folder, FIXTURE);
    expected = local(fixture.folder);
    actual = await web(fixture.folder);
  });
  afterAll(() => fixture.cleanup());

  test("예제 폴더가 로컬판에서 실패 없이 읽힌다(비교의 전제)", () => {
    expect(expected.error).toBeNull();
    expect(actual.error).toBeNull();
  });

  test("문서마다 기능 구분·작성일·회신 대상·미결/완료/취소됨·최종 갱신·상태·화면 이름이 같다(A3–A7)", () => {
    expect(actual.docs).toEqual(expected.docs);
  });

  test("진행 중·종결·참고 구역과 순서가 같다(A8)", () => {
    expect(actual.sections).toEqual(expected.sections);
  });

  test("건수와 경고 문구가 같다(A9)", () => {
    expect(actual.counts).toEqual(expected.counts);
    expect(actual.warnings).toEqual(expected.warnings);
    expect(actual.warnings.length).toBeGreaterThan(4);
  });

  test("목록 md(로컬판이 00_<폴더명>_목록.md 로 쓰는 글)가 글자까지 같다(A13)", () => {
    expect(actual.md).toBe(expected.md);
  });

  test("목록 화면 조각(요약 카드·탭·기능 칩·표)이 같은 마크업이다(A8·A10·A11)", () => {
    expect(actual.parsed).toEqual(expected.parsed);
    const parts = renderParts(actual.parsed);
    expect(parts.stats).toBe(expected.parts.STATS);
    expect(parts.tabs).toBe(expected.parts.TABS);
    expect(parts.chips).toBe(expected.parts.CHIPS);
    expect(parts.panels).toBe(expected.parts.PANELS);
  });

  test("바로 아래 *.html 만(숨김 포함), 00_·하위 폴더·.HTML·다른 확장자는 뺀다(A3)", () => {
    const files = actual.docs.map((d) => d.file);
    expect(files).toContain(".숨김.html");
    for (const name of ["00_90-assets_목록.html", "00_다른_목록.html", "notes.txt", "대문자.HTML", "하위.html"]) expect(files).not.toContain(name);
    expect([isDocName("00_x.html"), isDocName("x.HTML"), isDocName("x.htm"), isDocName(".x.html")]).toEqual([false, false, false, true]);
  });
});

describe("로컬판이 목록 전체를 실패하는 입력은 웹판도 실패한다", () => {
  const cases = {
    "회신 대상에 줄바꿈": { "a.html": status("open", "줄\n바꿈", 1, 0, 0, "2026-11-01") },
    "파일명에 ]": { "a]b.html": head("x", "2026-11-01") },
    "화면 이름이 비는 파일명(.html)": { ".html": head("x", "2026-11-01") },
  };
  for (const [label, files] of Object.entries(cases)) {
    test(label, async () => {
      const fixture = tempFolder("90-assets");
      try {
        fill(fixture.folder, files);
        const expected = local(fixture.folder);
        const actual = await web(fixture.folder);
        expect(expected.error).not.toBeNull();
        expect(actual.error).not.toBeNull();
        expect(actual.error.split(":")[0]).toBe(expected.error.split(":")[0]);
        expect(actual.md).toBe(expected.md);
      } finally {
        fixture.cleanup();
      }
    });
  }

  test(".html 이름의 폴더", async () => {
    const fixture = tempFolder("90-assets");
    try {
      mkdirSync(join(fixture.folder, "폴더.html"));
      expect(() => local(fixture.folder)).toThrow(/IsADirectoryError/);
      await expect(readFolder(dirHandle(fixture.folder))).rejects.toThrow(/IsADirectoryError/);
    } finally {
      fixture.cleanup();
    }
  });

  test("깨진 UTF-8", async () => {
    const fixture = tempFolder("90-assets");
    try {
      write(fixture.folder, "a.html", Buffer.from([0x3c, 0xff, 0x3e]));
      expect(() => local(fixture.folder)).toThrow(/UnicodeDecodeError/);
      await expect(readFolder(dirHandle(fixture.folder))).rejects.toThrow();
    } finally {
      fixture.cleanup();
    }
  });
});

describe("로컬판 test_assets_mount.py 와 같은 입력·기대값", () => {
  test("meta 가 없으면 기능 구분 없음·작성일 없음 경고, 상태 표로 진행 중·참고를 센다", () => {
    const data = summarize([{ name: "TRB_4.0.0_결재_정책.html", text: DOC }, { name: "ABC_v2_배포_설명.html", text: TAGGED }], "90-assets");
    expect(data.counts).toEqual({ open: 1, closed: 0, reference: 1 });
    expect(data.warnings.map((w) => w.split(":")[0])).toEqual(["기능 구분 없음", "작성일 없음"]);
    expect(data.warnings.every((w) => w.includes("결재_정책"))).toBe(true);
    expect(data.md).toContain("| 외부 결재, 배포 | [[ABC_v2_배포_설명.html\\|배포 설명]] | 2026-10-01 |");
  });

  test("프로젝트_버전_ 접두어는 어떤 프로젝트든 뗀다", () => {
    for (const [name, title] of [["TRB_4.0.0_결재_정책.html", "결재 정책"], ["ABC_v2_배포_설명.html", "배포 설명"],
      ["배포_설명.html", "배포 설명"], ["EXCN_TYPE_CD_설명.html", "EXCN_TYPE_CD 설명"]]) {
      expect(displayName(name)).toBe(title);
    }
  });

  test("내려받은 템플릿은 meta·집계가 든 진행 중 문서로 읽힌다(A2)", () => {
    const today = "2026-11-12";
    const doc = readDoc("의사결정_문서_제목.html", TEMPLATE.replaceAll("{{TODAY}}", today));
    expect([doc.title, doc.state, doc.features, doc.date, doc.who, doc.open, doc.done, doc.updated])
      .toEqual(["의사결정 문서 제목", "open", ["기능 구분 A", "기능 구분 B"], today, "담당자 이름", "2", "0", today]);
  });

  test("구역 안은 작성일 내림차순, 묶음은 최신 작성일 순, 기능 구분 없는 문서는 맨 뒤, 작성일 없음(-)은 묶음 안 맨 뒤(A8)", () => {
    const docs = [
      { file: "b-old", state: "closed", features: ["B"], date: "2026-11-03", updated: "2026-11-09" },
      { file: "a-old", state: "closed", features: ["A"], date: "2026-11-04" },
      { file: "a-new", state: "closed", features: ["A"], date: "2026-11-05" },
      { file: "b-new", state: "closed", features: ["B"], date: "2026-11-04" },
      { file: "b-nodate", state: "closed", features: ["B"], date: "-" },
      { file: "none", state: "closed", features: [], date: "2026-11-06" },
      { file: "other", state: "open", features: ["A"], date: "2026-11-07" },
    ];
    expect(byDate(docs, "closed").map((d) => d.file)).toEqual(["a-new", "a-old", "b-new", "b-old", "b-nodate", "none"]);
  });
});

describe("세부 규칙", () => {
  test("meta 는 대소문자를 가리지 않고 마지막 것이 이긴다, 속성 순서가 바뀌면 못 읽는다", () => {
    expect(metaTags('<META NAME="Feature" CONTENT="a, b"><meta name="feature" content=" c ">')).toEqual({ features: ["c"], date: "-" });
    expect(metaTags('<meta content="x" name="feature">')).toEqual({ features: [], date: "-" });
  });

  test("파일을 읽을 때 \\r\\n·\\r 은 \\n 으로, BOM 은 그대로(Python read_text)", () => {
    const bytes = new TextEncoder().encode("﻿a\r\nb\rc");
    expect(readText(bytes.buffer)).toBe("﻿a\nb\nc");
  });

  test("파일명 끝 버전·문서 정보 줄 버전이 화면 이름에 붙는다", () => {
    expect(readDoc("TRB_4.0.0_버전_v1.0.html", docinfo("v1.1")).title).toBe("버전 v1.1");
    expect(readDoc("TRB_4.0.0_버전_v2.html", "").title).toBe("버전 v2");
    expect(readDoc("버전.html", docinfo("v3")).title).toBe("버전 v3");
  });

  test("목록 표의 건수가 어긋나면 실패한다(로컬판 parse ValueError)", () => {
    expect(() => parseMd("## 참고 (2)\n\n| 기능 구분 | 문서 | 작성일 |\n| --- | --- | --- |\n| - | [[a.html\\|a]] | - |\n")).toThrow(/ValueError/);
  });

  test("경로 복사 버튼은 넘겨준 함수가 만든 것만 들어가고, 문서 링크는 뷰어로 간다(A15·A17)", () => {
    const { parsed } = summarize([{ name: "TRB_4.0.0_a b.html", text: TAGGED }], "90-assets");
    const without = renderParts(parsed).panels;
    expect(without).not.toContain("copy-path");
    expect(without).toContain('href="view.html#TRB_4.0.0_a%20b.html"');
    const withButton = renderParts(parsed, (file) => `<button data-copy-file="${file}">경로 복사</button>`).panels;
    expect(withButton).toContain('<button data-copy-file="TRB_4.0.0_a b.html">경로 복사</button>');
  });
});

describe("manifest", () => {
  test("assets 항목은 로컬판 Tab.describe() 와 같고 src·템플릿 주소만 상대 경로다(A1·A2)", () => {
    const localTab = python(`import json; from tabs.assets import TAB; print(json.dumps(TAB.describe(), ensure_ascii=False))`);
    const item = WEB_TABS.find((tab) => tab.id === "assets");
    const strip = ({ src, templates, fields, ...rest }) => ({ ...rest, fields: fields.map(({ realPath, ...f }) => f), templates: templates.map(({ url, ...t }) => t) });
    expect(strip(item)).toEqual(strip(localTab));
    expect(item.src).toBe("tabs/assets/");
    expect(item.templates[0].url).toBe("tabs/assets/templates/의사결정_문서_제목.html");
    expect(item.fields[0].realPath).toBe(true);
  });

  test("탭 순서는 로컬판 ALL_TABS 순서를 따른다", () => {
    const order = python(`import json; from tabs import ALL_TABS; print(json.dumps([t.id for t in ALL_TABS]))`);
    const ids = WEB_TABS.map((tab) => tab.id);
    expect(ids).toEqual(order.filter((id) => ids.includes(id)));
  });
});
