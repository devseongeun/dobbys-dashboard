// 뷰어 화면 조각(AI 브리핑·초안 원문·근거 배지·미해결 표시·확인 버튼·표준 섹션 안내 창). 로컬판 generate_viewer.py
// (briefing_html·viewer_payload), viewer_html.py, viewer_cite.py(cite_button), viewer_review.py(review_button·flags_section),
// viewer_guide.py(open_button·guide_dialog) 를 옮겼다. 같은 보고서면 로컬판과 같은 마크업이다(tests/js/web/weekly_parity.test.js).
import { inline, outline, renderMarkdown } from "./markdown_renderer.js";
import { node, norm, reportMonth, reportPeriod, reportSubtitle, reportTitle } from "./report_parser.js";
import { S, esc, quote } from "./pystr.js";

export { esc };

export function nodesHtml(nodes, cssClass = "") {
  if (!nodes.length) return "";
  const items = nodes.map((item) => `<li><span>${inline(item.text)}${nodesHtml(item.kids, cssClass)}</span></li>`).join("");
  return `<ul class="notes ${cssClass}">${items}</ul>`;
}

const NEED_CODE_RE = new RegExp(`<code>확인${S}*필요</code>`, "gu");

export function markInline(value) {
  let rendered = inline(value);
  rendered = rendered.replace(NEED_CODE_RE, '<span class="mk need">확인 필요</span>');
  rendered = rendered.replace(/<code>N\/A<\/code>/giu, '<span class="mk na">N/A</span>');
  return rendered.replace(/(미검증|미확인)/gu, '<span class="mk unver">$1</span>');
}

// ---------------------------------------------------------------- 근거 배지(viewer_cite.py)

const GLYPH = "※";

export function citeButton(fileName, section, extra = "") {
  let attrs = ` data-file="${esc(fileName || "")}" data-section="${esc(section || "")}"`;
  if (extra) attrs += ` data-extra="${esc(extra)}"`;
  return '<span class="cite-wrap">'
    + `<button type="button" class="cite" aria-expanded="false" aria-label="근거 보기"${attrs}>`
    + `<i class="cite-gl" aria-hidden="true">${GLYPH}</i>근거`
    + "</button>"
    + "</span>";
}

// ---------------------------------------------------------------- 확인 완료·미해결 표시(viewer_review.py)

const KINDS = ["need", "na", "unver"];
const LABELS = { need: "확인 필요", na: "N/A", unver: "미검증" };

export const reviewButton = () => '<button type="button" class="review" id="reviewBtn" aria-pressed="false">'
  + '<span class="review-mark" aria-hidden="true">✓</span>'
  + '<span class="review-text">초안 확인 완료</span></button>';

export function flagsSection(report, cite = "") {
  if (!report.flags.length) return "";
  const counts = {};
  const rows = [];
  for (const flag of report.flags) {
    const kind = flag.kind ?? "need";
    counts[kind] = (counts[kind] ?? 0) + 1;
    rows.push(`<li><span class="from">${esc(flag.origin)}</span><span class="txt">${markInline(flag.text)}</span></li>`);
  }
  const chips = KINDS.filter((kind) => counts[kind]).map((kind) => `<span>${LABELS[kind]} ${counts[kind]}</span>`).join("");
  return `<section class="blk"><h2>미해결 표시${cite}</h2>`
    + `<div class="flags"><div class="cnt">${chips}</div>`
    + `<ul>${rows.join("")}</ul></div></section>`;
}

// ---------------------------------------------------------------- 표준 섹션 안내(viewer_guide.py)

export const TEMPLATE_NAME = "YYYY-MM-DD 주간 보고.md";

// [섹션, 적는 법, AI 브리핑에서]. 로컬판 SECTIONS 와 같은 문구다(비교 테스트가 guide_dialog() 와 맞춘다).
const SECTIONS = [
  ["# 제목", "문서 맨 위 한 줄. `제목: …` 줄도 된다.",
    "핵심 업무가 없을 때 회차 제목이 된다."],
  ["## 보고 기간", "`조회 기간: 시작일 ~ 종료일`, `차주 범위`, `버전`, `실제 확인 범위`(아래에 불릿) 불릿.",
    "맨 위 기간·버전 칸. 조회 기간 날짜로 회차 기간을 정하고 같은 주 초안을 묶는다. "
    + "없으면 첫 섹션 제목의 날짜를 쓴다."],
  ["## 이번 주 핵심 업무", "번호 목록. 앞 5개까지 읽는다.",
    "1번·2번이 왼쪽 회차 목록의 제목·부제가 된다. N번을 누르면 업무별 상세 N번 카드로 간다. "
    + "이 섹션이 없으면 `금주 주요 사항` → `금주 작업 정리` → `이번 주 작업 요약` 순으로 찾는다."],
  ["## 업무별 상세 내용", "업무마다 `### 1. 업무명`, 그 아래 `수행 내용:` `확인 결과:` `의사결정/원인:` `다음 단계:` 불릿.",
    "업무 카드. 이 섹션이 있으면 표준 형식 초안으로 보고, 같은 주 초안이 여럿이면 이 초안을 고른다."],
  ["## 정량 지표", "지표 불릿. 첫 `###` 아래에 `전체 N건`과 그 아래 `분류 N건` 불릿, 기준 한 줄.",
    "지표 목록과 건수·막대 그래프."],
  ["## 금주 주요 사항 · ## 차주 주요 사항", "불릿 또는 `###` 묶음. 제목 뒤 `(기간)` 괄호는 무시한다.",
    "나란히 놓인 두 목록."],
  ["## 이슈 및 기타 사항", "불릿.", "이슈 목록."],
  ["## PPT 붙여넣기용", "PPT에 붙일 글을 그대로.", "원문 그대로 복사 버튼이 붙은 블록."],
  ["## 출처 및 검증", "근거 자료 불릿.", "접힌 목록."],
  ["## PPT 처리", "상태 한 줄. `## 승인 상태`도 된다.", "회차 제목 위 태그."],
];

const RULES = [
  "파일명은 `YYYY-MM-DD 주간 보고.md`처럼 날짜로 시작하고 `주간`이 들어가거나, "
  + "`YYYY-MM-DD~ YYYY-MM-DD-weekly-report.md` 형식이다. 앞 날짜가 회차 날짜다.",
  "섹션은 `##`, 그 아래 묶음은 `###`로 쓴다. 섹션 이름은 띄어쓰기·굵게 표시를 무시하고 맞춘다.",
  "없는 섹션은 건너뛴다. 핵심 업무(대체 섹션 포함)도 업무별 상세 내용도 없으면 AI 브리핑이 비고 초안 원문 탭에서 본다.",
  "업무별 상세 내용·이슈 및 기타 사항·정량 지표에 `확인 필요`, `N/A`, `미검증`, `미확인`을 쓰면 미해결 항목으로 모은다.",
  "AI 브리핑은 문장을 고쳐 쓰지 않고 섹션별로 옮겨 담기만 한다.",
];

export const guideButton = (text = "표준 섹션 안내") => `<button class="guide-open" type="button" data-guide-open>${esc(text)}</button>`;

// template: 템플릿 파일 내용(web_serve.py SHARED_FILES 가 로컬판 templates/ 의 같은 파일을 준다).
export function guideDialog(template) {
  const rows = SECTIONS.map(([name, how, shown]) => `<tr><th scope="row"><code>${esc(name)}</code></th><td>${inline(how)}</td><td>${inline(shown)}</td></tr>`).join("");
  const rules = RULES.map((rule) => `<li>${inline(rule)}</li>`).join("");
  const href = "data:text/markdown;charset=utf-8," + quote(template);
  return '<dialog class="guide" id="guide" aria-labelledby="guide-title">'
    + '<div class="guide-head"><h2 id="guide-title">표준 섹션 구성</h2>'
    + '<button class="guide-close" type="button" data-guide-close aria-label="닫기">×</button></div>'
    + '<p class="guide-lead">AI 브리핑은 초안 Markdown에서 아래 이름의 섹션을 찾아 화면에 배치합니다. '
    + "표준 섹션 구성은 이 섹션들을 갖춘 초안입니다.</p>"
    + '<table class="guide-table"><thead><tr><th>섹션</th><th>적는 법</th><th>AI 브리핑에서</th></tr></thead>'
    + `<tbody>${rows}</tbody></table>`
    + `<ul class="guide-rules">${rules}</ul>`
    + '<div class="guide-actions">'
    + `<a class="guide-btn primary" download="${esc(TEMPLATE_NAME)}" href="${esc(href)}">템플릿 내려받기</a>`
    + '<button class="guide-btn" type="button" data-guide-copy>템플릿 복사</button>'
    + '<span class="guide-hint">내려받은 뒤 파일명의 YYYY-MM-DD를 회차 날짜로 바꿔 주간 보고 폴더에 넣으세요.</span>'
    + "</div>"
    + '<p class="guide-skill">Claude Code를 쓰면 팀 공용 스킬로 이 형식의 초안을 바로 쓸 수 있습니다. '
    + "<code>/plugin marketplace add devseongeun/dobbys-dashboard</code> → "
    + '<code>/plugin install dobbys-dashboard@dobbys-dashboard</code> 뒤 "이번 주 주간 보고 초안 써줘".</p>'
    + `<details class="guide-preview"><summary>템플릿 미리 보기</summary><pre id="guide-template">${esc(template)}</pre></details>`
    + "</dialog>";
}

// ---------------------------------------------------------------- AI 브리핑(generate_viewer.py briefing_html)

export function briefingHtml(report) {
  const parts = [];
  // 제목 옆 근거 아이콘. 이 블록을 어느 초안 파일 어느 섹션에서 뽑았는지 밝힌다.
  const cite = (section, extra = "") => citeButton(report.source.name, section, extra);

  parts.push('<div class="notice"><span class="label">AI 브리핑</span>'
    + "<span>초안에서 항목을 그대로 뽑아 배치한 화면입니다. 새로 지어낸 문장은 없습니다. "
    + "문장 전체와 맥락은 <b>초안 원문</b> 탭에서 확인하세요.</span>"
    + `${guideButton()}</div>`);

  const meta = [];
  if (report.period_range) meta.push(`<div><dt>조회 기간</dt><dd>${esc(report.period_range)}</dd></div>`);
  if (report.period_next) meta.push(`<div><dt>차주 범위</dt><dd>${esc(report.period_next)}</dd></div>`);
  if (report.period_version) meta.push(`<div><dt>버전</dt><dd>${esc(report.period_version)}</dd></div>`);
  if (report.period_scope.length) meta.push(`<div><dt>실제 확인 범위</dt><dd>${report.period_scope.length}개 소스</dd></div>`);
  if (meta.length) parts.push(`<dl class="meta-grid">${meta.join("")}</dl>`);
  if (report.period_scope.length) {
    const scope = nodesHtml(report.period_scope.map((item) => node(item)));
    parts.push(`<section class="blk"><details class="src"><summary>실제 확인 범위 ${report.period_scope.length}건</summary>`
      + `<div class="body">${cite("보고 기간")}${scope}</div></details></section>`);
  }

  if (report.core.length) {
    let rows = "";
    report.core.forEach((item, i) => {
      const index = i + 1;
      // 대응하는 업무별 상세 카드가 있으면 눌러서 이동할 수 있게 한다.
      const href = index <= report.tasks.length ? ` href="#task-${index}"` : "";
      rows += `<a class="core"${href}><span class="num">${index}</span><b>${markInline(item)}</b></a>`;
    });
    parts.push(`<section class="blk"><h2>${esc(report.core_origin)} · 초안 문장 그대로${cite(report.core_origin)}</h2>`
      + `<div class="panel">${rows}</div></section>`);
  }

  if (report.flags.length) parts.push(flagsSection(report, cite("업무별 상세 내용 · 이슈 및 기타 사항 · 정량 지표")));

  if (report.tasks.length) {
    const cards = report.tasks.map((task, i) => {
      const index = i + 1;
      let rows = "";
      for (const row of task.rows) {
        const isNext = norm(row.label) === norm("다음 단계");
        const body = nodesHtml(row.items.map((item) => node(item)), isNext ? "accent" : "");
        rows += `<div class="row${isNext ? " next" : ""}"><dt>${esc(row.label || "내용")}</dt><dd>${body}</dd></div>`;
      }
      return `<article class="task" id="task-${index}">`
        + `<h3><span class="n">${index}</span><span>${markInline(task.title)}`
        + `${cite("업무별 상세 내용", task.title)}</span></h3>${rows}</article>`;
    });
    parts.push(`<section class="blk"><h2>업무별 상세 내용${cite("업무별 상세 내용")}</h2>${cards.join("")}</section>`);
  }

  if (report.metrics.length || report.tally) {
    let block = nodesHtml(report.metrics);
    if (report.tally) {
      const tally = report.tally;
      const bars = tally.parts.filter((part) => part.value)
        .map((part) => `<i style="flex:${part.value}" title="${esc(part.label)} ${part.value}건"></i>`).join("")
        || '<i style="flex:1;background:var(--border)"></i>';
      const legend = tally.parts.map((part) => `<div class="${part.value ? "on" : ""}"><span>${esc(part.label)}</span>`
        + `<span>${part.value}건</span></div>`).join("");
      const note = tally.note ? `<p class="note">${inline(tally.note)}</p>` : "";
      block += `<div class="stat"><span class="big">${tally.total}</span>`
        + `<span class="cap">건 · ${esc(tally.name)}</span>`
        + `<div class="bar">${bars}</div><div class="legend">${legend}</div>${note}</div>`;
    }
    parts.push(`<section class="blk"><h2>정량 지표${cite("정량 지표")}</h2>${block}</section>`);
  }

  let columns = "";
  if (report.this_week.length) columns += `<section class="blk"><h2>금주 주요 사항${cite("금주 주요 사항")}</h2>${nodesHtml(report.this_week)}</section>`;
  if (report.next_week.length) columns += `<section class="blk"><h2>차주 주요 사항${cite("차주 주요 사항")}</h2>${nodesHtml(report.next_week, "accent")}</section>`;
  if (columns) parts.push(`<div class="cols">${columns}</div>`);
  if (report.issues.length) parts.push(`<section class="blk"><h2>이슈 및 기타 사항${cite("이슈 및 기타 사항")}</h2>${nodesHtml(report.issues, "warn")}</section>`);

  if (report.ppt) {
    parts.push(`<section class="blk"><h2>PPT 붙여넣기용${cite("PPT 붙여넣기용")}</h2>`
      + '<button class="copy" data-copy="ppt">원문 그대로 복사</button>'
      + `<pre class="raw" id="ppt-block">${esc(report.ppt)}</pre></section>`);
  }

  if (report.sources.length) {
    parts.push('<section class="blk"><details class="src"><summary>출처 및 검증</summary>'
      + `<div class="body">${cite("출처 및 검증")}${nodesHtml(report.sources)}</div>`
      + "</details></section>");
  }

  if (report.body.length) parts.push(`<section class="blk"><h2>초안 본문${cite("초안 본문")}</h2>${nodesHtml(report.body)}</section>`);

  if (!report.core.length && !report.tasks.length && !report.body.length) {
    parts.push('<section class="blk"><div class="panel guide-empty">이 초안은 표준 섹션 구성이 아닙니다. '
      + "초안 원문 탭에서 전체 내용을 확인하세요."
      + `${guideButton("표준 섹션 구성 보기")}</div></section>`);
  }
  return parts.join("");
}

// ---------------------------------------------------------------- 회차 목록 자료(generate_viewer.py viewer_payload)

export function viewerPayload(reports) {
  return reports.map((report) => {
    const title = reportTitle(report);
    const subtitle = reportSubtitle(report);
    return {
      slug: report.slug,
      date: report.date,
      month: reportMonth(report),
      period: reportPeriod(report),
      title,
      subtitle,
      origin: report.core_origin || "원문",
      approval: report.approval,
      file: report.source.name,
      flags: report.flags.length,
      tasks: report.tasks.length,
      search: `${title} ${subtitle} ${report.raw}`.toLowerCase(),
      briefing: briefingHtml(report),
      document: '<div class="document-shell"><nav class="toc"><b>초안 목차</b>'
        + outline(report.raw).map((item) => `<a href="#${item.anchor}">${esc(item.title)}</a>`).join("")
        + `</nav><article class="doc">${renderMarkdown(report.raw)}</article></div>`,
      raw: report.raw,
    };
  });
}
