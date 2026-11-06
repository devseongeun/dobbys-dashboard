// 온보딩·설정 화면. 저장 계약은 하나: POST /_dashboard/config → 422 면 오류 표시, 성공하면 새로고침.
// - 첫 실행(configured=false): 불편 지점을 하나씩 묻고, 예라고 답한 탭의 설정을 그 자리에서 받는다.
// - ⚙ 설정(configured=true): 확인 단계와 같은 탭 편집 화면(토글 + 아코디언)에 프로젝트 이름 칸을 더해 한 화면에서 고친다.
// 로그인이 필요한 탭(WBS·Jira, 기획서 코멘트 현황)은 여기서 로그인하지 않는다. 각 탭 안에서 한다.
// 문서 안 형식에서 상태를 읽는 탭(의사결정·구현 진행 현황)은 입력 항목 아래에서 템플릿을 내려받게 한다.
import { buildPayload, buildSteps, hasErrors, initialAnswers, initialDraft, mergePicked, pickStart, questionText, shownFields } from "./onboarding_flow.js";

// 경로 칸은 직접 적지 않는다. 버튼(또는 칸)을 누르면 서버가 Finder 선택 창을 띄우고 고른 절대 경로를 채운다.
const PATH_KINDS = new Set(["dir", "file", "dirs"]);
const PICK_LABEL = { dir: "폴더 선택", file: "파일 선택", dirs: "폴더 추가" };
const PLACEHOLDER = {
  dir: "폴더 선택을 누르면 고른 폴더가 여기 표시됩니다",
  file: "파일 선택을 누르면 고른 파일이 여기 표시됩니다",
  dirs: "폴더 추가를 누르면 고른 폴더가 한 줄에 하나씩 쌓입니다",
};

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

// Finder 선택 창 결과. 취소하면 null, 실패하면 예외.
async function pickPaths(kind, current) {
  const res = await fetch("/_dashboard/pick", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, current }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "HTTP " + res.status);
  return body.cancelled ? null : body.paths ?? [];
}

// 경로 칸의 선택·비우기 버튼. 값을 바꾸면 input 이벤트를 보내 질문 단계의 draft 도 따라가게 한다.
function pathControls(field, input) {
  const note = el("p", { class: "error", hidden: true });
  const set = (value) => {
    input.value = value;
    input.dispatchEvent(new Event("input"));
  };
  const choose = button(PICK_LABEL[field.kind], async () => {
    if (choose.disabled) return;
    choose.disabled = true;
    note.hidden = true;
    try {
      const picked = await pickPaths(field.kind, pickStart(field.kind, input.value));
      if (picked) set(mergePicked(field.kind, input.value, picked));
    } catch (err) {
      note.textContent = err.message;
      note.hidden = false;
    } finally {
      choose.disabled = false;
    }
  });
  input.addEventListener("click", () => choose.click());
  const clear = field.kind === "dirs" || !field.required ? button("비우기", () => set("")) : "";
  return { controls: el("div", { class: "pick" }, choose, clear), note };
}

// 고르기 칸(choice): 라디오 묶음. 값이 바뀌면 라디오의 input 이벤트가 묶음까지 올라온다(event.target.value 가 고른 값).
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
  return { row, input: group, focus };
}

// 필드 한 줄: 이름, 입력란, 안내, 오류. input 은 input 이벤트를 듣는 곳, focus 는 처음 초점을 줄 곳이다.
// 경로 칸은 label 대신 div 다. label 이면 안내 글자를 눌러도 선택 창이 뜬다.
function fieldRow(name, field, value, error) {
  if (field.kind === "choice") return choiceRow(name, field, value, error);
  const isPath = PATH_KINDS.has(field.kind);
  const title = field.label + (field.required ? " ✱" : "");
  const input = field.kind === "dirs"
    ? el("textarea", { name, rows: 3 })
    : el("input", { name, type: "text", autocomplete: "off", spellcheck: "false" });
  input.value = value;
  input.placeholder = field.placeholder ?? PLACEHOLDER[field.kind] ?? "";
  const picker = isPath ? pathControls(field, input) : null;
  if (isPath) {
    input.readOnly = true;
    input.classList.add("path");
    input.setAttribute("aria-label", title);
  }
  const row = el(isPath ? "div" : "label", { class: "field" },
    el("span", { text: title }),
    input,
    picker ? picker.controls : "",
    picker ? picker.note : "",
    field.help ? el("span", { class: "hint", text: field.help }) : "",
    error ? el("p", { class: "error", text: error }) : "");
  return { row, input, focus: input };
}

const projectRow = (value, error) => fieldRow("project",
  { key: "project", label: "프로젝트 이름", kind: "text", required: true, placeholder: "예: TRB 4.0.0" }, value, error);

// 탭이 읽는 형식을 미리 채운 문서 템플릿 내려받기 줄. 템플릿이 없는 탭은 빈 배열.
const templateRows = (tab) => (tab.templates ?? []).map((template) => el("p", { class: "template" },
  el("a", { href: template.url, download: template.name, text: `⬇ ${template.name}` }),
  template.help ? el("span", { class: "hint", text: template.help }) : ""));

// 200 이면 새로고침하고 null, 422 면 오류 객체, 그 밖에는 예외.
async function submit(payload) {
  const res = await fetch("/_dashboard/config", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 422) return body.errors || {};
  if (!res.ok) throw new Error(body.error || "HTTP " + res.status);
  location.reload();
  return null;
}

export function openOnboarding(root, config) {
  root.hidden = false;
  if (config.configured) openSettings(root, config);
  else openQuestions(root, config);
}

// 화면을 다시 그린다. keep 이 있으면(토글·펼치기처럼 같은 화면 갱신) 스크롤을 지키고 data-key 가 같은 요소에 초점을 돌려준다.
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

// 첫 온보딩 확인 단계와 ⚙ 설정이 함께 쓰는 편집 상태. 탭 켜기·끄기, 입력값, 펼친 탭, 저장 오류를 한곳에 둔다.
function editorState(config) {
  return {
    project: config.project ?? "", answers: initialAnswers(config), draft: initialDraft(config),
    errors: {}, failure: "", saving: false,
    open: new Set(),  // 펼친 탭 id
  };
}

// 탭 하나의 입력 항목과 템플릿. 입력은 draft 에 바로 담는다. 질문 단계와 탭 편집 아코디언이 함께 쓴다.
// 고르기 칸이 바뀌면 다시 그린다. 그 값에 따라 보이는 칸(when)이 달라진다.
function tabFields(state, tab, rerender) {
  const nodes = [];
  let first = null;
  if (!tab.fields.length) nodes.push(el("p", { class: "hint", text: "입력할 항목이 없습니다." }));
  for (const field of shownFields(tab, state.draft[tab.id])) {
    const name = `${tab.id}.${field.key}`;
    const { row, input, focus } = fieldRow(name, field, state.draft[tab.id][field.key], state.errors[tab.id]?.[field.key]);
    input.addEventListener("input", (event) => {
      state.draft[tab.id][field.key] = event.target.value;
      if (field.kind === "choice") rerender(`${name}=${event.target.value}`);
    });
    first ??= focus;
    nodes.push(row);
  }
  nodes.push(...templateRows(tab));
  return { nodes, first };
}

// 탭마다 한 줄: 머리(누르면 입력 항목이 펼쳐짐)와 켬·끔 토글. 켜면 바로 펼친다.
function tabRow(state, tab, rerender) {
  const on = state.answers[tab.id] === true;
  const open = state.open.has(tab.id);
  const head = button("", () => {
    if (open) state.open.delete(tab.id);
    else state.open.add(tab.id);
    rerender(`${tab.id}-head`);
  }, { class: "acc-head", "aria-expanded": open ? "true" : "false", "data-key": `${tab.id}-head` });
  head.append(el("span", { class: "icon", text: tab.icon }), el("span", { class: "label", text: tab.label }),
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

// 탭 편집 폼: (앞부분) → 탭 아코디언 → 이전·취소 + 저장. 저장 오류는 오류 난 탭을 펼쳐 그 자리에서 고친다.
// onErrors 는 422 뒤에 불린다(첫 온보딩은 프로젝트 이름 오류면 첫 단계로 돌아간다).
function tabEditor(state, config, { before = [], back, rerender, onErrors = () => rerender() }) {
  const none = !config.tabs.some((tab) => state.answers[tab.id] === true);
  const save = el("button", { class: "primary", type: "submit", disabled: none || state.saving, text: state.saving ? "저장 중…" : "저장" });
  const form = el("form", { novalidate: true },
    state.failure ? el("p", { class: "error", text: state.failure }) : "",
    state.errors._?.tabs ? el("p", { class: "error", text: state.errors._.tabs }) : "",
    ...before,
    el("ul", { class: "accordion" }, ...config.tabs.map((tab) => tabRow(state, tab, rerender))),
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
      const errors = await submit(buildPayload(state.project, config.tabs, state.answers, state.draft));
      if (!errors) return;
      state.saving = false;
      state.errors = errors;
      for (const tab of config.tabs) if (hasErrors(errors, tab.id)) state.open.add(tab.id);
      onErrors();
    } catch (err) {
      state.saving = false;
      state.failure = "저장 실패: " + err.message;
      rerender();
    }
  });
  return { form, save };
}

function openQuestions(root, config) {
  const steps = buildSteps(config.tabs);
  const total = steps.length - 2;
  const state = { ...editorState(config), step: 0 };

  const go = (step) => { state.step = step; render(); };

  function render(keep = null) {
    const step = steps[state.step];
    paint(root, step.kind === "project" ? projectStep() : step.kind === "question" ? questionStep(step.tab) : confirmStep(), keep);
  }

  // Enter 로 다음 단계: 단계마다 form 하나, submit 이 곧 "다음".
  function stepForm(onSubmit, ...children) {
    const form = el("form", { novalidate: true }, ...children);
    form.addEventListener("submit", (event) => { event.preventDefault(); onSubmit(); });
    return form;
  }

  function projectStep() {
    const { row, input } = projectRow(state.project, state.errors._?.project);
    input.addEventListener("input", () => { state.project = input.value; });
    const form = stepForm(() => go(1),
      row, el("div", { class: "actions" }, el("button", { class: "primary", type: "submit", text: "다음" })));
    return {
      nodes: [
        el("h1", { text: "어떤 프로젝트의 대시보드를 만들까요?" }),
        el("p", { class: "muted", text: "필요한 탭만 활성화할게요. 여기서 입력한 값은 나중에 사이드바 ⚙ 설정에서 언제든 바꿀 수 있어요." }),
        form,
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
    const { form, save } = tabEditor(state, config, {
      back: button("이전", () => go(state.step - 1)),
      rerender: render,
      onErrors: () => (state.errors._?.project ? go(0) : render()),
    });
    return {
      nodes: [
        el("h1", { text: "확인" }),
        el("p", { class: "muted", text: `프로젝트 ${state.project || "(이름 없음)"}. 켠 탭만 사이드바에 보입니다. 토글로 켜고 끄고, 탭 이름을 누르면 입력 항목이 펼쳐집니다. 저장한 뒤에도 사이드바 ⚙ 설정에서 프로젝트 이름, 탭 켜기·끄기, 경로를 바꿀 수 있습니다.` }),
        form,
      ],
      focus: save,
    };
  }

  render();
}

// ⚙ 설정: 첫 온보딩 확인 단계와 같은 탭 편집 화면에 프로젝트 이름 칸을 더한다.
function openSettings(root, config) {
  const state = editorState(config);

  function close() {
    root.hidden = true;
    root.replaceChildren();
  }

  function render(keep = null) {
    const project = projectRow(state.project, state.errors._?.project);
    project.input.addEventListener("input", () => { state.project = project.input.value; });
    const { form } = tabEditor(state, config, {
      before: [el("fieldset", {}, el("legend", { text: "프로젝트" }), project.row)],
      back: button("취소", close),
      rerender: render,
    });
    paint(root, {
      nodes: [
        el("h1", { text: "설정" }),
        el("p", { class: "muted", text: "토글로 탭을 켜고 끄고, 탭 이름을 누르면 경로·옵션이 펼쳐집니다. 로그인이 필요한 탭(WBS·Jira, 기획서 코멘트 현황)은 탭 안에서 로그인하세요." }),
        form,
      ],
      focus: project.input,
    }, keep);
  }

  render();
}
