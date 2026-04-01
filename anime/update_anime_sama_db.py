#!/usr/bin/env python3

from __future__ import annotations

import concurrent.futures
import datetime as dt
import hashlib
import json
import os
import re
import sqlite3
import time
import urllib.parse
import urllib.request
import zlib
from dataclasses import dataclass
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("ANIME_SAMA_DB_PATH", SCRIPT_DIR / "anime_sama.db"))
BASE_CANDIDATES = [
    value.strip().rstrip("/")
    for value in os.environ.get(
        "ANIME_SAMA_BASES",
        "https://anime-sama.to,https://anime-sama.si",
    ).split(",")
    if value.strip()
]

MAX_ANIME_PER_RUN = max(1, int(os.environ.get("ANIME_SAMA_MAX_ANIME_PER_RUN", "90")))
MAX_NEW_ANIME_PER_RUN = max(1, int(os.environ.get("ANIME_SAMA_MAX_NEW_ANIME_PER_RUN", "15")))
MAX_WORKERS = max(1, int(os.environ.get("ANIME_SAMA_MAX_WORKERS", "12")))
ROTATION_BUCKETS = max(1, int(os.environ.get("ANIME_SAMA_ROTATION_BUCKETS", "30")))
HOT_DAYS = max(1, int(os.environ.get("ANIME_SAMA_HOT_DAYS", "120")))
HOT_REFRESH_HOURS = max(1, int(os.environ.get("ANIME_SAMA_HOT_REFRESH_HOURS", "18")))
RETRY_HOURS = max(1, int(os.environ.get("ANIME_SAMA_RETRY_HOURS", "24")))
ROTATION_REFRESH_DAYS = max(1, int(os.environ.get("ANIME_SAMA_ROTATION_REFRESH_DAYS", "14")))
HTTP_TIMEOUT = max(5, int(os.environ.get("ANIME_SAMA_HTTP_TIMEOUT", "30")))
HTTP_RETRIES = max(1, int(os.environ.get("ANIME_SAMA_HTTP_RETRIES", "3")))
USER_AGENT = os.environ.get(
    "ANIME_SAMA_USER_AGENT",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
)

PANEL_ROUTE_RE = re.compile(r"panneauAnime\(\s*['\"]([^'\"]+)['\"]\s*,\s*['\"]([^'\"]+)['\"]", re.I)
HREF_RE = re.compile(r"href\s*=\s*['\"]([^'\"]+)['\"]", re.I)
TITLE_RE = re.compile(r"<h4[^>]+id=['\"]titreOeuvre['\"][^>]*>(.*?)</h4>", re.I | re.S)
EPISODES_SCRIPT_RE = re.compile(r"([\w:/?=&.%+-]*episodes\.js(?:\?[^'\"\s<>]*)?)", re.I)
EP_ARRAY_RE = re.compile(r"var\s+(eps[a-z0-9_]+)\s*=\s*\[(.*?)\]\s*;", re.I | re.S)
STRING_RE = re.compile(r"'([^']*)'|\"([^\"]*)\"")
URL_RE = re.compile(r"https?://[^\s'\"]+")
STRIP_TAGS_RE = re.compile(r"<[^>]+>")


@dataclass(frozen=True)
class RouteInfo:
    slug: str
    key: str
    season: str
    lang: str
    page_url: str


@dataclass
class RoutePayload:
    season: str
    lang: str
    rows: list[tuple[int, int, str]]


@dataclass
class ScrapeResult:
    slug: str
    title: str | None
    payloads: list[RoutePayload]
    content_kind: str | None = None
    error: str | None = None


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def isoformat(value: dt.datetime | None) -> str | None:
    return value.isoformat() if value else None


def parse_iso(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return None


def stable_bucket(slug: str) -> int:
    return zlib.crc32(slug.encode("utf-8")) % ROTATION_BUCKETS


def clean_html_text(html: str | None) -> str:
    text = STRIP_TAGS_RE.sub(" ", html or "")
    return re.sub(r"\s+", " ", text).strip()


def log(message: str) -> None:
    print(message, flush=True)


def build_request(url: str) -> urllib.request.Request:
    return urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        },
    )


def fetch_text(url: str, *, timeout: int = HTTP_TIMEOUT, retries: int = HTTP_RETRIES) -> str:
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(build_request(url), timeout=timeout) as response:
                charset = response.headers.get_content_charset() or "utf-8"
                return response.read().decode(charset, errors="replace")
        except Exception as error:  # noqa: BLE001
            last_error = error
            if attempt >= retries:
                break
            time.sleep(1.2 * attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last_error}")


def resolve_working_base() -> tuple[str, str]:
    for base_url in BASE_CANDIDATES:
        sitemap_url = f"{base_url}/sitemap.xml"
        try:
            xml_text = fetch_text(sitemap_url)
            if "/catalogue/" in xml_text:
                return base_url, xml_text
        except Exception as error:  # noqa: BLE001
            log(f"Base probe failed for {base_url}: {error}")
    raise RuntimeError("Could not reach a working Anime-Sama base URL")


def extract_sitemap_routes(xml_text: str, base_url: str) -> dict[str, list[RouteInfo]]:
    route_map: dict[str, dict[str, RouteInfo]] = {}
    for url in re.findall(r"<loc>([^<]+)</loc>", xml_text, re.I):
        info = extract_route_info(url, None, base_url)
        if not info:
            continue
        per_slug = route_map.setdefault(info.slug, {})
        per_slug[info.key] = info
    return {slug: list(routes.values()) for slug, routes in route_map.items()}


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS anime (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            anilist_id INTEGER,
            title TEXT,
            slug TEXT UNIQUE,
            unresolved INTEGER DEFAULT 0
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS episode_sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            anime_id INTEGER,
            season TEXT,
            episode INTEGER,
            lang TEXT,
            source INTEGER,
            url TEXT,
            UNIQUE(anime_id, season, episode, lang, source, url)
        )
        """
    )

    existing_columns = {row[1] for row in conn.execute("PRAGMA table_info(anime)")}
    desired_columns = {
        "last_seen_at": "TEXT",
        "last_refresh_at": "TEXT",
        "last_success_at": "TEXT",
        "last_failure_at": "TEXT",
        "last_source_count": "INTEGER DEFAULT 0",
        "source_hash": "TEXT",
        "hot_until": "TEXT",
        "refresh_bucket": "INTEGER",
        "content_kind": "TEXT",
    }
    for name, sql_type in desired_columns.items():
        if name not in existing_columns:
            conn.execute(f"ALTER TABLE anime ADD COLUMN {name} {sql_type}")

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_episode_sources_anime_season_lang "
        "ON episode_sources(anime_id, season, lang)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_anime_refresh_bucket ON anime(refresh_bucket)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_anime_hot_until ON anime(hot_until)"
    )
    conn.commit()


def bootstrap_metadata(conn: sqlite3.Connection, now_iso: str) -> None:
    rows = conn.execute("SELECT id, slug FROM anime WHERE refresh_bucket IS NULL").fetchall()
    if rows:
        conn.executemany(
            "UPDATE anime SET refresh_bucket = ? WHERE id = ?",
            [(stable_bucket(slug), anime_id) for anime_id, slug in rows],
        )

    conn.execute(
        """
        UPDATE anime
        SET last_source_count = COALESCE(last_source_count, 0)
        WHERE last_source_count IS NULL
        """
    )

    rows = conn.execute(
        """
        SELECT anime.id, COUNT(episode_sources.id)
        FROM anime
        LEFT JOIN episode_sources ON episode_sources.anime_id = anime.id
        WHERE anime.last_success_at IS NULL
        GROUP BY anime.id
        HAVING COUNT(episode_sources.id) > 0
        """
    ).fetchall()
    if rows:
        conn.executemany(
            """
            UPDATE anime
            SET last_success_at = ?,
                last_refresh_at = ?,
                last_source_count = ?
            WHERE id = ?
            """,
            [(now_iso, now_iso, count, anime_id) for anime_id, count in rows],
        )
    conn.commit()


def upsert_sitemap_slugs(conn: sqlite3.Connection, slugs: list[str], now_iso: str) -> int:
    inserted = 0
    for slug in slugs:
        cursor = conn.execute(
            "INSERT OR IGNORE INTO anime (slug, last_seen_at, refresh_bucket) VALUES (?, ?, ?)",
            (slug, now_iso, stable_bucket(slug)),
        )
        inserted += cursor.rowcount
    conn.executemany(
        "UPDATE anime SET last_seen_at = ?, refresh_bucket = COALESCE(refresh_bucket, ?) WHERE slug = ?",
        [(now_iso, stable_bucket(slug), slug) for slug in slugs],
    )
    conn.commit()
    return inserted


def select_candidates(conn: sqlite3.Connection, now: dt.datetime, sitemap_seen_at: str) -> list[str]:
    selected: list[str] = []
    seen: set[str] = set()

    def add(query: str, params: tuple[object, ...] = ()) -> None:
        if len(selected) >= MAX_ANIME_PER_RUN:
            return
        for (slug,) in conn.execute(query, params):
            if slug in seen:
                continue
            selected.append(slug)
            seen.add(slug)
            if len(selected) >= MAX_ANIME_PER_RUN:
                return

    now_iso = isoformat(now)
    hot_cutoff = isoformat(now - dt.timedelta(hours=HOT_REFRESH_HOURS))
    retry_cutoff = isoformat(now - dt.timedelta(hours=RETRY_HOURS))
    rotation_cutoff = isoformat(now - dt.timedelta(days=ROTATION_REFRESH_DAYS))
    rotation_bucket = now.timetuple().tm_yday % ROTATION_BUCKETS

    add(
        """
        SELECT slug
        FROM anime
                WHERE last_seen_at = ?
                    AND COALESCE(content_kind, '') NOT IN ('scan', 'missing')
                    AND last_success_at IS NULL
                    AND COALESCE(last_source_count, 0) = 0
                    AND last_failure_at IS NULL
        ORDER BY id DESC
                LIMIT ?
                """,
                (sitemap_seen_at, min(MAX_NEW_ANIME_PER_RUN, MAX_ANIME_PER_RUN)),
    )
    add(
        """
        SELECT slug
        FROM anime
                WHERE last_seen_at = ?
                    AND COALESCE(content_kind, '') NOT IN ('scan', 'missing')
                    AND last_failure_at IS NOT NULL
          AND (last_refresh_at IS NULL OR last_refresh_at < ?)
        ORDER BY last_failure_at DESC
        """,
                (sitemap_seen_at, retry_cutoff),
    )
    add(
        """
        SELECT slug
        FROM anime
                WHERE last_seen_at = ?
                    AND COALESCE(content_kind, '') NOT IN ('scan', 'missing')
                    AND hot_until IS NOT NULL
          AND hot_until > ?
          AND (last_refresh_at IS NULL OR last_refresh_at < ?)
        ORDER BY hot_until DESC, last_refresh_at ASC
        """,
                (sitemap_seen_at, now_iso, hot_cutoff),
    )
    add(
        """
        SELECT slug
        FROM anime
                WHERE last_seen_at = ?
                    AND COALESCE(content_kind, '') NOT IN ('scan', 'missing')
                    AND refresh_bucket = ?
          AND (hot_until IS NULL OR hot_until <= ?)
          AND (last_refresh_at IS NULL OR last_refresh_at < ?)
        ORDER BY last_refresh_at ASC, id ASC
        """,
                (sitemap_seen_at, rotation_bucket, now_iso, rotation_cutoff),
    )
    return selected


def build_catalogue_url(base_url: str, slug: str) -> str:
    return f"{base_url}/catalogue/{urllib.parse.quote(slug)}/"


def extract_title(html: str) -> str | None:
    match = TITLE_RE.search(html)
    if not match:
        return None
    title = clean_html_text(match.group(1))
    return title or None


def absolute_url(path: str, base_url: str) -> str:
    return urllib.parse.urljoin(base_url, path.strip())


def path_parts(candidate: str, base_url: str) -> list[str]:
    if not candidate:
        return []
    url = absolute_url(candidate, base_url)
    parsed = urllib.parse.urlparse(url)
    return [part for part in parsed.path.split("/") if part]


def extract_route_info(candidate: str, slug: str | None, base_url: str) -> RouteInfo | None:
    if not candidate:
        return None
    url = absolute_url(candidate, base_url)
    parsed = urllib.parse.urlparse(url)
    parts = [part for part in parsed.path.split("/") if part]
    try:
        index = parts.index("catalogue")
    except ValueError:
        return None
    if len(parts) <= index + 3:
        return None
    parsed_slug = parts[index + 1]
    if slug and parsed_slug != slug:
        return None
    tail = parts[index + 2 :]
    if not tail or tail[0].lower() == "scan":
        return None
    lang = tail[-1].lower()
    if lang not in {"vf", "vostfr"}:
        return None
    season = "/".join(tail[:-1]).strip()
    if not season:
        return None
    normalized = urllib.parse.urlunparse(parsed._replace(fragment="", query=""))
    if not normalized.endswith("/"):
        normalized += "/"
    return RouteInfo(
        slug=parsed_slug,
        key=f"{season}:{lang}",
        season=season,
        lang=lang.upper(),
        page_url=normalized,
    )


def discover_routes_from_html(html: str, slug: str, base_url: str) -> list[RouteInfo]:
    routes: list[RouteInfo] = []
    seen: set[str] = set()
    for _label, route_path in PANEL_ROUTE_RE.findall(html or ""):
        info = extract_route_info(route_path, slug, base_url)
        if info and info.key not in seen:
            seen.add(info.key)
            routes.append(info)
    for href in HREF_RE.findall(html or ""):
        info = extract_route_info(href, slug, base_url)
        if info and info.key not in seen:
            seen.add(info.key)
            routes.append(info)
    return routes


def has_scan_routes(html: str, slug: str, base_url: str) -> bool:
    for candidate in HREF_RE.findall(html or ""):
        parts = path_parts(candidate, base_url)
        try:
            index = parts.index("catalogue")
        except ValueError:
            continue
        if len(parts) <= index + 2 or parts[index + 1] != slug:
            continue
        if parts[index + 2].lower() == "scan":
            return True
    return False


def extract_episodes_script_urls(html: str, page_url: str) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    for match in EPISODES_SCRIPT_RE.findall(html or ""):
        if "episodes.js" not in match.lower():
            continue
        absolute = absolute_url(match, page_url)
        if absolute not in seen:
            seen.add(absolute)
            urls.append(absolute)
    return urls


def source_id_from_name(name: str, fallback: int) -> int:
    match = re.search(r"eps(\d+)$", name, re.I)
    if match:
        return int(match.group(1))
    return 1000 + fallback


def parse_episodes_script(script_text: str) -> list[tuple[int, int, str]]:
    rows: list[tuple[int, int, str]] = []
    seen: set[tuple[int, int, str]] = set()
    for source_index, match in enumerate(EP_ARRAY_RE.finditer(script_text or ""), start=1):
        source_name = match.group(1)
        array_body = match.group(2)
        urls: list[str] = []
        for url_match in STRING_RE.finditer(array_body):
            value = (url_match.group(1) or url_match.group(2) or "").strip()
            if value.startswith("http://") or value.startswith("https://"):
                urls.append(value)
        source_id = source_id_from_name(source_name, source_index)
        for episode_number, url in enumerate(urls, start=1):
            key = (episode_number, source_id, url)
            if key in seen:
                continue
            seen.add(key)
            rows.append(key)

    if rows:
        return rows

    fallback_urls = []
    for url in URL_RE.findall(script_text or ""):
        lower = url.lower()
        if any(token in lower for token in (".m3u8", ".mp4", "/embed/", "videodelivery", "manifest")):
            fallback_urls.append(url)
    deduped = list(dict.fromkeys(fallback_urls))
    return [(index + 1, 1999, url) for index, url in enumerate(deduped)]


def scrape_slug(slug: str, base_url: str, seed_routes: list[RouteInfo] | None = None) -> ScrapeResult:
    anime_url = build_catalogue_url(base_url, slug)
    title: str | None = None
    route_map: dict[str, RouteInfo] = {route.key: route for route in seed_routes or []}
    base_error: Exception | None = None
    try:
        anime_html = fetch_text(anime_url)
        title = extract_title(anime_html)
        discovered_routes = discover_routes_from_html(anime_html, slug, anime_url)
        for route in discovered_routes:
            route_map[route.key] = route
        scan_only = False
        if not route_map:
            scan_only = has_scan_routes(anime_html, slug, anime_url)
            if not scan_only:
                for probe in ("saison1/vostfr/", "saison1/vf/", "film/vostfr/", "film/vf/"):
                    info = extract_route_info(probe, slug, anime_url)
                    if info:
                        route_map[info.key] = info

        if scan_only:
            return ScrapeResult(
                slug=slug,
                title=title,
                payloads=[],
                content_kind="scan",
                error="scan-only entry",
            )
    except Exception as error:  # noqa: BLE001
        base_error = error
        if not route_map:
            return ScrapeResult(slug=slug, title=None, payloads=[], error=str(error))

    payloads: list[RoutePayload] = []
    queue = list(route_map.values())
    processed: set[str] = set()
    fetched_any_route = False
    route_not_found_count = 0

    while queue:
        route = queue.pop(0)
        if route.key in processed:
            continue
        processed.add(route.key)
        try:
            season_html = fetch_text(route.page_url)
            fetched_any_route = True
        except Exception as error:
            if "HTTP Error 404" in str(error):
                route_not_found_count += 1
            continue

        if not title:
            title = extract_title(season_html) or title

        for sibling in discover_routes_from_html(season_html, slug, route.page_url):
            if sibling.key not in route_map:
                route_map[sibling.key] = sibling
                queue.append(sibling)

        script_urls = extract_episodes_script_urls(season_html, route.page_url)
        route_rows: list[tuple[int, int, str]] = []
        for script_url in script_urls:
            try:
                script_text = fetch_text(script_url)
            except Exception:
                continue
            route_rows = parse_episodes_script(script_text)
            if route_rows:
                break
        if route_rows:
            payloads.append(RoutePayload(season=route.season, lang=route.lang, rows=route_rows))

    if payloads:
        return ScrapeResult(slug=slug, title=title, payloads=payloads, content_kind="anime")
    if route_map and not fetched_any_route and route_not_found_count == len(route_map):
        return ScrapeResult(
            slug=slug,
            title=title,
            payloads=[],
            content_kind="missing",
            error="all sitemap routes returned 404",
        )
    if base_error:
        return ScrapeResult(slug=slug, title=title, payloads=[], error=str(base_error))
    return ScrapeResult(slug=slug, title=title, payloads=[], content_kind="anime")


def compute_source_hash(conn: sqlite3.Connection, anime_id: int) -> tuple[int, str]:
    rows = conn.execute(
        """
        SELECT season, episode, lang, source, url
        FROM episode_sources
        WHERE anime_id = ?
        ORDER BY season, episode, lang, source, url
        """,
        (anime_id,),
    ).fetchall()
    serializable_rows = [tuple(row) for row in rows]
    payload = json.dumps(serializable_rows, ensure_ascii=True, separators=(",", ":"))
    return len(serializable_rows), hashlib.sha1(payload.encode("utf-8")).hexdigest()


def apply_result(conn: sqlite3.Connection, result: ScrapeResult, now: dt.datetime) -> tuple[bool, str]:
    now_iso = isoformat(now)
    row = conn.execute(
        "SELECT id, title, source_hash, hot_until, content_kind FROM anime WHERE slug = ?",
        (result.slug,),
    ).fetchone()
    if not row:
        raise RuntimeError(f"Missing anime row for slug {result.slug}")

    anime_id, existing_title, existing_hash, existing_hot_until, existing_content_kind = row
    current_count_before = conn.execute(
        "SELECT COUNT(*) FROM episode_sources WHERE anime_id = ?",
        (anime_id,),
    ).fetchone()[0]
    prior_hash = existing_hash
    if current_count_before > 0 and not prior_hash:
        _, prior_hash = compute_source_hash(conn, anime_id)

    title = result.title or existing_title
    if result.payloads:
        with conn:
            for payload in result.payloads:
                conn.execute(
                    "DELETE FROM episode_sources WHERE anime_id = ? AND season = ? AND lang = ?",
                    (anime_id, payload.season, payload.lang),
                )
                conn.executemany(
                    """
                    INSERT OR IGNORE INTO episode_sources(anime_id, season, episode, lang, source, url)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (anime_id, payload.season, episode, payload.lang, source, url)
                        for episode, source, url in payload.rows
                    ],
                )

            current_count, current_hash = compute_source_hash(conn, anime_id)
            changed = current_hash != prior_hash or current_count != current_count_before
            next_hot_until = existing_hot_until
            hot_until_dt = parse_iso(existing_hot_until)
            if changed or current_count_before == 0:
                next_hot_until = isoformat(now + dt.timedelta(days=HOT_DAYS))
            elif hot_until_dt and hot_until_dt <= now:
                next_hot_until = None

            conn.execute(
                """
                UPDATE anime
                SET title = ?,
                    last_refresh_at = ?,
                    last_success_at = ?,
                    last_failure_at = NULL,
                    last_source_count = ?,
                    source_hash = ?,
                    hot_until = ?,
                    content_kind = 'anime'
                WHERE id = ?
                """,
                (title, now_iso, now_iso, current_count, current_hash, next_hot_until, anime_id),
            )
        return True, "updated" if changed else "checked"

    if result.content_kind == "scan":
        with conn:
            conn.execute("DELETE FROM episode_sources WHERE anime_id = ?", (anime_id,))
            conn.execute(
                """
                UPDATE anime
                SET title = COALESCE(?, title),
                    last_refresh_at = ?,
                    last_success_at = NULL,
                    last_failure_at = NULL,
                    last_source_count = 0,
                    source_hash = NULL,
                    hot_until = NULL,
                    content_kind = 'scan'
                WHERE id = ?
                """,
                (title, now_iso, anime_id),
            )
        return True, "skipped scan-only"

    if result.content_kind == "missing":
        with conn:
            conn.execute(
                """
                UPDATE anime
                SET title = COALESCE(?, title),
                    last_refresh_at = ?,
                    last_success_at = NULL,
                    last_failure_at = NULL,
                    hot_until = NULL,
                    content_kind = 'missing'
                WHERE id = ?
                """,
                (title, now_iso, anime_id),
            )
        return True, "skipped missing"

    conn.execute(
        """
        UPDATE anime
        SET title = COALESCE(?, title),
            last_refresh_at = ?,
            last_failure_at = ?,
            content_kind = COALESCE(?, content_kind)
        WHERE id = ?
        """,
        (title, now_iso, now_iso, result.content_kind or existing_content_kind, anime_id),
    )
    conn.commit()
    return False, result.error or "no routes found"


def print_summary(base_url: str, slugs: list[str], candidates: list[str]) -> None:
    log(f"Using Anime-Sama base: {base_url}")
    log(f"Sitemap slugs: {len(slugs)}")
    log(f"Selected {len(candidates)} anime for this run (max {MAX_ANIME_PER_RUN})")


def main() -> int:
    start = time.time()
    now = utc_now()
    now_iso = isoformat(now)

    base_url, sitemap_text = resolve_working_base()
    sitemap_routes = extract_sitemap_routes(sitemap_text, base_url)
    sitemap_slugs = sorted(sitemap_routes)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")

    ensure_schema(conn)
    bootstrap_metadata(conn, now_iso)
    inserted = upsert_sitemap_slugs(conn, sitemap_slugs, now_iso)
    candidates = select_candidates(conn, now, now_iso)
    print_summary(base_url, sitemap_slugs, candidates)
    if inserted:
        log(f"Inserted {inserted} new anime rows from sitemap")
    if not candidates:
        log("No anime need refreshing today")
        return 0

    updated = 0
    checked = 0
    failed = 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_map = {
            executor.submit(scrape_slug, slug, base_url, sitemap_routes.get(slug, [])): slug
            for slug in candidates
        }
        for index, future in enumerate(concurrent.futures.as_completed(future_map), start=1):
            slug = future_map[future]
            try:
                result = future.result()
            except Exception as error:  # noqa: BLE001
                failed += 1
                log(f"[{index}/{len(candidates)}] {slug}: worker failed: {error}")
                conn.execute(
                    "UPDATE anime SET last_refresh_at = ?, last_failure_at = ? WHERE slug = ?",
                    (now_iso, now_iso, slug),
                )
                conn.commit()
                continue

            success, status = apply_result(conn, result, now)
            if success:
                if status == "updated":
                    updated += 1
                else:
                    checked += 1
                log(f"[{index}/{len(candidates)}] {slug}: {status} ({len(result.payloads)} season/lang pages)")
            else:
                failed += 1
                log(f"[{index}/{len(candidates)}] {slug}: failed ({status})")

    conn.close()
    elapsed = time.time() - start
    log(
        "Finished incremental Anime-Sama refresh: "
        f"updated={updated}, checked={checked}, failed={failed}, elapsed={elapsed:.1f}s"
    )
    return 0 if failed < len(candidates) else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)