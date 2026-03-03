import os
import requests
import json
import time
from collections import defaultdict
from pathlib import Path

apiKey = '792f6fa1e1c53d234af7859d10bdf833'
BASE_URL = "https://api.themoviedb.org/3"
IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500"
TRENDING_JSON_PATH = "titles/trending.json"
NEW_JSON_PATH = "titles/new.json"
POSTERS_DIR = "posters"
CACHE_DIR = ".tmdb_cache"
CACHE_TTL = 86400  # 24 hours

# Rate limiting: TMDB allows ~40 requests/10 seconds = 4 requests/second max
REQUEST_DELAY = 0.3  # seconds between requests
last_request_time = 0

def ensure_cache_dir():
    """Ensure cache directory exists."""
    os.makedirs(CACHE_DIR, exist_ok=True)

def get_cache_path(key):
    """Get cache file path for a key."""
    return os.path.join(CACHE_DIR, f"{key}.json")

def is_cache_valid(cache_path):
    """Check if cache file exists and is recent."""
    if not os.path.exists(cache_path):
        return False
    age = time.time() - os.path.getmtime(cache_path)
    return age < CACHE_TTL

def read_cache(key):
    """Read from cache if valid."""
    cache_path = get_cache_path(key)
    if is_cache_valid(cache_path):
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            return None
    return None

def write_cache(key, data):
    """Write data to cache."""
    ensure_cache_dir()
    cache_path = get_cache_path(key)
    try:
        with open(cache_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False)
    except:
        pass

def rate_limited_request(url, params):
    """Make HTTP request with rate limiting."""
    global last_request_time
    elapsed = time.time() - last_request_time
    if elapsed < REQUEST_DELAY:
        time.sleep(REQUEST_DELAY - elapsed)
    
    last_request_time = time.time()
    response = requests.get(url, params=params, timeout=10)
    response.raise_for_status()
    return response.json()

def fetch_trending(media_type):
    """Fetch trending titles with caching."""
    cache_key = f"trending_{media_type}"
    cached = read_cache(cache_key)
    if cached:
        print(f"✓ Trending {media_type} loaded from cache")
        return cached
    
    url = f"{BASE_URL}/trending/{media_type}/day"
    params = {"api_key": apiKey, "language": "en-US"}
    data = rate_limited_request(url, params)
    results = data.get("results", [])[:50]
    write_cache(cache_key, results)
    return results

def fetch_new(media_type):
    """Fetch new titles with caching."""
    cache_key = f"new_{media_type}"
    cached = read_cache(cache_key)
    if cached:
        print(f"✓ New {media_type} loaded from cache")
        return cached
    
    if media_type == "movie":
        url = f"{BASE_URL}/movie/now_playing"
    else:  # tv
        url = f"{BASE_URL}/tv/on_the_air"
    params = {"api_key": apiKey, "language": "en-US", "page": 1}
    data = rate_limited_request(url, params)
    results = data.get("results", [])[:50]
    write_cache(cache_key, results)
    return results

def fetch_details(media_type, tmdb_id):
    """Fetch details with caching to avoid duplicate requests."""
    cache_key = f"details_{media_type}_{tmdb_id}"
    cached = read_cache(cache_key)
    if cached:
        return cached
    
    url = f"{BASE_URL}/{media_type}/{tmdb_id}"
    params = {"api_key": apiKey, "language": "en-US"}
    data = rate_limited_request(url, params)
    write_cache(cache_key, data)
    return data

def download_poster(poster_path, filename):
    """Download poster if not already present."""
    if not poster_path:
        return
    # Skip download if file already exists and is non-empty
    if os.path.exists(filename) and os.path.getsize(filename) > 0:
        return
    url = f"{IMAGE_BASE_URL}{poster_path}"
    response = requests.get(url, stream=True, timeout=10)
    response.raise_for_status()
    with open(filename, "wb") as f:
        for chunk in response.iter_content(8192):
            if chunk:
                f.write(chunk)

def cleanup_unused_posters(used_paths):
    """Remove files in POSTERS_DIR that are not in used_paths."""
    used = set(os.path.abspath(p) for p in used_paths)
    if not os.path.isdir(POSTERS_DIR):
        return
    for fname in os.listdir(POSTERS_DIR):
        full = os.path.abspath(os.path.join(POSTERS_DIR, fname))
        if full not in used and os.path.isfile(full):
            try:
                os.remove(full)
                print(f"Removed unused poster: {full}")
            except Exception as e:
                print(f"Failed to remove {full}: {e}")

def fetch_top_bollywood():
    """Fetch Bollywood movies (Hindi language)."""
    cache_key = "bollywood_movies"
    cached = read_cache(cache_key)
    if cached:
        print("✓ Bollywood movies loaded from cache")
        return cached
    
    url = f"{BASE_URL}/discover/movie"
    all_results = []
    for page in (1, 2):
        params = {
            "api_key": apiKey,
            "sort_by": "popularity.desc",
            "with_original_language": "hi",
            "region": "IN",
            "page": page,
            "primary_release_date.gte": "2010-01-01",
        }
        data = rate_limited_request(url, params)
        all_results.extend(data.get("results", []))
    write_cache(cache_key, all_results)
    return all_results

def fetch_top_by_language(media_type, language_code, region=None, page=1, count=50):
    """Fetch titles by language with caching."""
    cache_key = f"{media_type}_{language_code}_{region}_p{page}"
    cached = read_cache(cache_key)
    if cached:
        return cached
    
    endpoint = "discover/movie" if media_type == "movie" else "discover/tv"
    params = {
        "api_key": apiKey,
        "sort_by": "popularity.desc",
        "with_original_language": language_code,
        "page": page
    }
    if region:
        params["region"] = region
    
    data = rate_limited_request(f"{BASE_URL}/{endpoint}", params)
    results = data.get("results", [])[:count]
    write_cache(cache_key, results)
    return results

def fetch_korean_drama_trending(count=50, max_pages=10):
    """Fetch Korean dramas with caching."""
    cache_key = "korean_dramas"
    cached = read_cache(cache_key)
    if cached:
        print("✓ Korean dramas loaded from cache")
        return cached
    
    collected = []
    page = 1
    while len(collected) < count and page <= max_pages:
        params = {
            "api_key": apiKey,
            "with_original_language": "ko",
            "with_genres": "18",  # Drama
            "sort_by": "popularity.desc",
            "page": page,
        }
        data = rate_limited_request(f"{BASE_URL}/discover/tv", params)
        results = data.get("results", [])
        if not results:
            break
        collected.extend(results)
        page += 1
    
    result = collected[:count]
    write_cache(cache_key, result)
    return result

def fetch_trending_by_genre(genre_id, count=50, max_pages=5):
    """Batch fetch movies by genre with better resource management."""
    cache_key = f"genre_{genre_id}"
    cached = read_cache(cache_key)
    if cached:
        return cached
    
    collected = []
    page = 1
    while len(collected) < count and page <= max_pages:
        params = {
            "api_key": apiKey,
            "with_genres": str(genre_id),
            "sort_by": "popularity.desc",
            "language": "en-US",
            "page": page,
        }
        data = rate_limited_request(f"{BASE_URL}/discover/movie", params)
        results = data.get("results", [])
        if not results:
            break
        collected.extend(results)
        page += 1
    
    result = collected[:count]
    write_cache(cache_key, result)
    return result

def build_genre_list(genre_id, genre_name, count=50, max_pages=5):
    """Build a genre list, fetching full details with deduplication."""
    movies = []
    seen_ids = set()
    trending = fetch_trending_by_genre(genre_id, count=count, max_pages=max_pages)
    
    for movie in trending:
        mid = movie.get("id")
        if not mid or mid in seen_ids:
            continue
        
        details = fetch_details("movie", mid)
        details["media_type"] = "movie"
        
        # Verify genre
        genres = details.get("genres") or []
        if not any(
            (g.get("id") == genre_id) or
            (g.get("name", "").strip().lower() == genre_name) 
            for g in genres
        ):
            continue
        
        seen_ids.add(mid)
        movies.append(details)
        poster_path = details.get("poster_path")
        if poster_path:
            poster_filename = f"{POSTERS_DIR}/movie_{mid}.png"
            download_poster(poster_path, poster_filename)
        
        # Progress indicator
        if len(movies) % 10 == 0:
            print(f"  ... fetched {len(movies)}/{count} {genre_name} movies")
    
    return movies

def main():
    print("[TMDB Data Pipeline] Starting collection...\n")
    
    os.makedirs(os.path.dirname(TRENDING_JSON_PATH), exist_ok=True)
    os.makedirs(os.path.dirname(NEW_JSON_PATH), exist_ok=True)
    os.makedirs(POSTERS_DIR, exist_ok=True)
    os.makedirs("titles", exist_ok=True)
    ensure_cache_dir()

    all_collected_data = {"movies": [], "tv_shows": []}
    used_posters = set()

    # === TRENDING ===
    print("Fetching Trending...")
    trending = {"movies": [], "tv_shows": []}
    
    # Trending Movies
    movies = fetch_trending("movie")
    for i, movie in enumerate(movies):
        details = fetch_details("movie", movie["id"])
        details["media_type"] = "movie"
        trending["movies"].append(details)
        poster_path = details.get("poster_path")
        if poster_path:
            poster_filename = f"{POSTERS_DIR}/movie_{details['id']}.png"
            download_poster(poster_path, poster_filename)
            used_posters.add(os.path.abspath(poster_filename))

    # Trending TV Shows
    tv_shows = fetch_trending("tv")
    for i, tv in enumerate(tv_shows):
        details = fetch_details("tv", tv["id"])
        details["media_type"] = "tv"
        trending["tv_shows"].append(details)
        poster_path = details.get("poster_path")
        if poster_path:
            poster_filename = f"{POSTERS_DIR}/tv_{details['id']}.png"
            download_poster(poster_path, poster_filename)
            used_posters.add(os.path.abspath(poster_filename))

    with open(TRENDING_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(trending, f, ensure_ascii=False, indent=2)
    print(f"✓ Saved {len(trending['movies'])} movies + {len(trending['tv_shows'])} TV shows to trending.json\n")

    # === NEW RELEASES ===
    print("Fetching New Releases...")
    new_titles = {"movies": [], "tv_shows": []}

    new_movies = fetch_new("movie")
    for movie in new_movies:
        details = fetch_details("movie", movie["id"])
        details["media_type"] = "movie"
        new_titles["movies"].append(details)
        poster_path = details.get("poster_path")
        if poster_path:
            poster_filename = f"{POSTERS_DIR}/movie_{details['id']}.png"
            download_poster(poster_path, poster_filename)
            used_posters.add(os.path.abspath(poster_filename))

    new_tv_shows = fetch_new("tv")
    for tv in new_tv_shows:
        details = fetch_details("tv", tv["id"])
        details["media_type"] = "tv"
        if details.get("type") in ("Talk Show", "Scripted"):
            continue
        new_titles["tv_shows"].append(details)
        poster_path = details.get("poster_path")
        if poster_path:
            poster_filename = f"{POSTERS_DIR}/tv_{details['id']}.png"
            download_poster(poster_path, poster_filename)
            used_posters.add(os.path.abspath(poster_filename))

    with open(NEW_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(new_titles, f, ensure_ascii=False, indent=2)
    print(f"✓ Saved {len(new_titles['movies'])} movies + {len(new_titles['tv_shows'])} TV shows to new.json\n")

    # === GENRE-BASED COLLECTIONS ===
    print("Fetching Genre-based Collections...")
    genres = [
        (28, "action", "action"),
        (14, "fantasy", "fantasy"),
        (18, "drama", "drama"),
        (53, "thriller", "thriller"),
        (12, "adventure", "adventure"),
        (10749, "romance", "romance"),
        (878, "scifi", "science fiction"),
        (10751, "family", "family"),
        (16, "animation", "animation"),
        (35, "comedy", "comedy"),
        (80, "crime", "crime"),
        (27, "horror", "horror"),
    ]

    for genre_id, filename, genre_name in genres:
        print(f"  Fetching {genre_name}...")
        genre_movies = build_genre_list(genre_id, genre_name, count=50, max_pages=5)
        
        with open(f"titles/{filename}.json", "w", encoding="utf-8") as f:
            json.dump({"movies": genre_movies}, f, ensure_ascii=False, indent=2)
        print(f"  ✓ Saved {len(genre_movies)} {genre_name} movies")
        
        for m in genre_movies:
            mid = m.get("id")
            if mid and m.get("poster_path"):
                used_posters.add(os.path.abspath(f"{POSTERS_DIR}/movie_{mid}.png"))

    # === BOLLYWOOD ===
    print("\nFetching Bollywood...")
    bollywood_movies = fetch_top_bollywood()
    bollywood_details = []
    seen_ids = set()
    for movie in bollywood_movies:
        mid = movie.get("id")
        if not mid or mid in seen_ids:
            continue
        details = fetch_details("movie", mid)
        details["media_type"] = "movie"
        bollywood_details.append(details)
        seen_ids.add(mid)
        poster_path = details.get("poster_path")
        if poster_path:
            poster_filename = f"{POSTERS_DIR}/movie_{mid}.png"
            download_poster(poster_path, poster_filename)
            used_posters.add(os.path.abspath(poster_filename))

    with open("titles/bollywood.json", "w", encoding="utf-8") as f:
        json.dump({"movies": bollywood_details}, f, ensure_ascii=False, indent=2)
    print(f"✓ Saved {len(bollywood_details)} Bollywood movies\n")

    # === KOREAN DRAMAS ===
    print("Fetching K-Dramas...")
    kdramas = {"movies": [], "tv_shows": []}
    seen_ids = set()
    discovered_tvs = fetch_korean_drama_trending(count=50, max_pages=5)
    
    for tv in discovered_tvs:
        tid = tv.get("id")
        if not tid or tid in seen_ids:
            continue
        details = fetch_details("tv", tid)
        details["media_type"] = "tv"
        if details.get("original_language") != "ko":
            continue
        genres = details.get("genres") or []
        if not any(
            (g.get("id") == 18) or (g.get("name", "").strip().lower() == "drama")
            for g in genres
        ):
            continue
        seen_ids.add(tid)
        kdramas["tv_shows"].append(details)
        poster_path = details.get("poster_path")
        if poster_path:
            poster_filename = f"{POSTERS_DIR}/tv_{tid}.png"
            download_poster(poster_path, poster_filename)
            used_posters.add(os.path.abspath(poster_filename))

    with open("titles/kdramas.json", "w", encoding="utf-8") as f:
        json.dump(kdramas, f, ensure_ascii=False, indent=2)
    print(f"✓ Saved {len(kdramas['tv_shows'])} K-Dramas\n")

    # === COUNTRY-BASED COLLECTIONS ===
    print("Fetching Country-based Collections...")
    country_configs = [
        {"name": "china", "lang": "zh", "region": "CN"},
        {"name": "taiwan", "lang": "zh", "region": "TW"},
        {"name": "philippines", "lang": "tl", "region": "PH"},
        {"name": "japan", "lang": "ja", "region": "JP"},
        {"name": "hongkong", "lang": "zh", "region": "HK"},
        {"name": "thailand", "lang": "th", "region": "TH"},
    ]

    for config in country_configs:
        print(f"  Fetching {config['name']}...")
        country_data = {"movies": [], "tv_shows": []}
        pages = 5 if config["name"] == "japan" else 1

        # Movies
        for page in range(1, pages + 1):
            movies = fetch_top_by_language("movie", config["lang"], region=config["region"], page=page, count=50)
            for movie in movies:
                details = fetch_details("movie", movie["id"])
                details["media_type"] = "movie"
                
                if config["name"] == "japan":
                    if details.get("adult"):
                        continue
                    genres = details.get("genres") or []
                    if any((g.get("id") == 16) for g in genres):
                        continue
                
                country_data["movies"].append(details)
                poster_path = details.get("poster_path")
                if poster_path:
                    poster_filename = f"{POSTERS_DIR}/movie_{details['id']}.png"
                    download_poster(poster_path, poster_filename)
                    used_posters.add(os.path.abspath(poster_filename))

        # TV Shows
        for page in range(1, pages + 1):
            tv_shows = fetch_top_by_language("tv", config["lang"], region=config["region"], page=page, count=50)
            for tv in tv_shows:
                details = fetch_details("tv", tv["id"])
                details["media_type"] = "tv"
                
                if config["name"] == "japan":
                    if details.get("adult"):
                        continue
                    genres = details.get("genres") or []
                    if any((g.get("id") == 16) for g in genres):
                        continue
                
                country_data["tv_shows"].append(details)
                poster_path = details.get("poster_path")
                if poster_path:
                    poster_filename = f"{POSTERS_DIR}/tv_{details['id']}.png"
                    download_poster(poster_path, poster_filename)
                    used_posters.add(os.path.abspath(poster_filename))

        with open(f"titles/{config['name']}.json", "w", encoding="utf-8") as f:
            json.dump(country_data, f, ensure_ascii=False, indent=2)
        print(f"  ✓ Saved {len(country_data['movies'])} movies + {len(country_data['tv_shows'])} TV shows for {config['name']}")

    # === CLEANUP ===
    print("\nCleaning up unused posters...")
    cleanup_unused_posters(used_posters)
    
    print("\n[TMDB Data Pipeline] ✓ Collection complete!")

if __name__ == "__main__":
    main()
