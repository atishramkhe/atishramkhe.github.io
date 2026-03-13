from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, datetime
from html import unescape
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup

BASE_URL = 'https://readcomiconline.li'
CATALOG_PATH = '/ComicList'
DATA_DIR = Path(__file__).resolve().parent / 'data'
CATALOG_JSON = DATA_DIR / 'catalog.json'
DISCOVERY_JSON = DATA_DIR / 'discovery.json'
USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36'
MAX_WORKERS = 10

SECTION_SOURCES = [
    {
        'id': 'newest',
        'title': 'Fresh drops',
        'nav_label': 'Newest',
        'description': 'Brand-new launches and one-shots that just landed on the source site.',
        'source_url': f'{BASE_URL}/ComicList/Newest',
        'kind': 'series',
    },
    {
        'id': 'latest',
        'title': 'Latest updates',
        'nav_label': 'Latest',
        'description': 'Recently updated issues across the full site, mapped back to their series pages.',
        'source_url': f'{BASE_URL}/ComicList/LatestUpdate',
        'kind': 'updates',
    },
    {
        'id': 'popular',
        'title': 'Most popular',
        'nav_label': 'Popular',
        'description': 'The biggest long-tail titles and evergreen runs people still return to.',
        'source_url': f'{BASE_URL}/ComicList/MostPopular',
        'kind': 'series',
    },
    {
        'id': 'marvel',
        'title': 'Marvel radar',
        'nav_label': 'Marvel',
        'description': 'Recent Marvel movement pulled from the publisher update page.',
        'source_url': f'{BASE_URL}/Publisher/Marvel/LatestUpdate',
        'kind': 'series',
    },
    {
        'id': 'dc',
        'title': 'DC radar',
        'nav_label': 'DC',
        'description': 'Fresh DC activity without making you scan the original site manually.',
        'source_url': f'{BASE_URL}/Publisher/DC-Comics/LatestUpdate',
        'kind': 'series',
    },
    {
        'id': 'ongoing',
        'title': 'Still ongoing',
        'nav_label': 'Ongoing',
        'description': 'Ongoing series with recent activity for readers who want current runs, not archives.',
        'source_url': f'{BASE_URL}/Status/Ongoing/LatestUpdate',
        'kind': 'updates',
    },
]


@dataclass(slots=True)
class ComicItem:
    title: str
    series_url: str
    cover_url: str
    latest_label: str = ''
    issue_url: str = ''
    context: str = ''
    source_section: str = ''

    def to_dict(self) -> dict[str, str]:
        return {
            'title': self.title,
            'series_url': self.series_url,
            'cover_url': self.cover_url,
            'latest_label': self.latest_label,
            'issue_url': self.issue_url,
            'context': self.context,
            'source_section': self.source_section,
        }


def fetch_html(url: str) -> str:
    request = Request(url, headers={'User-Agent': USER_AGENT})
    with urlopen(request, timeout=30) as response:
        return response.read().decode('utf-8', errors='ignore')


def clean_text(value: str) -> str:
    value = unescape(value or '')
    value = re.sub(r'\s+', ' ', value)
    return value.strip()


def absolute(url: str) -> str:
    return urljoin(BASE_URL, url)


def derive_series_url(issue_url: str) -> str:
    parsed = urlparse(issue_url)
    parts = [part for part in parsed.path.split('/') if part]
    if len(parts) >= 2 and parts[0].lower() == 'comic':
        return absolute('/' + '/'.join(parts[:2]))
    return issue_url


def parse_item_context(block: BeautifulSoup) -> str:
    tooltip_html = block.get('title', '')
    if not tooltip_html:
        return ''

    tooltip = BeautifulSoup(tooltip_html, 'html.parser')
    segments: list[str] = []
    for paragraph in tooltip.select('p'):
        text = clean_text(paragraph.get_text(' ', strip=True))
        if not text or text.lower() == 'summary:':
            continue
        if 'title' in (paragraph.get('class') or []):
            continue
        segments.append(text)

    if not segments:
        return ''
    return ' | '.join(segments[:2])


def parse_item_title(block: BeautifulSoup, fallback: str) -> str:
    tooltip_html = block.get('title', '')
    if tooltip_html:
        tooltip = BeautifulSoup(tooltip_html, 'html.parser')
        title_node = tooltip.select_one('p.title')
        if title_node:
            title = clean_text(title_node.get_text(' ', strip=True))
            if title:
                return title
    return clean_text(fallback)


def parse_comic_items(html: str, source_section: str = '') -> list[ComicItem]:
    soup = BeautifulSoup(html, 'html.parser')
    entries: list[ComicItem] = []
    for block in soup.select('.list-comic .item'):
        series_anchor = block.select_one('a[href^="/Comic/"]')
        cover_image = block.select_one('img')
        title_node = block.select_one('span.title')
        issue_anchor = block.select_one('.ep-bg a[href]')
        if not series_anchor:
            continue

        latest_label = clean_text(issue_anchor.get_text(' ', strip=True)) if issue_anchor else ''
        issue_href = issue_anchor.get('href', '') if issue_anchor else ''
        entries.append(
            ComicItem(
                title=parse_item_title(block, title_node.get_text(' ', strip=True) if title_node else series_anchor.get_text(' ', strip=True)),
                series_url=absolute(series_anchor.get('href', '')),
                cover_url=absolute(cover_image.get('src', '')) if cover_image else '',
                latest_label=latest_label,
                issue_url=absolute(issue_href) if issue_href else '',
                context=parse_item_context(block),
                source_section=source_section,
            )
        )
    return entries


def parse_series_blocks(html: str, source_section: str = '') -> list[ComicItem]:
    return parse_comic_items(html, source_section=source_section)


def parse_update_blocks(html: str, source_section: str = '') -> list[ComicItem]:
    return parse_comic_items(html, source_section=source_section)


def fetch_catalog_page(page: int) -> list[ComicItem]:
    url = f'{BASE_URL}{CATALOG_PATH}?page={page}'
    return parse_series_blocks(fetch_html(url))


def page_has_items(page: int) -> bool:
    try:
        return bool(fetch_catalog_page(page))
    except (HTTPError, URLError):
        return False


def find_last_catalog_page() -> int:
    low = 1
    high = 128
    while page_has_items(high):
        low = high
        high *= 2

    while low + 1 < high:
        mid = (low + high) // 2
        if page_has_items(mid):
            low = mid
        else:
            high = mid
    return low


def collect_catalog(last_page: int) -> list[ComicItem]:
    collected: dict[str, ComicItem] = {}

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(fetch_catalog_page, page): page for page in range(1, last_page + 1)}
        completed = 0
        for future in as_completed(futures):
            items = future.result()
            for item in items:
                if item.series_url not in collected:
                    collected[item.series_url] = item
            completed += 1
            if completed % 50 == 0 or completed == last_page:
                print(f'Catalog pages processed: {completed}/{last_page}')

    return sorted(collected.values(), key=lambda item: item.title.casefold())


def enrich_with_catalog(items: Iterable[ComicItem], catalog_map: dict[str, ComicItem]) -> list[ComicItem]:
    enriched: list[ComicItem] = []
    seen: set[str] = set()
    for item in items:
        base = catalog_map.get(item.series_url)
        if base:
            if not item.cover_url:
                item.cover_url = base.cover_url
        if item.series_url in seen:
            continue
        seen.add(item.series_url)
        enriched.append(item)
    return enriched


def collect_sections(catalog_map: dict[str, ComicItem]) -> list[dict[str, object]]:
    sections: list[dict[str, object]] = []
    for source in SECTION_SOURCES:
        html = fetch_html(source['source_url'])
        if source['kind'] == 'series':
            items = parse_series_blocks(html, source_section=source['title'])
        else:
            items = parse_update_blocks(html, source_section=source['title'])
        items = enrich_with_catalog(items, catalog_map)[:24]
        sections.append(
            {
                'id': source['id'],
                'title': source['title'],
                'nav_label': source['nav_label'],
                'description': source['description'],
                'source_url': source['source_url'],
                'items': [item.to_dict() for item in items],
            }
        )
    return sections


def write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=True, separators=(',', ':')), encoding='utf-8')


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(UTC).isoformat().replace('+00:00', 'Z')

    print('Finding last catalog page...')
    last_page = find_last_catalog_page()
    print(f'Last catalog page: {last_page}')

    print('Collecting full catalog...')
    catalog_items = collect_catalog(last_page)
    catalog_map = {item.series_url: item for item in catalog_items}

    print('Collecting discovery sections...')
    sections = collect_sections(catalog_map)

    catalog_payload = {
        'generated_at': generated_at,
        'total': len(catalog_items),
        'items': [item.to_dict() for item in catalog_items],
    }
    discovery_payload = {
        'meta': {
            'generated_at': generated_at,
            'catalog_pages': last_page,
            'catalog_total': len(catalog_items),
            'section_count': len(sections),
            'source': BASE_URL,
        },
        'sections': sections,
    }

    write_json(CATALOG_JSON, catalog_payload)
    write_json(DISCOVERY_JSON, discovery_payload)
    print(f'Wrote {CATALOG_JSON}')
    print(f'Wrote {DISCOVERY_JSON}')


if __name__ == '__main__':
    main()