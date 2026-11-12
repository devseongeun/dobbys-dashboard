// 주간 보고 초안 Markdown 을 구조로 읽어 들인다. 로컬판 tabs/weekly/report_parser.py 를 줄 단위로 옮겼다.
// 보고 기간 / 이번 주 핵심 업무 / 업무별 상세 내용 / 정량 지표 / 금주·차주·이슈 / PPT 붙여넣기용 / 출처 및 검증 /
// PPT 처리(또는 승인 상태)를 뽑아낸다. 문장을 요약하거나 새로 쓰지 않는다. 있는 문장을 옮겨 담기만 한다.
// 보고서 필드 이름은 로컬판 Report dataclass 와 같게(snake_case) 둬 비교 테스트가 그대로 맞춰 본다.
// 다른 점: 파일은 디스크 경로가 아니라 {name, folder, text, mtime, size} 로 받는다(폴더 핸들에서 읽은 값, readFolders).
import { D, S, WS, cmp, pyInt, pyLen, readText, splitlines, strip } from "./pystr.js";

// 초안 파일명 규칙. 날짜로 시작하는 `…weekly-report` 이거나 `주간` 이 들어간 이름, `weekly-report…` 로 시작하는 이름.
const DATED_REPORT_RE = new RegExp(`^${D}{4}-${D}{2}-${D}{2}.*weekly-report`, "iu");

export function isReportFile(name) {
  if (name.startsWith("#") || !name.endsWith(".md")) return false;
  return name.includes("주간") || name.startsWith("weekly-report") || DATED_REPORT_RE.test(name);
}

export const DETAIL_LABELS = ["수행 내용", "확인 결과", "의사결정/원인", "다음 단계"];
const TITLE_SECTIONS = [
  ["이번 주 핵심 업무", "초안 핵심 업무"],
  ["금주 주요 사항", "금주 주요 사항"],
  ["금주 작업 정리", "금주 작업 정리"],
  ["이번 주 작업 요약", "이번 주 작업 요약"],
];

const NORM_RE = new RegExp(`[${WS}·]`, "gu");
const SPACES_RE = new RegExp(`${S}+`, "gu");

// 헤딩·라벨 비교용 키. 강조 기호와 공백을 지운다.
export const norm = (value) => strip(String(value || "").replace(/[*_`]/g, "").replace(NORM_RE, ""));

// 강조 기호만 벗긴다. 백틱은 `확인 필요` 같은 표시를 살리려고 남긴다.
export const clean = (value) => strip(String(value || "").replace(/[*_]/g, "").replace(SPACES_RE, " "));

// ---------------------------------------------------------------- 문서 구조 읽기

export const node = (text, kids = []) => ({ text, kids });

const BULLET_RE = new RegExp(`^(${S}*)([-*+]|${D}+[.)])${S}+(.*)$`, "u");

// 들여쓰기 불릿을 트리로 만든다. 불릿이 아닌 줄은 직전 항목에 붙인다.
export function buildTree(lines) {
  const root = [];
  const stack = [[-1, root, null]];
  for (const raw of lines) {
    if (!strip(raw)) continue;
    const bullet = raw.match(BULLET_RE);
    if (!bullet) {
      const last = stack.at(-1)[2];
      if (last !== null) last.text = strip(`${last.text} ${strip(raw)}`);
      else root.push(node(strip(raw)));
      continue;
    }
    const depth = Math.floor(bullet[1].replace(/\t/g, "  ").length / 2);
    const item = node(strip(bullet[3]));
    while (stack.length > 1 && stack.at(-1)[0] >= depth) stack.pop();
    stack.at(-1)[1].push(item);
    stack.push([depth, item.kids, item]);
  }
  return root;
}

export function flatten(nodes) {
  const out = [];
  for (const item of nodes) {
    out.push(item.text);
    out.push(...flatten(item.kids));
  }
  return out;
}

const section = (name) => ({ name, lines: [], subs: [] });
const HEADING_RE = new RegExp(`^(#{1,3})${S}+(.*)$`, "u");

export function splitSections(raw) {
  let title = "";
  const sections = [];
  let current = null;
  let sub = null;
  let inFrontMatter = false;
  splitlines(raw).forEach((line, index) => {
    const stripped = strip(line);
    if (index === 0 && stripped === "---") { inFrontMatter = true; return; }
    if (inFrontMatter) {
      if (stripped === "---") inFrontMatter = false;
      return;
    }
    const heading = stripped.match(HEADING_RE);
    if (heading) {
      const level = heading[1].length;
      const text = clean(heading[2]);
      if (level === 1) { title = title || text; return; }
      if (level === 2) {
        current = section(text);
        sections.push(current);
        sub = null;
        return;
      }
      if (current === null) {
        current = section("");
        sections.push(current);
      }
      sub = section(text);
      current.subs.push(sub);
      return;
    }
    if (sub !== null) sub.lines.push(line);
    else if (current !== null) current.lines.push(line);
    else if (!title && stripped.startsWith("제목:")) title = clean(stripped.split(":").slice(1).join(":"));
  });
  return [title, sections];
}

export function findSection(sections, name) {
  for (const item of sections) {
    if (norm(item.name) === norm(name)) return item;
    // '금주 주요 사항 (2026-06-08 ~ 2026-06-12)' 처럼 기간이 붙은 헤딩도 같은 섹션으로 본다.
    if (norm(item.name.replace(/\(.*?\)/gu, "")) === norm(name)) return item;
  }
  return null;
}

export function labelOf(text) {
  const head = norm(text.split(/[:：]/u)[0]);
  return DETAIL_LABELS.find((label) => norm(label) === head) ?? null;
}

// ---------------------------------------------------------------- 보고서 모델

// Report 의 property(title·subtitle·period·month·week_key). month 는 strptime('%Y-%m-%d') 이 읽는 날짜만, 아니면 null.
export const reportTitle = (report) => (report.core.length ? report.core[0] : (report.doc_title || report.source.name.replace(/\.[^.]*$/u, "")));
export const reportSubtitle = (report) => (report.core.length > 1 ? report.core[1] : "");
export function reportPeriod(report) {
  if (report.week_start && report.week_end) return `${report.week_start.replaceAll("-", ".")} — ${report.week_end.replaceAll("-", ".")}`;
  return report.date.replaceAll("-", ".");
}
export function reportMonth(report) {
  // strptime: 연도는 유니코드 숫자 4자, 월·일은 ASCII 두 자리이고 실제 있는 날짜여야 한다(아니면 ValueError).
  const match = report.date.match(new RegExp(`^(${D}{4})-(\\d{2})-(\\d{2})$`, "u"));
  if (!match) return null;
  const [year, month, day] = [pyInt(match[1]), Number(match[2]), Number(match[3])];
  const at = new Date(Date.UTC(2000, month - 1, day));
  if (year < 1 || month < 1 || month > 12 || day < 1 || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null;
  if (month === 2 && day === 29 && !((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0)) return null;
  return `${year}년 ${month}월`;
}
export const weekKey = (report) => report.week_start || report.date;

const STAMP_RE = new RegExp(`(${D}{4}-${D}{2}-${D}{2})`, "u");
const COMPACT_RE = new RegExp(`(${D}{4})(${D}{2})(${D}{2})`, "u");
const DATES_RE = new RegExp(`${D}{4}-${D}{2}-${D}{2}`, "gu");
const NUMBERED_RE = new RegExp(`^${D}+[.)]${S}+`, "u");
const LABEL_HEAD_RE = new RegExp(`^[*_${WS}]*[^:：]*[:：]${S}*[*_${WS}]*`, "u");
const COUNT_RE = new RegExp(`^(.*?)${S}*(${D}+)${S}*건`, "u");
const LIST_LINE_RE = new RegExp(`^${S}*([-*+]|${D}+[.)])${S}+`, "u");
const NEED_RE = new RegExp(`확인${S}*필요`, "u");

// file: {name, folder, text, mtime, size}. 날짜를 못 찾으면 null(로컬판과 같이 건너뛴다).
export function parseReport(file) {
  const raw = file.text;
  const [docTitle, sections] = splitSections(raw);

  let date;
  const stamp = file.name.match(STAMP_RE);
  const compact = stamp ? null : file.name.match(COMPACT_RE);
  if (stamp) date = stamp[1];
  else if (compact) date = `${compact[1]}-${compact[2]}-${compact[3]}`;
  else {
    const found = docTitle.match(STAMP_RE);
    if (!found) return null;
    date = found[1];
  }

  const report = {
    date, slug: date, source: { name: file.name, folder: file.folder ?? "" }, raw, doc_title: docTitle, sections,
    period_range: "", period_next: "", period_version: "", period_scope: [], week_start: "", week_end: "",
    core: [], core_origin: "", tasks: [], metrics: [], tally: null, this_week: [], next_week: [], issues: [],
    ppt: "", sources: [], approval: "", flags: [], body: [], standard: false,
    mtime: file.mtime ?? 0, size: file.size ?? 0,
  };

  const period = findSection(sections, "보고 기간");
  if (period) {
    for (const item of buildTree(period.lines)) {
      const at = item.text.indexOf(":");
      const head = at < 0 ? item.text : item.text.slice(0, at);
      const tail = at < 0 ? "" : item.text.slice(at + 1);
      const key = norm(head);
      const value = clean(tail);
      if (key === "조회기간") report.period_range = value;
      else if (key === "차주범위") report.period_next = value;
      else if (key === "버전") report.period_version = value;
      else if (key === "실제확인범위") report.period_scope = item.kids.map((kid) => clean(kid.text));
    }
  }

  let dates = report.period_range.match(DATES_RE) ?? [];
  if (!dates.length) dates = (sections.length ? sections[0].name : "").match(DATES_RE) ?? [];
  if (dates.length >= 2) [report.week_start, report.week_end] = dates;

  if (!sections.length) {
    let bodyLines = splitlines(raw);
    if (bodyLines.length && strip(bodyLines[0]) === "---") {
      const end = bodyLines.findIndex((line, i) => i > 0 && strip(line) === "---");
      bodyLines = bodyLines.slice((end < 0 ? 0 : end) + 1);
    }
    report.body = buildTree(bodyLines);
    const tops = report.body.map((item) => clean(item.text)).filter(Boolean);
    if (tops.length) {
      report.core = tops.slice(0, 5);
      report.core_origin = "초안 본문";
    }
  }

  for (const [name, origin] of TITLE_SECTIONS) {
    const found = findSection(sections, name);
    if (!found) continue;
    let items = buildTree(found.lines).map((item) => clean(item.text)).filter(Boolean);
    items = items.filter((item) => pyLen(item) > 1);
    if (!items.length && found.subs.length) items = found.subs.map((sub) => clean(sub.name)).filter(Boolean);
    items = items.map((item) => item.replace(NUMBERED_RE, ""));
    if (items.length) {
      report.core = items.slice(0, 5);
      report.core_origin = origin;
      break;
    }
  }

  const details = findSection(sections, "업무별 상세 내용");
  if (details) {
    report.standard = true;
    for (const sub of details.subs) {
      const task = { title: clean(sub.name).replace(NUMBERED_RE, ""), rows: [] };
      for (const item of buildTree(sub.lines)) {
        const label = labelOf(item.text);
        if (label) {
          const items = [];
          const head = strip(item.text.replace(LABEL_HEAD_RE, ""));
          if (item.text.includes(":") || item.text.includes("：")) {
            if (head && norm(head) !== norm(item.text)) items.push(clean(head));
          }
          for (const kid of item.kids) {
            items.push(clean(kid.text));
            items.push(...kid.kids.map((grand) => clean(grand.text)));
          }
          task.rows.push({ label, items: items.filter(Boolean) });
        } else {
          const items = [clean(item.text), ...item.kids.map((kid) => clean(kid.text))];
          task.rows.push({ label: "", items: items.filter(Boolean) });
        }
      }
      report.tasks.push(task);
    }
  }

  const metrics = findSection(sections, "정량 지표");
  if (metrics) {
    report.metrics = buildTree(metrics.lines);
    if (metrics.subs.length) {
      const sub = metrics.subs[0];
      const tally = { name: clean(sub.name), total: 0, parts: [], note: "" };
      for (const item of buildTree(sub.lines)) {
        const match = item.text.match(COUNT_RE);
        if (match && norm(match[1]) === "전체") {
          tally.total = pyInt(match[2]);
          for (const kid of item.kids) {
            const kidMatch = kid.text.match(COUNT_RE);
            if (kidMatch) tally.parts.push({ label: clean(kidMatch[1]), value: pyInt(kidMatch[2]) });
          }
        } else if (match) {
          tally.parts.push({ label: clean(match[1]), value: pyInt(match[2]) });
        }
      }
      tally.note = strip(sub.lines.filter((line) => strip(line) && !LIST_LINE_RE.test(line)).map(strip).join(" "));
      if (tally.total || tally.parts.length) report.tally = tally;
    }
  }

  for (const [attr, name] of [["this_week", "금주 주요 사항"], ["next_week", "차주 주요 사항"], ["issues", "이슈 및 기타 사항"]]) {
    const found = findSection(sections, name);
    if (!found) continue;
    const nodes = buildTree(found.lines);
    for (const sub of found.subs) nodes.push(node(clean(sub.name).replace(NUMBERED_RE, ""), buildTree(sub.lines)));
    report[attr] = nodes;
  }

  const ppt = findSection(sections, "PPT 붙여넣기용");
  if (ppt) {
    const chunks = [strip(ppt.lines.join("\n"))];
    for (const sub of ppt.subs) chunks.push(clean(sub.name) + "\n" + strip(sub.lines.join("\n")));
    report.ppt = strip(chunks.filter(Boolean).join("\n\n"));
  }

  const src = findSection(sections, "출처 및 검증");
  if (src) report.sources = buildTree(src.lines);

  const approval = findSection(sections, "PPT 처리") ?? findSection(sections, "승인 상태");
  if (approval) report.approval = strip(approval.lines.filter((line) => strip(line)).map(clean).join(" "));

  const scan = (texts, origin) => {
    for (const text of texts) {
      let kind;
      if (NEED_RE.test(text)) kind = "need";
      else if (/N\/A/iu.test(text)) kind = "na";
      else if (/미검증|미확인/u.test(text)) kind = "unver";
      else continue;
      report.flags.push({ kind, origin, text });
    }
  };
  for (const task of report.tasks) for (const row of task.rows) scan(row.items, task.title);
  scan(flatten(report.issues), "이슈 및 기타 사항");
  scan(flatten(report.metrics), "정량 지표");
  return report;
}

// 같은 주를 가리키는 초안이 여러 개면 표준 형식 > 최신 수정 > 큰 파일 순으로 하나만 남긴다.
const rankOf = (report) => [report.standard ? 1 : 0, report.mtime, report.size];
function outranks(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// load_reports 의 파일 목록 뒤 단계. files 는 readFolders() 결과(로컬판처럼 경로 순으로 정렬된 후보).
// 반환 {reports, warnings}. 깨진 파일은 건너뛰고 경고로 남긴다(로컬판은 터미널에 '건너뜀:' 을 찍는다).
export function loadReports(files) {
  const reports = [];
  const warnings = [];
  for (const file of files) {
    if (file.error) { warnings.push(`건너뜀: ${file.name} (${file.error})`); continue; }
    let report;
    try {
      report = parseReport(file);
    } catch (error) {
      warnings.push(`건너뜀: ${file.name} (${error?.message ?? error})`);
      continue;
    }
    if (!report) continue;
    // 로컬판은 strptime 이 못 읽는 날짜(예: 2026-13-40)면 뷰어 전체를 만들지 못한다. 웹은 그 초안만 건너뛴다.
    if (reportMonth(report) === null) { warnings.push(`건너뜀: ${file.name} (날짜 ${report.date} 를 읽지 못함)`); continue; }
    reports.push(report);
  }

  const best = new Map();
  for (const report of reports) {
    const key = weekKey(report);
    const current = best.get(key);
    if (current === undefined || outranks(rankOf(report), rankOf(current))) best.set(key, report);
  }

  // Python sorted(reverse=True) 은 안정 정렬이다: 같은 키는 원래 순서를 지킨다.
  const ordered = [...best.values()].sort((a, b) => cmp(b.date, a.date) || cmp(weekKey(b), weekKey(a)));
  const seen = new Set();
  for (const report of ordered) {
    let slug = report.date;
    let suffix = 2;
    while (seen.has(slug)) slug = `${report.date}-${suffix++}`;
    seen.add(slug);
    report.slug = slug;
  }
  return { reports: ordered, warnings };
}

// 폴더 핸들 여러 개 → 후보 파일 목록. 로컬판 load_reports 의 glob('*.md') 단계.
// - 폴더 바로 아래 파일만, isReportFile 이름만. 같은 폴더를 두 번 골랐으면 한 번만 읽는다(isSameEntry).
// - 순서: 로컬판은 절대 경로(Path, 조각별 비교) 순이다. 브라우저는 절대 경로를 모르므로 (폴더 이름, 파일 이름) 순(같으면
//   고른 순서)으로 둔다. 같은 상위 폴더 아래 폴더들이면 로컬판과 같은 순서다.
// - 폴더를 못 읽으면(옮겨짐·권한) 그 폴더는 건너뛰고 warnings 에 적는다.
export async function readFolders(handles) {
  const folders = [];
  const warnings = [];
  for (const handle of handles ?? []) {
    let same = false;
    for (const seen of folders) if (await seen.isSameEntry(handle).catch(() => false)) same = true;
    if (!same) folders.push(handle);
  }
  const files = [];
  for (const [order, folder] of folders.entries()) {
    try {
      for await (const [name, entry] of folder.entries()) {
        if (entry.kind !== "file" || !isReportFile(name)) continue;
        files.push({ order, folder: folder.name, name, entry });
      }
    } catch (error) {
      warnings.push(`폴더 ${folder.name} 를 읽지 못했다: ${error?.name === "NotFoundError" ? "폴더를 찾을 수 없다(옮겨졌거나 지워졌다)" : error?.message ?? error}`);
    }
  }
  files.sort((a, b) => cmp(a.folder, b.folder) || cmp(a.name, b.name) || a.order - b.order);
  const out = [];
  for (const file of files) {
    try {
      const blob = await file.entry.getFile();
      const text = readText(new Uint8Array(await blob.arrayBuffer()));
      out.push({ name: file.name, folder: file.folder, text, mtime: blob.lastModified ?? 0, size: blob.size ?? 0 });
    } catch (error) {
      out.push({ name: file.name, folder: file.folder, error: error?.name === "TypeError" ? "UTF-8 로 읽지 못함" : error?.message ?? String(error) });
    }
  }
  return { files: out, warnings };
}
