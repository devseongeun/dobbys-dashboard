"""초안 Markdown을 원문 탭용 HTML로 옮긴다.

줄 단위로 그대로 옮기고, H2 헤딩에서 목차를 만든다. 내용은 바꾸지 않는다.
"""
from __future__ import annotations

import html
import re

HEADING_RE = re.compile(r'^(#{1,6})\s+(.*)$')
BULLET_RE = re.compile(r'^(\s*)[-*+]\s+(.*)$')
ORDERED_RE = re.compile(r'^(\s*)(\d+)[.)]\s+(.*)$')
LINK_RE = re.compile(r'\[([^\]]+)\]\((https?://[^)]+)\)')


def plain_heading(value: str) -> str:
    """헤딩에서 마크다운 강조 기호만 벗겨 순수 텍스트를 만든다."""
    return re.sub(r'[*_`]', '', value).strip()


def slugify(value: str, fallback: str) -> str:
    text = plain_heading(value)
    slug = re.sub(r'[^0-9A-Za-z가-힣]+', '-', text).strip('-').lower()
    return slug or fallback


def link_html(match: re.Match) -> str:
    """URL을 href 속성 안에 넣는다. 따옴표가 남아 있으면 속성을 탈출해
    `onmouseover=` 같은 조작 속성이 생기므로 엔티티로 바꾼다."""
    href = match.group(2).replace('"', '&quot;').replace("'", '&#x27;')
    return f'<a href="{href}" target="_blank" rel="noopener">{match.group(1)}</a>'


def inline(value: str) -> str:
    escaped = html.escape(value, quote=False)
    escaped = re.sub(r'`([^`]+)`', r'<code>\1</code>', escaped)
    escaped = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', escaped)
    escaped = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)', r'<em>\1</em>', escaped)
    escaped = LINK_RE.sub(link_html, escaped)
    return escaped


def outline(source: str) -> list[dict]:
    """원문의 H2 헤딩 목차. 실제 문서에 있는 헤딩만 담는다."""
    items = []
    for line_number, raw in enumerate(source.splitlines(), 1):
        match = HEADING_RE.match(raw.strip())
        if match and len(match.group(1)) == 2:
            items.append({
                'title': plain_heading(match.group(2)),
                'anchor': slugify(match.group(2), f'line-{line_number}'),
            })
    return items


def render_markdown(source: str) -> str:
    rendered: list[str] = []
    in_front_matter = False
    for line_number, raw in enumerate(source.splitlines(), 1):
        stripped = raw.strip()

        if line_number == 1 and stripped == '---':
            in_front_matter = True
            continue
        if in_front_matter:
            if stripped == '---':
                in_front_matter = False
            continue

        if not stripped:
            rendered.append('<div class="blank" aria-hidden="true"></div>')
            continue

        heading = HEADING_RE.match(stripped)
        if heading:
            level = len(heading.group(1))
            text = heading.group(2)
            anchor = slugify(text, f'line-{line_number}')
            rendered.append(
                f'<h{level} id="{anchor}" data-source-line="{line_number}">{inline(plain_heading(text))}</h{level}>'
            )
            continue

        bullet = BULLET_RE.match(raw)
        if bullet:
            depth = min(len(bullet.group(1).replace('\t', '  ')) // 2, 4)
            rendered.append(
                f'<div class="md-list depth-{depth}" data-source-line="{line_number}">'
                f'<span class="marker">•</span><div>{inline(bullet.group(2))}</div></div>'
            )
            continue

        ordered = ORDERED_RE.match(raw)
        if ordered:
            depth = min(len(ordered.group(1).replace('\t', '  ')) // 2, 4)
            rendered.append(
                f'<div class="md-list depth-{depth}" data-source-line="{line_number}">'
                f'<span class="marker">{ordered.group(2)}.</span><div>{inline(ordered.group(3))}</div></div>'
            )
            continue

        if stripped == '---':
            rendered.append('<hr>')
            continue

        rendered.append(f'<p data-source-line="{line_number}">{inline(stripped)}</p>')
    return '\n'.join(rendered)
