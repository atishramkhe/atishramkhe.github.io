import os
import requests
import json

apiKey = '792f6fa1e1c53d234af7859d10bdf833'
BASE_URL = "https://api.themoviedb.org/3"
IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500"
TRENDING_JSON_PATH = "titles/trending.json"
NEW_JSON_PATH = "titles/new.json"
POSTERS_DIR = "posters"

def fetch_trending(media_type):
    url = f"{BASE_URL}/trending/{media_type}/day"
    params = {"api_key": apiKey, "language": "en-US"}
    response = requests.get(url, params=params)
    response.raise_for_status()
    return response.json()["results"][:50]

def fetch_new(media_type):
    if media_type == "movie":
        url = f"{BASE_URL}/movie/now_playing"
    else:  # tv
        url = f"{BASE_URL}/tv/on_the_air"
    params = {"api_key": apiKey, "language": "en-US", "page": 1}
    response = requests.get(url, params=params)
    response.raise_for_status()
    return response.json()["results"][:50]

def fetch_details(media_type, tmdb_id):
    url = f"{BASE_URL}/{media_type}/{tmdb_id}"
    params = {"api_key": apiKey, "language": "en-US"}
    response = requests.get(url, params=params)
    response.raise_for_status()
    return response.json()

def download_poster(poster_path, filename):
    if not poster_path:
        return
    # Skip download if file already exists (and is non-empty) to preserve bandwidth
    if os.path.exists(filename) and os.path.getsize(filename) > 0:
        return
    url = f"{IMAGE_BASE_URL}{poster_path}"
    response = requests.get(url, stream=True)
    response.raise_for_status()
    with open(filename, "wb") as f:
        for chunk in response.iter_content(8192):
            if chunk:
                f.write(chunk)

def cleanup_unused_posters(used_paths):
    """Remove files in POSTERS_DIR that are not in used_paths (iterable of full paths)."""
    used = set(os.path.abspath(p) for p in used_paths)
    if not os.path.isdir(POSTERS_DIR):
        return
    for fname in os.listdir(POSTERS_DIR):
        full = os.path.abspath(os.path.join(POSTERS_DIR, fname))
        # only remove regular files
        if full not in used and os.path.isfile(full):
            try:
                os.remove(full)
                print(f"Removed unused poster: {full}")
            except Exception as e:
                print(f"Failed to remove {full}: {e}")

def fetch_top_bollywood():
    url = f"{BASE_URL}/discover/movie"
    params = {
        "api_key": apiKey,
        "sort_by": "popularity.desc",
        "with_original_language": "hi",  # Hindi
        "region": "IN",
        "page": 1
    }
    response = requests.get(url, params=params)
    response.raise_for_status()
    return response.json()["results"]

# New helper: fetch discover results by language for movie or tv
def fetch_top_by_language(media_type, language_code, region=None, page=1, count=50):
    endpoint = "discover/movie" if media_type == "movie" else "discover/tv"
    params = {
        "api_key": apiKey,
        "sort_by": "popularity.desc",
        "with_original_language": language_code,
        "page": page
    }
    if region:
        params["region"] = region
    response = requests.get(f"{BASE_URL}/{endpoint}", params=params)
    response.raise_for_status()
    return response.json().get("results", [])[:count]

def main():
    os.makedirs(os.path.dirname(TRENDING_JSON_PATH), exist_ok=True)
    os.makedirs(os.path.dirname(NEW_JSON_PATH), exist_ok=True)
    os.makedirs(POSTERS_DIR, exist_ok=True)
    os.makedirs("titles", exist_ok=True)

    trending = {"movies": [], "tv_shows": []}
    new_titles = {"movies": [], "tv_shows": []}

    # Trending Movies
    movies = fetch_trending("movie")
    for movie in movies:
        details = fetch_details("movie", movie["id"])
        details["media_type"] = "movie"
        trending["movies"].append(details)
        poster_path = details.get("poster_path")
        if poster_path:
            poster_filename = f"{POSTERS_DIR}/movie_{details['id']}.png"
            download_poster(poster_path, poster_filename)

    # Trending TV Shows
    tv_shows = fetch_trending("tv")
    for tv in tv_shows:
        details = fetch_details("tv", tv["id"])
        details["media_type"] = "tv"
        trending["tv_shows"].append(details)
        poster_path = details.get("poster_path")
        if poster_path:
            poster_filename = f"{POSTERS_DIR}/tv_{details['id']}.png"
            download_poster(poster_path, poster_filename)

    # New Movies
    new_movies = fetch_new("movie")
    for movie in new_movies:
        details = fetch_details("movie", movie["id"])
        details["media_type"] = "movie"
        new_titles["movies"].append(details)
        poster_path = details.get("poster_path")
        if poster_path:
            poster_filename = f"{POSTERS_DIR}/movie_{details['id']}.png"
            download_poster(poster_path, poster_filename)

    # New TV Shows
    new_tv_shows = fetch_new("tv")
    for tv in new_tv_shows:
        details = fetch_details("tv", tv["id"])
        details["media_type"] = "tv"
        # Skip if type is "Talk Show" or "Scripted"
        if details.get("type") in ("Talk Show", "Scripted"):
            continue
        new_titles["tv_shows"].append(details)
        poster_path = details.get("poster_path")
        if poster_path:
            poster_filename = f"{POSTERS_DIR}/tv_{details['id']}.png"
            download_poster(poster_path, poster_filename)

    # Bollywood Movies
    bollywood_movies = fetch_top_bollywood()
    bollywood_details = []
    for movie in bollywood_movies:
        details = fetch_details("movie", movie["id"])
        details["media_type"] = "movie"
        # Skip if already in trending or new titles
        if details in trending["movies"] or details in new_titles["movies"]:
            continue
        bollywood_details.append(details)
        poster_path = details.get("poster_path")
        if poster_path:
            poster_filename = f"{POSTERS_DIR}/movie_{details['id']}.png"
            download_poster(poster_path, poster_filename)

    # Save Bollywood movies to JSON
    with open("titles/bollywood.json", "w", encoding="utf-8") as f:
        json.dump({"movies": bollywood_details}, f, ensure_ascii=False, indent=2)

    # Korean dramas (K-dramas) — trending Korean TV shows with genre "Drama"
    # Rewritten K-dramas section:
    # Query TMDB discover/tv for original_language=ko + genre=Drama (id 18), sorted by popularity.
    # This returns many results (pages) so we loop pages until we collect the desired amount.
    def fetch_korean_drama_trending(count=50, max_pages=10):
        collected = []
        page = 1
        while len(collected) < count and page <= max_pages:
            params = {
                "api_key": apiKey,
                "with_original_language": "ko",
                "with_genres": "18",            # Drama (TV) genre id
                "sort_by": "popularity.desc",
                "page": page,
            }
            resp = requests.get(f"{BASE_URL}/discover/tv", params=params)
            resp.raise_for_status()
            results = resp.json().get("results", [])
            if not results:
                break
            collected.extend(results)
            page += 1
        return collected[:count]

    kdramas = {"movies": [], "tv_shows": []}
    seen_ids = set()

    # Get up to 50 trending Korean dramas via discover
    discovered_tvs = fetch_korean_drama_trending(count=50, max_pages=5)
    for tv in discovered_tvs:
        tid = tv.get("id")
        if not tid or tid in seen_ids:
            continue
        # fetch full details for reliable genre & language fields
        details = fetch_details("tv", tid)
        details["media_type"] = "tv"
        # double-check language == Korean and Drama genre present
        if details.get("original_language") != "ko":
            continue
        genres = details.get("genres") or []
        if not any((g.get("id") == 18) or (g.get("name", "").strip().lower() == "drama") for g in genres):
            continue
        seen_ids.add(tid)
        kdramas["tv_shows"].append(details)
        poster_path = details.get("poster_path")
        if poster_path:
            poster_filename = f"{POSTERS_DIR}/tv_{tid}.png"
            download_poster(poster_path, poster_filename)

    # Save K-dramas (trending Korean dramas) to JSON
    with open("titles/kdramas.json", "w", encoding="utf-8") as f:
        json.dump(kdramas, f, ensure_ascii=False, indent=2)

    # Save JSON files
    with open(TRENDING_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(trending, f, ensure_ascii=False, indent=2)
    with open(NEW_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(new_titles, f, ensure_ascii=False, indent=2)

    # Build set of poster paths that are still in use
    used_posters = set()
    for m in trending.get("movies", []) + new_titles.get("movies", []) + (bollywood_details or []):
        pid = m.get("id")
        if pid and m.get("poster_path"):
            used_posters.add(os.path.abspath(f"{POSTERS_DIR}/movie_{pid}.png"))
    for tv in trending.get("tv_shows", []) + new_titles.get("tv_shows", []) + kdramas.get("tv_shows", []):
        tid = tv.get("id")
        if tid and tv.get("poster_path"):
            used_posters.add(os.path.abspath(f"{POSTERS_DIR}/tv_{tid}.png"))

    # Remove posters not referenced by the current run (safe for automation / CI)
    cleanup_unused_posters(used_posters)

if __name__ == "__main__":
    main()