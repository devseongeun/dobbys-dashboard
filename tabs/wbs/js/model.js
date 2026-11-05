const DAY_MS = 86400000;

function toDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function diffDays(from, to) {
  const a = toDate(from);
  const b = toDate(to);
  if (!a || !b) return null;
  return Math.round((b - a) / DAY_MS);
}

export function hoursText(seconds) {
  if (!seconds) return "—";
  return (seconds / 3600).toFixed(1) + "h";
}

export function dateRangeText(start, end) {
  if (!start || !end) return "—";
  const short = (iso) => iso.slice(5).replace("-", ".");
  return `${short(start)} ~ ${short(end)}`;
}

export function jiraUrl(key) {
  return `https://example.atlassian.net/browse/${key}`;
}

export function recentWorklogs(worklogs, issueKey, limit) {
  return worklogs
    .filter((log) => log.issueKey === issueKey)
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .slice(0, limit);
}

export function joinRows(wbsTasks, issues, today) {
  const byKey = new Map(issues.map((issue) => [issue.key, issue]));
  const rows = [];
  const usedKeys = new Set();

  for (const task of wbsTasks) {
    const issue = byKey.get(task.jira) || null;
    usedKeys.add(task.jira);
    rows.push(buildRow(task, issue, task.jira, today));
  }
  for (const issue of issues) {
    if (usedKeys.has(issue.key)) continue;
    rows.push(buildRow(null, issue, issue.key, today));
  }
  return rows;
}

// Jira 값이 우선한다. WBS 는 Jira 에 값이 없을 때만 채우고, 도메인·화면ID·M/D 같은 계획 메타만 보탠다.
function buildRow(task, issue, key, today) {
  const start = issue?.planStart || task?.start || null;
  const end = issue?.duedate || task?.end || null;
  const spentSeconds = issue?.timeSpentSeconds || 0;
  const duedate = issue?.duedate || null;
  const statusCategory = issue?.statusCategory || null;
  return {
    key,
    name: issue?.summary || task?.name || key,
    summary: issue?.summary || null,
    status: issue?.status || null,
    statusCategory,
    assignee: issue?.assignee || null,
    domain: task ? task.d1 : null,
    menu: task ? task.d2 : null,
    screen: task ? task.screen : null,
    requirementId: task ? task.id : null,
    detail: task ? task.detail : null,
    people: task ? task.people : 1,
    md: task ? task.md : null,
    start,
    end,
    planStart: issue?.planStart || null,
    actualStart: issue?.actualStart || null,
    actualEnd: issue?.actualEnd || null,
    duedate,
    spentSeconds,
    spentHours: spentSeconds / 3600,
    overdue: Boolean(duedate && duedate < today && statusCategory !== "완료"),
    dday: duedate ? diffDays(today, duedate) : null,
    schedulable: Boolean(start && end),
  };
}
