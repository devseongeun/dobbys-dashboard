// 주간 보고 탭 등록(manifest)·템플릿 공유·확인 완료 기록(IndexedDB tabState) 확인.
import { afterEach, describe, expect, test } from "bun:test";
import { WEB_TABS } from "../../../web/tabs/manifest.js";
import { memoryBackend, saveConfig, stateKey, tabState, useBackend } from "../../../web/lib/store.js";
import { REVIEWED, cleanReviewed, loadReviewed, saveReviewed, toggled } from "../../../web/tabs/weekly/review.js";
import { python } from "./support.js";

describe("manifest", () => {
  test("weekly 항목은 로컬판 Tab.describe() 와 같고 src·템플릿 주소만 상대 경로다", () => {
    const local = python(`import json; from tabs.weekly import TAB; print(json.dumps(TAB.describe(), ensure_ascii=False))`);
    const web = WEB_TABS.find((item) => item.id === "weekly");
    const strip = ({ src, templates, ...rest }) => ({ ...rest, templates: templates.map(({ url, ...t }) => t) });
    expect(strip(web)).toEqual(strip(local));
    expect(web.src).toBe("tabs/weekly/");
    expect(web.fields[0].kind).toBe("dirs");
    expect(web.experimental).toBe(true);
  });

  test("순서는 로컬판 ALL_TABS 순서에서 웹에 있는 탭만 남긴 것이다", () => {
    const order = python(`import json; from tabs import ALL_TABS; print(json.dumps([t.id for t in ALL_TABS]))`);
    const ids = WEB_TABS.map((item) => item.id);
    expect(ids).toEqual(order.filter((id) => ids.includes(id)));
  });

  test("템플릿 주소는 web_serve.py SHARED_FILES 가 로컬판의 같은 파일로 준다(복사하지 않는다)", () => {
    const shared = python(`import json, web_serve
print(json.dumps({k: str(v.relative_to(web_serve.REPO_ROOT)) for k, v in web_serve.SHARED_FILES.items()}, ensure_ascii=False))`);
    const url = WEB_TABS.find((item) => item.id === "weekly").templates[0].url;
    expect(shared[url]).toBe("tabs/weekly/templates/YYYY-MM-DD 주간 보고.md");
  });
});

describe("확인 완료 기록(tabState weekly / reviewed)", () => {
  afterEach(() => useBackend(null));

  test("{slug: ISO} 로 IndexedDB 에 남고, 다시 열어도 그대로 읽힌다. 모두 해제하면 키를 지운다", async () => {
    const backend = memoryBackend();
    useBackend(backend);
    await saveConfig({ project: "DEMO 1.0.0", tabs: { weekly: { folders: [] } } });
    const state = tabState("weekly");
    expect(await loadReviewed(state)).toEqual({});

    const at = new Date("2026-11-12T03:04:05.678Z");
    let map = toggled({}, "2026-11-13", true, at);
    await saveReviewed(state, map);
    expect(backend.stores.state.get(stateKey("DEMO 1.0.0", "weekly", REVIEWED))).toEqual({ "2026-11-13": "2026-11-12T03:04:05.678Z" });
    // 새로고침 = 같은 저장소를 새로 읽는다.
    expect(await loadReviewed(tabState("weekly"))).toEqual({ "2026-11-13": "2026-11-12T03:04:05.678Z" });

    map = toggled(map, "2026-11-13", false);
    await saveReviewed(state, map);
    expect(backend.stores.state.has(stateKey("DEMO 1.0.0", "weekly", REVIEWED))).toBe(false);
  });

  test("모양이 틀린 기록은 문자열 키·값만 남긴다(로컬판 load_reviewed)", () => {
    expect(cleanReviewed(null)).toEqual({});
    expect(cleanReviewed(["x"])).toEqual({});
    expect(cleanReviewed({ a: "2026-01-01T00:00:00.000Z", b: 1, c: "", d: null })).toEqual({ a: "2026-01-01T00:00:00.000Z" });
  });
});
