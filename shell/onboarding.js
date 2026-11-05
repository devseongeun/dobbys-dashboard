// 온보딩·설정 화면. ① 쓸 탭 고르기 → ② 고른 탭의 경로·옵션 입력 → 서버 검증 → 저장되면 새로고침.
// 로그인이 필요한 탭(WBS·Jira, 기획서 코멘트 현황)은 여기서 로그인하지 않는다. 각 탭 안에서 한다.
const HINT = {
  dir: "Finder에서 폴더를 고르고 ⌥⌘C(경로 복사) 후 붙여넣는다.",
  file: "Finder에서 파일을 고르고 ⌥⌘C(경로 복사) 후 붙여넣는다.",
  dirs: "한 줄에 폴더 하나. Finder에서 ⌥⌘C로 경로를 복사해 붙여넣는다.",
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

const valueOf = (config, tab, field) => {
  const saved = config.values?.[tab.id]?.[field.key];
  if (Array.isArray(saved)) return saved.join("\n");
  return saved ?? field.default ?? "";
};

export function openOnboarding(root, config) {
  const selected = new Set(config.enabled);
  root.hidden = false;
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
    const actions = el("div", { class: "actions" });
    if (config.configured) {
      const cancel = el("button", { type: "button", text: "취소" });
      cancel.addEventListener("click", close);
      actions.append(cancel);
    }
    actions.append(next);
    root.replaceChildren(
      el("h1", { text: config.configured ? "설정" : "도비의 대시보드 시작하기" }),
      el("p", { class: "muted", text: "쓸 탭만 고른다. 다음 단계에서 고른 탭의 경로만 입력한다. 로그인이 필요한 탭(WBS·Jira, 기획서 코멘트 현황)은 탭 안에서 로그인한다." }),
      list, actions,
    );
  }

  function showFields(errors) {
    const chosen = config.tabs.filter((tab) => selected.has(tab.id));
    const form = el("form", { novalidate: true });
    if (errors._?.tabs) form.append(el("p", { class: "error", text: errors._.tabs }));
    const project = el("input", { name: "project", type: "text", autocomplete: "off", spellcheck: "false", placeholder: "예: TRB 4.0.0" });
    project.value = config.project ?? "";
    form.append(el("fieldset", {}, el("legend", { text: "프로젝트" }),
      el("label", { class: "field" },
        el("span", { text: "프로젝트 이름 ✱" }),
        project,
        el("span", { class: "hint", text: "대시보드는 한 번에 한 프로젝트만 본다. 수동 연결·일정 초안 같은 개인 상태는 이 이름 아래에 따로 저장되고, 이름을 바꾸면 빈 상태에서 시작한다(다시 돌아오면 복원)." }),
        errors._?.project ? el("p", { class: "error", text: errors._.project }) : "")));
    for (const tab of chosen) {
      const set = el("fieldset", {}, el("legend", { text: `${tab.icon} ${tab.label}` }));
      if (!tab.fields.length) set.append(el("p", { class: "hint", text: "입력할 항목이 없다." }));
      for (const field of tab.fields) {
        const name = `${tab.id}.${field.key}`;
        const input = field.kind === "dirs"
          ? el("textarea", { name, rows: 3 })
          : el("input", { name, type: "text", autocomplete: "off", spellcheck: "false" });
        input.value = valueOf(config, tab, field);
        if (field.kind !== "text") input.placeholder = field.kind === "file" ? "~/Downloads/파일.xlsx" : "~/Documents/…";
        const hint = [field.help, HINT[field.kind]].filter(Boolean).join(" ");
        const error = errors[tab.id]?.[field.key];
        set.append(el("label", { class: "field" },
          el("span", { text: field.label + (field.required ? " ✱" : "") }),
          input,
          hint ? el("span", { class: "hint", text: hint }) : "",
          error ? el("p", { class: "error", text: error }) : ""));
      }
      form.append(set);
    }
    const back = el("button", { type: "button", text: "이전" });
    back.addEventListener("click", showTabs);
    const save = el("button", { class: "primary", type: "submit", text: "저장" });
    form.append(el("div", { class: "actions" }, back, save));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const tabs = {};
      for (const tab of chosen) {
        tabs[tab.id] = {};
        for (const field of tab.fields) tabs[tab.id][field.key] = form.elements[`${tab.id}.${field.key}`].value;
      }
      const payload = { project: project.value, tabs };
      save.disabled = true;
      try {
        const res = await fetch("/_dashboard/config", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (res.status === 422) {
          config = { ...config, project: project.value, values: { ...config.values, ...tabs } };
          showFields(body.errors || {});
          return;
        }
        if (!res.ok) throw new Error(body.error || "HTTP " + res.status);
        location.reload();
      } catch (err) {
        save.disabled = false;
        form.prepend(el("p", { class: "error", text: "저장 실패: " + err.message }));
      }
    });
    root.replaceChildren(el("h1", { text: "경로 입력" }), form);
    form.querySelector("input, textarea")?.focus();
  }
}
