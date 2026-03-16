import json
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


API_BASE = 'https://kisskh.ovh/api/DramaList'
OUTPUT_PATH = Path(__file__).parent / 'data' / 'catalog_snapshot.json'
PAGE_SIZE = 40
PAGES_PER_FILTER = 3
DETAIL_WORKERS = 10

FILTERS = {
    'latest': {'type': 0, 'sub': 0, 'country': 0, 'status': 0, 'order': 2},
    'kdrama': {'type': 0, 'sub': 0, 'country': 2, 'status': 0, 'order': 1},
    'cdrama': {'type': 0, 'sub': 0, 'country': 3, 'status': 0, 'order': 1},
    'hollywood': {'type': 4, 'sub': 0, 'country': 0, 'status': 0, 'order': 1},
    'anime': {'type': 3, 'sub': 0, 'country': 0, 'status': 0, 'order': 1},
    'movies': {'type': 2, 'sub': 0, 'country': 0, 'status': 0, 'order': 1},
}


def fetch_json(url):
    request = urllib.request.Request(
        url,
        headers={
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json, text/plain, */*',
            'Referer': 'https://kisskh.ovh/',
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode('utf-8'))


def compact_item(item):
    return {
        'id': item['id'],
        'title': item.get('title') or '',
        'thumbnail': item.get('thumbnail') or '',
        'episodesCount': item.get('episodesCount') or 0,
        'label': item.get('label') or '',
    }


def compact_detail(detail):
    episodes = []
    for episode in detail.get('episodes') or []:
        episodes.append({
            'number': episode.get('number'),
            'sub': episode.get('sub') or 0,
        })

    return {
        'id': detail['id'],
        'title': detail.get('title') or '',
        'thumbnail': detail.get('thumbnail') or '',
        'episodesCount': detail.get('episodesCount') or 0,
        'releaseDate': detail.get('releaseDate') or '',
        'country': detail.get('country') or '',
        'status': detail.get('status') or '',
        'type': detail.get('type') or '',
        'description': detail.get('description') or '',
        'episodes': episodes,
    }


def fetch_list_page(filter_params, page):
    params = dict(filter_params)
    params['pageSize'] = PAGE_SIZE
    params['page'] = page
    query = urllib.parse.urlencode(params)
    return fetch_json(f'{API_BASE}/List?{query}')


def fetch_detail(drama_id):
    return fetch_json(f'{API_BASE}/Drama/{drama_id}?is498=false')


def main():
    items = {}
    sections = {}
    filters = {}

    for name, filter_params in FILTERS.items():
        ids = []
        print(f'Fetching list for {name}...')
        for page in range(PAGES_PER_FILTER):
            payload = fetch_list_page(filter_params, page)
            for entry in payload.get('data') or []:
                compact = compact_item(entry)
                items[str(compact['id'])] = compact
                ids.append(compact['id'])
            time.sleep(0.15)

        deduped_ids = list(dict.fromkeys(ids))
        sections[name] = deduped_ids[:PAGE_SIZE]
        if name != 'latest':
            filters[name] = deduped_ids

    detail_ids = sorted({drama_id for ids in filters.values() for drama_id in ids} | set(sections['latest']))
    details = {}

    print(f'Fetching details for {len(detail_ids)} dramas...')
    with ThreadPoolExecutor(max_workers=DETAIL_WORKERS) as executor:
        future_map = {executor.submit(fetch_detail, drama_id): drama_id for drama_id in detail_ids}
        completed = 0
        for future in as_completed(future_map):
            drama_id = future_map[future]
            completed += 1
            try:
                details[str(drama_id)] = compact_detail(future.result())
            except Exception as exc:
                print(f'Failed detail {drama_id}: {exc}')
            if completed % 25 == 0 or completed == len(detail_ids):
                print(f'  {completed}/{len(detail_ids)} complete')

    snapshot = {
        'generatedAt': int(time.time()),
        'pageSize': PAGE_SIZE,
        'pagesPerFilter': PAGES_PER_FILTER,
        'sections': sections,
        'filters': filters,
        'items': items,
        'details': details,
    }

    OUTPUT_PATH.write_text(json.dumps(snapshot, separators=(',', ':'), ensure_ascii=False), encoding='utf-8')
    print(f'Wrote {OUTPUT_PATH}')


if __name__ == '__main__':
    main()