/**
 * Discovery Enhancement System
 * 
 * Features:
 * 1. Genre Filter Chips - Filter visible sections by genre
 * 2. Surprise Me - Random title picker
 * 3. Showcase Carousel - Auto-rotating featured titles
 * 4. Mood-Based Discovery - Curated mood feeds
 * 5. Enhanced Search Filters - Type, year, rating filters
 */

// =============================================
// 1. GENRE FILTER CHIPS
// =============================================
(function initGenreChips() {
    // Map genre chip data-genre to section IDs
    const GENRE_TO_SECTION = {
        trending: 'trendingSection',
        new: 'newSection',
        netflixfrance: 'netflixfranceSection',
        bollywood: 'bollywoodSection',
        kdrama: 'kdramaSection',
        animation: 'animationSection',
        family: 'familySection',
        comedy: 'comedySection',
        adventure: 'adventureSection',
        fantasy: 'fantasySection',
        scifi: 'scifiSection',
        action: 'actionSection',
        thriller: 'thrillerSection',
        crime: 'crimeSection',
        horror: 'horrorSection',
        drama: 'dramaSection',
        romance: 'romanceSection',
        thailand: 'thailandSection',
        philippines: 'philippinesSection',
        chinese: 'chineseSection',
        japan: 'japanSection'
    };

    // All filterable section IDs (genre-based content sections)
    const ALL_GENRE_SECTIONS = Object.values(GENRE_TO_SECTION);

    // Sections that should always remain visible (user-specific)
    const ALWAYS_VISIBLE = [
        'continueSection', 'becauseWatchedSection', 
        'watchLaterSection', 'watchedSection',
        'platform-section'
    ];

    document.addEventListener('DOMContentLoaded', () => {
        const chipsBar = document.getElementById('genre-chips-bar');
        if (!chipsBar) return;

        const chips = chipsBar.querySelectorAll('.genre-chip');
        const moodSection = document.getElementById('mood-section');

        chips.forEach(chip => {
            chip.addEventListener('click', () => {
                const genre = chip.dataset.genre;

                // Handle mood chip specially
                if (genre === 'mood') {
                    // Toggle mood section visibility
                    chips.forEach(c => c.classList.remove('active'));
                    chip.classList.add('active');
                    
                    if (moodSection) {
                        moodSection.classList.toggle('visible');
                        if (moodSection.classList.contains('visible')) {
                            // Hide genre sections when mood is active
                            ALL_GENRE_SECTIONS.forEach(secId => {
                                const el = document.getElementById(secId);
                                if (el) el.style.display = 'none';
                            });
                            moodSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        } else {
                            // Show all sections again
                            ALL_GENRE_SECTIONS.forEach(secId => {
                                const el = document.getElementById(secId);
                                if (el) el.style.display = '';
                            });
                        }
                    }
                    return;
                }

                // Regular genre chip
                chips.forEach(c => c.classList.remove('active'));
                chip.classList.add('active');

                // Hide mood section when switching to genre
                if (moodSection) moodSection.classList.remove('visible');

                if (genre === 'all') {
                    // Show all sections
                    ALL_GENRE_SECTIONS.forEach(secId => {
                        const el = document.getElementById(secId);
                        if (el) el.style.display = '';
                    });
                } else {
                    // Show only the matching section, hide others
                    const targetSection = GENRE_TO_SECTION[genre];
                    ALL_GENRE_SECTIONS.forEach(secId => {
                        const el = document.getElementById(secId);
                        if (!el) return;
                        if (secId === targetSection) {
                            el.style.display = '';
                        } else {
                            el.style.display = 'none';
                        }
                    });

                    // Scroll to the visible section
                    if (targetSection) {
                        const target = document.getElementById(targetSection);
                        if (target) {
                            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                    }
                }
            });
        });
    });
})();


// =============================================
// 2. SURPRISE ME - RANDOM TITLE PICKER
// =============================================
(function initSurpriseMe() {
    const TITLE_SOURCES = [
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
        'titles/comedy.json'
    ];

    let allTitlesCache = null;

    async function loadAllTitles() {
        if (allTitlesCache) return allTitlesCache;

        const responses = await Promise.all(
            TITLE_SOURCES.map(src => fetch(src).then(r => r.ok ? r.json() : null).catch(() => null))
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

        allTitlesCache = Array.from(byId.values()).filter(item => {
            // Only include items with posters and valid release dates
            if (!item.poster_path && !item.poster) return false;
            const date = item.release_date || item.first_air_date || '';
            if (date) {
                const releaseDate = new Date(date);
                if (releaseDate > new Date()) return false;
            }
            return true;
        });

        return allTitlesCache;
    }

    document.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('surprise-me-btn');
        if (!btn) return;

        btn.addEventListener('click', async () => {
            // Spin animation on the icon
            const icon = btn.querySelector('.material-symbols-outlined');
            if (icon) {
                icon.style.animation = 'dice-spin 0.6s ease';
                setTimeout(() => { icon.style.animation = 'none'; }, 600);
            }

            try {
                const titles = await loadAllTitles();
                if (!titles.length) return;

                // Pick a random title
                const pick = titles[Math.floor(Math.random() * titles.length)];
                const mediaType = pick.media_type || (pick.seasons ? 'tv' : 'movie');
                const posterPath = pick.poster_path
                    ? `posters/${mediaType === 'tv' ? 'tv' : 'movie'}_${pick.id}.png`
                    : (pick.poster || 'assets/no_poster.png');
                const title = pick.title || pick.name || '';
                const date = pick.release_date || pick.first_air_date || '';
                const year = date ? date.slice(0, 4) : '';

                // Open the detail modal
                if (typeof showMorePosterInfo === 'function') {
                    showMorePosterInfo({
                        id: pick.id,
                        mediaType,
                        poster: posterPath,
                        title,
                        year,
                        date,
                        overview: pick.overview || '',
                        isTV: mediaType === 'tv'
                    });
                }
            } catch (e) {
                console.warn('[SurpriseMe] Error:', e);
            }
        });
    });
})();


// =============================================
// 3. SHOWCASE CAROUSEL (AUTO-ROTATE)
// =============================================
(function initShowcaseCarousel() {
    const ROTATE_INTERVAL_MS = 10000; // 10 seconds per slide
    let showcaseCandidates = [];
    let currentIndex = 0;
    let rotateTimer = null;
    let isPaused = false;

    // Wait for the main showcase to initialize first, then enhance it
    document.addEventListener('DOMContentLoaded', () => {
        // Delay to let the original initShowcase() run first
        setTimeout(async () => {
            try {
                const candidates = await loadShowcaseCandidatesForCarousel();
                if (candidates.length < 2) return; // No carousel needed for < 2 items

                showcaseCandidates = candidates;
                
                // Build dots
                buildDots();
                
                // Start auto-rotation
                startRotation();

                // Pause on hover
                const showcase = document.getElementById('showcase');
                if (showcase) {
                    showcase.addEventListener('mouseenter', () => { isPaused = true; });
                    showcase.addEventListener('mouseleave', () => { isPaused = false; });
                }
            } catch (e) {
                console.warn('[ShowcaseCarousel] Init error:', e);
            }
        }, 3000); // Wait 3s for initial showcase to load
    });

    async function loadShowcaseCandidatesForCarousel() {
        try {
            const res = await fetch('titles/trending.json');
            const data = await res.json();
            const shows = [
                ...(data.movies || []),
                ...(data.tv_shows || [])
            ].filter(item => item && item.id);
            return shows.slice(0, 8); // Top 8 for carousel
        } catch (e) {
            return [];
        }
    }

    function buildDots() {
        const dotsContainer = document.getElementById('showcase-dots');
        if (!dotsContainer) return;
        dotsContainer.innerHTML = '';

        showcaseCandidates.forEach((_, idx) => {
            const dot = document.createElement('button');
            dot.className = 'showcase-dot' + (idx === 0 ? ' active' : '');
            dot.setAttribute('aria-label', `Featured title ${idx + 1}`);
            dot.addEventListener('click', () => {
                goToSlide(idx);
                resetTimer();
            });
            dotsContainer.appendChild(dot);
        });
    }

    function updateDots(idx) {
        const dotsContainer = document.getElementById('showcase-dots');
        if (!dotsContainer) return;
        const dots = dotsContainer.querySelectorAll('.showcase-dot');
        dots.forEach((d, i) => {
            d.classList.toggle('active', i === idx);
        });
    }

    async function goToSlide(idx) {
        if (idx === currentIndex && showcaseCandidates.length > 1) return;
        currentIndex = idx;

        const showcase = document.getElementById('showcase');
        if (!showcase) return;

        // Fade out
        showcase.classList.add('fading');

        // Wait for fade
        await new Promise(r => setTimeout(r, 600));

        // Render new content
        const chosen = showcaseCandidates[idx];
        await renderCarouselSlide(chosen);

        // Update dots
        updateDots(idx);

        // Fade in
        showcase.classList.remove('fading');
    }

    async function renderCarouselSlide(show) {
        const tmdbId = show.id;
        const mediaType = show.media_type || (show.seasons ? 'tv' : 'movie');
        const date = show.release_date || show.first_air_date || '';
        const year = date ? date.slice(0, 4) : '';
        const title = show.title || show.name || 'Untitled';
        const overview = show.overview || '';

        // Fetch TMDB details
        let backdrop = null, runtime = '', tags = [], platformLogo = 'assets/platform_logos/default.svg';
        let voteAverage = show.vote_average || '';

        try {
            if (typeof fetchMorePosterInfo === 'function') {
                const extra = await fetchMorePosterInfo(tmdbId, mediaType);
                backdrop = extra.backdrop || null;
                runtime = extra.runtime ? `${extra.runtime} min` : '';
                tags = (extra.genres || '').split(',').map(g => g.trim()).filter(Boolean);
                voteAverage = extra.voteAverage || voteAverage;

                if (mediaType === 'tv' && extra.networks && extra.networks.length) {
                    const net = extra.networks.find(n => n.logo_path) || extra.networks[0];
                    if (net && net.logo_path) platformLogo = `https://image.tmdb.org/t/p/w154${net.logo_path}`;
                } else if (mediaType === 'movie' && extra.productionCompanies && extra.productionCompanies.length) {
                    const comp = extra.productionCompanies.find(c => c.logo_path) || extra.productionCompanies[0];
                    if (comp && comp.logo_path) platformLogo = `https://image.tmdb.org/t/p/w154${comp.logo_path}`;
                }
            }
        } catch (e) { /* use defaults */ }

        // Fetch logo
        let logoUrl = null;
        try {
            if (typeof fetchTitleLogo === 'function') {
                logoUrl = await fetchTitleLogo(tmdbId, mediaType);
            }
        } catch (e) { /* no logo */ }

        // Update backdrop
        const bg = backdrop ? `url('${backdrop}')` : '';
        const heroWrapper = document.getElementById('hero-wrapper');
        if (heroWrapper && bg) {
            heroWrapper.style.backgroundImage = bg;
        }

        // Update logo/title
        const logoWrapper = document.querySelector('.showcase-logo-wrapper');
        if (logoWrapper) {
            if (logoUrl) {
                logoWrapper.innerHTML = `<img src="${logoUrl}" alt="${title}" style="object-fit:contain;filter:drop-shadow(0 4px 14px rgba(0,0,0,0.8));">`;
            } else {
                logoWrapper.innerHTML = `<div style="font-family:'OumaTrialBold',sans-serif;font-size:clamp(2.2em,4.8vw,3.6em);letter-spacing:2px;text-transform:uppercase;color:#fff;text-shadow:0 6px 18px rgba(0,0,0,0.9);line-height:1;">${title}</div>`;
            }
        }

        // Update text elements
        const titleEl = document.getElementById('showcase-title');
        const yearEl = document.getElementById('showcase-year');
        const ratingEl = document.getElementById('showcase-rating');
        const runtimeEl = document.getElementById('showcase-runtime');
        const overviewEl = document.getElementById('showcase-overview');
        const platformEl = document.getElementById('showcase-platform');
        const tagsEl = document.getElementById('showcase-tags');

        if (titleEl) titleEl.textContent = title;
        if (yearEl) yearEl.textContent = year;
        if (ratingEl) ratingEl.textContent = voteAverage ? (typeof voteAverage === 'number' ? voteAverage.toFixed(1) : voteAverage) : '';
        if (runtimeEl) runtimeEl.textContent = runtime;
        if (overviewEl) {
            overviewEl.textContent = overview.length > 250 ? overview.slice(0, 250) + '…' : overview;
            overviewEl.classList.add('long');
            overviewEl.classList.remove('expanded');
        }
        if (platformEl) platformEl.innerHTML = `<img src="${platformLogo}" alt="Platform" style="height:22px;">`;

        if (tagsEl) {
            tagsEl.innerHTML = '';
            (tags || []).slice(0, 5).forEach(t => {
                const span = document.createElement('span');
                span.className = 'showcase-tag';
                span.textContent = t;
                tagsEl.appendChild(span);
            });
        }

        // Re-wire buttons
        const playBtn = document.getElementById('play-featured');
        const moreBtn = document.getElementById('showcase-more');

        if (playBtn) {
            playBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (typeof openPlayer === 'function') {
                    openPlayer(mediaType, tmdbId, 1, 1);
                }
            };
        }

        if (moreBtn) {
            moreBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (typeof showMorePosterInfo === 'function') {
                    showMorePosterInfo({
                        id: tmdbId,
                        mediaType,
                        poster: null,
                        title,
                        year,
                        date,
                        overview,
                        isTV: mediaType === 'tv'
                    });
                }
            };
        }
    }

    function startRotation() {
        rotateTimer = setInterval(() => {
            if (isPaused) return;
            const next = (currentIndex + 1) % showcaseCandidates.length;
            goToSlide(next);
        }, ROTATE_INTERVAL_MS);
    }

    function resetTimer() {
        clearInterval(rotateTimer);
        startRotation();
    }
})();


// =============================================
// 4. MOOD-BASED DISCOVERY
// =============================================
(function initMoodDiscovery() {
    const MOOD_GENRES = {
        'feel-good': {
            label: '😊 Feel Good',
            sources: ['titles/comedy.json', 'titles/family.json', 'titles/romance.json']
        },
        'edge-of-seat': {
            label: '😰 Edge of Your Seat',
            sources: ['titles/thriller.json', 'titles/action.json', 'titles/crime.json']
        },
        'binge-worthy': {
            label: '📺 Binge-Worthy',
            sources: ['titles/drama.json', 'titles/kdramas.json', 'titles/thriller.json']
        },
        'epic-adventure': {
            label: '⚔️ Epic Adventure',
            sources: ['titles/adventure.json', 'titles/fantasy.json', 'titles/scifi.json', 'titles/action.json']
        },
        'dark-twisted': {
            label: '🌑 Dark & Twisted',
            sources: ['titles/horror.json', 'titles/thriller.json', 'titles/crime.json']
        },
        'date-night': {
            label: '💕 Date Night',
            sources: ['titles/romance.json', 'titles/comedy.json', 'titles/drama.json']
        },
        'mind-bending': {
            label: '🧠 Mind-Bending',
            sources: ['titles/scifi.json', 'titles/thriller.json', 'titles/fantasy.json']
        },
        'family-time': {
            label: '👨‍👩‍👧‍👦 Family Time',
            sources: ['titles/family.json', 'titles/animation.json', 'titles/comedy.json', 'titles/adventure.json']
        }
    };

    let activeMood = null;

    document.addEventListener('DOMContentLoaded', () => {
        const moodCards = document.querySelectorAll('.mood-card');
        const titleEl = document.getElementById('mood-results-title');
        const gridEl = document.getElementById('mood-results-grid');

        if (!moodCards.length || !gridEl) return;

        moodCards.forEach(card => {
            card.addEventListener('click', async () => {
                const mood = card.dataset.mood;
                const moodConfig = MOOD_GENRES[mood];
                if (!moodConfig) return;

                // Toggle off if same mood clicked
                if (activeMood === mood) {
                    activeMood = null;
                    moodCards.forEach(c => c.classList.remove('active'));
                    gridEl.innerHTML = '';
                    if (titleEl) titleEl.style.display = 'none';
                    return;
                }

                activeMood = mood;
                moodCards.forEach(c => c.classList.remove('active'));
                card.classList.add('active');

                // Show loading state
                if (titleEl) {
                    titleEl.style.display = '';
                    titleEl.innerHTML = `
                        <img src="assets/bar.svg" alt="" style="height:1em;vertical-align:middle;margin-right:10px;margin-bottom:9px;">
                        ${moodConfig.label}
                    `;
                }
                gridEl.innerHTML = '<div style="color:#888;padding:20px;">Loading curated picks...</div>';

                try {
                    // Fetch all sources for this mood
                    const responses = await Promise.all(
                        moodConfig.sources.map(src => 
                            fetch(src).then(r => r.ok ? r.json() : null).catch(() => null)
                        )
                    );

                    // Merge and deduplicate
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

                    let titles = Array.from(byId.values());
                    
                    // Filter out future releases
                    const today = new Date();
                    titles = titles.filter(item => {
                        const date = item.release_date || item.first_air_date || '';
                        if (date) {
                            const releaseDate = new Date(date);
                            if (releaseDate > today) return false;
                        }
                        if (!item.poster_path) return false;
                        return true;
                    });

                    // Shuffle
                    for (let i = titles.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [titles[i], titles[j]] = [titles[j], titles[i]];
                    }

                    // Limit to 40
                    titles = titles.slice(0, 40);

                    // Render using the existing buildPosterCard if available
                    gridEl.innerHTML = '';
                    titles.forEach(show => {
                        const tmdb_id = show.id;
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
                        const last_season = isTV && show.seasons ? (show.seasons[show.seasons.length - 1]?.season_number || 1) : 1;

                        if (!poster || poster === 'assets/no_poster.png') return;

                        if (typeof buildPosterCard === 'function') {
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
                                onClick: () => { if (typeof openPlayer === 'function') openPlayer(mediaType, tmdb_id, last_season); },
                                withPreview: true
                            });
                            gridEl.appendChild(card);
                        }
                    });

                    if (gridEl.children.length === 0) {
                        gridEl.innerHTML = '<div style="color:#888;padding:20px;">No titles found for this mood.</div>';
                    }

                } catch (e) {
                    console.warn('[MoodDiscovery] Error:', e);
                    gridEl.innerHTML = '<div style="color:#888;padding:20px;">Could not load mood picks.</div>';
                }
            });
        });
    });
})();


// =============================================
// 5. ENHANCED SEARCH FILTERS + CATEGORY + PAGINATION
// =============================================
(function initSearchFilters() {
    const TMDB_KEY = '792f6fa1e1c53d234af7859d10bdf833';
    // TV genre IDs differ from movie IDs for some genres; map movie→tv where needed
    const TV_GENRE_MAP = {
        '28': '10759',   // Action → Action & Adventure
        '12': '10759',   // Adventure → Action & Adventure
        '14': '10765',   // Fantasy → Sci-Fi & Fantasy
        '878': '10765',  // Sci-Fi → Sci-Fi & Fantasy
        '10752': '10768' // War → War & Politics
    };

    let activeTypeFilter = 'all';
    let activeYearFilter = '';
    let activeRatingFilter = '';
    let activeCategoryFilter = '';
    let currentPage = 1;
    let totalPages = 1;
    let lastQuery = '';             // last text search query
    let lastRawResults = [];
    let searchMode = 'text';        // 'text' or 'discover'
    let _searchDebounce = null;

    document.addEventListener('DOMContentLoaded', () => {
        const searchInput = document.getElementById('search-input');
        const filtersBar = document.getElementById('search-filters');
        const resultsContainer = document.getElementById('results');
        const paginationContainer = document.getElementById('search-pagination');
        if (!searchInput || !filtersBar) return;

        const typeChips = filtersBar.querySelectorAll('.search-filter-chip');
        const yearSelect = document.getElementById('search-year-filter');
        const ratingSelect = document.getElementById('search-rating-filter');
        const categorySelect = document.getElementById('search-category-filter');

        // --- Type filter chips ---
        typeChips.forEach(chip => {
            chip.addEventListener('click', (e) => {
                e.preventDefault();
                typeChips.forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                activeTypeFilter = chip.dataset.type;
                currentPage = 1;
                triggerSearch();
            });
        });

        // --- Dropdown filters ---
        if (yearSelect) yearSelect.addEventListener('change', () => {
            activeYearFilter = yearSelect.value;
            currentPage = 1;
            triggerSearch();
        });
        if (ratingSelect) ratingSelect.addEventListener('change', () => {
            activeRatingFilter = ratingSelect.value;
            currentPage = 1;
            triggerSearch();
        });
        if (categorySelect) categorySelect.addEventListener('change', () => {
            activeCategoryFilter = categorySelect.value;
            currentPage = 1;
            triggerSearch();
        });

        // --- Show filters on focus/click ---
        const resultsWrapper = document.getElementById('search-results-wrapper');
        const closeSearchBtn = document.getElementById('close-search-results');

        searchInput.addEventListener('focus', () => {
            filtersBar.classList.add('visible');
        });
        searchInput.addEventListener('click', () => {
            filtersBar.classList.add('visible');
        });

        // --- Close search results button ---
        if (closeSearchBtn) {
            closeSearchBtn.addEventListener('click', () => {
                closeSearchPanel();
            });
        }

        function closeSearchPanel() {
            searchInput.value = '';
            lastQuery = '';
            activeTypeFilter = 'all';
            activeYearFilter = '';
            activeRatingFilter = '';
            activeCategoryFilter = '';
            currentPage = 1;
            if (resultsContainer) { resultsContainer.innerHTML = ''; resultsContainer.style.display = 'none'; }
            if (resultsWrapper) resultsWrapper.classList.remove('active');
            filtersBar.classList.remove('visible');
            if (closeSearchBtn) closeSearchBtn.classList.remove('visible');
            renderPagination(0, 0);
            // Reset filter controls
            typeChips.forEach(c => c.classList.remove('active'));
            const allChip = filtersBar.querySelector('[data-type="all"]');
            if (allChip) allChip.classList.add('active');
            if (yearSelect) yearSelect.value = '';
            if (ratingSelect) ratingSelect.value = '';
            if (categorySelect) categorySelect.value = '';
        }

        // Expose for search.js clear button
        window._closeSearchPanel = closeSearchPanel;

        // --- Search input ---
        searchInput.addEventListener('input', () => {
            clearTimeout(_searchDebounce);
            _searchDebounce = setTimeout(() => {
                lastQuery = searchInput.value.trim();
                currentPage = 1;
                triggerSearch();
            }, 350);
        });

        // --- Core: decide text-search vs discover ---
        function triggerSearch() {
            const hasText = lastQuery.length >= 2;
            const hasFilters = activeTypeFilter !== 'all' || activeYearFilter || activeRatingFilter || activeCategoryFilter;

            if (!hasText && !hasFilters) {
                // Nothing to show
                if (resultsContainer) {
                    resultsContainer.innerHTML = '';
                    resultsContainer.style.display = 'none';
                }
                renderPagination(0, 0);
                return;
            }

            // Ensure results wrapper is visible
            if (resultsContainer) resultsContainer.style.display = '';
            if (resultsWrapper) resultsWrapper.classList.add('active');
            if (closeSearchBtn) closeSearchBtn.classList.add('visible');

            if (hasText) {
                searchMode = 'text';
                fetchTextSearch(lastQuery, currentPage);
            } else {
                searchMode = 'discover';
                fetchDiscover(currentPage);
            }
        }

        // --- Text search (TMDB /search/multi) ---
        async function fetchTextSearch(query, page) {
            try {
                const res = await fetch(
                    `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(query)}&page=${page}`
                );
                const data = await res.json();
                totalPages = Math.min(data.total_pages || 1, 500);
                lastRawResults = (data.results || []);
                const filtered = applyLocalFilters(lastRawResults);
                renderResults(filtered);
                renderPagination(currentPage, totalPages);
            } catch (e) {
                console.error('Search error:', e);
                if (resultsContainer) resultsContainer.innerHTML = 'Error fetching results.';
            }
        }

        // --- Discover (TMDB /discover/movie or /discover/tv) ---
        async function fetchDiscover(page) {
            try {
                const types = activeTypeFilter === 'all' ? ['movie', 'tv'] : [activeTypeFilter];
                let all = [];
                let maxPages = 1;

                for (const mtype of types) {
                    const params = new URLSearchParams({
                        api_key: TMDB_KEY,
                        page: String(page),
                        sort_by: 'popularity.desc',
                        include_adult: 'false'
                    });

                    // Genre
                    if (activeCategoryFilter) {
                        const genreId = (mtype === 'tv' && TV_GENRE_MAP[activeCategoryFilter])
                            ? TV_GENRE_MAP[activeCategoryFilter]
                            : activeCategoryFilter;
                        params.set('with_genres', genreId);
                    }

                    // Year
                    if (activeYearFilter) {
                        const yp = yearParams(activeYearFilter, mtype);
                        for (const [k, v] of Object.entries(yp)) params.set(k, v);
                    }

                    // Rating
                    if (activeRatingFilter) {
                        params.set('vote_average.gte', activeRatingFilter);
                        params.set('vote_count.gte', '50');
                    }

                    const url = `https://api.themoviedb.org/3/discover/${mtype}?${params}`;
                    const res = await fetch(url);
                    const data = await res.json();
                    maxPages = Math.max(maxPages, Math.min(data.total_pages || 1, 500));
                    (data.results || []).forEach(item => {
                        item.media_type = mtype;
                        all.push(item);
                    });
                }

                totalPages = maxPages;
                // Interleave movie & tv results if both types
                if (types.length > 1) {
                    all.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
                }
                lastRawResults = all;
                renderResults(all);
                renderPagination(currentPage, totalPages);
            } catch (e) {
                console.error('Discover error:', e);
                if (resultsContainer) resultsContainer.innerHTML = 'Error fetching results.';
            }
        }

        // --- Year params helper ---
        function yearParams(val, mtype) {
            const dateGte = mtype === 'tv' ? 'first_air_date.gte' : 'primary_release_date.gte';
            const dateLte = mtype === 'tv' ? 'first_air_date.lte' : 'primary_release_date.lte';
            if (val === 'classic') return { [dateLte]: '1999-12-31' };
            if (val === '2020s') return { [dateGte]: '2020-01-01', [dateLte]: '2029-12-31' };
            if (val === '2010s') return { [dateGte]: '2010-01-01', [dateLte]: '2019-12-31' };
            if (val === '2000s') return { [dateGte]: '2000-01-01', [dateLte]: '2009-12-31' };
            // Specific year
            return { [dateGte]: `${val}-01-01`, [dateLte]: `${val}-12-31` };
        }

        // --- Local post-filters (for text search only) ---
        function applyLocalFilters(results) {
            return results.filter(item => {
                if (item.media_type !== 'movie' && item.media_type !== 'tv') return false;
                if (activeTypeFilter !== 'all' && item.media_type !== activeTypeFilter) return false;

                if (activeCategoryFilter && searchMode === 'text') {
                    const gids = (item.genre_ids || []).map(String);
                    if (!gids.includes(activeCategoryFilter)) return false;
                }

                if (activeYearFilter && searchMode === 'text') {
                    const date = item.release_date || item.first_air_date || '';
                    const yr = date ? parseInt(date.slice(0, 4)) : 0;
                    if (activeYearFilter === 'classic' && (yr >= 2000 || yr === 0)) return false;
                    else if (activeYearFilter === '2020s' && (yr < 2020 || yr > 2029)) return false;
                    else if (activeYearFilter === '2010s' && (yr < 2010 || yr > 2019)) return false;
                    else if (activeYearFilter === '2000s' && (yr < 2000 || yr > 2009)) return false;
                    else if (/^\d{4}$/.test(activeYearFilter) && yr !== parseInt(activeYearFilter)) return false;
                }

                if (activeRatingFilter && searchMode === 'text') {
                    if (!item.vote_average || item.vote_average < parseFloat(activeRatingFilter)) return false;
                }

                return true;
            });
        }

        // --- Render results using the original displayResults ---
        const _origDisplay = window.displayResults;
        function renderResults(items) {
            if (!resultsContainer) return;
            if (!items.length) {
                resultsContainer.style.display = '';
                resultsContainer.innerHTML = '<p style="color:#888;text-align:center;padding:40px 0;">No results found. Try adjusting your filters.</p>';
                return;
            }
            if (typeof _origDisplay === 'function') {
                _origDisplay.call(window, items);
            }
            addFilterSummary(items);
        }

        function addFilterSummary(filtered) {
            if (!resultsContainer) return;
            const existing = resultsContainer.querySelector('.filter-summary');
            if (existing) existing.remove();

            const hasFilters = activeTypeFilter !== 'all' || activeYearFilter || activeRatingFilter || activeCategoryFilter;
            if (!hasFilters && searchMode === 'text') return;

            const summary = document.createElement('div');
            summary.className = 'filter-summary';
            summary.style.cssText = 'grid-column:1/-1;color:#888;font-size:0.8em;padding:4px 0;margin-bottom:8px;';
            const parts = [];
            if (activeTypeFilter !== 'all') parts.push(activeTypeFilter === 'movie' ? 'Movies' : 'TV Shows');
            if (activeCategoryFilter) {
                const opt = categorySelect?.querySelector(`option[value="${activeCategoryFilter}"]`);
                parts.push(opt ? opt.textContent : 'Genre');
            }
            if (activeYearFilter) parts.push(activeYearFilter);
            if (activeRatingFilter) parts.push(`${activeRatingFilter}+ rating`);
            summary.textContent = `Filtered: ${parts.join(' · ')} — ${filtered.length} result${filtered.length !== 1 ? 's' : ''} (page ${currentPage}/${totalPages})`;
            resultsContainer.insertBefore(summary, resultsContainer.firstChild);
        }

        // --- Pagination ---
        function renderPagination(page, total) {
            if (!paginationContainer) return;
            paginationContainer.innerHTML = '';
            if (total <= 1) return;

            const maxVisible = 7;
            const createBtn = (label, pg, disabled, active) => {
                const btn = document.createElement('button');
                btn.className = 'pagination-btn' + (active ? ' active' : '');
                btn.textContent = label;
                btn.disabled = disabled;
                btn.addEventListener('click', () => {
                    currentPage = pg;
                    triggerSearch();
                    // Scroll to top of results
                    resultsContainer?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
                return btn;
            };

            // Prev
            paginationContainer.appendChild(createBtn('‹', page - 1, page <= 1, false));

            // Page numbers
            let start = Math.max(1, page - Math.floor(maxVisible / 2));
            let end = Math.min(total, start + maxVisible - 1);
            if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);

            if (start > 1) {
                paginationContainer.appendChild(createBtn('1', 1, false, page === 1));
                if (start > 2) {
                    const dots = document.createElement('span');
                    dots.className = 'pagination-info';
                    dots.textContent = '…';
                    paginationContainer.appendChild(dots);
                }
            }

            for (let i = start; i <= end; i++) {
                paginationContainer.appendChild(createBtn(String(i), i, false, i === page));
            }

            if (end < total) {
                if (end < total - 1) {
                    const dots = document.createElement('span');
                    dots.className = 'pagination-info';
                    dots.textContent = '…';
                    paginationContainer.appendChild(dots);
                }
                paginationContainer.appendChild(createBtn(String(total), total, false, page === total));
            }

            // Next
            paginationContainer.appendChild(createBtn('›', page + 1, page >= total, false));
        }

        // Override the global displayResults so the search.js input handler
        // routes through our filter/pagination system
        window.displayResults = function(results) {
            lastRawResults = results || [];
            const filtered = applyLocalFilters(lastRawResults);
            renderResults(filtered);
        };
    });
})();
