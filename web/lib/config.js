// 설정 검증·사이드바 순서·셸 상태. 로컬판 dashboard/config.py(normalize)·dashboard/app.py(_ordered·describe)의 규칙을 옮겼다.
// DOM·IndexedDB 를 모르는 순수 함수다(tests/js/web/config.test.js). 저장은 store.js, 화면은 shell/*.js 가 한다.
import { isHandle } from "./fsa.js";

export const PATH_KINDS = new Set(["dir", "file", "dirs"]);
const HANDLE_KIND = { dir: "directory", file: "file", dirs: "directory" };
export const realPathKey = (key) => `${key}RealPath`;

// 조건(when: [다른 필드 key, 값])이 맞을 때만 보인다. 검증 중에는 앞에서 이미 정규화한 값으로 본다(config.py Field.shown).
const shown = (field, settings) => !field.when || settings[field.when[0]] === field.when[1];
const text = (raw) => String(raw ?? "").trim();
const blank = (raw) => raw === null || raw === undefined || (typeof raw === "string" && !raw.trim());

function fieldValue(field, raw) {
  if (field.kind === "choice") {
    const value = text(raw) || field.default;
    return (field.options ?? []).some(([option]) => option === value) ? [value, null] : [field.default, "목록에 있는 값을 고르세요"];
  }
  if (field.kind === "dirs") {
    const items = (Array.isArray(raw) ? raw : [raw]).filter((item) => !blank(item));
    if (items.some((item) => !isHandle(item) || item.kind !== "directory")) return [[], "폴더를 다시 고르세요"];
    if (!items.length) return [[], field.required ? "폴더를 하나 이상 고르세요" : null];
    return [items, null];
  }
  if (PATH_KINDS.has(field.kind)) {
    if (blank(raw)) return [null, field.required ? "필수 항목입니다" : null];
    if (!isHandle(raw) || raw.kind !== HANDLE_KIND[field.kind]) return [null, field.kind === "dir" ? "폴더를 다시 고르세요" : "파일을 다시 고르세요"];
    return [raw, null];
  }
  const value = text(raw) || field.default || "";
  if (!value) return ["", field.required ? "필수 항목입니다" : null];
  return [value, null];
}

// 프로젝트 이름은 IndexedDB 상태 키 앞부분(<project>/<tab>/<name>)이 된다. 로컬판과 같은 규칙.
export function projectError(raw, tabIds) {
  const name = text(raw);
  if (!name) return [name, "프로젝트 이름을 입력하세요"];
  if (/[/\\\x00]/.test(name) || name.startsWith(".")) return [name, "폴더 이름에 쓸 수 없는 글자(/ \\ 맨 앞 .)가 있습니다"];
  if ([...name].length > 64) return [name, "64자 이하로 적으세요"];
  if (tabIds.includes(name)) return [name, "탭 id와 같은 이름은 쓸 수 없습니다"];
  return [name, null];
}

// 제출값 {project, tabs: {id: {key: value}}} → {config, errors}. 오류가 있으면 config 는 null.
// 탭 고유 검사(manifest 항목의 선택 속성 validate(settings) → {key: 문구})는 칸 검사를 통과한 탭에만 돈다.
export async function normalize(tabs, submitted) {
  const picked = submitted && typeof submitted === "object" ? submitted.tabs : null;
  if (!picked || typeof picked !== "object" || Array.isArray(picked) || !Object.keys(picked).length) {
    return { config: null, errors: { _: { tabs: "탭을 하나 이상 고르세요" } } };
  }
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const errors = {};
  const [project, error] = projectError(submitted.project, [...byId.keys()]);
  if (error) errors._ = { project: error };
  const clean = {};
  for (const [tabId, raw] of Object.entries(picked)) {
    const tab = byId.get(tabId);
    if (!tab) {
      errors._ = { ...errors._, tabs: `알 수 없는 탭입니다: ${tabId}` };
      continue;
    }
    const values = raw && typeof raw === "object" ? raw : {};
    const settings = {};
    let fieldErrors = {};
    for (const field of tab.fields) {
      if (!shown(field, settings)) continue;
      const [value, problem] = fieldValue(field, values[field.key]);
      settings[field.key] = value;
      if (problem) fieldErrors[field.key] = problem;
      if (field.realPath && PATH_KINDS.has(field.kind)) settings[realPathKey(field.key)] = text(values[realPathKey(field.key)]);
    }
    if (!Object.keys(fieldErrors).length && typeof tab.validate === "function") fieldErrors = (await tab.validate(settings)) ?? {};
    if (Object.keys(fieldErrors).length) errors[tabId] = fieldErrors;
    clean[tabId] = settings;
  }
  if (Object.keys(errors).length) return { config: null, errors };
  return { config: { project, tabs: clean }, errors: {} };
}

// 켜진 탭을 wanted 순서로, 빠진 것은 등록 순서로 뒤에. 모르는 id·꺼진 탭·중복은 버린다(app.py _ordered).
export function ordered(tabs, configTabs, wanted) {
  const enabled = tabs.map((tab) => tab.id).filter((id) => Object.hasOwn(configTabs ?? {}, id));
  const head = [];
  for (const id of Array.isArray(wanted) ? wanted : []) if (enabled.includes(id) && !head.includes(id)) head.push(id);
  return [...head, ...enabled.filter((id) => !head.includes(id))];
}

// 셸이 쓰는 모양(로컬판 /_dashboard/config 응답과 같다).
export function describe(config, tabs) {
  return {
    configured: Boolean(config?.project),
    project: config?.project ?? "",
    tabs,
    enabled: config ? ordered(tabs, config.tabs, config.order) : [],
    values: config?.tabs ?? {},
  };
}

// 사이드바 끌기 결과를 config.order 에 반영한 새 설정.
export function reorder(config, tabs, wanted) {
  if (!config?.project) throw new Error("설정이 먼저다");
  if (!Array.isArray(wanted)) throw new Error("order 는 탭 id 목록이다");
  return { ...config, order: ordered(tabs, config.tabs, wanted) };
}

// 저장 직전: 검증한 설정에 지난 순서를 이어 붙인다(다시 저장해도 사이드바 순서 유지, 새로 켠 탭은 뒤에).
export async function apply(tabs, previous, submitted) {
  const { config, errors } = await normalize(tabs, submitted);
  if (!config) return { config: null, errors };
  return { config: { ...config, order: ordered(tabs, config.tabs, previous?.order) }, errors: {} };
}

// 편집 화면의 처음 값. 텍스트·고르기는 저장값 → 기본값, 경로 칸은 저장된 핸들(dirs 는 배열), 실제 경로 칸은 문자열.
export function initialDraft(desc) {
  return Object.fromEntries(desc.tabs.map((tab) => {
    const saved = desc.values?.[tab.id] ?? {};
    const draft = {};
    for (const field of tab.fields) {
      if (field.kind === "dirs") draft[field.key] = Array.isArray(saved[field.key]) ? saved[field.key].filter(isHandle) : [];
      else if (PATH_KINDS.has(field.kind)) draft[field.key] = isHandle(saved[field.key]) ? saved[field.key] : null;
      else draft[field.key] = saved[field.key] ?? field.default ?? "";
      if (field.realPath) draft[realPathKey(field.key)] = saved[realPathKey(field.key)] ?? "";
    }
    return [tab.id, draft];
  }));
}

// 로컬판 buildPayload 는 필드 key 만 싣는다. 실제 경로 칸(<key>RealPath)을 보이는 폴더 칸 옆에 덧붙인다.
export function withRealPaths(payload, tabs, draft) {
  const out = { ...payload, tabs: { ...payload.tabs } };
  for (const [tabId, values] of Object.entries(out.tabs)) {
    const tab = tabs.find((item) => item.id === tabId);
    const next = { ...values };
    for (const field of tab?.fields ?? []) {
      if (field.realPath && Object.hasOwn(values, field.key)) next[realPathKey(field.key)] = draft[tabId]?.[realPathKey(field.key)] ?? "";
    }
    out.tabs[tabId] = next;
  }
  return out;
}

// 켠 탭마다 {id, ok, error, pending}. pending 은 권한이 'prompt' 라 '폴더 다시 연결'이 필요한 핸들 목록.
// fsa 는 {supported(), permission(handle, mode)} (테스트에서 바꿔 끼운다).
export async function tabStatus(desc, fsa) {
  const out = [];
  for (const id of desc.enabled) {
    const tab = desc.tabs.find((item) => item.id === id);
    const values = desc.values[id] ?? {};
    const status = { id, ok: true, error: null, pending: [] };
    const settings = {};
    for (const field of tab?.fields ?? []) {
      if (!shown(field, settings)) continue;
      settings[field.key] = values[field.key];
      if (!PATH_KINDS.has(field.kind)) continue;
      const handles = (field.kind === "dirs" ? values[field.key] ?? [] : [values[field.key]]).filter((h) => h !== null && h !== undefined);
      if (!fsa.supported()) {
        Object.assign(status, { ok: false, error: "이 브라우저는 폴더·파일 접근(File System Access API)을 지원하지 않는다. Chrome·Edge 로 연다" });
        break;
      }
      if (!handles.length || handles.some((h) => !isHandle(h))) {
        if (field.required) Object.assign(status, { ok: false, error: `${field.label}을(를) 다시 고른다(⚙ 설정)` });
        continue;
      }
      for (const handle of handles) {
        const state = await fsa.permission(handle, field.mode ?? "read");
        if (state === "prompt") status.pending.push({ tab: id, key: field.key, label: field.label, handle, mode: field.mode ?? "read" });
        else if (state !== "granted") Object.assign(status, { ok: false, error: `${field.label} 권한이 거부됐다(⚙ 설정에서 다시 고른다)` });
      }
    }
    out.push(status);
  }
  return out;
}

// 템플릿 본문의 {{TODAY}} 를 내려받는 날(로컬 날짜 YYYY-MM-DD)로 바꾼다(dashboard/tab.py Template.body).
export const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const templateBody = (text, date = new Date()) => String(text).replaceAll("{{TODAY}}", localDate(date));
