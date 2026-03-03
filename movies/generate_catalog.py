"""
Generate diverse catalog views and recommendation metadata for better discovery.
This script creates multiple shuffled views of titles to increase variety.
"""

import json
import os
import random
from recommendation_engine import RecommendationEngine

def generate_exploration_catalog(output_file="titles/exploration_catalog.json"):
    """
    Generate a 'exploration catalog' with multiple permutations of titles
    grouped by category. Each time the page loads, a different permutation
    can be shown for variety.
    """
    print("[Exploration Catalog] Generating diverse catalog views...")
    
    engine = RecommendationEngine()
    
    exploration_catalog = {
        "all_movies": [],
        "all_tv": [],
        "exploration_seeds": {
            "action_adventure": [],
            "drama_thriller": [],
            "comedy_family": [],
            "sci_fi_fantasy": [],
            "international": [],
            "trending_first": [],
        }
    }
    
    # Separate movies and TV
    movies = [tid for tid in engine.type_index["movie"] if tid in engine.all_titles]
    tv = [tid for tid in engine.type_index["tv"] if tid in engine.all_titles]
    
    print(f"  Total movies: {len(movies)}")
    print(f"  Total TV: {len(tv)}")
    
    # Create multiple random permutations for discovery variety
    for i in range(5):  # 5 different shuffle seeds
        shuffled_movies = movies.copy()
        shuffled_tv = tv.copy()
        random.shuffle(shuffled_movies)
        random.shuffle(shuffled_tv)
        
        exploration_catalog["all_movies"].append({
            "seed": i,
            "titles": shuffled_movies
        })
        exploration_catalog["all_tv"].append({
            "seed": i,
            "titles": shuffled_tv
        })
    
    # Create thematic combinations
    action_ids = set(engine.genre_index.get("action", []))
    adventure_ids = set(engine.genre_index.get("adventure", []))
    action_adventure = list(action_ids | adventure_ids)
    random.shuffle(action_adventure)
    exploration_catalog["exploration_seeds"]["action_adventure"] = action_adventure[:100]
    
    drama_ids = set(engine.genre_index.get("drama", []))
    thriller_ids = set(engine.genre_index.get("thriller", []))
    drama_thriller = list(drama_ids | thriller_ids)
    random.shuffle(drama_thriller)
    exploration_catalog["exploration_seeds"]["drama_thriller"] = drama_thriller[:100]
    
    comedy_ids = set(engine.genre_index.get("comedy", []))
    family_ids = set(engine.genre_index.get("family", []))
    comedy_family = list(comedy_ids | family_ids)
    random.shuffle(comedy_family)
    exploration_catalog["exploration_seeds"]["comedy_family"] = comedy_family[:100]
    
    scifi_ids = set(engine.genre_index.get("science fiction", []))
    fantasy_ids = set(engine.genre_index.get("fantasy", []))
    scifi_fantasy = list(scifi_ids | fantasy_ids)
    random.shuffle(scifi_fantasy)
    exploration_catalog["exploration_seeds"]["sci_fi_fantasy"] = scifi_fantasy[:100]
    
    # International content (all that have a parent genre/region)
    international = list(action_adventure) + list(drama_thriller) + list(comedy_family)
    random.shuffle(international)
    exploration_catalog["exploration_seeds"]["international"] = international[:150]
    
    # Load actual trending data
    trending_file = os.path.join("titles", "trending.json")
    if os.path.exists(trending_file):
        with open(trending_file, 'r', encoding='utf-8') as f:
            trending_data = json.load(f)
            trending_ids = []
            for item in trending_data.get("tv_shows", []):
                if item.get("id"):
                    trending_ids.append(item.get("id"))
            for item in trending_data.get("movies", []):
                if item.get("id"):
                    trending_ids.append(item.get("id"))
            exploration_catalog["exploration_seeds"]["trending_first"] = trending_ids[:100]
    
    # Save exploration catalog
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(exploration_catalog, f, ensure_ascii=False, indent=2)
    
    print(f"✓ Saved exploration catalog to {output_file}")


def generate_genre_combination_feeds():
    """
    Generate unique feeds combining multiple genres for better recommendations.
    """
    print("\n[Genre Combination Feeds] Generating...")
    
    engine = RecommendationEngine()
    
    feeds = {}
    
    # Define combination themes
    combinations = {
        "binge_worthy": ["drama", "thriller", "crime"],  # TV-heavy
        "feel_good": ["comedy", "family", "animation"],
        "intense": ["thriller", "horror", "crime"],
        "romantic": ["romance", "drama", "family"],
        "cerebral": ["science fiction", "thriller", "drama"],
        "escapism": ["fantasy", "adventure", "animation"],
        "indie_gems": ["drama", "independent"],  # Lesser known
    }
    
    for feed_name, genres in combinations.items():
        titles = set()
        for genre in genres:
            genre_lower = genre.lower()
            if genre_lower in engine.genre_index:
                titles.update(engine.genre_index[genre_lower])
        
        titles_list = list(titles)
        random.shuffle(titles_list)
        feeds[feed_name] = titles_list[:100]
        print(f"  {feed_name}: {len(titles_list[:100])} titles")
    
    # Save combination feeds
    output_file = "titles/genre_combination_feeds.json"
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(feeds, f, ensure_ascii=False, indent=2)
    
    print(f"✓ Saved combination feeds to {output_file}")


def generate_recommendation_metadata():
    """
    Generate metadata about what recommendations each title might lead to.
    This helps the frontend pick better recommendations.
    """
    print("\n[Recommendation Metadata] Generating...")
    
    engine = RecommendationEngine()
    
    metadata = {}
    
    # For each title, find its top similar titles
    sample_titles = list(engine.all_titles.keys())
    
    for i, title_id in enumerate(sample_titles):
        if i % 100 == 0:
            print(f"  Processing {i}/{len(sample_titles)}...")
        
        similars = engine.find_similar_titles(title_id, limit=10)
        metadata[str(title_id)] = {
            "similar_ids": [tid for tid, _ in similars],
            "genres": engine.get_genres(title_id),
        }
    
    output_file = "titles/recommendation_metadata.json"
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
    
    print(f"✓ Saved metadata for {len(metadata)} titles to {output_file}")


def main():
    print("[Catalog Generation System] Starting...\n")
    
    # Generate exploration catalog (multiple shuffles for variety)
    generate_exploration_catalog()
    
    # Generate genre combination feeds
    generate_genre_combination_feeds()
    
    # Generate recommendation metadata
    generate_recommendation_metadata()
    
    print("\n[Catalog Generation System] ✓ Complete!")
    print("\nUpdates:")
    print("  - exploration_catalog.json: Multiple shuffled views of all titles")
    print("  - genre_combination_feeds.json: Thematic combinations for discovery")
    print("  - recommendation_metadata.json: Similarity data for smart recommendations")


if __name__ == "__main__":
    main()
