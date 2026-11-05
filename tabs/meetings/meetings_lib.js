// 회의 자료 화면(meetings.js)의 순수 함수. DOM·네트워크를 쓰지 않는다. work-dashboard/tests/meetings_lib.test.js 가 검사한다.
const FENCE = /^\s*(```|~~~)/;
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeHtml = (text) => text.replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]);
// 서버 meetings_canvas.PREVIEW_MIME 과 같은 목록. /file 이 내려주는 형식.
const PREVIEW_EXT = new Set([".md", ".txt", ".html", ".htm", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);

// 화면 해시: #m=<회의 id>&f=<vault 경로>. 셸은 이것을 #meetings/… 로 감싼다. f 는 회의에 담기지 않은 Vault 파일일 수도 있다.
export function parseState(hash) {
  const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  return { meeting: params.get("m") || "", file: params.get("f") || "" };
}

export function toHash({ meeting = "", file = "" } = {}) {
  const params = new URLSearchParams();
  if (meeting) params.set("m", meeting);
  if (file) params.set("f", file);
  const query = params.toString();
  return query ? "#" + query : "";
}

export const fileUrl = (path) => `file?p=${encodeURIComponent(path)}`;

// Vault 경로 → 이름·소문자 확장자(Python Path.suffix 와 같다)·미리보기 가능 여부.
export function fileInfo(path) {
  const name = String(path).split("/").pop();
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : "";
  return { name, ext, preview: PREVIEW_EXT.has(ext) };
}

export const obsidianUri = (vault, path) =>
  `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(path)}`;

export function isWebUrl(value) {
  try {
    const { protocol } = new URL(String(value));
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function linkLabel(url) {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return last ? `${parsed.hostname} · ${decodeURIComponent(last)}` : parsed.hostname;
  } catch {
    return String(url);
  }
}

export function stripFrontmatter(src) {
  const text = String(src);
  const lines = text.split("\n");
  if (lines[0].trim() !== "---") return text;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  return end < 0 ? text : lines.slice(end + 1).join("\n");
}

// Obsidian 문법을 일반 md로 바꾼다(plans_view.html 과 같은 규칙). 펜스 코드 블록 안은 그대로 둔다.
export function obsidianToMarkdown(body) {
  let fenced = false;
  return String(body).split("\n").map((line) => {
    if (FENCE.test(line)) { fenced = !fenced; return line; }
    if (fenced) return line;
    return line
      .replace(/!\[\[([^\]|]+)(?:\\?\|[^\]]*)?\]\]/g, (_, f) => `<span class="embed">[이미지: ${escapeHtml(f)}]</span>`)
      .replace(/\[\[([^\]|]+?)\\?\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[([^\]]+)\]\]/g, "$1");
  }).join("\n");
}

// 드래그 중 포인터 y 가 들어갈 자리: 항목 세로 중점(위→아래 순) 중 y 보다 위에 있는 개수.
export const dropIndex = (midpoints, y) => midpoints.filter((mid) => mid < y).length;

export function todayIso(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
