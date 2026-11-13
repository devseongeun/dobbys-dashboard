// 초안 Markdown 을 원문 탭용 HTML 로 옮긴다. 로컬판 tabs/weekly/markdown_renderer.py 를 줄 단위로 옮겼다(marked 를 쓰지 않는다).
// 줄 단위로 그대로 옮기고, H2 헤딩에서 목차를 만든다. 내용은 바꾸지 않는다. 같은 입력이면 로컬판과 같은 마크업이다
// (tests/js/web/weekly_parity.test.js).
import { D, S, escapeText, splitlines, strip, stripChars } from "./pystr.js";

const HEADING_RE = new RegExp(`^(#{1,6})${S}+(.*)$`, "u");
const BULLET_RE = new RegExp(`^(${S}*)[-*+]${S}+(.*)$`, "u");
const ORDERED_RE = new RegExp(`^(${S}*)(${D}+)[.)]${S}+(.*)$`, "u");
const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gu;

// 헤딩에서 마크다운 강조 기호만 벗겨 순수 텍스트를 만든다.
export const plainHeading = (value) => strip(String(value).replace(/[*_`]/g, ""));

export function slugify(value, fallback) {
  const text = plainHeading(value);
  const slug = stripChars(text.replace(/[^0-9A-Za-z가-힣]+/gu, "-"), "-").toLowerCase();
  return slug || fallback;
}

// URL 을 href 속성 안에 넣는다. 따옴표가 남아 있으면 속성을 탈출하므로 엔티티로 바꾼다.
const linkHtml = (_, text, url) => `<a href="${url.replace(/"/g, "&quot;").replace(/'/g, "&#x27;")}" target="_blank" rel="noopener">${text}</a>`;

export function inline(value) {
  let escaped = escapeText(value);
  escaped = escaped.replace(/`([^`]+)`/gu, (_, code) => `<code>${code}</code>`);
  escaped = escaped.replace(/\*\*([^*]+)\*\*/gu, (_, text) => `<strong>${text}</strong>`);
  escaped = escaped.replace(/(?<!\*)\*([^*]+)\*(?!\*)/gu, (_, text) => `<em>${text}</em>`);
  return escaped.replace(LINK_RE, linkHtml);
}

const indentDepth = (indent) => Math.min(Math.floor(indent.replace(/\t/g, "  ").length / 2), 4);

// 원문의 H2 헤딩 목차. 실제 문서에 있는 헤딩만 담는다.
export function outline(source) {
  const items = [];
  splitlines(source).forEach((raw, index) => {
    const match = strip(raw).match(HEADING_RE);
    if (match && match[1].length === 2) items.push({ title: plainHeading(match[2]), anchor: slugify(match[2], `line-${index + 1}`) });
  });
  return items;
}

export function renderMarkdown(source) {
  const rendered = [];
  let inFrontMatter = false;
  splitlines(source).forEach((raw, index) => {
    const lineNumber = index + 1;
    const stripped = strip(raw);
    if (lineNumber === 1 && stripped === "---") { inFrontMatter = true; return; }
    if (inFrontMatter) {
      if (stripped === "---") inFrontMatter = false;
      return;
    }
    if (!stripped) { rendered.push('<div class="blank" aria-hidden="true"></div>'); return; }

    const heading = stripped.match(HEADING_RE);
    if (heading) {
      const level = heading[1].length;
      const anchor = slugify(heading[2], `line-${lineNumber}`);
      rendered.push(`<h${level} id="${anchor}" data-source-line="${lineNumber}">${inline(plainHeading(heading[2]))}</h${level}>`);
      return;
    }
    const bullet = raw.match(BULLET_RE);
    if (bullet) {
      rendered.push(`<div class="md-list depth-${indentDepth(bullet[1])}" data-source-line="${lineNumber}">`
        + `<span class="marker">•</span><div>${inline(bullet[2])}</div></div>`);
      return;
    }
    const ordered = raw.match(ORDERED_RE);
    if (ordered) {
      rendered.push(`<div class="md-list depth-${indentDepth(ordered[1])}" data-source-line="${lineNumber}">`
        + `<span class="marker">${ordered[2]}.</span><div>${inline(ordered[3])}</div></div>`);
      return;
    }
    if (stripped === "---") { rendered.push("<hr>"); return; }
    rendered.push(`<p data-source-line="${lineNumber}">${inline(stripped)}</p>`);
  });
  return rendered.join("\n");
}
