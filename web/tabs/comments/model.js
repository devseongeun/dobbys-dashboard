// 웹 기획서 코멘트 판정 규칙(분류·결정 완료·자기 종결·우선순위). 로컬판 tabs/comments/model.py 이식.
// 같은 TROMBONE 응답으로 Python 과 결과가 같아야 한다(tests/js/web/comments_parity.test.js).
// Python 과 맞추려고 길이·자르기는 코드 포인트 기준(pyLen·pySlice), 공백은 Python str.isspace 집합(PY_WS),
// 정렬은 코드 포인트 순(pyCmp)으로 한다.

export const CATEGORY_RULES = [
  ["담당자·일정 지정", ["담당자 지정"]],
  ["기획서 자체 오류·수정", ["웹기획서 버그", "웹 기획서 수정", "웹기획서 수정"]],
  ["설명란 보완", ["설명란 업데이트", "설명 업데이트"]],
  ["메시지 코드 등록", ["메시지 코드"]],
  ["기능·예외 정의 확인", ["기능 확인 요청", "예외 처리 확인"]],
];
export const FALLBACK_CATEGORY = "내용 확인·제안";

// 리뷰 우선순위 = 화면 조치 시급도 순. 필터 칩 노출 순서에도 쓴다.
export const CATEGORY_ORDER = [
  "담당자·일정 지정",
  "기획서 자체 오류·수정",
  "메시지 코드 등록",
  "설명란 보완",
  "기능·예외 정의 확인",
  "내용 확인·제안",
];

export const CATEGORY_COLOR = {
  "담당자·일정 지정": "#b45309",
  "기획서 자체 오류·수정": "#b91c1c",
  "메시지 코드 등록": "#7c3aed",
  "설명란 보완": "#0f766e",
  "기능·예외 정의 확인": "#1d4ed8",
  "내용 확인·제안": "#475569",
};

export const HEAD_LIMIT_MD = 70;
export const HEAD_LIMIT_HTML = 80;

// Python str.isspace() 가 참인 글자(= str.split()·strip()·정규식 \s 가 보는 공백).
export const PY_WS = "\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const STRIP_RE = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, "gu");
const RSTRIP_RE = new RegExp(`[${PY_WS}]+$`, "u");
const SPLIT_RE = new RegExp(`[${PY_WS}]+`, "u");

export const pyStrip = (text) => String(text).replace(STRIP_RE, "");
export const pyRstrip = (text) => String(text).replace(RSTRIP_RE, "");
export const pySquash = (text) => String(text).split(SPLIT_RE).filter(Boolean).join(" "); // " ".join(text.split())
export const pyLen = (text) => [...String(text)].length;
export const pySlice = (text, end) => [...String(text)].slice(0, end).join("");

// 코드 포인트 순 비교(Python 문자열 비교). JS 의 < 는 UTF-16 단위라 보조 평면 글자에서 갈린다.
export function pyCmp(a, b) {
  const x = String(a);
  const y = String(b);
  const ix = x[Symbol.iterator]();
  const iy = y[Symbol.iterator]();
  for (;;) {
    const p = ix.next();
    const q = iy.next();
    if (p.done || q.done) return p.done === q.done ? 0 : p.done ? -1 : 1;
    const d = p.value.codePointAt(0) - q.value.codePointAt(0);
    if (d) return d < 0 ? -1 : 1;
  }
}
export const pyMax = (values) => values.reduce((best, v) => (pyCmp(v, best) > 0 ? v : best));
export const minute = (at) => pySlice(at, 16).replaceAll("T", " "); // at[:16].replace("T", " ")

// 내가 스스로 "답변 안 하셔도 된다" 고 단 답글. 이 답글과 그 원 코멘트를 함께 잠근다(model.py SELF_CLOSE_RE).
const S = `[${PY_WS}]`;
export const SELF_CLOSE_RE = new RegExp(`(?:답변|회신|답글)[^\\n]{0,14}(?:않아도|않으셔도|안${S}*하셔도|안${S}*주셔도|불필요)`, "u");

// 결정 완료 판정 — 내가(작성자가) 직접 붙인 👀(EMO005) 반응. 타인의 👀 는 세지 않는다.
export const DECIDED_EMOJI = "EMO005";
export const DECIDED_EMOJI_CHAR = "👀";
export const PRIORITY_ORDER = ["상", "중"];

export function eyeActors(comment) {
  const out = [];
  for (const rx of comment?.reactions || []) {
    if (rx?.emoji !== DECIDED_EMOJI) continue;
    for (const actor of rx.actors || []) out.push(actor);
  }
  return out;
}

export function classify(text) {
  const head = pySlice(text, 60);
  for (const [name, keys] of CATEGORY_RULES) if (keys.some((k) => head.includes(k))) return name;
  return FALLBACK_CATEGORY;
}

export const clip = (text, limit) => (pyLen(text) <= limit ? text : pySlice(text, limit) + "…");

export function priorityOf(commentId, overrides) {
  const entry = (overrides?.priority || {})[commentId] || {};
  const level = entry.level;
  return PRIORITY_ORDER.includes(level) ? [level, entry.reason || ""] : ["", ""];
}

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// 페이지 묶음을 순서대로 불러온다(동시에 limit 개까지). 결과 순서는 입력 순서다.
async function fetchAll(entries, fetchBundle, limit = 4) {
  const out = new Array(entries.length);
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const i = next++;
      out[i] = await fetchBundle(entries[i][1]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, entries.length) }, worker));
  return out;
}

// 작성자 기준 코멘트를 화면별로 묶는다(model.py collect). {rows, pages: Map(pageId → page), answered}.
export async function collect(inbox, fetchBundle, author, overrides) {
  const resolvedByHand = overrides?.resolved || {};
  const mine = (inbox || []).filter((c) => c.author === author);
  if (!mine.length) return { rows: [], pages: new Map(), answered: 0 };
  const pagePaths = new Map();
  for (const c of [...mine].sort((a, b) => pyCmp(a.at, b.at))) if (!pagePaths.has(c.pageId)) pagePaths.set(c.pageId, c.path);
  const entries = [...pagePaths];
  const fetched = await fetchAll(entries, fetchBundle);
  const bundles = new Map(entries.map(([pageId], i) => [pageId, fetched[i]]));

  const rows = [];
  for (const [pageId, bundle] of bundles) {
    for (const c of bundle.comments || []) {
      if (c.author !== author) continue;
      const [priLevel, priWhy] = priorityOf(c.commentId, overrides || {});
      rows.push({
        ...c,
        pageId,
        path: pagePaths.get(pageId),
        // 기획서 메타 미입력 화면은 autoScrnId 가 null 로 온다. 정렬 키라서 문자열로 고정한다.
        scrnId: bundle.page.autoScrnId || "-",
        pageTitle: bundle.page.title,
        category: classify(c.text),
        isReply: Boolean(c.parentCommentId),
        resolved: has(resolvedByHand, c.commentId) ? resolvedByHand[c.commentId] : "",
        resolvedOwn: has(resolvedByHand, c.commentId),
        priorityLevel: priLevel,
        priority: priWhy,
        answers: [],
      });
    }
  }

  // 내 코멘트에 달린 타인의 답글 = 받은 답변. 코멘트ID로 원 코멘트에 되붙인다.
  const byId = new Map(rows.map((r) => [r.commentId, r]));
  for (const bundle of bundles.values()) {
    for (const c of bundle.comments || []) {
      if (c.author === author) continue;
      const parent = byId.get(c.parentCommentId || "");
      if (parent === undefined) continue;
      parent.answers.push({ commentId: c.commentId, author: c.author, at: c.at, text: pyStrip(c.text), eyed: eyeActors(c).includes(author) });
    }
  }
  for (const r of rows) {
    r.answers.sort((a, b) => pyCmp(a.at, b.at));
    r.answered = r.answers.length > 0;
    const marks = eyeActors(r).includes(author) ? ["코멘트 본문"] : [];
    for (const a of r.answers) if (a.eyed) marks.push(`답글 \`${a.commentId}\``);
    r.decidedOn = marks;
    r.decided = marks.length > 0;
  }

  // 자기 답글로 종결한 문의: 답글과 원 코멘트를 함께 잠근다.
  for (const r of rows) {
    if (!r.isReply || !SELF_CLOSE_RE.test(r.text)) continue;
    const head = clip(pySquash(r.text), 90);
    const parent = byId.get(r.parentCommentId);
    if (!r.resolved) r.resolved = `작성자 본인이 종결한 답글이다 — ${head}`;
    if (parent && !parent.resolved) parent.resolved = `작성자 본인이 \`${r.commentId}\` 답글로 종결했다 — ${head}`;
  }

  rows.sort((a, b) => pyCmp(a.scrnId, b.scrnId) || pyCmp(a.at, b.at));
  const grouped = new Map();
  for (const r of rows) {
    if (!grouped.has(r.pageId)) {
      const page = bundles.get(r.pageId).page;
      grouped.set(r.pageId, {
        pageId: r.pageId, scrnId: r.scrnId, title: r.pageTitle, path: r.path,
        changeType: page.changeType || "-", author: page.author || "-", rows: [],
      });
    }
    grouped.get(r.pageId).rows.push(r);
  }
  const pages = new Map([...grouped].sort((a, b) => pyCmp(a[1].scrnId, b[1].scrnId)));
  // 답변 완료 = 기획(타인)이 답글을 단 내 코멘트 수
  const answered = rows.filter((r) => r.answered).length;
  return { rows, pages, answered };
}

// 👀 를 붙일 대상: 기획 답글이 있으면 마지막 답글, 없으면 내 코멘트 본문.
export const targetOf = (row) => (row.answers.length ? row.answers.at(-1).commentId : row.commentId);
export const alreadyEyed = (row, author) => (row.answers.length ? row.answers.at(-1).eyed : eyeActors(row).includes(author));
export const locked = (row) => Boolean(row.resolved) && !row.answered && !row.decided;

export function categoryCounts(rows) {
  const counts = new Map();
  for (const r of rows) counts.set(r.category, (counts.get(r.category) || 0) + 1);
  return CATEGORY_ORDER.filter((c) => counts.get(c)).map((c) => [c, counts.get(c)]);
}

// 화면에 내려줄 모양(model.py page_payload).
export function pagePayload(pages) {
  return [...pages.values()].map((p) => ({
    pageId: p.pageId, scrnId: p.scrnId, title: p.title, path: p.path,
    changeType: p.changeType, author: p.author,
    comments: p.rows.map((r) => ({
      id: r.commentId,
      at: minute(r.at),
      cat: r.category,
      reply: r.isReply,
      text: pyStrip(r.text),
      head: clip(pyStrip(pyStrip(r.text).split("\n")[0]), HEAD_LIMIT_HTML),
      // 답변을 받았거나 👀 결정이 난 건은 '답변 불필요' 잠금보다 우선한다.
      lock: r.answered || r.decided ? "" : r.resolved,
      st: r.answered ? "ans" : (r.resolved && !r.decided ? "lock" : "open"),
      res: Boolean(r.resolved),
      resOwn: r.resolvedOwn,
      dec: r.decided,
      decOn: r.decidedOn.map((m) => m.replaceAll("`", "")),
      priLv: r.priorityLevel,
      pri: r.priority,
      ans: r.answers.map((a) => ({ id: a.commentId, author: a.author, at: minute(a.at), text: a.text, eyed: a.eyed })),
    })),
  }));
}
