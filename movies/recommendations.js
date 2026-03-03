/**
 * Netflix-style Recommendation and Discovery System
 * 
 * Provides:
 * - Smart catalogue shuffling with rotation (different each visit)
 * - Personalized recommendations based on watched/watchlater data
 * - Intelligent grid loading with variety
 */

class RecommendationSystem {
    constructor() {
        this.explorationCatalog = null;
        this.genreCombinations = null;
        this.recommendationMetadata = null;
        this.userWatched = [];
        this.userWatchLater = [];
        this.userContinueWatching = [];
        this.currentExplorationSeed = Math.floor(Math.random() * 5); // Pick random seed 0-4
        this.isInitialized = false;
    }

    async initialize() {
        console.log("[RecommendationSystem] Initializing...");
        
        try {
            // Load all recommendation data in parallel
            const [explorationData, genreData, metadataData] = await Promise.all([
                this.loadJSON('titles/exploration_catalog.json'),
                this.loadJSON('titles/genre_combination_feeds.json'),
                this.loadJSON('titles/recommendation_metadata.json')
            ]);
            
            this.explorationCatalog = explorationData;
            this.genreCombinations = genreData;
            this.recommendationMetadata = metadataData;
            
            // Load user data from localStorage
            this.loadUserData();
            
            this.isInitialized = true;
            console.log("[RecommendationSystem] ✓ Initialized");
            return true;
        } catch (error) {
            console.warn("[RecommendationSystem] Error initializing:", error);
            return false;
        }
    }

    async loadJSON(path) {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`Failed to load ${path}`);
        return response.json();
    }

    loadUserData() {
        // Load from localStorage (same format as search.js)
        try {
            const watchedRaw = localStorage.getItem('watchedList')
                || localStorage.getItem('watched')
                || '[]';
            this.userWatched = JSON.parse(watchedRaw)
                .map(item => (item && item.id != null) ? item.id : item)
                .map(v => Number(v))
                .filter(v => Number.isFinite(v));
        } catch {
            this.userWatched = [];
        }

        try {
            const watchLaterRaw = localStorage.getItem('watchLater') || '[]';
            this.userWatchLater = JSON.parse(watchLaterRaw)
                .map(item => (item && item.id != null) ? item.id : item)
                .map(v => Number(v))
                .filter(v => Number.isFinite(v));
        } catch {
            this.userWatchLater = [];
        }

        // Load continue watching (from progress keys)
        this.userContinueWatching = this.extractContinueWatching();
    }

    extractContinueWatching() {
        const ids = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('progress_')) {
                const match = key.match(/progress_(\d+)_/);
                if (match && match[1]) {
                    ids.push(parseInt(match[1]));
                }
            }
        }
        return [...new Set(ids)]; // Deduplicate
    }

    /**
     * Get shuffled catalog with rotation.
     * Uses a different seed each visit if data hasn't changed.
     */
    getShuffledCatalog(type = 'movies') {
        if (!this.explorationCatalog) return [];
        
        const catalogs = type === 'movies' 
            ? this.explorationCatalog.all_movies
            : this.explorationCatalog.all_tv;
        
        if (!catalogs || catalogs.length === 0) return [];
        
        // Use current seed or get a fresh one
        const seedData = catalogs[this.currentExplorationSeed];
        if (!seedData) return [];
        
        return seedData.titles || [];
    }

    /**
     * Get thematic feed for a specific mood.
     */
    getThematicFeed(theme) {
        if (!this.genreCombinations || !this.genreCombinations[theme]) {
            return [];
        }
        return this.genreCombinations[theme];
    }

    /**
     * Get personalized recommendations based on user history.
     */
    getPersonalizedRecommendations(limit = 100) {
        const userEngagement = [
            ...this.userWatched,
            ...this.userWatchLater,
            ...this.userContinueWatching
        ];
        if (userEngagement.length === 0) {
            // No user history, return random
            return this.getShuffledCatalog('movies').slice(0, limit);
        }

        const recommendations = new Set();
        const metadata = this.recommendationMetadata || {};

        // For each watched/watchlater item, find similar titles
        for (const titleId of userEngagement) {
            const metaKey = String(titleId);
            if (metaKey in metadata && metadata[metaKey].similar_ids) {
                metadata[metaKey].similar_ids.forEach(id => {
                    if (!userEngagement.includes(id)) {
                        recommendations.add(id);
                    }
                });
            }
        }

        // If we don't have enough recommendations, add from genres
        if (recommendations.size < limit) {
            const userGenres = new Set();
            for (const titleId of userEngagement.slice(0, 5)) {
                const metaKey = String(titleId);
                if (metaKey in metadata && metadata[metaKey].genres) {
                    metadata[metaKey].genres.forEach(g => userGenres.add(g));
                }
            }

            // Find more titles with matching genres
            for (const [titleKey, titleMeta] of Object.entries(metadata)) {
                if (recommendations.size >= limit) break;
                const titleId = parseInt(titleKey);
                if (userEngagement.includes(titleId)) continue;
                
                const titleGenres = titleMeta.genres || [];
                const hasMatchingGenre = titleGenres.some(g => userGenres.has(g));
                if (hasMatchingGenre) {
                    recommendations.add(titleId);
                }
            }
        }

        return Array.from(recommendations).slice(0, limit);
    }

    /**
     * Get intelligent grid data - combines recommendations with variety.
     */
    getIntelligentGridContent(gridType, userHasData = false) {
        if (userHasData && this.userWatched.length > 0) {
            return this.getPersonalizedRecommendations(50);
        }

        // Otherwise use thematic or shuffled data
        switch (gridType) {
            case 'action':
                return this.getThematicFeed('action_adventure') || this.getShuffledCatalog('movies');
            case 'comedy':
                return this.getThematicFeed('comedy_family') || this.getShuffledCatalog('movies');
            case 'drama':
                return this.getThematicFeed('drama_thriller') || this.getShuffledCatalog('movies');
            case 'scifi':
                return this.getThematicFeed('sci_fi_fantasy') || this.getShuffledCatalog('movies');
            default:
                return this.getShuffledCatalog('movies');
        }
    }

    /**
     * Rotate to next seed for next visit (creates variety perception).
     */
    rotateToNextSeed() {
        this.currentExplorationSeed = (this.currentExplorationSeed + 1) % 5;
        // In production, might save this to localStorage for persistence across visits
    }

    /**
     * Get all title data needed for displaying (with details).
     */
    async getTitleDetails(titleIds, jsonPath) {
        try {
            const response = await fetch(jsonPath);
            const data = await response.json();
            
            const idSet = new Set(titleIds);
            const allTitles = [...(data.movies || []), ...(data.tv_shows || [])];
            
            return allTitles.filter(t => idSet.has(t.id));
        } catch (error) {
            console.warn(`Failed to get title details from ${jsonPath}:`, error);
            return [];
        }
    }
}

// Global instance
const recSystem = new RecommendationSystem();

/**
 * Modified loadGrid function that uses recommendations when appropriate.
 * This replaces or enhances the existing loadGrid.
 */
async function loadGridWithRecommendations(jsonPath, gridId, enableRecommendations = true) {
    const grid = document.getElementById(gridId);
    if (!grid || !recSystem.isInitialized) {
        // Fall back to standard loading
        return loadGrid(jsonPath, gridId);
    }

    try {
        // Determine if we should show recommendations vs standard content
        const userHasWatchHistory = recSystem.userWatched.length > 0;
        const minItems = 12;
        
        let titles;
        if (enableRecommendations && userHasWatchHistory) {
            // Show personalized recommendations
            const titleIds = recSystem.getPersonalizedRecommendations(50);
            
            // Load details from the JSON file
            const response = await fetch(jsonPath);
            const data = await response.json();
            const allTitles = [...(data.movies || []), ...(data.tv_shows || [])];
            
            titles = allTitles.filter(t => titleIds.includes(t.id));
            if (!titles || titles.length < minItems) {
                // If too few recommendations in this section, fall back to shuffled data
                titles = shuffleWithSeed(allTitles, recSystem.currentExplorationSeed);
            }
        } else {
            // Standard loading with smart shuffling
            const response = await fetch(jsonPath);
            const data = await response.json();
            titles = [...(data.movies || []), ...(data.tv_shows || [])];
            
            // Use intelligent shuffle (with seed variation)
            titles = shuffleWithSeed(titles, recSystem.currentExplorationSeed);
        }

        // Render grid (same as original loadGrid)
        renderGridContent(grid, titles);

    } catch (error) {
        console.warn(`Error in loadGridWithRecommendations for ${gridId}:`, error);
        // Fall back to standard loading
        loadGrid(jsonPath, gridId);
    }
}

/**
 * Deterministic shuffle using a seed, so same seed produces same order.
 */
function shuffleWithSeed(array, seed) {
    const arr = [...array];
    const seededRandom = mulberry32(seed);
    
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(seededRandom() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    
    return arr;
}

/**
 * Seeded random number generator (Mulberry32).
 */
function mulberry32(a) {
    return function() {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Extracted grid rendering logic.
 */
function renderGridContent(grid, titles) {
    if (!grid) return;
    grid.innerHTML = '';

    const today = new Date();
    titles.forEach(show => {
        const tmdb_id = show.id;
        if (!tmdb_id) return;

        const mediaType = show.media_type || (show.seasons ? 'tv' : 'movie');
        const poster = show.poster_path
            ? `posters/${mediaType === 'tv' ? 'tv' : 'movie'}_${tmdb_id}.png`
            : 'assets/no_poster.png';
        
        const title = show.title || show.name || '';
        const date = show.release_date || show.first_air_date || '';
        const year = date ? date.slice(0, 4) : '';
        const overview = show.overview || '';
        const isTV = mediaType === 'tv';
        
        const lastSeason = isTV && show.seasons ? show.seasons[show.seasons.length - 1] : null;
        const lastSeasonNum = lastSeason?.season_number || '';
        const lastSeasonEpisodes = lastSeason?.episode_count || '';

        if (!poster || poster === 'assets/no_poster.png') return;

        if (date) {
            const releaseDate = new Date(date);
            if (releaseDate > today) return;  // Skip unreleased
        }

        const card = buildPosterCard({
            id: tmdb_id,
            mediaType,
            poster,
            title,
            year,
            date,
            overview,
            isTV,
            lastSeasonNum,
            lastSeasonEpisodes,
            onClick: () => openPlayer(mediaType, tmdb_id, 1),
            withPreview: true
        });

        grid.appendChild(card);
    });
}

const RECOMMENDATION_SOURCES = [
    'titles/trending.json',
    'titles/new.json',
    'titles/netflixfrance.json',
    'titles/bollywood.json',
    'titles/kdramas.json',
    'titles/horror.json',
    'titles/animation.json',
    'titles/action.json',
    'titles/fantasy.json',
    'titles/drama.json',
    'titles/thriller.json',
    'titles/adventure.json',
    'titles/romance.json',
    'titles/scifi.json',
    'titles/family.json',
    'titles/crime.json',
    'titles/comedy.json',
    'titles/thailand.json',
    'titles/china.json',
    'titles/taiwan.json',
    'titles/philippines.json',
    'titles/japan.json',
    'titles/hongkong.json'
];

async function loadBecauseYouWatchedRow(gridId = 'becauseWatchedGrid', sectionId = 'becauseWatchedSection') {
    if (!recSystem || !recSystem.isInitialized) return;

    const section = document.getElementById(sectionId);
    const grid = document.getElementById(gridId);
    if (!section || !grid) return;

    const userEngagement = [
        ...(recSystem.userWatched || []),
        ...(recSystem.userWatchLater || []),
        ...(recSystem.userContinueWatching || [])
    ];
    const dedupedEngagement = Array.from(new Set(userEngagement));
    if (dedupedEngagement.length === 0) {
        section.style.display = 'none';
        grid.innerHTML = '';
        return;
    }

    try {
        const responses = await Promise.all(
            RECOMMENDATION_SOURCES.map(src => fetch(src).then(r => r.ok ? r.json() : null).catch(() => null))
        );

        const byId = new Map();
        responses.forEach(data => {
            if (!data) return;
            const items = [...(data.movies || []), ...(data.tv_shows || [])];
            items.forEach(item => {
                if (item && item.id && !byId.has(item.id)) {
                    byId.set(item.id, item);
                }
            });
        });

        const recommendedIds = recSystem.getPersonalizedRecommendations(120);
        let picks = recommendedIds.map(id => byId.get(id)).filter(Boolean);

        if (picks.length < 18) {
            const fallbackPool = Array.from(byId.values()).filter(item => !dedupedEngagement.includes(item.id));
            const shuffled = shuffleWithSeed(fallbackPool, recSystem.currentExplorationSeed);
            picks = picks.concat(shuffled);
        }

        const finalPicks = picks.slice(0, 30);
        if (finalPicks.length === 0) {
            section.style.display = 'none';
            grid.innerHTML = '';
            return;
        }

        section.style.display = 'block';
        renderGridContent(grid, finalPicks);
    } catch (error) {
        console.warn('[RecommendationSystem] Because You Watched row failed:', error);
        section.style.display = 'none';
    }
}

/**
 * Initialize recommendation system on page load.
 */
document.addEventListener('DOMContentLoaded', async () => {
    console.log("[RecommendationSystem] Page loaded, initializing...");
    
    // Try to initialize recommendation system
    const initialized = await recSystem.initialize();
    
    if (initialized) {
        console.log("[RecommendationSystem] System ready for recommendations");
        
        // You can update specific grids to use recommendations:
        // loadGridWithRecommendations('titles/trending.json', 'trendingGrid', true);
        
        // Rotate seed for next visit (increases variety perception)
        recSystem.rotateToNextSeed();

        // Notify the main page to reload grids with recommendations.
        try {
            if (typeof window !== 'undefined' && typeof window.recommendationsReady === 'function') {
                window.recommendationsReady();
            }
        } catch (e) {
            console.warn("[RecommendationSystem] recommendationsReady hook failed:", e);
        }
    }
});

if (typeof window !== 'undefined') {
    window.loadBecauseYouWatchedRow = loadBecauseYouWatchedRow;
}

// Export for use in search.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RecommendationSystem, loadGridWithRecommendations };
}
