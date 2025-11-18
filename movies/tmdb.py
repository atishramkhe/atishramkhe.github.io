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
    # Fetch popular Hindi-language movies from 2010 onwards, pages 1 and 2
    url = f"{BASE_URL}/discover/movie"
    all_results = []
    for page in (1, 2):
        params = {
            "api_key": apiKey,
            "sort_by": "popularity.desc",
            "with_original_language": "hi",  # Hindi
            "region": "IN",
            "page": page,
            "primary_release_date.gte": "2010-01-01",  # Only movies from 2010 onwards
        }
        response = requests.get(url, params=params)
        response.raise_for_status()
        page_results = response.json().get("results", [])
        all_results.extend(page_results)
    return all_results

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

def search_tmdb_by_title(title, media_type="movie"):
    """Search TMDB for a title and return the best match's details."""
    url = f"{BASE_URL}/search/{media_type}"
    params = {"api_key": apiKey, "query": title, "language": "en-US"}
    resp = requests.get(url, params=params)
    resp.raise_for_status()
    results = resp.json().get("results", [])
    if not results and media_type == "movie":
        # Try TV if not found as movie
        return search_tmdb_by_title(title, media_type="tv")
    if results:
        # Return full details for the best match
        best = results[0]
        return fetch_details(media_type, best["id"])
    return None

def fetch_tmdb_list(list_id):
    """Fetch a TMDB public list by its ID."""
    url = f"{BASE_URL}/list/{list_id}"
    params = {"api_key": apiKey, "language": "en-US"}
    resp = requests.get(url, params=params)
    resp.raise_for_status()
    return resp.json().get("items", [])

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

    # Trending Horror Movies
    def fetch_trending_horror(count=50, max_pages=5):
        collected = []
        page = 1
        while len(collected) < count and page <= max_pages:
            params = {
                "api_key": apiKey,
                "with_genres": "27",  # Horror
                "sort_by": "popularity.desc",
                "language": "en-US",
                "page": page,
            }
            resp = requests.get(f"{BASE_URL}/discover/movie", params=params)
            resp.raise_for_status()
            results = resp.json().get("results", [])
            if not results:
                break
            collected.extend(results)
            page += 1
        return collected[:count]

    horror_movies = []
    seen_horror_ids = set()
    trending_horror = fetch_trending_horror(count=50, max_pages=5)
    for movie in trending_horror:
        mid = movie.get("id")
        if not mid or mid in seen_horror_ids:
            continue
        details = fetch_details("movie", mid)
        details["media_type"] = "movie"
        genres = details.get("genres") or []
        if not any((g.get("id") == 27) or (g.get("name", "").strip().lower() == "horror") for g in genres):
            continue
        seen_horror_ids.add(mid)
        horror_movies.append(details)
        poster_path = details.get("poster_path")
        if poster_path:
            poster_filename = f"{POSTERS_DIR}/movie_{mid}.png"
            download_poster(poster_path, poster_filename)

    with open("titles/horror.json", "w", encoding="utf-8") as f:
        json.dump({"movies": horror_movies}, f, ensure_ascii=False, indent=2)

    # Generic helper to reduce repetition for genre-based lists
    def fetch_trending_by_genre(genre_id, count=50, max_pages=5):
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
            resp = requests.get(f"{BASE_URL}/discover/movie", params=params)
            resp.raise_for_status()
            results = resp.json().get("results", [])
            if not results:
                break
            collected.extend(results)
            page += 1
        return collected[:count]

    def build_genre_list(genre_id, genre_key_name, count=50, max_pages=5):
        movies = []
        seen_ids = set()
        trending = fetch_trending_by_genre(genre_id, count=count, max_pages=max_pages)
        for movie in trending:
            mid = movie.get("id")
            if not mid or mid in seen_ids:
                continue
            details = fetch_details("movie", mid)
            details["media_type"] = "movie"
            genres = details.get("genres") or []
            # double-check genre id or name
            if not any(
                (g.get("id") == genre_id)
                or (g.get("name", "").strip().lower() == genre_key_name)
                for g in genres
            ):
                continue
            seen_ids.add(mid)
            movies.append(details)
            poster_path = details.get("poster_path")
            if poster_path:
                poster_filename = f"{POSTERS_DIR}/movie_{mid}.png"
                download_poster(poster_path, poster_filename)
        return movies

    # Build each genre set
    action_movies = build_genre_list(28, "action")
    fantasy_movies = build_genre_list(14, "fantasy")
    drama_movies = build_genre_list(18, "drama")
    thriller_movies = build_genre_list(53, "thriller")
    adventure_movies = build_genre_list(12, "adventure")
    romance_movies = build_genre_list(10749, "romance")
    scifi_movies = build_genre_list(878, "science fiction")  # "Science Fiction"
    family_movies = build_genre_list(10751, "family")
    crime_movies = build_genre_list(80, "crime")
    comedy_movies = build_genre_list(35, "comedy")

    # Trending Animation Movies (kept as-is but can also use the generic helper)
    def fetch_trending_animation(count=50, max_pages=5):
        collected = []
        page = 1
        while len(collected) < count and page <= max_pages:
            params = {
                "api_key": apiKey,
                "with_genres": "16",  # Animation
                "sort_by": "popularity.desc",
                "language": "en-US",
                "page": page,
            }
            resp = requests.get(f"{BASE_URL}/discover/movie", params=params)
            resp.raise_for_status()
            results = resp.json().get("results", [])
            if not results:
                break
            collected.extend(results)
            page += 1
        return collected[:count]

    animation_movies = []
    seen_animation_ids = set()
    trending_animation = fetch_trending_animation(count=50, max_pages=5)
    for movie in trending_animation:
        mid = movie.get("id")
        if not mid or mid in seen_animation_ids:
            continue
        details = fetch_details("movie", mid)
        details["media_type"] = "movie"
        genres = details.get("genres") or []
        if not any((g.get("id") == 16) or (g.get("name", "").strip().lower() == "animation") for g in genres):
            continue
        seen_animation_ids.add(mid)
        animation_movies.append(details)
        poster_path = details.get("poster_path")
        if poster_path:
            poster_filename = f"{POSTERS_DIR}/movie_{mid}.png"
            download_poster(poster_path, poster_filename)
        else:
            print(f"No poster for animation movie: {details.get('title', details.get('name', 'Unknown'))} (ID: {mid})")

    # Save each genre list to its own JSON
    with open("titles/animation.json", "w", encoding="utf-8") as f:
        json.dump({"movies": animation_movies}, f, ensure_ascii=False, indent=2)
    with open("titles/action.json", "w", encoding="utf-8") as f:
        json.dump({"movies": action_movies}, f, ensure_ascii=False, indent=2)
    with open("titles/fantasy.json", "w", encoding="utf-8") as f:
        json.dump({"movies": fantasy_movies}, f, ensure_ascii=False, indent=2)
    with open("titles/drama.json", "w", encoding="utf-8") as f:
        json.dump({"movies": drama_movies}, f, ensure_ascii=False, indent=2)
    with open("titles/thriller.json", "w", encoding="utf-8") as f:
        json.dump({"movies": thriller_movies}, f, ensure_ascii=False, indent=2)
    with open("titles/adventure.json", "w", encoding="utf-8") as f:
        json.dump({"movies": adventure_movies}, f, ensure_ascii=False, indent=2)
    with open("titles/romance.json", "w", encoding="utf-8") as f:
        json.dump({"movies": romance_movies}, f, ensure_ascii=False, indent=2)
    with open("titles/scifi.json", "w", encoding="utf-8") as f:
        json.dump({"movies": scifi_movies}, f, ensure_ascii=False, indent=2)
    with open("titles/family.json", "w", encoding="utf-8") as f:
        json.dump({"movies": family_movies}, f, ensure_ascii=False, indent=2)
    with open("titles/crime.json", "w", encoding="utf-8") as f:
        json.dump({"movies": crime_movies}, f, ensure_ascii=False, indent=2)
    with open("titles/comedy.json", "w", encoding="utf-8") as f:
        json.dump({"movies": comedy_movies}, f, ensure_ascii=False, indent=2)

    # Build set of poster paths that are still in use
    used_posters = set()
    for m in (
        trending.get("movies", [])
        + new_titles.get("movies", [])
        + (bollywood_details or [])
        + horror_movies
        + animation_movies
        + action_movies
        + fantasy_movies
        + drama_movies
        + thriller_movies
        + adventure_movies
        + romance_movies
        + scifi_movies
        + family_movies
        + crime_movies
        + comedy_movies
        + (netflix_xmas.get("movies", []) if 'netflix_xmas' in locals() else [])
        + (netflix_xmas.get("tv_shows", []) if 'netflix_xmas' in locals() else [])
        + (best_xmas.get("movies", []) if 'best_xmas' in locals() else [])
        + (best_xmas.get("tv_shows", []) if 'best_xmas' in locals() else [])
    ):
        pid = m.get("id")
        if pid and m.get("poster_path"):
            used_posters.add(os.path.abspath(f"{POSTERS_DIR}/movie_{pid}.png"))

    for tv in (
        trending.get("tv_shows", [])
        + new_titles.get("tv_shows", [])
        + kdramas.get("tv_shows", [])
        + (netflix_xmas.get("tv_shows", []) if 'netflix_xmas' in locals() else [])
        + (best_xmas.get("tv_shows", []) if 'best_xmas' in locals() else [])
    ):
        tid = tv.get("id")
        if tid and tv.get("poster_path"):
            used_posters.add(os.path.abspath(f"{POSTERS_DIR}/tv_{tid}.png"))

    # Country codes and TMDB language codes
    country_configs = [
        {"name": "china", "lang": "zh", "region": "CN"},
        {"name": "taiwan", "lang": "zh", "region": "TW"},
        {"name": "philippines", "lang": "tl", "region": "PH"},
        {"name": "japan", "lang": "ja", "region": "JP"},
        {"name": "hongkong", "lang": "zh", "region": "HK"},
        {"name": "thailand", "lang": "th", "region": "TH"},
        {"name": "france", "lang": "fr", "region": "FR"}, # Added France
    ]
    
    for config in country_configs:
        country_data = {"movies": [], "tv_shows": []}
        # For Japan, fetch 5 pages; others fetch 1 page
        pages = 5 if config["name"] == "japan" else 1

        # Movies
        for page in range(1, pages + 1):
            movies = fetch_top_by_language("movie", config["lang"], region=config["region"], page=page, count=50)
            for movie in movies:
                details = fetch_details("movie", movie["id"])
                details["media_type"] = "movie"
                # Exclude animation and adult for Japan
                if config["name"] == "japan":
                    if details.get("adult"):
                        continue
                    genres = details.get("genres") or []
                    if any((g.get("id") == 16) or (g.get("name", "").strip().lower() == "animation") for g in genres):
                        continue
                country_data["movies"].append(details)
                poster_path = details.get("poster_path")
                if poster_path:
                    poster_filename = f"{POSTERS_DIR}/movie_{details['id']}.png"
                    download_poster(poster_path, poster_filename)

        # TV Shows
        for page in range(1, pages + 1):
            tv_shows = fetch_top_by_language("tv", config["lang"], region=config["region"], page=page, count=50)
            for tv in tv_shows:
                details = fetch_details("tv", tv["id"])
                details["media_type"] = "tv"
                # Exclude animation and adult for Japan
                if config["name"] == "japan":
                    if details.get("adult"):
                        continue
                    genres = details.get("genres") or []
                    if any((g.get("id") == 16) or (g.get("name", "").strip().lower() == "animation") for g in genres):
                        continue
                country_data["tv_shows"].append(details)
                poster_path = details.get("poster_path")
                if poster_path:
                    poster_filename = f"{POSTERS_DIR}/tv_{details['id']}.png"
                    download_poster(poster_path, poster_filename)

        # Save to JSON
        with open(f"titles/{config['name']}.json", "w", encoding="utf-8") as f:
            json.dump(country_data, f, ensure_ascii=False, indent=2)

    # Netflix XMas 2025 titles
    netflix_xmas_titles_and_ids = [
        ("A Very Vintage Christmas", 626282, "movie"),
        ("Dear Santa", 1097870, "movie"),
        ("Happy Christmas", 244534, "movie"),
        ("Merry Liddle Christmas", 627475, "movie"),
        ("Tyler Perry's A Madea Christmas", 175555, "movie"),
        ("A Holiday Engagement", 82099, "movie"),
        ("Christmas in the Heartland", 485612, "movie"),
        ("My Dad's Christmas Date", 754053, "movie"),
        ("Ghosting: The Spirit of Christmas", 646732, "movie"),
        ("No Sleep 'Til Christmas", 550097, "movie"),
        ("Same Time, Next Christmas", 639422, "movie"),
        ("A Merry Little Ex-Mas", 1401318, "movie"),
        ("A Royal Date for Christmas", 1142780, "movie"),
        ("A Sprinkle of Christmas", 1359604, "movie"),
        ("A Vineyard Christmas", 1166824, "movie"),
        ("Becoming Santa", 367541, "movie"),
        ("Christmas Casanova", 1134596, "movie"),
        ("Just Like a Christmas Movie", 1155086, "movie"),
        ("Meet Me at the Christmas Train Parade", 1180406, "movie"),
        ("Royally Yours, This Christmas", 1053725, "movie"),
        ("Champagne Problems", 1323475, "movie"),
        ("The Great British Baking Show: Holidays", 215598, "tv"),
        ("Marry Christmas", 1388409, "movie"),
        ("Mistletoe Mixup", 911758, "movie"),
        ("Santa Bootcamp", 1012286, "movie"),
        ("Is It Cake? Holiday", 275144, "tv"),
        ("Jingle Bell Heist", 1218762, "movie")
    ]

    netflix_xmas = {"movies": [], "tv_shows": []}
    for title, tmdb_id, media_type in netflix_xmas_titles_and_ids:
        details = None
        try:
            details = fetch_details(media_type, tmdb_id)
            details["media_type"] = media_type
            if media_type == "movie":
                netflix_xmas["movies"].append(details)
                poster_path = details.get("poster_path")
                if poster_path:
                    poster_filename = f"{POSTERS_DIR}/movie_{tmdb_id}.png"
                    download_poster(poster_path, poster_filename)
            else:
                netflix_xmas["tv_shows"].append(details)
                poster_path = details.get("poster_path")
                if poster_path:
                    poster_filename = f"{POSTERS_DIR}/tv_{tmdb_id}.png"
                    download_poster(poster_path, poster_filename)
        except Exception:
            print(f"Not found on TMDB: {title} ({tmdb_id}, {media_type})")

    with open("titles/netflix_xmas_2025.json", "w", encoding="utf-8") as f:
        json.dump(netflix_xmas, f, ensure_ascii=False, indent=2)

    # The Best of Xmas (TMDB list 5915)
    best_xmas_items = fetch_tmdb_list(5915)
    best_xmas = {"movies": [], "tv_shows": []}
    for item in best_xmas_items:
        mtype = item.get("media_type", "movie")
        details = fetch_details(mtype, item["id"])
        details["media_type"] = mtype
        if mtype == "movie":
            best_xmas["movies"].append(details)
            poster_path = details.get("poster_path")
            if poster_path:
                poster_filename = f"{POSTERS_DIR}/movie_{details['id']}.png"
                download_poster(poster_path, poster_filename)
        else:
            best_xmas["tv_shows"].append(details)
            poster_path = details.get("poster_path")
            if poster_path:
                poster_filename = f"{POSTERS_DIR}/tv_{details['id']}.png"
                download_poster(poster_path, poster_filename)

    with open("titles/best_xmas.json", "w", encoding="utf-8") as f:
        json.dump(best_xmas, f, ensure_ascii=False, indent=2)

    # Build set of poster paths that are still in use
    used_posters = set()
    for m in (
        trending.get("movies", [])
        + new_titles.get("movies", [])
        + (bollywood_details or [])
        + horror_movies
        + animation_movies
        + action_movies
        + fantasy_movies
        + drama_movies
        + thriller_movies
        + adventure_movies
        + romance_movies
        + scifi_movies
        + family_movies
        + crime_movies
        + comedy_movies
        + (netflix_xmas.get("movies", []) if 'netflix_xmas' in locals() else [])
        + (netflix_xmas.get("tv_shows", []) if 'netflix_xmas' in locals() else [])
        + (best_xmas.get("movies", []) if 'best_xmas' in locals() else [])
        + (best_xmas.get("tv_shows", []) if 'best_xmas' in locals() else [])
    ):
        pid = m.get("id")
        if pid and m.get("poster_path"):
            used_posters.add(os.path.abspath(f"{POSTERS_DIR}/movie_{pid}.png"))

    for tv in (
        trending.get("tv_shows", [])
        + new_titles.get("tv_shows", [])
        + kdramas.get("tv_shows", [])
        + (netflix_xmas.get("tv_shows", []) if 'netflix_xmas' in locals() else [])
        + (best_xmas.get("tv_shows", []) if 'best_xmas' in locals() else [])
    ):
        tid = tv.get("id")
        if tid and tv.get("poster_path"):
            used_posters.add(os.path.abspath(f"{POSTERS_DIR}/tv_{tid}.png"))

    country_names = ["china", "taiwan", "philippines", "japan", "hongkong", "thailand", "france"]
    for cname in country_names:
        cpath = f"titles/{cname}.json"
        if os.path.exists(cpath):
            with open(cpath, "r", encoding="utf-8") as f:
                cdata = json.load(f)
                for m in cdata.get("movies", []):
                    pid = m.get("id")
                    if pid and m.get("poster_path"):
                        used_posters.add(os.path.abspath(f"{POSTERS_DIR}/movie_{pid}.png"))
                for tv in cdata.get("tv_shows", []):
                    tid = tv.get("id")
                    if tid and tv.get("poster_path"):
                        used_posters.add(os.path.abspath(f"{POSTERS_DIR}/tv_{tid}.png"))

    # Remove posters not referenced by the current run (safe for automation / CI)
    cleanup_unused_posters(used_posters)

if __name__ == "__main__":
    main()