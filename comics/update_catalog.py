from __future__ import annotations

import argparse
import json
import re
import time
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
DEFAULT_MODE = 'full'
DEFAULT_TRACKED_SECTION_IDS = ('newest', 'ongoing')
REQUEST_TIMEOUT_SECONDS = 30
REQUEST_RETRIES = 3
RETRYABLE_HTTP_STATUSES = {429, 500, 502, 503, 504}
RETRY_BACKOFF_SECONDS = 2

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

    @classmethod
    def from_dict(cls, payload: dict[str, object]) -> ComicItem:
        return cls(
            title=clean_text(str(payload.get('title', ''))),
            series_url=str(payload.get('series_url', '')).strip(),
            cover_url=str(payload.get('cover_url', '')).strip(),
            latest_label=clean_text(str(payload.get('latest_label', ''))),
            issue_url=str(payload.get('issue_url', '')).strip(),
            context=clean_text(str(payload.get('context', ''))),
            source_section=clean_text(str(payload.get('source_section', ''))),
        )


def fetch_html(url: str) -> str:
    request = Request(url, headers={'User-Agent': USER_AGENT})
    last_error: Exception | None = None
    for attempt in range(1, REQUEST_RETRIES + 1):
        try:
            with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                return response.read().decode('utf-8', errors='ignore')
        except HTTPError as error:
            last_error = error
            if error.code not in RETRYABLE_HTTP_STATUSES or attempt == REQUEST_RETRIES:
                raise
        except (URLError, TimeoutError) as error:
            last_error = error
            if attempt == REQUEST_RETRIES:
                raise
        time.sleep(RETRY_BACKOFF_SECONDS * attempt)

    if last_error is not None:
        raise last_error
    raise RuntimeError(f'Failed to fetch {url}')


def clean_text(value: str) -> str:
    value = unescape(value or '')
    value = re.sub(r'\s+', ' ', value)
    return value.strip()


def absolute(url: str) -> str:
    return urljoin(BASE_URL, url)


def is_series_url(url: str) -> bool:
    parsed = urlparse(absolute(url))
    parts = [part for part in parsed.path.split('/') if part]
    return len(parts) == 2 and parts[0].lower() == 'comic' and bool(parts[1])


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


def parse_series_page_title(html: str, series_url: str) -> str:
    soup = BeautifulSoup(html, 'html.parser')
    meta_title = soup.select_one('meta[property="og:title"]')
    if meta_title and meta_title.get('content'):
        title = clean_text(meta_title.get('content', ''))
        if title:
            return title

    title_node = soup.find('title')
    if title_node:
        title = clean_text(title_node.get_text(' ', strip=True))
        title = re.sub(r'\s*-\s*Read.*$', '', title, flags=re.IGNORECASE)
        title = re.sub(r'\s+comic online in high quality$', '', title, flags=re.IGNORECASE)
        if title:
            return title

    parsed = urlparse(series_url)
    parts = [part for part in parsed.path.split('/') if part]
    slug = parts[1] if len(parts) >= 2 else series_url.rstrip('/').rsplit('/', 1)[-1]
    return clean_text(slug.replace('-', ' '))


def extract_series_page_field(html: str, label: str) -> str:
    soup = BeautifulSoup(html, 'html.parser')
    lines = [clean_text(line) for line in soup.get_text('\n').splitlines() if clean_text(line)]
    label_lower = f'{label.lower()}:'
    for line in lines:
        lowered = line.lower()
        if not lowered.startswith(label_lower):
            continue
        value = clean_text(line.split(':', 1)[1])
        if label.lower() == 'status':
            value = clean_text(value.split('Views:', 1)[0])
        if value:
            return value
    return ''


def parse_series_page_cover(html: str) -> str:
    soup = BeautifulSoup(html, 'html.parser')
    meta_cover = soup.select_one('meta[property="og:image"]')
    if meta_cover and meta_cover.get('content'):
        return absolute(meta_cover.get('content', ''))

    cover_image = soup.select_one('img[src*="/Uploads/"]')
    if cover_image and cover_image.get('src'):
        return absolute(cover_image.get('src', ''))
    return ''


def parse_related_series_urls(html: str, current_url: str) -> list[str]:
    soup = BeautifulSoup(html, 'html.parser')
    current = absolute(current_url)
    related: list[str] = []
    seen: set[str] = set()
    for anchor in soup.select('a[href^="/Comic/"]'):
        href = anchor.get('href', '').strip()
        if not href or not is_series_url(href):
            continue
        series_url = absolute(href)
        if series_url == current or series_url in seen:
            continue
        seen.add(series_url)
        related.append(series_url)
    return related


def fetch_series_page_item(series_url: str, source_section: str = '') -> ComicItem:
    html = fetch_html(series_url)
    status = extract_series_page_field(html, 'Status')
    publication = extract_series_page_field(html, 'Publication date')
    context_parts = []
    if status:
        context_parts.append(f'Status: {status}')
    if publication:
        context_parts.append(f'Publication: {publication}')
    return ComicItem(
        title=parse_series_page_title(html, series_url),
        series_url=absolute(series_url),
        cover_url=parse_series_page_cover(html),
        context=' | '.join(context_parts),
        source_section=source_section,
    )


def discover_related_catalog_items(seed_items: Iterable[ComicItem], existing_series_urls: Iterable[str]) -> list[ComicItem]:
    seed_urls = unique_items(seed_items)
    known_urls = {absolute(url) for url in existing_series_urls if url}
    related_urls: set[str] = set()
    scanned_count = 0
    seed_total = len(seed_urls)

    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, 6)) as executor:
        futures = {executor.submit(fetch_html, item.series_url): item.series_url for item in seed_urls if item.series_url}
        for future in as_completed(futures):
            series_url = futures[future]
            scanned_count += 1
            try:
                html = future.result()
            except (HTTPError, URLError, TimeoutError, ValueError):
                if scanned_count % 50 == 0 or scanned_count == seed_total:
                    print(f'Related seed pages scanned: {scanned_count}/{seed_total} | candidates: {len(related_urls)}')
                continue
            for related_url in parse_related_series_urls(html, series_url):
                if related_url in known_urls:
                    continue
                related_urls.add(related_url)
            if scanned_count % 50 == 0 or scanned_count == seed_total:
                print(f'Related seed pages scanned: {scanned_count}/{seed_total} | candidates: {len(related_urls)}')

    if not related_urls:
        return []

    discovered: list[ComicItem] = []
    fetched_count = 0
    related_total = len(related_urls)
    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, 6)) as executor:
        futures = {
            executor.submit(fetch_series_page_item, series_url, 'Related picks'): series_url
            for series_url in sorted(related_urls)
        }
        for future in as_completed(futures):
            fetched_count += 1
            try:
                item = future.result()
            except (HTTPError, URLError, TimeoutError, ValueError):
                if fetched_count % 25 == 0 or fetched_count == related_total:
                    print(f'Related series fetched: {fetched_count}/{related_total} | discovered: {len(discovered)}')
                continue
            if not item.series_url or item.series_url in known_urls:
                if fetched_count % 25 == 0 or fetched_count == related_total:
                    print(f'Related series fetched: {fetched_count}/{related_total} | discovered: {len(discovered)}')
                continue
            known_urls.add(item.series_url)
            discovered.append(item)
            if fetched_count % 25 == 0 or fetched_count == related_total:
                print(f'Related series fetched: {fetched_count}/{related_total} | discovered: {len(discovered)}')

    return sorted(discovered, key=lambda item: item.title.casefold())


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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Build comics catalog and discovery data.')
    parser.add_argument(
        '--mode',
        choices=('full', 'incremental'),
        default=DEFAULT_MODE,
        help='Use full to recrawl the complete catalog or incremental to only merge active/new discovery items into the existing catalog.',
    )
    parser.add_argument(
        '--tracked-sections',
        default=','.join(DEFAULT_TRACKED_SECTION_IDS),
        help='Comma-separated discovery section ids to treat as the active subset for automation.',
    )
    return parser.parse_args()


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


def merge_catalog_items(existing_items: Iterable[ComicItem], updated_items: Iterable[ComicItem]) -> list[ComicItem]:
    merged: dict[str, ComicItem] = {item.series_url: item for item in existing_items if item.series_url}
    for item in updated_items:
        if not item.series_url:
            continue
        merged[item.series_url] = item
    return sorted(merged.values(), key=lambda item: item.title.casefold())


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


def collect_sections(catalog_map: dict[str, ComicItem]) -> tuple[list[dict[str, object]], dict[str, list[ComicItem]]]:
    sections: list[dict[str, object]] = []
    section_items: dict[str, list[ComicItem]] = {}
    for source in SECTION_SOURCES:
        html = fetch_html(source['source_url'])
        if source['kind'] == 'series':
            items = parse_series_blocks(html, source_section=source['title'])
        else:
            items = parse_update_blocks(html, source_section=source['title'])
        items = enrich_with_catalog(items, catalog_map)
        section_items[source['id']] = items
        sections.append(
            {
                'id': source['id'],
                'title': source['title'],
                'nav_label': source['nav_label'],
                'description': source['description'],
                'source_url': source['source_url'],
                'items': [item.to_dict() for item in items[:24]],
            }
        )
    return sections, section_items


def load_json(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding='utf-8'))


def load_existing_catalog_items() -> list[ComicItem]:
    payload = load_json(CATALOG_JSON)
    items = payload.get('items', [])
    if not isinstance(items, list):
        return []
    return [ComicItem.from_dict(item) for item in items if isinstance(item, dict)]


def unique_items(items: Iterable[ComicItem]) -> list[ComicItem]:
    unique: list[ComicItem] = []
    seen: set[str] = set()
    for item in items:
        if not item.series_url or item.series_url in seen:
            continue
        seen.add(item.series_url)
        unique.append(item)
    return unique


def collect_tracked_items(section_items: dict[str, list[ComicItem]], tracked_section_ids: set[str]) -> list[ComicItem]:
    tracked: list[ComicItem] = []
    for section_id in tracked_section_ids:
        tracked.extend(section_items.get(section_id, []))
    return unique_items(tracked)


def write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=True, separators=(',', ':')), encoding='utf-8')


def main() -> None:
    args = parse_args()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(UTC).isoformat().replace('+00:00', 'Z')
    tracked_section_ids = {section_id.strip() for section_id in args.tracked_sections.split(',') if section_id.strip()}
    if not tracked_section_ids:
        tracked_section_ids = set(DEFAULT_TRACKED_SECTION_IDS)

    catalog_pages: int | None = None

    if args.mode == 'incremental':
        catalog_items = load_existing_catalog_items()
        if not catalog_items:
            print('No existing catalog.json found. Falling back to full crawl.')
            args.mode = 'full'
        else:
            print('Loading existing catalog...')
            catalog_map = {item.series_url: item for item in catalog_items}
            print('Collecting discovery sections...')
            sections, section_items = collect_sections(catalog_map)
            tracked_items = collect_tracked_items(section_items, tracked_section_ids)
            print('Discovering hidden related series from tracked pages...')
            related_items = discover_related_catalog_items(tracked_items, catalog_map.keys())
            if related_items:
                tracked_items = merge_catalog_items(tracked_items, related_items)
                print(f'Discovered {len(related_items)} related series.')
            catalog_items = merge_catalog_items(catalog_items, tracked_items)
            catalog_map = {item.series_url: item for item in catalog_items}
            print(f'Merged {len(tracked_items)} tracked series into existing catalog.')

            previous_discovery = load_json(DISCOVERY_JSON)
            previous_meta = previous_discovery.get('meta', {}) if isinstance(previous_discovery, dict) else {}
            catalog_pages_value = previous_meta.get('catalog_pages') if isinstance(previous_meta, dict) else None
            catalog_pages = int(catalog_pages_value) if isinstance(catalog_pages_value, int) else None

            tracked_series_urls = [item.series_url for item in tracked_items]
            catalog_payload = {
                'generated_at': generated_at,
                'mode': args.mode,
                'tracked_series_total': len(tracked_series_urls),
                'total': len(catalog_items),
                'items': [item.to_dict() for item in catalog_items],
            }
            discovery_payload = {
                'meta': {
                    'generated_at': generated_at,
                    'catalog_pages': catalog_pages,
                    'catalog_total': len(catalog_items),
                    'section_count': len(sections),
                    'source': BASE_URL,
                    'update_mode': args.mode,
                    'tracked_section_ids': sorted(tracked_section_ids),
                    'tracked_series_total': len(tracked_series_urls),
                    'tracked_series_urls': tracked_series_urls,
                },
                'sections': sections,
            }

            write_json(CATALOG_JSON, catalog_payload)
            write_json(DISCOVERY_JSON, discovery_payload)
            print(f'Wrote {CATALOG_JSON}')
            print(f'Wrote {DISCOVERY_JSON}')
            return

    print('Finding last catalog page...')
    last_page = find_last_catalog_page()
    catalog_pages = last_page
    print(f'Last catalog page: {last_page}')

    print('Collecting full catalog...')
    catalog_items = collect_catalog(last_page)
    catalog_map = {item.series_url: item for item in catalog_items}

    print('Collecting discovery sections...')
    sections, section_items = collect_sections(catalog_map)
    tracked_items = collect_tracked_items(section_items, tracked_section_ids)
    print('Discovering hidden related series from catalog pages...')
    related_items = discover_related_catalog_items(catalog_items, catalog_map.keys())
    if related_items:
        catalog_items = merge_catalog_items(catalog_items, related_items)
        tracked_items = merge_catalog_items(tracked_items, related_items)
        catalog_map = {item.series_url: item for item in catalog_items}
        print(f'Discovered {len(related_items)} related series.')
    tracked_series_urls = [item.series_url for item in tracked_items]

    catalog_payload = {
        'generated_at': generated_at,
        'mode': args.mode,
        'tracked_series_total': len(tracked_series_urls),
        'total': len(catalog_items),
        'items': [item.to_dict() for item in catalog_items],
    }
    discovery_payload = {
        'meta': {
            'generated_at': generated_at,
            'catalog_pages': catalog_pages,
            'catalog_total': len(catalog_items),
            'section_count': len(sections),
            'source': BASE_URL,
            'update_mode': args.mode,
            'tracked_section_ids': sorted(tracked_section_ids),
            'tracked_series_total': len(tracked_series_urls),
            'tracked_series_urls': tracked_series_urls,
        },
        'sections': sections,
    }

    write_json(CATALOG_JSON, catalog_payload)
    write_json(DISCOVERY_JSON, discovery_payload)
    print(f'Wrote {CATALOG_JSON}')
    print(f'Wrote {DISCOVERY_JSON}')


if __name__ == '__main__':
    main()