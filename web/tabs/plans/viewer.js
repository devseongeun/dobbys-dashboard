// md 뷰어의 순수 규칙. 로컬판 tabs/plans/plans_view.html 스크립트와 plans_serve.py resolve_plan 을 옮겼다.
export const STATES = { "할 일": "todo", "할일": "todo", "todo": "todo", "진행 중": "doing", "진행중": "doing", "doing": "doing", "완료": "done", "done": "done" };
export const LABELS = { todo: "할 일", doing: "진행 중", done: "완료" };
const FENCE = /^\s*(```|~~~)/;

// 폴더 바로 아래 .md 만 연다. 하위 폴더·숨김·상위 경로·다른 확장자는 열지 않는다(resolve_plan 과 같은 이름 규칙).
export const planName = (name) => Boolean(name) && !name.startsWith(".") && !name.includes("/") && !name.includes("\\") && name.endsWith(".md");

// 맨 앞 --- 블록에서 한 줄짜리 "키: 값"만 읽는다(plans_index 와 같은 규칙).
export function splitFrontmatter(src) {
  const lines = src.split("\n");
  if (lines[0].trim() !== "---") return { meta: {}, body: src };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return { meta: {}, body: src };
  const meta = {};
  for (const line of lines.slice(1, end)) {
    const m = line.match(/^([^\s:-][^:]*):\s*(.*)$/);
    if (m) meta[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: lines.slice(end + 1).join("\n") };
}

// Obsidian 문법을 일반 md 로 바꾼다. 펜스 코드 블록 안은 그대로 둔다.
export function obsidian(body) {
  let fenced = false;
  return body.split("\n").map((line) => {
    if (FENCE.test(line)) { fenced = !fenced; return line; }
    if (fenced) return line;
    return line
      .replace(/!\[\[([^\]|]+)(?:\\?\|[^\]]*)?\]\]/g, (_, f) => `<span class="embed">[이미지: ${f}]</span>`)
      .replace(/\[\[([^\]|]+?)\\?\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[([^\]]+)\]\]/g, "$1");
  }).join("\n");
}

export const toSlug = (text) => text.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "sec";
