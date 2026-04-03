#!/usr/bin/env python3

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
SNAPSHOT_PATH = Path(os.environ.get('ANIME_HOME_SNAPSHOT_PATH', SCRIPT_DIR / 'anime_home_snapshot.json'))
POSTERS_DIR = Path(os.environ.get('ANIME_HOME_POSTERS_DIR', SCRIPT_DIR / 'cache' / 'home-posters'))
PLAYBACK_SNAPSHOT_PATH = Path(os.environ.get('ANIME_PLAYBACK_SNAPSHOT_PATH', SCRIPT_DIR / 'anime_playback_snapshot.json'))
HTTP_TIMEOUT = max(5, int(os.environ.get('ANIME_HOME_HTTP_TIMEOUT', '30')))
HTTP_RETRIES = max(1, int(os.environ.get('ANIME_HOME_HTTP_RETRIES', '3')))
REQUEST_DELAY_SECONDS = max(0.0, float(os.environ.get('ANIME_HOME_REQUEST_DELAY', '0.2')))
JIKAN_BASE = 'https://api.jikan.moe/v4'
USER_AGENT = os.environ.get(
    'ANIME_HOME_USER_AGENT',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
)

SECTION_DEFINITIONS = [
    {'gridId': 'trendingGrid', 'kind': 'endpoint', 'url': f'{JIKAN_BASE}/top/anime?filter=bypopularity&limit=24&page={{page}}&sfw'},
    {'gridId': 'isekaiTrendingGrid', 'kind': 'endpoint', 'url': f'{JIKAN_BASE}/anime?themes=62&order_by=members&sort=desc&limit=24&page={{page}}&sfw'},
    {'gridId': 'airingGrid', 'kind': 'endpoint', 'url': f'{JIKAN_BASE}/top/anime?filter=airing&limit=24&page={{page}}&sfw'},
    {'gridId': 'isekaiNewGrid', 'kind': 'endpoint', 'url': f'{JIKAN_BASE}/anime?themes=62&order_by=start_date&sort=desc&limit=24&page=1&sfw'},
    {'gridId': 'shounenGrid', 'kind': 'endpoint', 'url': f'{JIKAN_BASE}/anime?genres=27&order_by=members&sort=desc&limit=24&page={{page}}&sfw'},
    {'gridId': 'shoujoGrid', 'kind': 'endpoint', 'url': f'{JIKAN_BASE}/anime?genres=25&order_by=members&sort=desc&limit=24&page={{page}}&sfw'},
    {'gridId': 'seinenGrid', 'kind': 'endpoint', 'url': f'{JIKAN_BASE}/anime?genres=42&order_by=members&sort=desc&limit=24&page={{page}}&sfw'},
    {'gridId': 'joseiGrid', 'kind': 'endpoint', 'url': f'{JIKAN_BASE}/anime?genres=43&order_by=members&sort=desc&limit=24&page={{page}}&sfw'},
    {'gridId': 'upcomingGrid', 'kind': 'endpoint', 'url': f'{JIKAN_BASE}/top/anime?filter=upcoming&limit=24&page={{page}}&sfw'},
    {'gridId': 'topGrid', 'kind': 'endpoint', 'url': f'{JIKAN_BASE}/top/anime?limit=24&page={{page}}&sfw'},
    {'gridId': 'moviesGrid', 'kind': 'endpoint', 'url': f'{JIKAN_BASE}/top/anime?type=movie&filter=bypopularity&limit=24&page={{page}}&sfw'},
    {'gridId': 'adultGrid', 'kind': 'adult', 'movie': False, 'count': 24},
    {'gridId': 'adultMoviesGrid', 'kind': 'adult', 'movie': True, 'count': 24},
]

PAGE_CEILINGS = {
    'trendingGrid': 10,
    'isekaiTrendingGrid': 6,
    'airingGrid': 10,
    'isekaiNewGrid': 1,
    'shounenGrid': 6,
    'shoujoGrid': 4,
    'seinenGrid': 5,
    'joseiGrid': 3,
    'upcomingGrid': 10,
    'topGrid': 10,
    'moviesGrid': 10,
    'adultGrid': 10,
    'adultMoviesGrid': 10,
}
ADULT_GENRE_NAMES = ('ecchi', 'erotica', 'hentai', 'adult cast')
ADULT_GENRE_IDS = {'9', '12', '49'}


def log(message: str) -> None:
    print(message, flush=True)


def parse_positive_int(value: object) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def build_request(url: str) -> urllib.request.Request:
    return urllib.request.Request(
        url,
        headers={
            'Accept': 'application/json,text/plain,*/*',
            'User-Agent': USER_AGENT,
        },
        method='GET',
    )


def fetch_json(url: str) -> dict[str, object]:
    last_error: Exception | None = None
    for attempt in range(1, HTTP_RETRIES + 1):
        try:
            with urllib.request.urlopen(build_request(url), timeout=HTTP_TIMEOUT) as response:
                return json.loads(response.read().decode('utf-8'))
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = error
            if attempt >= HTTP_RETRIES:
                break
            time.sleep(max(0.8, REQUEST_DELAY_SECONDS) * attempt)
    raise RuntimeError(f'Failed to fetch JSON for {url}: {last_error}')


def download_bytes(url: str) -> tuple[bytes, str]:
    last_error: Exception | None = None
    for attempt in range(1, HTTP_RETRIES + 1):
        try:
            with urllib.request.urlopen(build_request(url), timeout=HTTP_TIMEOUT) as response:
                return response.read(), str(response.headers.get_content_type() or '')
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
            last_error = error
            if attempt >= HTTP_RETRIES:
                break
            time.sleep(max(0.8, REQUEST_DELAY_SECONDS) * attempt)
    raise RuntimeError(f'Failed to download poster {url}: {last_error}')


def deterministic_page(section_key: str) -> int:
    page_max = max(1, int(PAGE_CEILINGS.get(section_key, 1)))
    digest = hashlib.sha1(f'{section_key}:{dt.datetime.now(dt.timezone.utc).date().isoformat()}'.encode('utf-8')).hexdigest()
    return (int(digest[:8], 16) % page_max) + 1


def is_anime_movie_type(anime: dict[str, object]) -> bool:
    return str(anime.get('type') or '').lower() == 'movie'


def is_released_anime(anime: dict[str, object]) -> bool:
    status = str(anime.get('status') or '').lower()
    return 'not yet aired' not in status and 'upcoming' not in status


def is_adult_anime(anime: dict[str, object]) -> bool:
    rating = str(anime.get('rating') or '').lower()
    if 'rx' in rating or 'hentai' in rating or 'r+' in rating:
        return True

    for bucket_key in ('genres', 'themes', 'demographics'):
        bucket = anime.get(bucket_key)
        if not isinstance(bucket, list):
            continue
        for entry in bucket:
            if not isinstance(entry, dict):
                continue
            name = str(entry.get('name') or '').lower()
            mal_id = str(entry.get('mal_id') or '').strip()
            if any(term in name for term in ADULT_GENRE_NAMES) or mal_id in ADULT_GENRE_IDS:
                return True
    return False


def load_playback_snapshot() -> tuple[dict[int, int], dict[int, dict[str, object]]]:
    if not PLAYBACK_SNAPSHOT_PATH.exists():
        return {}, {}
    try:
        raw = json.loads(PLAYBACK_SNAPSHOT_PATH.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as error:
        log(f'Warning: failed to read playback snapshot: {error}')
        return {}, {}

    mal_to_ani: dict[int, int] = {}
    by_ani: dict[int, dict[str, object]] = {}

    raw_mal_to_ani = raw.get('malToAniList') if isinstance(raw, dict) else {}
    if isinstance(raw_mal_to_ani, dict):
        for mal_id_raw, ani_id_raw in raw_mal_to_ani.items():
            mal_id = parse_positive_int(mal_id_raw)
            ani_id = parse_positive_int(ani_id_raw)
            if mal_id and ani_id:
                mal_to_ani[mal_id] = ani_id

    raw_by_ani = raw.get('byAniListId') if isinstance(raw, dict) else {}
    if isinstance(raw_by_ani, dict):
        for ani_id_raw, entry in raw_by_ani.items():
            ani_id = parse_positive_int(ani_id_raw)
            if ani_id and isinstance(entry, dict):
                by_ani[ani_id] = entry

    return mal_to_ani, by_ani


def resolve_has_french_dub(anime: dict[str, object], mal_to_ani: dict[int, int], by_ani: dict[int, dict[str, object]]) -> bool:
    mal_id = parse_positive_int(anime.get('mal_id'))
    if not mal_id:
        return False
    ani_id = mal_to_ani.get(mal_id)
    if not ani_id:
        return False
    return bool((by_ani.get(ani_id) or {}).get('hasFrenchDub'))


def choose_poster_url(anime: dict[str, object]) -> str:
    images = anime.get('images') if isinstance(anime.get('images'), dict) else {}
    for bucket_key in ('webp', 'jpg'):
        bucket = images.get(bucket_key) if isinstance(images.get(bucket_key), dict) else {}
        for url_key in ('image_url', 'large_image_url', 'small_image_url'):
            url = str(bucket.get(url_key) or '').strip()
            if url:
                return url
    return ''


def poster_extension(url: str, content_type: str) -> str:
    match = re.search(r'(\.[a-zA-Z0-9]+)$', urllib.parse.urlparse(url).path or '')
    if match:
        return match.group(1).lower()
    if 'webp' in content_type:
        return '.webp'
    if 'png' in content_type:
        return '.png'
    return '.jpg'


def download_poster(anime: dict[str, object]) -> str:
    poster_url = choose_poster_url(anime)
    if not poster_url:
        return ''

    POSTERS_DIR.mkdir(parents=True, exist_ok=True)
    anime_id = parse_positive_int(anime.get('mal_id')) or 0
    slug = hashlib.sha1(poster_url.encode('utf-8')).hexdigest()[:10]
    data, content_type = download_bytes(poster_url)
    extension = poster_extension(poster_url, content_type)
    filename = f'{anime_id or "anime"}-{slug}{extension}'
    poster_path = POSTERS_DIR / filename
    poster_path.write_bytes(data)
    return str(poster_path.relative_to(SCRIPT_DIR)).replace('\\', '/')


def compact_people_list(items: object) -> list[dict[str, object]]:
    output: list[dict[str, object]] = []
    if not isinstance(items, list):
        return output
    for entry in items:
        if not isinstance(entry, dict):
            continue
        output.append({'mal_id': entry.get('mal_id'), 'name': entry.get('name')})
    return output


def compact_titles(items: object) -> list[dict[str, object]]:
    output: list[dict[str, object]] = []
    if not isinstance(items, list):
        return output
    for entry in items:
        if not isinstance(entry, dict):
            continue
        output.append({'type': entry.get('type'), 'title': entry.get('title')})
    return output


def compact_anime(anime: dict[str, object], local_poster_path: str, has_french_dub: bool) -> dict[str, object]:
    aired = anime.get('aired') if isinstance(anime.get('aired'), dict) else {}
    return {
        'mal_id': anime.get('mal_id'),
        'title': anime.get('title'),
        'title_english': anime.get('title_english'),
        'title_japanese': anime.get('title_japanese'),
        'title_synonyms': anime.get('title_synonyms') if isinstance(anime.get('title_synonyms'), list) else [],
        'titles': compact_titles(anime.get('titles')),
        'synopsis': anime.get('synopsis') or '',
        'type': anime.get('type') or '',
        'episodes': anime.get('episodes') or '',
        'year': anime.get('year') or '',
        'status': anime.get('status') or '',
        'score': anime.get('score'),
        'rating': anime.get('rating') or '',
        'hasFrenchDub': has_french_dub,
        'aired': {
            'from': aired.get('from'),
            'prop': aired.get('prop') if isinstance(aired.get('prop'), dict) else {},
        },
        'genres': compact_people_list(anime.get('genres')),
        'themes': compact_people_list(anime.get('themes')),
        'demographics': compact_people_list(anime.get('demographics')),
        'images': {
            'jpg': {
                'small_image_url': local_poster_path,
                'image_url': local_poster_path,
                'large_image_url': local_poster_path,
            },
            'webp': {
                'small_image_url': local_poster_path,
                'image_url': local_poster_path,
                'large_image_url': local_poster_path,
            },
        },
    }


def collect_endpoint_section(section: dict[str, object]) -> list[dict[str, object]]:
    grid_id = str(section['gridId'])
    url_template = str(section['url'])
    url = url_template.format(page=deterministic_page(grid_id))
    payload = fetch_json(url)
    items = payload.get('data') if isinstance(payload, dict) else []
    return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []


def collect_adult_section(movie: bool, count: int) -> list[dict[str, object]]:
    variants = [
        {'order_by': 'popularity', 'sort': 'desc', 'limit': '50', 'page': str(deterministic_page('adultMoviesGrid' if movie else 'adultGrid'))},
        {'order_by': 'members', 'sort': 'desc', 'limit': '50', 'page': '1'},
    ]
    if movie:
        for variant in variants:
            variant['type'] = 'movie'

    collected: dict[str, dict[str, object]] = {}
    for variant in variants:
        payload = fetch_json(f'{JIKAN_BASE}/anime?{urllib.parse.urlencode(variant)}')
        items = payload.get('data') if isinstance(payload, dict) else []
        if not isinstance(items, list):
            continue
        for anime in items:
            if not isinstance(anime, dict):
                continue
            key = str(anime.get('mal_id') or '').strip()
            if not key or key in collected:
                continue
            if not is_released_anime(anime):
                continue
            if not is_adult_anime(anime):
                continue
            if movie != is_anime_movie_type(anime):
                continue
            collected[key] = anime
            if len(collected) >= count:
                break
        if len(collected) >= count:
            break
    return list(collected.values())[:count]


def cleanup_stale_posters(active_paths: set[str]) -> None:
    if not POSTERS_DIR.exists():
        return
    for child in POSTERS_DIR.iterdir():
        rel = str(child.relative_to(SCRIPT_DIR)).replace('\\', '/')
        if rel not in active_paths:
            child.unlink(missing_ok=True)


def main() -> None:
    mal_to_ani, by_ani = load_playback_snapshot()
    sections_output: dict[str, list[dict[str, object]]] = {}
    active_posters: set[str] = set()

    for section in SECTION_DEFINITIONS:
        grid_id = str(section['gridId'])
        log(f'Building {grid_id}...')
        items = collect_adult_section(bool(section.get('movie')), int(section.get('count') or 24)) if section['kind'] == 'adult' else collect_endpoint_section(section)
        compacted: list[dict[str, object]] = []
        for anime in items:
            try:
                poster_path = download_poster(anime)
            except Exception as error:  # noqa: BLE001
                log(f'Warning: failed to download poster for {anime.get("title")}: {error}')
                poster_path = choose_poster_url(anime)
            if poster_path:
                active_posters.add(poster_path)
            compacted.append(compact_anime(anime, poster_path, resolve_has_french_dub(anime, mal_to_ani, by_ani)))
            if REQUEST_DELAY_SECONDS > 0:
                time.sleep(REQUEST_DELAY_SECONDS)
        sections_output[grid_id] = compacted

    cleanup_stale_posters(active_posters)
    SNAPSHOT_PATH.write_text(json.dumps({
        'generatedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
        'sections': sections_output,
    }, ensure_ascii=True, separators=(',', ':')), encoding='utf-8')
    log(f'Wrote {SNAPSHOT_PATH}')


if __name__ == '__main__':
    main()