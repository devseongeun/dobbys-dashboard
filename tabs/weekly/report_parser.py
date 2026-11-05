"""주간 보고 초안 Markdown을 구조로 읽어 들인다.

보고 기간 / 이번 주 핵심 업무 / 업무별 상세 내용 / 정량 지표 /
금주·차주·이슈 / PPT 붙여넣기용 / 출처 및 검증 / PPT 처리(또는 승인 상태)를 뽑아낸다.
표준 섹션이 없는 옛 초안도 찾을 수 있는 만큼만 채우고 나머지는 원문으로 넘긴다.

문장을 요약하거나 새로 쓰지 않는다. 있는 문장을 옮겨 담기만 한다.
"""
from __future__ import annotations

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

# 초안 파일명 규칙. 기존 이력은 `weekly-report-...` 또는 `... 주간 ...`이고,
# 스킬이 새로 생성하는 파일은 `2026-09-07~ 2026-09-13-weekly-report.md`처럼
# 날짜로 시작한다. HANDOFF 같은 문서가 섞이지 않게 날짜 접두사를 함께 본다.
DATED_REPORT_RE = re.compile(r'^\d{4}-\d{2}-\d{2}.*weekly-report', re.IGNORECASE)


def is_report_file(name: str) -> bool:
    """초안 Markdown 파일명인지 판정한다."""
    if name.startswith('#') or not name.endswith('.md'):
        return False
    return (
        '주간' in name
        or name.startswith('weekly-report')
        or bool(DATED_REPORT_RE.match(name))
    )


DETAIL_LABELS = ['수행 내용', '확인 결과', '의사결정/원인', '다음 단계']
TITLE_SECTIONS = [
    ('이번 주 핵심 업무', '초안 핵심 업무'),
    ('금주 주요 사항', '금주 주요 사항'),
    ('금주 작업 정리', '금주 작업 정리'),
    ('이번 주 작업 요약', '이번 주 작업 요약'),
]


def norm(value: str) -> str:
    """헤딩·라벨 비교용 키. 강조 기호와 공백을 지운다."""
    return re.sub(r'[\s·]', '', re.sub(r'[*_`]', '', value or '')).strip()


def clean(value: str) -> str:
    """강조 기호만 벗긴다. 백틱은 `확인 필요` 같은 표시를 살리려고 남긴다."""
    return re.sub(r'\s+', ' ', re.sub(r'[*_]', '', value or '')).strip()


# ---------------------------------------------------------------- 문서 구조 읽기

@dataclass
class Node:
    text: str
    kids: list['Node'] = field(default_factory=list)


def build_tree(lines: list[str]) -> list[Node]:
    """들여쓰기 불릿을 트리로 만든다. 불릿이 아닌 줄은 직전 항목에 붙인다."""
    root: list[Node] = []
    stack: list[tuple[int, list[Node], Node | None]] = [(-1, root, None)]
    for raw in lines:
        if not raw.strip():
            continue
        bullet = re.match(r'^(\s*)([-*+]|\d+[.)])\s+(.*)$', raw)
        if not bullet:
            _, _, node = stack[-1]
            if node is not None:
                node.text = f'{node.text} {raw.strip()}'.strip()
            else:
                root.append(Node(raw.strip()))
            continue
        depth = len(bullet.group(1).replace('\t', '  ')) // 2
        node = Node(bullet.group(3).strip())
        while len(stack) > 1 and stack[-1][0] >= depth:
            stack.pop()
        stack[-1][1].append(node)
        stack.append((depth, node.kids, node))
    return root


def flatten(nodes: list[Node]) -> list[str]:
    out: list[str] = []
    for node in nodes:
        out.append(node.text)
        out.extend(flatten(node.kids))
    return out


@dataclass
class Section:
    name: str
    lines: list[str] = field(default_factory=list)
    subs: list['Section'] = field(default_factory=list)


def split_sections(raw: str) -> tuple[str, list[Section]]:
    title = ''
    sections: list[Section] = []
    current: Section | None = None
    sub: Section | None = None
    in_front_matter = False
    for index, line in enumerate(raw.splitlines()):
        stripped = line.strip()
        if index == 0 and stripped == '---':
            in_front_matter = True
            continue
        if in_front_matter:
            if stripped == '---':
                in_front_matter = False
            continue
        heading = re.match(r'^(#{1,3})\s+(.*)$', stripped)
        if heading:
            level = len(heading.group(1))
            text = clean(heading.group(2))
            if level == 1:
                title = title or text
                continue
            if level == 2:
                current = Section(text)
                sections.append(current)
                sub = None
                continue
            if current is None:
                current = Section('')
                sections.append(current)
            sub = Section(text)
            current.subs.append(sub)
            continue
        if sub is not None:
            sub.lines.append(line)
        elif current is not None:
            current.lines.append(line)
        elif not title and stripped.startswith('제목:'):
            title = clean(stripped.split(':', 1)[1])
    return title, sections


def find_section(sections: list[Section], name: str) -> Section | None:
    for section in sections:
        if norm(section.name) == norm(name):
            return section
        # '금주 주요 사항 (2026-06-08 ~ 2026-06-12)' 처럼 기간이 붙은 헤딩도 같은 섹션으로 본다.
        if norm(re.sub(r'\(.*?\)', '', section.name)) == norm(name):
            return section
    return None


def label_of(text: str) -> str | None:
    head = norm(re.split(r'[:：]', text, maxsplit=1)[0])
    for label in DETAIL_LABELS:
        if norm(label) == head:
            return label
    return None


# ---------------------------------------------------------------- 보고서 모델

@dataclass
class Report:
    date: str
    slug: str
    source: Path
    raw: str
    doc_title: str
    sections: list[Section]
    period_range: str = ''
    period_next: str = ''
    period_version: str = ''
    period_scope: list[str] = field(default_factory=list)
    week_start: str = ''
    week_end: str = ''
    core: list[str] = field(default_factory=list)
    core_origin: str = ''
    tasks: list[dict] = field(default_factory=list)
    metrics: list[Node] = field(default_factory=list)
    tally: dict | None = None
    this_week: list[Node] = field(default_factory=list)
    next_week: list[Node] = field(default_factory=list)
    issues: list[Node] = field(default_factory=list)
    ppt: str = ''
    sources: list[Node] = field(default_factory=list)
    approval: str = ''
    flags: list[dict] = field(default_factory=list)
    body: list[Node] = field(default_factory=list)
    standard: bool = False

    @property
    def title(self) -> str:
        return self.core[0] if self.core else (self.doc_title or self.source.stem)

    @property
    def subtitle(self) -> str:
        return self.core[1] if len(self.core) > 1 else ''

    @property
    def period(self) -> str:
        if self.week_start and self.week_end:
            return f'{self.week_start.replace("-", ".")} — {self.week_end.replace("-", ".")}'
        return self.date.replace('-', '.')

    @property
    def month(self) -> str:
        dt = datetime.strptime(self.date, '%Y-%m-%d')
        return f'{dt.year}년 {dt.month}월'

    @property
    def week_key(self) -> str:
        return self.week_start or self.date


def parse_report(source: Path) -> Report | None:
    raw = source.read_text(encoding='utf-8')
    doc_title, sections = split_sections(raw)

    stamp = re.search(r'(\d{4}-\d{2}-\d{2})', source.name) or re.search(r'(\d{4})(\d{2})(\d{2})', source.name)
    if stamp and stamp.re.groups == 3:
        date = f'{stamp.group(1)}-{stamp.group(2)}-{stamp.group(3)}'
    elif stamp:
        date = stamp.group(1)
    else:
        found = re.search(r'(\d{4}-\d{2}-\d{2})', doc_title)
        if not found:
            return None
        date = found.group(1)

    report = Report(date=date, slug=date, source=source, raw=raw,
                    doc_title=doc_title, sections=sections)

    period = find_section(sections, '보고 기간')
    if period:
        for node in build_tree(period.lines):
            head, _, tail = node.text.partition(':')
            key = norm(head)
            value = clean(tail)
            if key == '조회기간':
                report.period_range = value
            elif key == '차주범위':
                report.period_next = value
            elif key == '버전':
                report.period_version = value
            elif key == '실제확인범위':
                report.period_scope = [clean(kid.text) for kid in node.kids]

    dates = re.findall(r'\d{4}-\d{2}-\d{2}', report.period_range)
    if not dates:
        head = sections[0].name if sections else ''
        dates = re.findall(r'\d{4}-\d{2}-\d{2}', head)
    if len(dates) >= 2:
        report.week_start, report.week_end = dates[0], dates[1]

    if not sections:
        body_lines = [line for line in raw.splitlines()]
        if body_lines and body_lines[0].strip() == '---':
            end = next((i for i, line in enumerate(body_lines[1:], 1) if line.strip() == '---'), 0)
            body_lines = body_lines[end + 1:]
        report.body = build_tree(body_lines)
        tops = [clean(node.text) for node in report.body if clean(node.text)]
        if tops:
            report.core = tops[:5]
            report.core_origin = '초안 본문'

    for name, origin in TITLE_SECTIONS:
        section = find_section(sections, name)
        if not section:
            continue
        items = [clean(node.text) for node in build_tree(section.lines) if clean(node.text)]
        items = [item for item in items if len(item) > 1]
        if not items and section.subs:
            items = [clean(sub.name) for sub in section.subs if clean(sub.name)]
        items = [re.sub(r'^\d+[.)]\s+', '', item) for item in items]
        if items:
            report.core = items[:5]
            report.core_origin = origin
            break

    details = find_section(sections, '업무별 상세 내용')
    if details:
        report.standard = True
        for sub in details.subs:
            task = {'title': re.sub(r'^\d+[.)]\s+', '', clean(sub.name)), 'rows': []}
            for node in build_tree(sub.lines):
                label = label_of(node.text)
                items: list[str] = []
                if label:
                    head = re.sub(r'^[*_\s]*[^:：]*[:：]\s*[*_\s]*', '', node.text).strip()
                    if ':' in node.text or '：' in node.text:
                        if head and norm(head) != norm(node.text):
                            items.append(clean(head))
                    for kid in node.kids:
                        items.append(clean(kid.text))
                        items.extend(clean(g.text) for g in kid.kids)
                    task['rows'].append({'label': label, 'items': [i for i in items if i]})
                else:
                    items = [clean(node.text)] + [clean(kid.text) for kid in node.kids]
                    task['rows'].append({'label': '', 'items': [i for i in items if i]})
            report.tasks.append(task)

    metrics = find_section(sections, '정량 지표')
    if metrics:
        report.metrics = build_tree(metrics.lines)
        if metrics.subs:
            sub = metrics.subs[0]
            tally = {'name': clean(sub.name), 'total': 0, 'parts': [], 'note': ''}
            for node in build_tree(sub.lines):
                match = re.match(r'^(.*?)\s*(\d+)\s*건', node.text)
                if match and norm(match.group(1)) == '전체':
                    tally['total'] = int(match.group(2))
                    for kid in node.kids:
                        kid_match = re.match(r'^(.*?)\s*(\d+)\s*건', kid.text)
                        if kid_match:
                            tally['parts'].append({'label': clean(kid_match.group(1)), 'value': int(kid_match.group(2))})
                elif match:
                    tally['parts'].append({'label': clean(match.group(1)), 'value': int(match.group(2))})
            tally['note'] = ' '.join(
                line.strip() for line in sub.lines
                if line.strip() and not re.match(r'^\s*([-*+]|\d+[.)])\s+', line)
            ).strip()
            if tally['total'] or tally['parts']:
                report.tally = tally

    for attr, name in (('this_week', '금주 주요 사항'), ('next_week', '차주 주요 사항'),
                       ('issues', '이슈 및 기타 사항')):
        section = find_section(sections, name)
        if section:
            nodes = build_tree(section.lines)
            for sub in section.subs:
                nodes.append(Node(re.sub(r'^\d+[.)]\s+', '', clean(sub.name)), build_tree(sub.lines)))
            setattr(report, attr, nodes)

    ppt = find_section(sections, 'PPT 붙여넣기용')
    if ppt:
        chunks = ['\n'.join(ppt.lines).strip()]
        for sub in ppt.subs:
            chunks.append(clean(sub.name) + '\n' + '\n'.join(sub.lines).strip())
        report.ppt = '\n\n'.join(chunk for chunk in chunks if chunk).strip()

    src = find_section(sections, '출처 및 검증')
    if src:
        report.sources = build_tree(src.lines)

    approval = find_section(sections, 'PPT 처리') or find_section(sections, '승인 상태')
    if approval:
        report.approval = ' '.join(clean(line) for line in approval.lines if line.strip()).strip()

    def scan(texts: list[str], origin: str) -> None:
        for text in texts:
            if re.search(r'확인\s*필요', text):
                kind = 'need'
            elif re.search(r'N/A', text, re.I):
                kind = 'na'
            elif re.search(r'미검증|미확인', text):
                kind = 'unver'
            else:
                continue
            report.flags.append({'kind': kind, 'origin': origin, 'text': text})

    for task in report.tasks:
        for row in task['rows']:
            scan(row['items'], task['title'])
    scan(flatten(report.issues), '이슈 및 기타 사항')
    scan(flatten(report.metrics), '정량 지표')
    return report


def load_reports(source_dirs: Sequence[Path]) -> list[Report]:
    candidates = sorted({
        path.resolve()
        for source_dir in source_dirs
        if source_dir.exists()
        for path in source_dir.glob('*.md')
        if is_report_file(path.name)
    })
    reports: list[Report] = []
    for path in candidates:
        try:
            report = parse_report(path)
        except Exception as error:  # 한 파일이 깨져도 나머지는 쌓이게 한다.
            print(f'  건너뜀: {path.name} ({error})')
            continue
        if report:
            reports.append(report)

    # 같은 주를 가리키는 초안이 여러 개면 표준 형식 > 최신 수정 > 큰 파일 순으로 하나만 남긴다.
    best: dict[str, Report] = {}
    for report in reports:
        key = report.week_key
        current = best.get(key)
        if current is None:
            best[key] = report
            continue
        rank = (report.standard, report.source.stat().st_mtime, report.source.stat().st_size)
        current_rank = (current.standard, current.source.stat().st_mtime, current.source.stat().st_size)
        if rank > current_rank:
            best[key] = report

    ordered = sorted(best.values(), key=lambda item: (item.date, item.week_key), reverse=True)
    seen: set[str] = set()
    for report in ordered:
        slug = report.date
        suffix = 2
        while slug in seen:
            slug = f'{report.date}-{suffix}'
            suffix += 1
        seen.add(slug)
        report.slug = slug
    return ordered


# ---------------------------------------------------------------- 화면
