"""
Netflix-style Recommendation Engine for Ateaish Movies

Analyzes user behavior (watched, watch later, continue watching) and generates
personalized recommendations based on:
- Genre matching
- Similar content analysis
- User preference patterns
- Collaborative patterns (optional)
"""

import json
import os
from typing import List, Dict, Set, Tuple
from collections import Counter, defaultdict
import math

class RecommendationEngine:
    def __init__(self, all_titles_dir="titles"):
        """Initialize the recommendation engine with all available titles."""
        self.all_titles_dir = all_titles_dir
        self.all_titles = {}  # {id: {details}, ...}
        self.genre_index = defaultdict(list)  # {genre: [id1, id2, ...]}
        self.type_index = {"movie": [], "tv": []}  # {media_type: [ids]}
        self.tag_index = {}  # For future use
        self.load_all_titles()

    def load_all_titles(self):
        """Load all titles from JSON files for indexing."""
        print("[Recommendation Engine] Loading titles...")
        
        # JSON files to load
        json_files = [
            "trending.json", "new.json", "bollywood.json", "kdramas.json",
            "horror.json", "animation.json", "action.json", "fantasy.json",
            "drama.json", "thriller.json", "adventure.json", "romance.json",
            "scifi.json", "family.json", "comedy.json", "crime.json",
            "china.json", "taiwan.json", "philippines.json", "japan.json",
            "hongkong.json", "thailand.json", "netflixfrance.json"
        ]
        
        for filename in json_files:
            filepath = os.path.join(self.all_titles_dir, filename)
            if not os.path.exists(filepath):
                continue
            
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                # Process movies
                for movie in data.get("movies", []):
                    tid = movie.get("id")
                    if tid:
                        self.all_titles[tid] = movie
                        self.type_index["movie"].append(tid)
                        self._index_genres(tid, movie)
                
                # Process TV shows
                for tv_show in data.get("tv_shows", []):
                    tid = tv_show.get("id")
                    if tid:
                        self.all_titles[tid] = tv_show
                        self.type_index["tv"].append(tid)
                        self._index_genres(tid, tv_show)
            
            except Exception as e:
                print(f"  Error loading {filename}: {e}")
        
        print(f"[Recommendation Engine] Loaded {len(self.all_titles)} titles")
        print(f"  - {len(self.type_index['movie'])} movies")
        print(f"  - {len(self.type_index['tv'])} TV shows")

    def _index_genres(self, title_id, title_data):
        """Index a title by its genres."""
        genres = title_data.get("genres", [])
        for genre in genres:
            genre_name = genre.get("name", "").lower() if isinstance(genre, dict) else str(genre).lower()
            if genre_name:
                self.genre_index[genre_name].append(title_id)

    def get_title_info(self, title_id: int) -> Dict:
        """Get title information."""
        return self.all_titles.get(title_id, {})

    def get_genres(self, title_id: int) -> List[str]:
        """Get genres for a title."""
        title = self.get_title_info(title_id)
        genres = title.get("genres", [])
        return [g.get("name", "").lower() for g in genres if isinstance(g, dict)]

    def find_similar_titles(self, title_id: int, limit: int = 20) -> List[Tuple[int, float]]:
        """
        Find similar titles based on genre overlap.
        Returns list of (title_id, similarity_score) tuples, sorted by score descending.
        """
        title = self.get_title_info(title_id)
        if not title:
            return []
        
        title_genres = set(self.get_genres(title_id))
        if not title_genres:
            return []
        
        similars = []
        for other_id in self.all_titles:
            if other_id == title_id:
                continue
            
            other_genres = set(self.get_genres(other_id))
            if not other_genres:
                continue
            
            # Jaccard similarity: intersection / union
            intersection = len(title_genres & other_genres)
            union = len(title_genres | other_genres)
            similarity = intersection / union if union > 0 else 0
            
            if similarity > 0:
                similars.append((other_id, similarity))
        
        # Sort by similarity descending
        similars.sort(key=lambda x: x[1], reverse=True)
        return similars[:limit]

    def recommend_from_watched(self, watched_ids: List[int], limit: int = 50) -> List[int]:
        """
        Generate recommendations based on watched titles.
        Uses genre and similarity analysis.
        """
        if not watched_ids:
            return []
        
        watched_set = set(watched_ids)
        candidate_scores = defaultdict(float)
        
        # For each watched title, find similar titles
        for watched_id in watched_ids:
            similars = self.find_similar_titles(watched_id, limit=30)
            for similar_id, score in similars:
                if similar_id not in watched_set:
                    candidate_scores[similar_id] += score
        
        # Sort by score descending
        recommendations = sorted(
            candidate_scores.items(),
            key=lambda x: x[1],
            reverse=True
        )
        
        return [tid for tid, score in recommendations[:limit]]

    def recommend_from_genres(self, watched_ids: List[int], limit: int = 50) -> List[int]:
        """
        Generate recommendations based on genres from watched titles.
        Diversifies by picking from top genres.
        """
        if not watched_ids:
            return []
        
        watched_set = set(watched_ids)
        genre_counts = Counter()
        
        # Count genres in watched titles
        for watched_id in watched_ids:
            genres = self.get_genres(watched_id)
            genre_counts.update(genres)
        
        if not genre_counts:
            return []
        
        recommendations = []
        seen = set()
        
        # Iterate through genres by frequency
        for genre, _ in genre_counts.most_common():
            if genre not in self.genre_index:
                continue
            
            # Add titles from this genre
            for title_id in self.genre_index[genre]:
                if title_id not in watched_set and title_id not in seen:
                    recommendations.append(title_id)
                    seen.add(title_id)
                    if len(recommendations) >= limit:
                        break
            
            if len(recommendations) >= limit:
                break
        
        return recommendations[:limit]

    def recommend_trending_unseen(self, watched_ids: List[int], limit: int = 50) -> List[int]:
        """
        Recommend trending titles the user hasn't seen.
        Returns titles from trending.json that aren't in watched list.
        """
        watched_set = set(watched_ids)
        trending_file = os.path.join(self.all_titles_dir, "trending.json")
        
        if not os.path.exists(trending_file):
            return []
        
        try:
            with open(trending_file, 'r', encoding='utf-8') as f:
                trending_data = json.load(f)
        except:
            return []
        
        recommendations = []
        
        # Prioritize TV shows first (they're more binge-worthy), then movies
        for item in trending_data.get("tv_shows", []):
            tid = item.get("id")
            if tid and tid not in watched_set:
                recommendations.append(tid)
        
        for item in trending_data.get("movies", []):
            tid = item.get("id")
            if tid and tid not in watched_set:
                recommendations.append(tid)
        
        return recommendations[:limit]

    def recommend_next_in_series(self, watched_ids: List[int], watchlater_ids: List[int]) -> List[int]:
        """
        Recommend next episodes/movies in series the user is interested in.
        Looks for related titles by name/franchise patterns.
        """
        # Simple heuristic: if user has watched/added to watchlist 
        # items with similar names, recommend similar items
        recommendations = []
        
        # Group by potential series/franchise (simple substring matching)
        watched_titles = {tid: self.get_title_info(tid) for tid in watched_ids if tid in self.all_titles}
        
        # For each watched title, find similar-named titles
        for watched_id, title_info in watched_titles.items():
            title_name = title_info.get("title") or title_info.get("name", "")
            if not title_name:
                continue
            
            # Look for titles with similar names (potential sequels)
            for candidate_id in self.all_titles:
                if candidate_id in watched_ids + watchlater_ids:
                    continue
                
                candidate_info = self.all_titles[candidate_id]
                candidate_name = candidate_info.get("title") or candidate_info.get("name", "")
                
                # Simple matching: check if one name contains key parts of the other
                if self._names_related(title_name, candidate_name):
                    recommendations.append(candidate_id)
        
        return list(set(recommendations))[:50]

    def _names_related(self, name1: str, name2: str) -> bool:
        """Check if two titles are likely related (sequels, series, etc)."""
        if not name1 or not name2:
            return False
        
        # Remove common suffixes
        name1_lower = name1.lower().split(":")[0].strip()
        name2_lower = name2.lower().split(":")[0].strip()
        
        # Check substring matches (for sequels, etc)
        min_len = min(len(name1_lower), len(name2_lower))
        if min_len < 5:
            return False
        
        # If one is substring of other
        if name1_lower in name2_lower or name2_lower in name1_lower:
            return True
        
        # Check for common patterns (e.g., "Movie" vs "Movie 2")
        base1 = ''.join(c for c in name1_lower if c.isalpha())
        base2 = ''.join(c for c in name2_lower if c.isalpha())
        
        if base1 and base2 and (base1 in base2 or base2 in base1):
            return len(base1) > 10  # Avoid false positives
        
        return False

    def generate_personalized_recommendations(self, watched_ids: List[int], 
                                            watchlater_ids: List[int],
                                            continue_watching_ids: List[int] = None) -> Dict:
        """
        Generate comprehensive personalized recommendations.
        Returns a dict with different recommendation categories.
        """
        if continue_watching_ids is None:
            continue_watching_ids = []
        
        all_engaged_ids = set(watched_ids) | set(watchlater_ids) | set(continue_watching_ids)
        
        recommendations = {
            "similar_to_watched": self.recommend_from_watched(watched_ids, limit=40),
            "similar_genres": self.recommend_from_genres(watched_ids, limit=30),
            "trending_unseen": self.recommend_trending_unseen(list(all_engaged_ids), limit=30),
            "next_in_series": self.recommend_next_in_series(watched_ids, watchlater_ids)[:30],
        }
        
        # Deduplicate: if a title appears in multiple categories, keep only first occurrence
        seen = set()
        deduped = {}
        for category, titles in recommendations.items():
            deduped[category] = []
            for tid in titles:
                if tid not in seen:
                    deduped[category].append(tid)
                    seen.add(tid)
        
        # Add metadata for each recommendation
        final_recommendations = {}
        for category, titles in deduped.items():
            final_recommendations[category] = [
                {
                    "id": tid,
                    "title": self.all_titles.get(tid, {}).get("title") or 
                            self.all_titles.get(tid, {}).get("name", "Unknown"),
                    "type": "tv" if tid in self.type_index["tv"] else "movie",
                    "genres": self.get_genres(tid),
                    "poster_path": self.all_titles.get(tid, {}).get("poster_path")
                }
                for tid in titles[:30]  # Limit each category to 30
            ]
        
        return final_recommendations

    def get_random_recommendations(self, exclude_ids: List[int] = None, limit: int = 50) -> List[int]:
        """
        Get random titles for random shuffling (increases discovery).
        """
        import random
        
        if exclude_ids is None:
            exclude_ids = []
        
        exclude_set = set(exclude_ids)
        candidates = [tid for tid in self.all_titles if tid not in exclude_set]
        
        if len(candidates) <= limit:
            return candidates
        
        return random.sample(candidates, limit)


def main():
    """Test the recommendation engine."""
    engine = RecommendationEngine()
    
    # Simulate some user data
    watched = [550, 238, 299536]  # Some random TMDB IDs (might not exist, just for demo)
    watchlater = [120, 550]
    continue_watching = [299536]
    
    print("\n[Test] Generating recommendations for watched:", watched)
    recs = engine.generate_personalized_recommendations(watched, watchlater, continue_watching)
    
    for category, items in recs.items():
        print(f"\n{category}:")
        for item in items[:5]:
            print(f"  - {item['title']} ({item['type']}) - {item['genres']}")


if __name__ == "__main__":
    main()
