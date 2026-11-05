"""뷰어 HTML 조각을 만드는 공용 헬퍼.

generate_viewer.py와 기능 모듈(viewer_review / viewer_cite / viewer_refresh)이
같은 이스케이프·불릿·마커 규칙을 쓰도록 한곳에 모아 둔다.
"""
from __future__ import annotations

import html
import re

from .markdown_renderer import inline
from .report_parser import Node


def esc(value: str) -> str:
    return html.escape(value, quote=True)


def nodes_html(nodes: list[Node], css_class: str = '') -> str:
    if not nodes:
        return ''
    items = ''.join(
        f'<li><span>{inline(node.text)}{nodes_html(node.kids, css_class)}</span></li>'
        for node in nodes
    )
    return f'<ul class="notes {css_class}">{items}</ul>'


def mark_inline(value: str) -> str:
    rendered = inline(value)
    rendered = re.sub(r'<code>확인\s*필요</code>', '<span class="mk need">확인 필요</span>', rendered)
    rendered = re.sub(r'<code>N/A</code>', '<span class="mk na">N/A</span>', rendered, flags=re.I)
    rendered = re.sub(r'(미검증|미확인)', r'<span class="mk unver">\1</span>', rendered)
    return rendered
