// 코멘트 리뷰 체크리스트 md. 로컬판 tabs/comments/markdown.py 이식(같은 입력이면 글자까지 같다).
import {
  DECIDED_EMOJI, DECIDED_EMOJI_CHAR, HEAD_LIMIT_MD, PRIORITY_ORDER, clip, minute, pyCmp, pyLen, pyMax,
  pyRstrip, pyStrip,
} from "./model.js";

export function mdQuote(text) {
  return pyStrip(text).split("\n").map((raw) => {
    const line = pyRstrip(raw);
    return line ? "  > " + line : "  >";
  }).join("\n");
}

// collections.Counter(...).most_common(): 건수 내림차순, 같으면 처음 나온 순.
function mostCommon(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

// rows·pages·answered 는 model.js collect 결과. pages 는 Map(pageId → page).
export function buildMarkdown(rows, pages, answered, { base, author, date, collected }) {
  const counts = mostCommon(rows.map((r) => r.category));
  const latest = minute(pyMax(rows.map((r) => r.at)));
  const pageList = [...pages.values()];

  // 축이 둘이다. 답변 축(답변 완료 / 미답변 / 답변 불필요)과 결정 축(체크박스, 내 👀).
  const lockedRows = rows.filter((r) => r.resolved && !r.answered);
  const openRows = rows.filter((r) => !r.answered && !r.resolved);
  const answers = rows.flatMap((r) => r.answers);
  const decided = rows.filter((r) => r.decided);
  const ids = (list) => list.map((r) => `\`${r.commentId}\``).join(" · ");

  const L = [];
  L.push("---", "tags: [trb-400, 웹기획서, 코멘트, 기획리뷰, checklist]", "status: review", `created: ${date}`, "---", "");
  L.push(`# 웹 기획서 코멘트 리뷰 체크리스트 (${author})`, "");
  L.push(`- 대상: TROMBONE 웹 기획서 <${base}/>`);
  L.push(`- 작성자 필터: **${author}** · 코멘트 **${rows.length}건** / 화면 **${pageList.length}개**`);
  L.push(`- 수집 시각: ${collected} · 기준 날짜 ${date} · 최신 코멘트 ${latest}`);
  if (answered) {
    const lastAnswer = minute(pyMax(answers.map((a) => a.at)));
    const who = [...new Set(answers.map((a) => a.author))].sort(pyCmp).join(" · ");
    L.push(`- **답변 완료 ${answered}건** / 미답변 ${rows.length - answered - lockedRows.length}건 — 답글 작성자 \`${who}\` · 최신 답변 ${lastAnswer}`);
    L.push("  답글 전문은 각 항목 아래 `> ` 인용으로 붙여 뒀다. 기획 답변이 온 건은 재질의하지 않는다.");
  } else {
    L.push(`- **답변(대댓글) 달린 코멘트: 0건** — ${rows.length}건 전부 미응답 상태다.`);
  }
  if (lockedRows.length) {
    L.push(`- **답변 불필요 ${lockedRows.length}건**(${ids(lockedRows)}) — 기획서 밖에서 회신을 받았거나 작성자 본인이 종결한 항목이라 리뷰 안건에서 제외한다. 남은 리뷰 안건은 ${openRows.length}건이다.`);
  }
  if (decided.length) {
    L.push(`- **결정 완료 ${decided.length}건**(${ids(decided)}) — 내가 ${DECIDED_EMOJI_CHAR} 반응을 붙인 코멘트·답글이다. 확인·수용한 것으로 보고 \`- [x]\` 로 고정한다. 타인이 붙인 ${DECIDED_EMOJI_CHAR} 는 세지 않는다.`);
  }
  for (const level of PRIORITY_ORDER) {
    const prioritized = rows.filter((r) => r.priorityLevel === level);
    if (!prioritized.length) continue;
    const order = level === "상" ? "먼저 결론을 내는" : "그다음으로 다루는";
    L.push(`- **우선순위 ${level} ${prioritized.length}건**(${ids(prioritized)}) — 리뷰에서 ${order} 안건이다. 기획서에 없는 축이라 대시보드에서 사람이 지정한다.`);
  }
  L.push("");

  L.push("## 범례", "", "| 표시 | 축 | 뜻 |", "| --- | --- | --- |");
  L.push(`| \`- [x]\` | 결정 | **결정 완료** — 내가 ${DECIDED_EMOJI_CHAR}(${DECIDED_EMOJI}) 반응을 붙였다. 내 코멘트 본문에 붙였으면 스스로 종결한 것이고, 기획 답글에 붙였으면 그 답변을 수용한 것이다. 둘 다 리뷰 안건에서 내린다 |`);
  L.push("| `- [ ]` | 결정 | 미결 — 리뷰 안건이다 |");
  L.push("| `- [-]` | 결정 | 답변 불필요 — 기획서 밖에서 회신을 받았거나 작성자 본인이 종결했다 |");
  L.push("| `**답변 완료**` 라벨 | 답변 | 기획에서 답글을 받았다. 항목 아래에 답글 전문(작성자·시각·코멘트ID)이 인용돼 있다. 체크박스와 별개 축이다 |");
  L.push("| `우선순위 상`·`우선순위 중` 라벨 | 우선순위 | 리뷰에서 다룰 순서. 대시보드 코멘트 탭의 [우선순위] 버튼으로 지정한다 |", "");

  L.push("## 요약", "", "| 상태 | 건수 |", "| --- | --- |");
  L.push(`| 답변 완료 | ${answered} |`, `| 미답변 | ${openRows.length} |`, `| 답변 불필요 | ${lockedRows.length} |`);
  L.push(`| **합계** | **${rows.length}** |`, "");
  L.push("| 결정 | 건수 |", "| --- | --- |");
  L.push(`| 결정 완료 (${DECIDED_EMOJI_CHAR}) | ${decided.length} |`, `| 미결 | ${rows.length - decided.length - lockedRows.length} |`, `| 체크 제외(답변 불필요) | ${lockedRows.length} |`);
  L.push(`| **합계** | **${rows.length}** |`, "");

  L.push("| 구분 | 건수 |", "| --- | --- |");
  for (const [name, n] of counts) L.push(`| ${name} | ${n} |`);
  L.push(`| **합계** | **${rows.length}** |`, "");

  L.push("| 화면ID | 화면명 | 코멘트 | 답변 완료 | 결정 완료 | 변경구분 |", "| --- | --- | --- | --- | --- | --- |");
  for (const p of pageList) {
    const ans = p.rows.filter((r) => r.answered).length;
    const dec = p.rows.filter((r) => r.decided).length;
    L.push(`| ${p.scrnId} | ${p.title} | ${p.rows.length} | ${ans} | ${dec} | ${p.changeType} |`);
  }
  L.push("", "## 화면별 코멘트", "");

  for (const p of pageList) {
    L.push(`### ${p.scrnId} · ${p.title}`, "");
    L.push(`- 링크: ${base}${p.path}`);
    L.push(`- 페이지ID \`${p.pageId}\` · 변경구분 \`${p.changeType}\` · 기획 작성자 \`${p.author}\``, "");
    for (const r of p.rows) {
      const body = pyStrip(r.text);
      const head = clip(pyStrip(body.split("\n")[0]), HEAD_LIMIT_MD);
      const reply = r.isReply ? " · ↳답글" : "";
      let labels = "";
      let box;
      if (r.decided) {
        box = "x";
        labels += ` · **결정 완료** (${DECIDED_EMOJI_CHAR} ${r.decidedOn.join(" · ")})`;
      } else if (r.resolved && !r.answered) {
        box = "-";
      } else {
        box = " ";
      }
      if (r.answered) labels += " · **답변 완료**";
      const pri = r.priorityLevel ? ` \`우선순위 ${r.priorityLevel}\`` : "";
      L.push(`- [${box}]${pri} **${head}**  <!-- ${r.commentId} -->`);
      L.push(`  - \`${r.category}\` · ${minute(r.at)} · \`${r.commentId}\`${reply}${labels}`);
      if (r.priorityLevel) L.push(`  - **우선순위 ${r.priorityLevel}** — ${r.priority}`);
      if (r.resolved && !r.answered && !r.decided) L.push(`  - **답변 불필요** — ${r.resolved}`);
      if (body.includes("\n") || pyLen(body) > HEAD_LIMIT_MD) L.push(mdQuote(body));
      for (const a of r.answers) {
        const eye = a.eyed ? ` · ${DECIDED_EMOJI_CHAR} 확인` : "";
        L.push(`  - **답변** \`${a.author}\` · ${minute(a.at)} · \`${a.commentId}\`${eye}`);
        L.push(mdQuote(a.text));
      }
      if (r.resolved && (r.answered || r.decided)) L.push(`  - 참고 — 기획서 밖 회신도 있었다: ${r.resolved}`);
    }
    L.push("");
  }

  return L.join("\n") + "\n";
}
