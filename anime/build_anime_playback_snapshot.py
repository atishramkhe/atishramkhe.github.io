#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sqlite3
import time
import urllib.error
import urllib.request
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("ANIME_SAMA_DB_PATH", SCRIPT_DIR / "anime_sama.db"))
SNAPSHOT_PATH = Path(os.environ.get("ANIME_PLAYBACK_SNAPSHOT_PATH", SCRIPT_DIR / "anime_playback_snapshot.json"))
ANILIST_GRAPHQL_URL = os.environ.get("ANILIST_GRAPHQL_URL", "https://graphql.anilist.co")
HTTP_TIMEOUT = max(5, int(os.environ.get("ANIME_SNAPSHOT_HTTP_TIMEOUT", "30")))
HTTP_RETRIES = max(1, int(os.environ.get("ANIME_SNAPSHOT_HTTP_RETRIES", "3")))
BATCH_SIZE = max(1, int(os.environ.get("ANIME_SNAPSHOT_BATCH_SIZE", "40")))
REQUEST_DELAY_SECONDS = max(0.0, float(os.environ.get("ANIME_SNAPSHOT_REQUEST_DELAY", "0.35")))
USER_AGENT = os.environ.get(
    "ANIME_SNAPSHOT_USER_AGENT",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
)


def log(message: str) -> None:
    print(message, flush=True)


def parse_positive_int(value: object) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def is_french_dub_language(lang: object) -> bool:
    normalized = str(lang or "").strip().lower()
    return "vf" in normalized or "dub" in normalized or normalized == "fr"


def build_request(payload: dict[str, object]) -> urllib.request.Request:
    body = json.dumps(payload).encode("utf-8")
    return urllib.request.Request(
        ANILIST_GRAPHQL_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )


def fetch_graphql(query: str) -> dict[str, object]:
    payload = {"query": query}
    last_error: Exception | None = None
    for attempt in range(1, HTTP_RETRIES + 1):
        try:
            with urllib.request.urlopen(build_request(payload), timeout=HTTP_TIMEOUT) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code == 429 and attempt < HTTP_RETRIES:
                retry_after = parse_positive_int(error.headers.get("Retry-After")) if error.headers else None
                delay = max(float(retry_after or 0), REQUEST_DELAY_SECONDS * 6, 5.0)
                time.sleep(delay * attempt)
                continue
            if attempt >= HTTP_RETRIES:
                break
            time.sleep(1.2 * attempt)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = error
            if attempt >= HTTP_RETRIES:
                break
            time.sleep(1.2 * attempt)
    raise RuntimeError(f"AniList GraphQL request failed: {last_error}")


def iter_batches(values: list[int], size: int) -> list[list[int]]:
    return [values[index:index + size] for index in range(0, len(values), size)]


def load_previous_snapshot() -> dict[int, dict[str, object]]:
    if not SNAPSHOT_PATH.exists():
        return {}
    try:
        raw = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        log(f"Warning: failed to read previous snapshot: {error}")
        return {}

    by_ani_list_raw = raw.get("byAniListId") if isinstance(raw, dict) else {}
    previous_entries: dict[int, dict[str, object]] = {}
    if isinstance(by_ani_list_raw, dict):
        for key, value in by_ani_list_raw.items():
            ani_list_id = parse_positive_int(key)
            if ani_list_id and isinstance(value, dict):
                previous_entries[ani_list_id] = value
    return previous_entries


def load_direct_source_summaries(conn: sqlite3.Connection) -> dict[int, dict[str, object]]:
    rows = conn.execute(
        """
        SELECT anime.anilist_id, episode_sources.season, episode_sources.episode, LOWER(episode_sources.lang)
        FROM anime
        JOIN episode_sources ON episode_sources.anime_id = anime.id
        WHERE anime.anilist_id IS NOT NULL
        GROUP BY anime.anilist_id, episode_sources.season, episode_sources.episode, LOWER(episode_sources.lang)
        ORDER BY anime.anilist_id
        """
    )

    aggregate: dict[int, dict[str, object]] = {}
    for ani_list_id_raw, season, episode, lang in rows:
        ani_list_id = parse_positive_int(ani_list_id_raw)
        if not ani_list_id:
            continue
        entry = aggregate.setdefault(
            ani_list_id,
            {
                "languages": set(),
                "seasons": set(),
                "episodes": set(),
                "hasFrenchDub": False,
            },
        )
        if season:
            entry["seasons"].add(str(season))
        episode_number = parse_positive_int(episode)
        if season and episode_number:
            entry["episodes"].add((str(season), episode_number))
        if lang:
            normalized_lang = str(lang).strip().lower()
            if normalized_lang:
                entry["languages"].add(normalized_lang)
                if is_french_dub_language(normalized_lang):
                    entry["hasFrenchDub"] = True

    summaries: dict[int, dict[str, object]] = {}
    for ani_list_id, entry in aggregate.items():
        languages = sorted(entry["languages"])
        summaries[ani_list_id] = {
            "aniListId": ani_list_id,
            "sourceAniListId": ani_list_id,
            "hasAnySources": bool(entry["episodes"]),
            "hasFrenchDub": bool(entry["hasFrenchDub"]),
            "languages": languages,
            "seasonCount": len(entry["seasons"]),
            "episodeCount": len(entry["episodes"]),
        }
    return summaries


def load_all_anilist_ids(conn: sqlite3.Connection) -> list[int]:
    rows = conn.execute(
        "SELECT DISTINCT anilist_id FROM anime WHERE anilist_id IS NOT NULL ORDER BY anilist_id"
    )
    ids = [parse_positive_int(row[0]) for row in rows]
    return [value for value in ids if value]


def fetch_anilist_metadata_batch(ids: list[int]) -> dict[int, dict[str, object]]:
    query_lines = ["query {"]
    for index, ani_list_id in enumerate(ids):
        query_lines.append(f"  media_{index}: Media(id: {ani_list_id}, type: ANIME) {{")
        query_lines.append("    id")
        query_lines.append("    idMal")
        query_lines.append("    relations { edges { relationType node { id } } }")
        query_lines.append("  }")
    query_lines.append("}")
    payload = fetch_graphql("\n".join(query_lines))

    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        return {}

    metadata: dict[int, dict[str, object]] = {}
    for item in data.values():
        if not isinstance(item, dict):
            continue
        ani_list_id = parse_positive_int(item.get("id"))
        if not ani_list_id:
            continue
        prequel_ids: list[int] = []
        relations = item.get("relations") if isinstance(item.get("relations"), dict) else {}
        edges = relations.get("edges") if isinstance(relations, dict) else []
        if isinstance(edges, list):
            for edge in edges:
                if not isinstance(edge, dict):
                    continue
                if edge.get("relationType") != "PREQUEL":
                    continue
                node = edge.get("node") if isinstance(edge.get("node"), dict) else {}
                prequel_id = parse_positive_int(node.get("id"))
                if prequel_id and prequel_id not in prequel_ids:
                    prequel_ids.append(prequel_id)
        metadata[ani_list_id] = {
            "idMal": parse_positive_int(item.get("idMal")),
            "prequelIds": prequel_ids,
        }
    return metadata


def fetch_all_anilist_metadata(
    ani_list_ids: list[int],
    previous_entries: dict[int, dict[str, object]],
) -> dict[int, dict[str, object]]:
    metadata: dict[int, dict[str, object]] = {}
    batches = iter_batches(ani_list_ids, BATCH_SIZE)
    for batch_index, batch in enumerate(batches, start=1):
        try:
            batch_metadata = fetch_anilist_metadata_batch(batch)
            metadata.update(batch_metadata)
            log(f"Fetched AniList metadata batch {batch_index}/{len(batches)} ({len(batch)} ids)")
        except Exception as error:  # noqa: BLE001
            log(f"Warning: metadata batch {batch_index}/{len(batches)} failed: {error}")
            for ani_list_id in batch:
                previous_entry = previous_entries.get(ani_list_id, {})
                metadata[ani_list_id] = {
                    "idMal": parse_positive_int(previous_entry.get("idMal")),
                    "prequelIds": [],
                }
        if batch_index < len(batches) and REQUEST_DELAY_SECONDS > 0:
            time.sleep(REQUEST_DELAY_SECONDS)
    return metadata


def resolve_source_anilist_id(
    ani_list_id: int,
    metadata: dict[int, dict[str, object]],
    direct_summaries: dict[int, dict[str, object]],
    previous_entries: dict[int, dict[str, object]],
    memo: dict[int, int | None],
    stack: set[int] | None = None,
) -> int | None:
    if ani_list_id in memo:
        return memo[ani_list_id]
    if ani_list_id in direct_summaries:
        memo[ani_list_id] = ani_list_id
        return ani_list_id

    active_stack = stack or set()
    if ani_list_id in active_stack:
        memo[ani_list_id] = None
        return None

    active_stack.add(ani_list_id)
    info = metadata.get(ani_list_id, {})
    prequel_ids = info.get("prequelIds") if isinstance(info, dict) else []
    if isinstance(prequel_ids, list):
        for prequel_id in prequel_ids:
            normalized_prequel_id = parse_positive_int(prequel_id)
            if not normalized_prequel_id:
                continue
            resolved = resolve_source_anilist_id(
                normalized_prequel_id,
                metadata,
                direct_summaries,
                previous_entries,
                memo,
                active_stack,
            )
            if resolved and resolved in direct_summaries:
                memo[ani_list_id] = resolved
                active_stack.remove(ani_list_id)
                return resolved

    previous_entry = previous_entries.get(ani_list_id, {})
    previous_source_id = parse_positive_int(previous_entry.get("sourceAniListId"))
    if previous_source_id and previous_source_id in direct_summaries:
        memo[ani_list_id] = previous_source_id
        active_stack.remove(ani_list_id)
        return previous_source_id

    active_stack.remove(ani_list_id)
    memo[ani_list_id] = None
    return None


def build_snapshot(
    ani_list_ids: list[int],
    direct_summaries: dict[int, dict[str, object]],
    metadata: dict[int, dict[str, object]],
    previous_entries: dict[int, dict[str, object]],
) -> dict[str, object]:
    memo: dict[int, int | None] = {}
    by_ani_list_id: dict[str, dict[str, object]] = {}
    mal_to_ani_list: dict[str, int] = {}

    for ani_list_id in ani_list_ids:
        source_ani_list_id = resolve_source_anilist_id(
            ani_list_id,
            metadata,
            direct_summaries,
            previous_entries,
            memo,
        )
        source_summary = direct_summaries.get(source_ani_list_id) if source_ani_list_id else None
        entry = {
            "aniListId": ani_list_id,
            "sourceAniListId": source_ani_list_id or ani_list_id,
            "hasAnySources": bool(source_summary),
            "hasFrenchDub": bool(source_summary and source_summary.get("hasFrenchDub")),
            "languages": list(source_summary.get("languages", [])) if source_summary else [],
            "seasonCount": int(source_summary.get("seasonCount", 0)) if source_summary else 0,
            "episodeCount": int(source_summary.get("episodeCount", 0)) if source_summary else 0,
        }

        metadata_entry = metadata.get(ani_list_id, {})
        id_mal = parse_positive_int(metadata_entry.get("idMal"))
        if not id_mal:
            previous_entry = previous_entries.get(ani_list_id, {})
            id_mal = parse_positive_int(previous_entry.get("idMal"))
        if id_mal:
            entry["idMal"] = id_mal
            mal_to_ani_list[str(id_mal)] = ani_list_id

        by_ani_list_id[str(ani_list_id)] = entry

    return {
        "version": 1,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "malToAniList": dict(sorted(mal_to_ani_list.items(), key=lambda item: int(item[0]))),
        "byAniListId": by_ani_list_id,
    }


def main() -> int:
    if not DB_PATH.exists():
        raise SystemExit(f"Database not found: {DB_PATH}")

    previous_entries = load_previous_snapshot()
    with sqlite3.connect(DB_PATH) as conn:
        direct_summaries = load_direct_source_summaries(conn)
        ani_list_ids = load_all_anilist_ids(conn)

    log(f"Loaded {len(ani_list_ids)} AniList ids from database")
    log(f"Built direct source summaries for {len(direct_summaries)} AniList ids")

    metadata = fetch_all_anilist_metadata(ani_list_ids, previous_entries)
    snapshot = build_snapshot(ani_list_ids, direct_summaries, metadata, previous_entries)

    SNAPSHOT_PATH.write_text(json.dumps(snapshot, ensure_ascii=True, separators=(",", ":")), encoding="utf-8")
    log(
        "Wrote playback snapshot with "
        f"{len(snapshot['malToAniList'])} MAL mappings and {len(snapshot['byAniListId'])} AniList entries"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())