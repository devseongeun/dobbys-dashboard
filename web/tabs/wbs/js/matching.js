// WBS 행 ↔ Jira 이슈 연결. 로컬판 tabs/wbs/matching.py 이식.
// 수동 연결이 먼저고, 제목이 정확히 한 이슈와만 맞을 때만 자동으로 잇는다.

const norm = (text) => String(text ?? "").replace(/\s+/gu, "").toLowerCase();

export function titleCandidates(task) {
  const { d1, d2, d3, name } = task;
  if (!name) return new Set();
  const shapes = [[d1, d2, name], [d1, name], [d1, d2, d3, name], [d1, d3, name]];
  return new Set(shapes.map((shape) => norm(shape.filter(Boolean).join("-"))));
}

// tasks: [{id, d1, d2, d3, name}], issues: [{key, summary}], links: {요구사항ID: 이슈키}
export function matchKeys(tasks, issues, links) {
  const byTitle = new Map();
  for (const issue of issues) {
    const title = norm(issue.summary);
    if (!byTitle.has(title)) byTitle.set(title, new Set());
    byTitle.get(title).add(issue.key);
  }
  const manual = {};
  for (const task of tasks) if (Object.hasOwn(links, task.id)) manual[task.id] = links[task.id];
  const claimed = new Set(Object.values(manual));
  const wanted = {};
  for (const task of tasks) {
    if (Object.hasOwn(manual, task.id)) continue;
    const hits = new Set();
    for (const title of titleCandidates(task)) for (const key of byTitle.get(title) || []) hits.add(key);
    if (hits.size === 1) wanted[task.id] = [...hits][0];
  }
  const counts = new Map();
  for (const key of Object.values(wanted)) counts.set(key, (counts.get(key) || 0) + 1);
  const auto = {};
  for (const [taskId, key] of Object.entries(wanted)) {
    if (counts.get(key) === 1 && !claimed.has(key)) auto[taskId] = key;
  }
  return { ...manual, ...auto };
}
