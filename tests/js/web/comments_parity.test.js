// 웹 comments 탭 판정·체크리스트 md 이식 확인. 같은 TROMBONE 응답 예제(tests/js/web/comments_fixture.py)를
// 로컬판 Python(tabs/comments/model.py·markdown.py·service.py)과 웹 JS(web/tabs/comments/*.js)에 넣어 결과를 맞춘다.
import { beforeAll, describe, expect, test } from "bun:test";
import { buildMarkdown, mdQuote } from "../../../web/tabs/comments/markdown.js";
import {
  alreadyEyed, categoryCounts, classify, clip, collect, locked, pagePayload, pyCmp, pySquash, pyStrip, SELF_CLOSE_RE, targetOf,
} from "../../../web/tabs/comments/model.js";
import { python, REPO } from "./support.js";

let data;
beforeAll(() => {
  const run = Bun.spawnSync(["python3", "tests/js/web/comments_fixture.py"], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  data = JSON.parse(run.stdout.toString());
});

const plain = (value) => JSON.parse(JSON.stringify(value));
const fetchBundle = (path) => Promise.resolve(structuredClone(data.inputs.bundles[path]));

describe("코멘트 목록은 로컬판 model.collect·page_payload 와 같다", () => {
  test("시나리오 넷(덮어쓰기 있음·없음, 남의 코멘트, 코멘트 없는 사람)", async () => {
    expect(data.scenarios.length).toBe(4);
    for (const s of data.scenarios) {
      const { rows, pages, answered } = await collect(structuredClone(data.inputs.inbox), fetchBundle, s.author, structuredClone(s.overrides));
      expect({ name: s.name, rows: plain(rows) }).toEqual({ name: s.name, rows: s.rows });
      expect({ name: s.name, pages: plain([...pages.values()]) }).toEqual({ name: s.name, pages: s.pages });
      expect(answered).toBe(s.answered);
      expect({ name: s.name, payload: plain(pagePayload(pages)) }).toEqual({ name: s.name, payload: s.payload });
      expect(categoryCounts(rows)).toEqual(s.cats);
      const perRow = Object.fromEntries(rows.map((r) => [r.commentId, [targetOf(r), alreadyEyed(r, s.author), locked(r)]]));
      expect(perRow).toEqual(s.perRow);
    }
  });

  test("예제가 판정 갈래를 다 지난다(자기 종결·내 본문 👀·답글 👀·타인 👀·메타 없는 화면·잘못된 등급)", () => {
    const rows = Object.fromEntries(data.scenarios[0].rows.map((r) => [r.commentId, r]));
    expect(rows.CM14.resolved).toStartWith("작성자 본인이 종결한 답글이다");
    expect(rows.CM13.decidedOn).toEqual(["코멘트 본문"]);
    expect(rows.CM10.decidedOn).toEqual(["답글 `CM12`"]);
    expect(rows.CM23.decided).toBe(false);
    expect(rows.CM10.scrnId).toBe("-");
    expect(rows.CM1.priorityLevel).toBe("");
    expect(rows.CM20.resolvedOwn && rows.CM20.answered).toBe(true);
    const head = data.scenarios[0].payload.find((p) => p.pageId === "P3").comments.find((c) => c.id === "CM10").head;
    expect(head.endsWith("😀😀…")).toBe(true); // 코드 포인트로 자른다(UTF-16 으로 자르면 서로게이트가 깨진다)
  });

  test("bundle 은 페이지마다 한 번, 내 코멘트가 있는 페이지만 부른다", async () => {
    const calls = [];
    await collect(data.inputs.inbox, (path) => { calls.push(path); return fetchBundle(path); }, data.inputs.me, {});
    expect(calls.sort()).toEqual(["/spec/a", "/spec/c", "/spec/d"]);
  });
});

describe("체크리스트 md 는 로컬판 build_markdown 과 글자까지 같다", () => {
  test("코멘트가 있는 시나리오 셋", async () => {
    let compared = 0;
    for (const s of data.scenarios.filter((x) => x.markdown !== null)) {
      const { rows, pages, answered } = await collect(structuredClone(data.inputs.inbox), fetchBundle, s.author, structuredClone(s.overrides));
      const md = buildMarkdown(rows, pages, answered, { base: data.inputs.base, author: s.author, date: data.inputs.today, collected: data.inputs.now });
      expect({ name: s.name, md }).toEqual({ name: s.name, md: s.markdown });
      compared++;
    }
    expect(compared).toBe(3);
  });
});

describe("Python 문자열 규칙 이식", () => {
  const cases = [
    "  앞뒤 공백  ", " nbsp ", "　전각　", "\x1c제어\x1f", "﻿BOM", "탭\t\n줄", "", "😀 이모지 😀",
    "a b ", "x\x85y",
  ];
  test("strip·split·join·자르기·분류·자기 종결 정규식이 Python 과 같다", () => {
    const want = python(`
import json, sys
from tabs.comments import model
from tabs.comments.markdown import md_quote
cases = json.loads(sys.argv[1])
print(json.dumps({
  "strip": [c.strip() for c in cases],
  "squash": [" ".join(c.split()) for c in cases],
  "clip": [model.clip(c, 3) for c in cases],
  "quote": [md_quote(c) for c in cases if c.strip()],
  "selfClose": [bool(model.SELF_CLOSE_RE.search(t)) for t in json.loads(sys.argv[2])],
  "classify": [model.classify(t) for t in json.loads(sys.argv[3])],
  "sorted": sorted(json.loads(sys.argv[4])),
}, ensure_ascii=False))`, [JSON.stringify(cases),
      JSON.stringify(["답변 안 하셔도 됩니다", "답변　안 주셔도", "회신 불필요", "답글은 필요 없습니다", "답변" + "가".repeat(14) + "않아도",
        "답변" + "가".repeat(15) + "않아도", "답변😀😀😀😀😀😀😀😀😀😀😀😀😀😀않아도", "답변\n않아도"]),
      JSON.stringify(["😀".repeat(55) + "담당자 지정", "가".repeat(55) + "담당자 지정", "[메시지 코드] 추가", "아무 말"]),
      JSON.stringify(["가", "😀", "￿", "a", "B", "", "가나"])]);
    expect(cases.map(pyStrip)).toEqual(want.strip);
    expect(cases.map(pySquash)).toEqual(want.squash);
    expect(cases.map((c) => clip(c, 3))).toEqual(want.clip);
    expect(cases.filter((c) => pyStrip(c)).map(mdQuote)).toEqual(want.quote);
    expect(["답변 안 하셔도 됩니다", "답변　안 주셔도", "회신 불필요", "답글은 필요 없습니다", "답변" + "가".repeat(14) + "않아도",
      "답변" + "가".repeat(15) + "않아도", "답변😀😀😀😀😀😀😀😀😀😀😀😀😀😀않아도", "답변\n않아도"].map((t) => SELF_CLOSE_RE.test(t))).toEqual(want.selfClose);
    expect(["😀".repeat(55) + "담당자 지정", "가".repeat(55) + "담당자 지정", "[메시지 코드] 추가", "아무 말"].map(classify)).toEqual(want.classify);
    expect(["가", "😀", "￿", "a", "B", "", "가나"].sort(pyCmp)).toEqual(want.sorted);
  });
});
