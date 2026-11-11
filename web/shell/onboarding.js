// 웹 버전 온보딩·설정 화면. 로컬판 shell/onboarding.js 의 화면을 그대로 옮기고, 서버 API 대신 브라우저 계층을 쓴다.
// - 저장: POST /_dashboard/config 대신 config.apply()(검증) → store.saveConfig()(IndexedDB) → 새로고침.
// - 경로 칸: Finder 선택 창 대신 File System Access API 선택 창(클릭 안에서). 칸에는 절대 경로 대신 고른 핸들의 이름이 보인다.
// - 폴더 칸에 realPath 가 있으면 '실제 경로(경로 복사용, 선택)' 칸과 이름 불일치 경고를 더한다.
// - 설정 내보내기·가져오기(JSON, 핸들은 이름만·비밀값 제외).
// 단계 계산(buildSteps·shownFields·buildPayload…)은 로컬판 shell/onboarding_flow.js 를 그대로 import 한다(web_serve.py SHARED_FILES).
import { buildPayload, buildSteps, hasErrors, initialAnswers, questionText, shownFields } from "../shared/onboarding_flow.js";
import { apply, initialDraft, localDate, realPathKey, templateBody, withRealPaths } from "../lib/config.js";
import { errorText, pickDirectory, pickFile, realPathMismatch, supported } from "../lib/fsa.js";
import { exportAll, importAll, saveConfig } from "../lib/store.js";

const PATH_KINDS = new Set(["dir", "file", "dirs"]);
const PICK_LABEL = { dir: "폴더 선택", file: "파일 선택", dirs: "폴더 추가" };
const PLACEHOLDER = {
  dir: "폴더 선택을 누르면 고른 폴더 이름이 여기 표시됩니다",
  file: "파일 선택을 누르면 고른 파일 이름이 여기 표시됩니다",
  dirs: "폴더 추가를 누르면 고른 폴더가 한 줄에 하나씩 쌓입니다",
};
export const IMPORTED_KEY = "dobbys-dashboard:imported";

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  node.append(...children);
  return node;
}

function button(text, onClick, attrs = {}) {
  const node = el("button", { type: "button", text, ...attrs });
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

export const labBadge = () => el("span", { class: "lab", text: "실험실" });
const tabLabel = (tab) => el("span", { class: "label", text: tab.label }, tab.experimental ? labBadge() : "");

// 미지원 브라우저 안내. 첫 화면(셸)과 온보딩이 함께 쓴다.
export const UNSUPPORTED = "이 브라우저는 폴더·파일 선택(File System Access API)을 지원하지 않습니다. 폴더·파일을 읽는 탭(구현 진행 현황 등)은 Chrome·Edge 에서 HTTPS 주소(또는 localhost)로 여세요.";

const handleName = (value) => (Array.isArray(value) ? value.map((h) => h.name).join("\n") : value?.name ?? "");

// 경로 칸: 고른 핸들 이름을 보이는 읽기 전용 칸 + 선택·비우기 버튼. 선택 창은 이 클릭 안에서 연다.
function pathRow(name, tab, field, state, error, rerender) {
  const title = field.label + (field.required ? " ✱" : "");
  const value = state.draft[tab.id][field.key];
  const input = field.kind === "dirs" ? el("textarea", { name, rows: 3 }) : el("input", { name, type: "text", autocomplete: "off", spellcheck: "false" });
  input.value = handleName(value);
  input.placeholder = PLACEHOLDER[field.kind];
  input.readOnly = true;
  input.classList.add("path");
  input.setAttribute("aria-label", title);
  const note = el("p", { class: "error", hidden: true });
  const set = (next) => {
    state.draft[tab.id][field.key] = next;
    rerender(`${name}-pick`);
  };
  const choose = button(PICK_LABEL[field.kind], async () => {
    if (choose.disabled) return;
    choose.disabled = true;
    note.hidden = true;
    try {
      const id = `${tab.id}-${field.key}`;
      const current = Array.isArray(value) ? value.at(-1) : value;
      const picked = field.kind === "file"
        ? await pickFile({ id, accept: field.accept, startIn: current ?? undefined })
        : await pickDirectory({ id, mode: field.mode ?? "read", startIn: current ?? undefined });
      if (!picked) return;  // 취소는 오류가 아니다. 값은 그대로.
      if (field.kind !== "dirs") { set(picked); return; }
      for (const existing of value) if (await existing.isSameEntry(picked)) return;  // 이미 있는 폴더는 다시 넣지 않는다
      set([...value, picked]);
    } catch (err) {
      note.textContent = errorText(err);
      note.hidden = false;
    } finally {
      choose.disabled = !supported();
    }
  }, { "data-key": `${name}-pick` });
  if (!supported()) {
    choose.disabled = true;
    note.textContent = errorText(null);
    note.hidden = false;
  }
  input.addEventListener("click", () => choose.click());
  const clear = field.kind === "dirs" || !field.required ? button("비우기", () => set(field.kind === "dirs" ? [] : null)) : "";
  const rows = [el("div", { class: "field" },
    el("span", { text: title }), input, el("div", { class: "pick" }, choose, clear), note,
    field.help ? el("span", { class: "hint", text: field.help }) : "",
    error ? el("p", { class: "error", text: error }) : "")];
  if (field.realPath && field.kind === "dir") rows.push(realPathRow(name, tab, field, state));
  return { rows, input: choose, focus: choose };
}

// 실제 경로 칸: 경로 복사가 이 경로 + 폴더 안 상대 경로를 복사한다. 마지막 조각이 고른 폴더 이름과 다르면 경고만 한다.
function realPathRow(name, tab, field, state) {
  const key = realPathKey(field.key);
  const input = el("input", { name: `${name}RealPath`, type: "text", autocomplete: "off", spellcheck: "false", "data-key": `${name}RealPath` });
  input.value = state.draft[tab.id][key] ?? "";
  input.placeholder = "예: /Users/me/Vault/10-plans 또는 C:\\Vault\\10-plans";
  const warning = el("p", { class: "warning", hidden: true });
  const check = () => {
    const picked = state.draft[tab.id][field.key];
    const mismatch = realPathMismatch(input.value, picked?.name);
    warning.textContent = mismatch ? `고른 폴더와 이름이 다릅니다(고른 폴더: ${picked.name}). 경로가 맞는지 확인하세요.` : "";
    warning.hidden = !mismatch;
  };
  input.addEventListener("input", () => { state.draft[tab.id][key] = input.value; check(); });
  check();
  return el("label", { class: "field" },
    el("span", { text: "실제 경로(경로 복사용, 선택)" }), input, warning,
    el("span", { class: "hint", text: "브라우저는 고른 폴더의 실제 위치를 알 수 없습니다. 이 PC 에서의 폴더 경로를 적으면 '경로 복사'가 이 경로 + 파일 이름을 복사합니다. 비우면 경로 복사 버튼이 숨습니다. PC·브라우저마다 다시 입력해야 합니다." }));
}

function choiceRow(name, field, value, error) {
  const title = field.label + (field.required ? " ✱" : "");
  const group = el("div", { class: "choice-group", role: "radiogroup", "aria-label": title });
  let focus = null;
  for (const [option, text] of field.options) {
    const radio = el("input", { type: "radio", name, value: option, checked: option === value, "data-key": `${name}=${option}` });
    if (option === value) focus = radio;
    group.append(el("label", { class: "option" }, radio, el("span", { text })));
  }
  const row = el("div", { class: "field" },
    el("span", { text: title }), group,
    field.help ? el("span", { class: "hint", text: field.help }) : "",
    error ? el("p", { class: "error", text: error }) : "");
  return { rows: [row], input: group, focus };
}

function textRow(name, field, value, error) {
  const title = field.label + (field.required ? " ✱" : "");
  const input = el("input", { name, type: "text", autocomplete: "off", spellcheck: "false" });
  input.value = value ?? "";
  input.placeholder = field.placeholder ?? "";
  const row = el("label", { class: "field" },
    el("span", { text: title }), input,
    field.help ? el("span", { class: "hint", text: field.help }) : "",
    error ? el("p", { class: "error", text: error }) : "");
  return { rows: [row], input, focus: input };
}

const projectRow = (value, error) => textRow("project",
  { key: "project", label: "프로젝트 이름", kind: "text", required: true, placeholder: "예: TRB 4.0.0" }, value, error);

// 템플릿 내려받기: 정적 파일을 받아 {{TODAY}} 를 오늘로 바꾸고 같은 파일명으로 저장한다. 탭을 켜기 전에도 받을 수 있다.
async function downloadTemplate(template) {
  const res = await fetch(template.url, { cache: "no-cache" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const blob = new Blob([templateBody(await res.text())], { type: "text/markdown;charset=utf-8" });
  saveBlob(blob, template.name);
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const templateRows = (tab) => (tab.templates ?? []).map((template) => {
  const note = el("span", { class: "error", hidden: true });
  const link = el("a", { href: template.url, download: template.name, text: `⬇ ${template.name}` });
  link.addEventListener("click", async (event) => {
    event.preventDefault();
    note.hidden = true;
    try { await downloadTemplate(template); } catch (err) { note.textContent = `내려받기 실패: ${err.message}`; note.hidden = false; }
  });
  return el("p", { class: "template" }, link, template.help ? el("span", { class: "hint", text: template.help }) : "", note);
});

// 검증 오류면 오류 객체, 저장하면 새로고침하고 null, 저장 실패는 예외.
async function submit(desc, saved, state) {
  const payload = withRealPaths(buildPayload(state.project, desc.tabs, state.answers, state.draft), desc.tabs, state.draft);
  const { config, errors } = await apply(desc.tabs, saved, payload);
  if (!config) return errors;
  await saveConfig(config);
  location.reload();
  return null;
}

// desc: config.describe() 결과, saved: store.loadConfig() 결과(없으면 null). notice: 화면 위 안내 한 줄(가져오기 뒤 등).
export function openOnboarding(root, desc, saved, { notice = "" } = {}) {
  root.hidden = false;
  if (desc.configured) openSettings(root, desc, saved, notice);
  else openQuestions(root, desc, saved, notice);
}

function paint(root, view, keep) {
  const scrolled = root.scrollTop;
  root.replaceChildren(...view.nodes);
  if (keep) {
    root.scrollTop = scrolled;
    root.querySelector(`[data-key="${keep}"]`)?.focus({ preventScroll: true });
    return;
  }
  root.scrollTop = 0;
  view.focus?.focus();
}

function editorState(desc) {
  return {
    project: desc.project ?? "", answers: initialAnswers(desc), draft: initialDraft(desc),
    errors: {}, failure: "", saving: false, open: new Set(),
  };
}

function tabFields(state, tab, rerender) {
  const nodes = [];
  let first = null;
  if (!tab.fields.length) nodes.push(el("p", { class: "hint", text: "입력할 항목이 없습니다." }));
  for (const field of shownFields(tab, state.draft[tab.id])) {
    const name = `${tab.id}.${field.key}`;
    const error = state.errors[tab.id]?.[field.key];
    if (PATH_KINDS.has(field.kind)) {
      const { rows, focus } = pathRow(name, tab, field, state, error, rerender);
      first ??= focus;
      nodes.push(...rows);
      continue;
    }
    const { rows, input, focus } = field.kind === "choice"
      ? choiceRow(name, field, state.draft[tab.id][field.key], error)
      : textRow(name, field, state.draft[tab.id][field.key], error);
    input.addEventListener("input", (event) => {
      state.draft[tab.id][field.key] = event.target.value;
      if (field.kind === "choice") rerender(`${name}=${event.target.value}`);
    });
    first ??= focus;
    nodes.push(...rows);
  }
  nodes.push(...templateRows(tab));
  return { nodes, first };
}

function tabRow(state, tab, rerender) {
  const on = state.answers[tab.id] === true;
  const open = state.open.has(tab.id);
  const head = button("", () => {
    if (open) state.open.delete(tab.id);
    else state.open.add(tab.id);
    rerender(`${tab.id}-head`);
  }, { class: "acc-head", "aria-expanded": open ? "true" : "false", "data-key": `${tab.id}-head` });
  head.append(el("span", { class: "icon", text: tab.icon }), tabLabel(tab),
    hasErrors(state.errors, tab.id) ? el("span", { class: "error", text: "오류" }) : "",
    el("span", { class: "chevron", "aria-hidden": "true", text: open ? "▴" : "▾" }));
  const toggle = button("", () => {
    state.answers[tab.id] = !on;
    if (on) state.open.delete(tab.id);
    else state.open.add(tab.id);
    rerender(`${tab.id}-switch`);
  }, { class: "switch", role: "switch", "aria-checked": on ? "true" : "false", "aria-label": `${tab.label} 탭 켜기`, "data-key": `${tab.id}-switch` });
  toggle.append(el("span", { class: "track", "aria-hidden": "true" }, el("span", { class: "knob" })),
    el("span", { class: "state", text: on ? "켬" : "끔" }));
  const body = !open ? ""
    : el("div", { class: "acc-body" }, ...(on ? tabFields(state, tab, rerender).nodes : [el("p", { class: "hint", text: "탭을 켜면 입력 항목을 채울 수 있습니다." })]));
  return el("li", { class: on ? "on" : "off" }, el("div", { class: "acc-row" }, head, toggle), body);
}

function tabEditor(state, desc, saved, { before = [], back, rerender, onErrors = () => rerender() }) {
  const none = !desc.tabs.some((tab) => state.answers[tab.id] === true);
  const save = el("button", { class: "primary", type: "submit", disabled: none || state.saving, text: state.saving ? "저장 중…" : "저장" });
  const form = el("form", { novalidate: true },
    state.failure ? el("p", { class: "error", text: state.failure }) : "",
    state.errors._?.tabs ? el("p", { class: "error", text: state.errors._.tabs }) : "",
    ...before,
    el("ul", { class: "accordion" }, ...desc.tabs.map((tab) => tabRow(state, tab, rerender))),
    none ? el("p", { class: "error", text: "하나 이상 켜세요." }) : "",
    el("div", { class: "actions" }, back, save));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (none || state.saving) return;
    state.saving = true;
    state.failure = "";
    state.errors = {};
    rerender();
    try {
      const errors = await submit(desc, saved, state);
      if (!errors) return;
      state.saving = false;
      state.errors = errors;
      for (const tab of desc.tabs) if (hasErrors(errors, tab.id)) state.open.add(tab.id);
      onErrors();
    } catch (err) {
      state.saving = false;
      state.failure = "저장 실패: " + (err?.message ?? err);
      rerender();
    }
  });
  return { form, save };
}

// 설정 옮기기: 내보내기(JSON 내려받기)와 가져오기(파일 고르기). 가져오면 새로고침하고 설정 화면에서 폴더·파일을 다시 고르게 한다.
function moveRows({ exportable = true } = {}) {
  const status = el("p", { class: "hint", hidden: true });
  const fileInput = el("input", { type: "file", accept: ".json,application/json", hidden: true });
  const exporter = button("설정 내보내기(JSON)", async () => {
    status.hidden = true;
    try {
      const data = await exportAll();
      const name = `도비의 대시보드 설정 - ${data.config?.project ?? "빈 설정"} - ${localDate()}.json`;
      saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), name);
    } catch (err) {
      status.className = "error";
      status.textContent = `내보내기 실패: ${err?.message ?? err}`;
      status.hidden = false;
    }
  });
  const importer = button("설정 가져오기…", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    status.hidden = true;
    try {
      const { missing } = await importAll(JSON.parse(await file.text()));
      try { sessionStorage.setItem(IMPORTED_KEY, JSON.stringify(missing)); } catch { /* 안내만 빠진다 */ }
      location.reload();
    } catch (err) {
      status.className = "error";
      status.textContent = `가져오기 실패: ${err?.message ?? err}`;
      status.hidden = false;
    }
  });
  return [
    el("div", { class: "moves" }, exportable ? exporter : "", importer, fileInput),
    el("span", { class: "hint", text: "다른 브라우저·PC 로 설정(프로젝트·탭·옵션·순서와 탭 상태)을 옮깁니다. 폴더·파일 선택과 비밀값(Jira token 등)은 옮겨지지 않아 가져온 뒤 다시 고르고 로그인해야 합니다." }),
    status,
  ];
}

const noticeBox = (text) => el("div", { class: "notice" }, el("p", { text }));

function openQuestions(root, desc, saved, notice) {
  const steps = buildSteps(desc.tabs);
  const total = steps.length - 2;
  const state = { ...editorState(desc), step: 0 };

  const go = (step) => { state.step = step; render(); };

  function render(keep = null) {
    const step = steps[state.step];
    paint(root, step.kind === "project" ? projectStep() : step.kind === "question" ? questionStep(step.tab) : confirmStep(), keep);
  }

  function stepForm(onSubmit, ...children) {
    const form = el("form", { novalidate: true }, ...children);
    form.addEventListener("submit", (event) => { event.preventDefault(); onSubmit(); });
    return form;
  }

  function projectStep() {
    const { rows, input } = projectRow(state.project, state.errors._?.project);
    input.addEventListener("input", () => { state.project = input.value; });
    const form = stepForm(() => go(1),
      ...rows, el("div", { class: "actions" }, el("button", { class: "primary", type: "submit", text: "다음" })));
    return {
      nodes: [
        notice ? noticeBox(notice) : "",
        supported() ? "" : noticeBox(UNSUPPORTED),
        el("h1", { text: "어떤 프로젝트의 대시보드를 만들까요?" }),
        el("p", { class: "muted", text: "필요한 탭만 활성화할게요. 여기서 입력한 값은 나중에 사이드바 ⚙ 설정에서 언제든 바꿀 수 있어요." }),
        form,
        el("fieldset", {}, el("legend", { text: "다른 브라우저에서 쓰던 설정이 있나요?" }), ...moveRows({ exportable: false })),
      ],
      focus: input,
    };
  }

  function progress() {
    const dots = steps.slice(1, -1).map(({ tab }, i) => {
      const classes = ["dot"];
      if (state.answers[tab.id] !== undefined) classes.push("answered");
      if (i + 1 === state.step) classes.push("current");
      if (hasErrors(state.errors, tab.id)) classes.push("error");
      return el("span", { class: classes.join(" "), title: tab.label });
    });
    return el("div", { class: "progress", "aria-label": `질문 ${state.step} / ${total}` },
      el("span", { text: `${state.step} / ${total}` }), el("span", { class: "dots", "aria-hidden": "true" }, ...dots));
  }

  function questionStep(tab) {
    const answer = state.answers[tab.id];
    const yes = button("예", () => { state.answers[tab.id] = true; render(); },
      { class: "choice", "aria-pressed": answer === true ? "true" : "false" });
    const no = button("아니요", () => { state.answers[tab.id] = false; go(state.step + 1); },
      { class: "choice", "aria-pressed": answer === false ? "true" : "false" });
    const children = [];
    if (state.step === 1 && state.errors._?.tabs) children.push(el("p", { class: "error", text: state.errors._.tabs }));
    children.push(el("div", { class: "choices" }, yes, no));
    let first = null;
    if (answer === true) {
      const fields = tabFields(state, tab, render);
      first = fields.first;
      children.push(el("fieldset", {}, el("legend", { text: `${tab.icon} ${tab.label} 탭을 켭니다` }), ...fields.nodes));
    }
    const next = answer === undefined ? "" : el("button", { class: "primary", type: "submit", text: "다음" });
    children.push(el("div", { class: "actions" }, button("이전", () => go(state.step - 1)), next));
    const form = stepForm(() => { if (answer !== undefined) go(state.step + 1); }, ...children);
    return {
      nodes: [progress(), el("h1", { text: questionText(tab) }), tab.summary ? el("p", { class: "muted", text: tab.summary }) : "", form],
      focus: answer === true ? (first ?? next) : answer === false ? next : yes,
    };
  }

  function confirmStep() {
    const { form, save } = tabEditor(state, desc, saved, {
      back: button("이전", () => go(state.step - 1)),
      rerender: render,
      onErrors: () => (state.errors._?.project ? go(0) : render()),
    });
    return {
      nodes: [
        el("h1", { text: "확인" }),
        el("p", { class: "muted", text: `프로젝트 ${state.project || "(이름 없음)"}. 켠 탭만 사이드바에 보입니다. 토글로 켜고 끄고, 탭 이름을 누르면 입력 항목이 펼쳐집니다. 저장한 뒤에도 사이드바 ⚙ 설정에서 프로젝트 이름, 탭 켜기·끄기, 폴더·파일을 바꿀 수 있습니다.` }),
        form,
      ],
      focus: save,
    };
  }

  render();
}

function openSettings(root, desc, saved, notice) {
  const state = editorState(desc);
  // 가져오기 뒤처럼 다시 골라야 할 칸이 있으면 그 탭을 펼쳐 둔다.
  for (const tab of desc.tabs) if (desc.enabled.includes(tab.id) && notice) state.open.add(tab.id);

  function close() {
    root.hidden = true;
    root.replaceChildren();
  }

  function render(keep = null) {
    const project = projectRow(state.project, state.errors._?.project);
    project.input.addEventListener("input", () => { state.project = project.input.value; });
    const { form } = tabEditor(state, desc, saved, {
      before: [el("fieldset", {}, el("legend", { text: "프로젝트" }), ...project.rows)],
      back: button("취소", close),
      rerender: render,
    });
    paint(root, {
      nodes: [
        notice ? noticeBox(notice) : "",
        supported() ? "" : noticeBox(UNSUPPORTED),
        el("h1", { text: "설정" }),
        el("p", { class: "muted", text: "토글로 탭을 켜고 끄고, 탭 이름을 누르면 폴더·옵션이 펼쳐집니다. 로그인이 필요한 탭(WBS·Jira)은 탭 안에서 로그인하세요. 설정은 이 브라우저에만 저장됩니다." }),
        form,
        el("fieldset", {}, el("legend", { text: "설정 옮기기" }), ...moveRows()),
      ],
      focus: project.input,
    }, keep);
  }

  render();
}
