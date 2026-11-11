// 브라우저 저장소(web/lib/store.js)를 메모리 계층에 끼워 확인한다. IndexedDB 자체는 격리 서버 Chrome 확인에서 본다.
import { beforeEach, expect, test } from "bun:test";
import {
  FORMAT, exportAll, importAll, loadConfig, memoryBackend, saveConfig, tabState, useBackend,
} from "../../../web/lib/store.js";

let mem;
beforeEach(() => { mem = memoryBackend(); useBackend(mem); });

const handle = (kind, name) => ({ kind, name, isSameEntry: async () => false });

test("설정이 없으면 null, 저장하면 그대로 읽힌다(S1·S46)", async () => {
  expect(await loadConfig()).toBeNull();
  await saveConfig({ project: "P", tabs: { plans: { folder: null } }, order: ["plans"] });
  expect(await loadConfig()).toEqual({ project: "P", tabs: { plans: { folder: null } }, order: ["plans"] });
  expect(mem.stores.config.get("current").version).toBe(1);
});

test("형식·버전이 틀린 레코드는 broken-<시각> 으로 옮기고 온보딩(null)(S45)", async () => {
  for (const bad of [{ version: 2, project: "P", tabs: {} }, "oops", { version: 1, tabs: {} }, { version: 1, project: "P", tabs: [] }]) {
    mem = memoryBackend();
    useBackend(mem);
    await mem.put("config", "current", bad);
    expect(await loadConfig()).toBeNull();
    expect(mem.stores.config.has("current")).toBe(false);
    const aside = [...mem.stores.config.keys()].filter((key) => key.startsWith("broken-"));
    expect(aside.length).toBe(1);
    expect(mem.stores.config.get(aside[0])).toEqual(bad);
  }
});

test("저장 전에 형식을 검사한다(S32)", async () => {
  await expect(saveConfig({ project: "", tabs: {} })).rejects.toThrow("설정 형식이 아니다");
});

test("탭 상태는 프로젝트 이름별로 따로 있고, 돌아오면 그대로다(S50)", async () => {
  await saveConfig({ project: "A", tabs: { plans: {} } });
  const state = tabState("wbs");
  await state.set("links", { "R-1": "PROJ-1" });
  expect(await state.get("links")).toEqual({ "R-1": "PROJ-1" });
  expect(mem.stores.state.has("A/wbs/links")).toBe(true);
  await saveConfig({ project: "B", tabs: { plans: {} } });
  expect(await state.get("links")).toBeUndefined();
  await saveConfig({ project: "A", tabs: { plans: {} } });
  expect(await state.get("links")).toEqual({ "R-1": "PROJ-1" });
  await state.remove("links");
  expect(await state.get("links")).toBeUndefined();
});

test("설정 전에는 탭 상태를 쓸 수 없다", async () => {
  await expect(tabState("wbs").set("x", 1)).rejects.toThrow("설정이 먼저다");
});

test("내보내기: 핸들은 이름만, 비밀값처럼 보이는 키는 빼고 JSON 으로 옮길 수 있다", async () => {
  mem = memoryBackend({ clone: false });
  useBackend(mem);
  await saveConfig({ project: "P", tabs: { plans: { folder: handle("directory", "10-plans"), folderRealPath: "/x/10-plans" } }, order: ["plans"] });
  await tabState("wbs").set("plan-drafts", { "PROJ-1": { start: "2026-11-01", file: handle("file", "a.xlsx") } });
  await tabState("wbs").set("jira-token", "secret");
  const data = await exportAll();
  expect(data.format).toBe(FORMAT);
  expect(data.config).toEqual({ project: "P", tabs: { plans: { folder: { $handle: "directory", name: "10-plans" }, folderRealPath: "/x/10-plans" } }, order: ["plans"] });
  expect(data.state).toEqual({ "P/wbs/plan-drafts": { "PROJ-1": { start: "2026-11-01", file: { $handle: "file", name: "a.xlsx" } } } });
  expect(JSON.stringify(data)).not.toContain("secret");
  expect(JSON.parse(JSON.stringify(data))).toEqual(data);
});

test("가져오기: 핸들 자리는 비우고 다시 골라야 할 칸을 알려 준다", async () => {
  const data = {
    format: FORMAT, version: 1,
    config: { project: "P", tabs: { plans: { folder: { $handle: "directory", name: "10-plans" }, folderRealPath: "/x" } }, order: ["plans", 3] },
    state: { "P/wbs/links": { "R-1": "PROJ-1" }, "P/wbs/token": "x", "bad-key": 1 },
  };
  const result = await importAll(JSON.parse(JSON.stringify(data)));
  expect(result).toEqual({ project: "P", missing: ["plans.folder"] });
  expect(await loadConfig()).toEqual({ project: "P", tabs: { plans: { folder: null, folderRealPath: "/x" } }, order: ["plans"] });
  expect([...mem.stores.state.keys()]).toEqual(["P/wbs/links"]);
});

test("가져오기: 다른 파일이면 아무것도 바꾸지 않는다", async () => {
  await saveConfig({ project: "Keep", tabs: { plans: {} } });
  for (const bad of [null, {}, { format: FORMAT, version: 2 }, { format: FORMAT, version: 1, config: { project: "", tabs: {} } }]) {
    await expect(importAll(bad)).rejects.toThrow();
  }
  expect((await loadConfig()).project).toBe("Keep");
});
