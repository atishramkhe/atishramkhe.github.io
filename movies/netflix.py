import os
import json
import requests
from bs4 import BeautifulSoup

# Reuse helpers and constants from tmdb.py
from tmdb import (
    search_tmdb_by_title,
    download_poster,
    POSTERS_DIR,
)

TITLES_DIR = "titles"
NETFLIX_FRANCE_JSON = os.path.join(TITLES_DIR, "netflixfrance.json")

MOVIES_URL = "https://www.netflix.com/tudum/top10/france"
TV_URL = "https://www.netflix.com/tudum/top10/france/tv"


def scrape_netflix_tudum_top10(url: str, max_items: int = 10, is_tv: bool = False) -> list[str]:
    """
    Scrape a Netflix Tudum top 10 page and return a list of clean title strings.

    For movies: returns the button text as-is.
    For TV: strips trailing "Season X" / ": Season X" / "Saison X" in English/French.
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0 Safari/537.36"
        )
    }
    resp = requests.get(url, headers=headers, timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    titles: list[str] = []

    # The real title is inside:
    # <td class="title" data-uia="top10-table-row-title">
    #   ...
    #   <button>Frankenstein</button>
    # </td>
    for td in soup.select('td.title[data-uia="top10-table-row-title"] button'):
        raw = (td.get_text() or "").strip()
        if not raw:
            continue

        text = raw

        if is_tv:
            # Remove "Season X" or ": Season X" (English / French variants)
            # and "Limited Series" labels.
            # Examples:
            #  "Rhythm + Flow France: Season 4"      -> "Rhythm + Flow France"
            #  "Rhythm + Flow France: Saison 4"      -> "Rhythm + Flow France"
            #  "Rhythm + Flow France Season 4"       -> "Rhythm + Flow France"
            #  "Heweliusz: Limited Series"           -> "Heweliusz"
            #  "Death by Lightning: Limited Series"  -> "Death by Lightning"
            import re

            # Strip things like ": Season 4", ": Saison 4"
            text = re.sub(
                r'[:\-]\s*(Season|Saison)\s+\d+\s*$',
                "",
                text,
                flags=re.IGNORECASE,
            )
            # Strip bare "Season 4" / "Saison 4" at the end
            text = re.sub(
                r'\s*(Season|Saison)\s+\d+\s*$',
                "",
                text,
                flags=re.IGNORECASE,
            )
            # Strip ": Limited Series" (and similar)
            text = re.sub(
                r'[:\-]\s*Limited Series\s*$',
                "",
                text,
                flags=re.IGNORECASE,
            )
            # In case it's just "Limited Series" at the end without punctuation
            text = re.sub(
                r'\s*Limited Series\s*$',
                "",
                text,
                flags=re.IGNORECASE,
            )

            text = text.strip()

        if text and text not in titles:
            titles.append(text)

        if len(titles) >= max_items:
            break

    return titles[:max_items]


def build_netflix_france_top10() -> dict:
    """
    Scrape Netflix Tudum France Top 10 (movies & TV), resolve each title on TMDB,
    download posters, and return:
    {
      "movies": [movie_details...],
      "tv_shows": [tv_details...]
    }
    """
    os.makedirs(TITLES_DIR, exist_ok=True)
    os.makedirs(POSTERS_DIR, exist_ok=True)

    netflixfr = {"movies": [], "tv_shows": []}

    # Movies page
    movie_titles = scrape_netflix_tudum_top10(MOVIES_URL, max_items=10)
    print(f"Found {len(movie_titles)} movie titles on Tudum France.")
    for title in movie_titles:
        try:
            details = search_tmdb_by_title(title, media_type="movie")
            if not details:
                print(f"[NetflixFR] Movie not found on TMDB: {title}")
                continue
            details["media_type"] = "movie"
            netflixfr["movies"].append(details)
            poster_path = details.get("poster_path")
            if poster_path:
                fname = f"{POSTERS_DIR}/movie_{details['id']}.png"
                download_poster(poster_path, fname)
        except Exception as e:
            print(f"[NetflixFR] Error searching movie '{title}': {e}")

    # TV page
    tv_titles = scrape_netflix_tudum_top10(TV_URL, max_items=10, is_tv=True)
    print(f"Found {len(tv_titles)} TV titles on Tudum France.")
    for title in tv_titles:
        try:
            details = search_tmdb_by_title(title, media_type="tv")
            if not details:
                print(f"[NetflixFR] TV show not found on TMDB: {title}")
                continue
            details["media_type"] = "tv"
            netflixfr["tv_shows"].append(details)
            poster_path = details.get("poster_path")
            if poster_path:
                fname = f"{POSTERS_DIR}/tv_{details['id']}.png"
                download_poster(poster_path, fname)
        except Exception as e:
            print(f"[NetflixFR] Error searching TV '{title}': {e}")

    return netflixfr


def main() -> None:
    data = build_netflix_france_top10()
    with open(NETFLIX_FRANCE_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Wrote Netflix France Top 10 to {NETFLIX_FRANCE_JSON}")


if __name__ == "__main__":
    main()
