#!/usr/bin/env python3
"""
Scrape GOG Games listings into data/games.json

Usage:
    python3 scrape.py           # incremental (default) — stops once unchanged data is seen
    python3 scrape.py --full    # full rescrape (used weekly to catch deletions)

Incremental logic:
  - Fetches pages sorted by lastUpdateDescending (newest changes first).
  - Stops early once we see a full page where every game's last_update matches
    what is already stored — meaning everything below is also unchanged.
  - New/updated games are merged into the existing dataset.
  - Games absent from the API for a full run are pruned (only in --full mode).
"""

import argparse
import datetime
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE     = "https://gog-games.to/search"
OUT_FILE = Path(__file__).parent / "data" / "games.json"
DELAY    = 0.4   # seconds between requests

KEEP_KEYS = {
    "id", "slug", "title", "image", "background",
    "developer", "publisher", "rating", "release_timestamp",
    "gog_version", "gog_url", "infohash",
    "genres", "tags",
    "is_indev", "is_mod", "is_new", "is_updated",
    "last_update", "popularity_ranking",
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    "Accept":     "application/json",
}


# ── helpers ─────────────────────────────────────────────────────────────────

def fetch_page(page: int) -> dict:
    url = f"{BASE}?page={page}&sort_by=lastUpdateDescending"
    req = urllib.request.Request(url, headers=HEADERS)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 12 * (attempt + 1)
                print(f"  Rate limited — waiting {wait}s…", flush=True)
                time.sleep(wait)
            else:
                raise
        except Exception as e:
            print(f"  Error on attempt {attempt + 1}: {e}", flush=True)
            time.sleep(4)
    raise RuntimeError(f"Failed to fetch page {page} after 3 attempts")


def slim(game: dict) -> dict:
    out = {k: v for k, v in game.items() if k in KEEP_KEYS}
    out.setdefault("genres", [])
    out.setdefault("tags", [])
    return out


def load_existing() -> dict:
    """Return slug→game dict from existing games.json, or empty dict."""
    if not OUT_FILE.exists():
        return {}
    try:
        payload = json.loads(OUT_FILE.read_text())
        return {g["slug"]: g for g in payload.get("games", [])}
    except Exception:
        return {}


def save(games_by_slug: dict) -> None:
    OUT_FILE.parent.mkdir(exist_ok=True)
    games = list(games_by_slug.values())

    # Sort by last_update descending for a stable, predictable order
    games.sort(key=lambda g: g.get("last_update") or "", reverse=True)

    genres = sorted({g for game in games for g in (game.get("genres") or [])})
    payload = {
        "meta": {
            "total":      len(games),
            "genres":     genres,
            "scraped_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        },
        "games": games,
    }
    OUT_FILE.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
    print(f"Saved → {OUT_FILE}  ({OUT_FILE.stat().st_size / 1024:.0f} KB)", flush=True)


# ── modes ────────────────────────────────────────────────────────────────────

def run_incremental(cache: dict) -> tuple[int, int]:
    """
    Fetch pages newest-first; stop when a complete page is already up-to-date.
    Returns (added, updated) counts.
    """
    print("Mode: incremental", flush=True)
    first = fetch_page(1)
    total_pages = first["meta"]["last_page"]
    print(f"→ {first['meta']['total']} games on server, {len(cache)} in local cache\n", flush=True)

    added = updated = 0

    for page in range(1, total_pages + 1):
        data = first if page == 1 else fetch_page(page)
        batch = data["data"]

        page_changed = False
        for game in batch:
            s = game["slug"]
            cached = cache.get(s)
            if cached is None:
                cache[s] = slim(game)
                added += 1
                page_changed = True
            elif cached.get("last_update") != game.get("last_update"):
                cache[s] = slim(game)
                updated += 1
                page_changed = True

        print(
            f"\r  Page {page}/{total_pages}  "
            f"(+{added} new  ~{updated} updated)  "
            f"{'changed' if page_changed else 'all cached — stopping'}   ",
            end="", flush=True,
        )

        if not page_changed:
            # Everything on this page is already fresh; pages below are older.
            print(flush=True)
            break

        if page < total_pages:
            time.sleep(DELAY)

    print(flush=True)
    return added, updated


def run_full(cache: dict) -> tuple[int, int, int]:
    """
    Fetch every page; prune games no longer listed.
    Returns (added, updated, removed) counts.
    """
    print("Mode: full rescrape", flush=True)
    first = fetch_page(1)
    meta  = first["meta"]
    total_pages = meta["last_page"]
    print(f"→ {meta['total']} games across {total_pages} pages\n", flush=True)

    seen: set[str] = set()
    added = updated = 0

    for page in range(1, total_pages + 1):
        data = first if page == 1 else fetch_page(page)
        for game in data["data"]:
            s = game["slug"]
            seen.add(s)
            cached = cache.get(s)
            if cached is None:
                cache[s] = slim(game)
                added += 1
            elif cached.get("last_update") != game.get("last_update"):
                cache[s] = slim(game)
                updated += 1

        pct = page / total_pages * 100
        print(f"\r  Page {page}/{total_pages}  ({pct:.0f}%)  collected {len(seen)} games…",
              end="", flush=True)
        if page < total_pages:
            time.sleep(DELAY)

    print(flush=True)

    removed_slugs = [s for s in list(cache) if s not in seen]
    for s in removed_slugs:
        del cache[s]

    return added, updated, len(removed_slugs)


# ── entry point ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--full", action="store_true",
                        help="Full rescrape (use weekly; default is incremental)")
    args = parser.parse_args()

    cache = load_existing()

    if args.full or not cache:
        added, updated, removed = run_full(cache)
        print(f"\nDone — {len(cache)} games  (+{added} new  ~{updated} updated  -{removed} removed)",
              flush=True)
    else:
        added, updated = run_incremental(cache)
        print(f"\nDone — {len(cache)} games  (+{added} new  ~{updated} updated)", flush=True)

    if added or updated or not OUT_FILE.exists():
        save(cache)
    else:
        print("No changes — games.json unchanged.", flush=True)


if __name__ == "__main__":
    main()
