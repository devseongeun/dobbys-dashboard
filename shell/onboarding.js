// 온보딩·설정 화면. 저장 계약은 하나: POST /_dashboard/config → 422 면 오류 표시, 성공하면 새로고침.
// - 첫 실행(configured=false): 불편 지점을 하나씩 묻고, 예라고 답한 탭의 설정을 그 자리에서 받는다.
// - ⚙ 설정(configured=true): ① 쓸 탭 고르기 → ② 고른 탭의 경로·옵션을 한 화면에서 고친다.
// 로그인이 필요한 탭(WBS·Jira, 기획서 코멘트 현황)은 여기서 로그인하지 않는다. 각 탭 안에서 한다.
import { buildPayload, buildSteps, firstErrorStep, hasErrors, initialAnswers, initialDraft, questionText, valueOf } from "./onboarding_flow.js";

const HINT = {
  dir: "Finder에서 폴더를 골라 ⌥⌘C(경로 복사) 후 붙여넣으세요.",
  file: "Finder에서 파일을 골라 ⌥⌘C(경로 복사) 후 붙여넣으세요.",
  dirs: "한 줄에 폴더 하나씩, Finder에서 ⌥⌘C로 복사해 붙여넣으세요.",
  text: "",
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

// 필드 한 줄: 이름, 입력란, 안내, 오류. input 은 값 읽기·이벤트용으로 따로 돌려준다.
function fieldRow(name, field, value, error) {
  const input = field.kind === "dirs"
    ? el("textarea", { name, rows: 3 })
    : el("input", { name, type: "text", autocomplete: "off", spellcheck: "false" });
  input.value = value;
  if (field.placeholder) input.placeholder = field.placeholder;
  else if (field.kind !== "text") input.placeholder = field.kind === "file" ? "~/Downloads/파일.xlsx" : "~/Documents/…";
  const hint = [field.help, HINT[field.kind]].filter(Boolean).join(" ");
  const row = el("label", { class: "field" },
    el("span", { text: field.label + (field.required ? " ✱" : "") }),
    input,
    hint ? el("span", { class: "hint", text: hint }) : "",
    error ? el("p", { class: "error", text: error }) : "");
  return { row, input };
}

const projectRow = (value, error) => fieldRow("project",
  { key: "project", label: "프로젝트 이름", kind: "text", required: true, placeholder: "예: TRB 4.0.0" }, value, error);

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

function openQuestions(root, config) {
  const steps = buildSteps(config.tabs);
  const total = steps.length - 2;
  const state = {
    step: 0, project: config.project ?? "", answers: initialAnswers(config), draft: initialDraft(config),
    errors: {}, failure: "", saving: false,
  };

  const go = (step) => { state.step = step; render(); };

  function render() {
    const step = steps[state.step];
    const view = step.kind === "project" ? projectStep() : step.kind === "question" ? questionStep(step.tab) : confirmStep();
    root.replaceChildren(...view.nodes);
    root.scrollTop = 0;
    view.focus?.focus();
  }

  // Enter 로 다음 단계: 단계마다 form 하나, submit 이 곧 "다음"(확인 단계는 "저장").
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
        el("h1", { text: "도비의 대시보드 시작하기" }),
        el("p", { class: "muted", text: "필요한 탭만 활성화할게요." }),
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
      const set = el("fieldset", {}, el("legend", { text: `${tab.icon} ${tab.label} 탭을 켭니다` }));
      if (!tab.fields.length) set.append(el("p", { class: "hint", text: "입력할 항목이 없습니다." }));
      for (const field of tab.fields) {
        const { row, input } = fieldRow(`${tab.id}.${field.key}`, field, state.draft[tab.id][field.key], state.errors[tab.id]?.[field.key]);
        input.addEventListener("input", () => { state.draft[tab.id][field.key] = input.value; });
        first ??= input;
        set.append(row);
      }
      children.push(set);
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
    const list = el("ul", { class: "tabs summary" }, ...steps.slice(1, -1).map(({ tab }, i) => {
      const on = state.answers[tab.id] === true;
      const item = button("", () => go(i + 1), { class: on ? "" : "off" });
      item.append(el("span", { class: "icon", text: tab.icon }), el("span", { class: "label", text: tab.label }),
        hasErrors(state.errors, tab.id) ? el("span", { class: "error", text: "오류" }) : "",
        el("span", { class: "state", text: on ? "켬" : "끔" }));
      return el("li", {}, item);
    }));
    const none = !steps.some((step) => step.kind === "question" && state.answers[step.tab.id] === true);
    const save = el("button", { class: "primary", type: "submit", disabled: none || state.saving, text: state.saving ? "저장 중…" : "저장" });
    const form = stepForm(async () => {
      if (none || state.saving) return;
      state.saving = true;
      state.failure = "";
      render();
      try {
        const errors = await submit(buildPayload(state.project, config.tabs, state.answers, state.draft));
        if (!errors) return;
        state.saving = false;
        state.errors = errors;
        go(firstErrorStep(errors, steps) ?? state.step);
      } catch (err) {
        state.saving = false;
        state.failure = "저장 실패: " + err.message;
        render();
      }
    },
    state.failure ? el("p", { class: "error", text: state.failure }) : "",
    list,
    none ? el("p", { class: "error", text: "하나 이상 예를 고르세요." }) : "",
    el("div", { class: "actions" }, button("이전", () => go(state.step - 1)), save));
    return {
      nodes: [
        el("h1", { text: "확인" }),
        el("p", { class: "muted", text: `프로젝트 ${state.project || "(이름 없음)"}. 켬인 탭만 사이드바에 보입니다. 항목을 누르면 그 질문으로 돌아갑니다.` }),
        form,
      ],
      focus: save,
    };
  }

  render();
}

function openSettings(root, config) {
  const selected = new Set(config.enabled);
  showTabs();

  function close() {
    root.hidden = true;
    root.replaceChildren();
  }

  function showTabs() {
    const next = el("button", { class: "primary", type: "button", disabled: selected.size === 0, text: "다음" });
    const list = el("ul", { class: "tabs" }, ...config.tabs.map((tab) => {
      const box = el("input", { type: "checkbox", checked: selected.has(tab.id) });
      box.addEventListener("change", () => {
        if (box.checked) selected.add(tab.id);
        else selected.delete(tab.id);
        next.disabled = selected.size === 0;
      });
      return el("li", {}, el("label", {}, box, el("span", { class: "icon", text: tab.icon }), el("span", { text: tab.label })));
    }));
    next.addEventListener("click", () => showFields({}));
    root.replaceChildren(
      el("h1", { text: "설정" }),
      el("p", { class: "muted", text: "쓸 탭만 고르면 다음 단계에서 그 탭의 경로만 입력합니다. 로그인이 필요한 탭(WBS·Jira, 기획서 코멘트 현황)은 탭 안에서 로그인하세요." }),
      list, el("div", { class: "actions" }, button("취소", close), next),
    );
  }

  function showFields(errors) {
    const chosen = config.tabs.filter((tab) => selected.has(tab.id));
    const form = el("form", { novalidate: true });
    if (errors._?.tabs) form.append(el("p", { class: "error", text: errors._.tabs }));
    const project = projectRow(config.project ?? "", errors._?.project);
    form.append(el("fieldset", {}, el("legend", { text: "프로젝트" }), project.row));
    for (const tab of chosen) {
      const set = el("fieldset", {}, el("legend", { text: `${tab.icon} ${tab.label}` }));
      if (!tab.fields.length) set.append(el("p", { class: "hint", text: "입력할 항목이 없습니다." }));
      for (const field of tab.fields) {
        set.append(fieldRow(`${tab.id}.${field.key}`, field, valueOf(config, tab, field), errors[tab.id]?.[field.key]).row);
      }
      form.append(set);
    }
    const save = el("button", { class: "primary", type: "submit", text: "저장" });
    form.append(el("div", { class: "actions" }, button("이전", showTabs), save));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const tabs = {};
      for (const tab of chosen) {
        tabs[tab.id] = {};
        for (const field of tab.fields) tabs[tab.id][field.key] = form.elements[`${tab.id}.${field.key}`].value;
      }
      const payload = { project: project.input.value, tabs };
      save.disabled = true;
      try {
        const failed = await submit(payload);
        if (!failed) return;
        config = { ...config, project: payload.project, values: { ...config.values, ...tabs } };
        showFields(failed);
      } catch (err) {
        save.disabled = false;
        form.prepend(el("p", { class: "error", text: "저장 실패: " + err.message }));
      }
    });
    root.replaceChildren(el("h1", { text: "경로 입력" }), form);
    form.querySelector("input, textarea")?.focus();
  }
}
