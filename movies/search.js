// Safe DOM lookups
const searchInput = document.getElementById('search-input');
const resultsContainer = document.getElementById('results');
const searchContainer = document.getElementById('search-container');
const searchWrapper = document.getElementById('results');
const playerContainer = document.getElementById('player-container');
const playerContent = document.getElementById('player-content');
const closePlayer = document.getElementById('close-player');
const clearSearchBtn = document.getElementById('clear-search-btn');

const apiKey = '792f6fa1e1c53d234af7859d10bdf833';
const tmdbEndpoint = 'https://api.themoviedb.org/3/search/multi';
const imageBaseUrl = 'https://image.tmdb.org/t/p/w500';
const placeholderImage = 'assets/no_poster.png';

// Loading-screen logic: remove the loading video after it plays once
document.addEventListener('DOMContentLoaded', () => {
    const loadingVideo = document.getElementById('loading-video');
    const mainContent = document.getElementById('main-content');
    if (!loadingVideo || !mainContent) return;

    // Hide main content initially
    mainContent.style.display = 'none';

    // Ensure playsInline & muted for autoplay policies
    loadingVideo.muted = true;
    loadingVideo.playsInline = true;

    // Try to play (some environments require explicit play())
    loadingVideo.play().catch(() => { });

    function showMainContent() {
        if (mainContent) mainContent.style.display = '';
        if (loadingVideo && loadingVideo.parentNode) {
            loadingVideo.style.opacity = '0';
            setTimeout(() => {
                if (loadingVideo.parentNode) loadingVideo.parentNode.removeChild(loadingVideo);
            }, 500);
        }
    }

    // Remove loading video and show main content after video ends
    loadingVideo.addEventListener('ended', showMainContent, { once: true });

    // Fallback: remove after a maximum duration in case 'ended' doesn't fire
    const MAX_FALLBACK_MS = 25000; // 25 seconds
    setTimeout(() => {
        if (document.getElementById('loading-video')) showMainContent();
    }, MAX_FALLBACK_MS);

    // Optional: allow click to skip the loading video
    loadingVideo.addEventListener('click', showMainContent);
});

// Watch Later policy
const WATCH_LATER_POLICY = {
    removeOnStart: false,        // do not remove on play
    removeWhenProgressGte: 0.9   // auto-remove when >= 90% watched
};

// Max visible items before Show All is needed
const SECTION_SHOW_LIMIT = 7;

// Helper: truthy check for '1'/'0' or boolean
function isTrue(v) { return v === true || v === '1' || v === 1; }

// NEW: canonicalize content types and handle aliases
const TYPE_ALIASES = {
    tv: ['tv', 'series', 'serie', 'show', 'tvshow', 'tv_show', 'tv-series', 'tv_series'],
    movie: ['movie', 'film', 'movies']
};
function canonicalType(t) {
    if (!t) return '';
    const x = String(t).toLowerCase();
    if (TYPE_ALIASES.tv.includes(x)) return 'tv';
    if (TYPE_ALIASES.movie.includes(x)) return 'movie';
    return x; // fallback to lowercased unknown to avoid crashes
}
function aliasesForCanonical(c) {
    const x = canonicalType(c);
    if (x === 'tv') return TYPE_ALIASES.tv;
    if (x === 'movie') return TYPE_ALIASES.movie;
    return [x];
}

// Ensure a toggle button exists in the section header row (creates one if missing)
function ensureSectionToggleButton(section, config) {
    if (!section) return null;
    // Try to use an existing heading; otherwise create a header row
    let headerRow = section.querySelector('.section-header-row');
    if (!headerRow) {
        const heading = section.querySelector('h2, h3, .section-title, .title');
        headerRow = document.createElement('div');
        headerRow.className = 'section-header-row';
        headerRow.style.display = 'flex';
        headerRow.style.alignItems = 'center';
        headerRow.style.justifyContent = 'space-between';
        headerRow.style.marginBottom = '8px';
        if (heading) {
            // Insert row before existing heading and move heading into it
            section.insertBefore(headerRow, heading);
            heading.style.margin = '0';
            headerRow.appendChild(heading);
        } else {
            // Fallback title
            const t = document.createElement('span');
            t.className = 'section-title';
            t.textContent = config.fallbackTitle || '';
            t.style.fontWeight = '600';
            t.style.fontSize = '1.1rem';
            headerRow.appendChild(t);
            section.insertBefore(headerRow, section.firstChild);
        }
    }
    let btn = headerRow.querySelector(`#${config.buttonId}`);
    if (!btn) {
        btn = document.createElement('button');
        btn.id = config.buttonId;
        btn.style.background = 'transparent';
        btn.style.font = 'inherit';
        btn.style.marginRight = '40px';
        btn.style.border = '1px solid #444444ff';
        btn.style.color = '#444444ff';
        btn.style.padding = '4px 10px';
        btn.style.borderRadius = '4px';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '0.9em';
        btn.addEventListener('click', config.onClick);
        headerRow.appendChild(btn);
    }
    btn.textContent = config.isExpanded ? 'Show Less' : 'Show All';
    btn.style.display = config.shouldShow ? 'inline-block' : 'none';
    return btn;
}

// Optional positioning for search container
if (searchContainer) {
    searchContainer.style.position = 'relative';
}

// Inject minimal CSS so search posters render like other grids (2:3, cover)
let _resultsPosterCssInjected = false;
function ensureResultsPosterCSS() {
    if (_resultsPosterCssInjected) return;
    const style = document.createElement('style');
    style.textContent = `
        #results.poster-grid-match .poster img {
            width: 100%;
            height: auto;
            aspect-ratio: 2 / 3;
            object-fit: cover;
            display: block;
        }
    `;
    document.head.appendChild(style);
    _resultsPosterCssInjected = true;
}

let _searchGridRO = null;
// Ensure search results use the exact same grid sizing as the homepage (Trending)
function setupResultsGridLayout() {
    if (!resultsContainer) return;
    ensureResultsPosterCSS();
    resultsContainer.classList.add('poster-grid-match');
    resultsContainer.style.display = 'grid';

    const trending = document.getElementById('trendingGrid');

    const applyFromTrending = () => {
        if (!trending) return 0;

        // Measure only the first poster (or its img) for precise column width
        const firstCard = trending.querySelector('.poster') || trending.firstElementChild;
        const el = firstCard ? (firstCard.querySelector('img') || firstCard) : null;
        const rect = el ? el.getBoundingClientRect() : null;
        const w = rect ? Math.round(rect.width) : 0;

        // Copy spacing from Trending
        const cs = window.getComputedStyle(trending);
        const gap = cs.gap || cs.columnGap || '14px';
        const align = cs.alignItems || 'start';
        resultsContainer.style.gap = gap;
        resultsContainer.style.alignItems = align;

        if (w > 0 && Number.isFinite(w)) {
            resultsContainer.style.gridTemplateColumns = `repeat(auto-fill, minmax(${w}px, 1fr))`;
            return w;
        }
        return 0;
    };

    // First attempt to apply sizing immediately
    let appliedWidth = applyFromTrending();

    // If Trending not ready (images not laid out yet), observe and retry once it is
    if (appliedWidth === 0) {
        // Fallback so results don't explode in size before Trending resolves
        resultsContainer.style.gridTemplateColumns = 'repeat(auto-fill, minmax(180px, 1fr))';
        if (trending && !_searchGridRO) {
            _searchGridRO = new ResizeObserver(() => {
                const w = applyFromTrending();
                if (w > 0) {
                    _searchGridRO.disconnect();
                    _searchGridRO = null;
                }
            });
            _searchGridRO.observe(trending);
        }
    }
}

// Wire up search only if input/results exist
if (searchInput && resultsContainer) {
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();

        // Hide the results container when input is cleared or too short
        if (searchTerm.length < 2) {
            resultsContainer.innerHTML = '';
            if (searchWrapper) {
                // resultsWrapper and resultsContainer are the same element
                searchWrapper.style.display = 'none';
            }
            return;
        }

        // Show the results container again when we have a valid query
        if (searchWrapper) {
            searchWrapper.style.display = '';
        }

        fetch(`${tmdbEndpoint}?api_key=${apiKey}&query=${encodeURIComponent(searchTerm)}`)
            .then(response => response.json())
            .then(data => {
                displayResults(data.results || []);
            })
            .catch(error => {
                console.error("Error fetching data from TMDB:", error);
                resultsContainer.innerHTML = "Error fetching data. Please try again later.";
            });
    });
}

if (clearSearchBtn && searchInput && resultsContainer) {
    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        resultsContainer.innerHTML = '';
        if (searchContainer) searchContainer.style.display = 'flex';
        if (playerContainer) playerContainer.style.display = 'none';
        if (searchWrapper) searchWrapper.style.display = 'none';
        // searchInput.focus();
    });
}

if (searchInput === null) {
    if (searchWrapper) searchWrapper.style.display = 'none';
}

function displayResults(results) {
    if (!resultsContainer) return;

    // Ensure wrapper is visible when we render results
    if (searchWrapper) searchWrapper.style.display = '';

    setupResultsGridLayout();

    if (!Array.isArray(results) || results.length === 0) {
        resultsContainer.innerHTML = 'No results found.';
        return;
    }

    resultsContainer.innerHTML = ''; // Clear previous results

    results.forEach(item => {
        if (item.media_type !== 'movie' && item.media_type !== 'tv') return;

        const id = item.id;
        const mediaType = item.media_type;
        const title = item.title || item.name || 'Untitled';
        const date = item.release_date || item.first_air_date || '';
        const year = date ? date.slice(0, 4) : '';
        const overview = item.overview || '';
        const poster = item.poster_path ? `${imageBaseUrl}${item.poster_path}` : placeholderImage;

        const card = buildPosterCard({
            id,
            mediaType,
            poster,
            title,
            year,
            date,
            overview,
            isTV: mediaType === 'tv',
            lastSeasonNum: null,
            lastSeasonEpisodes: null,
            onClick: () => openPlayer(mediaType, id, 1),
            withPreview: true // same preview as other grids
        });

        resultsContainer.appendChild(card);
    });
}

let activeType = 'VO'; // 'VO' or 'VF'
let activeVOIdx = 0;
let activeVFIdx = 0;

// after activeType/indices
let continueShowAllExpanded = false;
let watchLaterShowAllExpanded = false;

const voVfToggle = document.getElementById('dn'); // The toggle input

// Get arrow buttons
const prevEpisodeBtn = document.getElementById('prev-episode-btn');
const nextEpisodeBtn = document.getElementById('next-episode-btn');

// Helper to show/hide episode arrows and handle navigation
function updateEpisodeArrows({ type, id, season, episode, lastSeason, lastEpisode }) {
    if (!prevEpisodeBtn || !nextEpisodeBtn) return;

    // Only show for TV shows
    if (type !== 'tv') {
        prevEpisodeBtn.style.display = 'none';
        nextEpisodeBtn.style.display = 'none';
        return;
    }

    // Previous episode logic
    let hasPrev = false;
    let prevSeason = season, prevEpisode = episode - 1;
    if (episode > 1) {
        hasPrev = true;
    } else if (season > 1) {
        hasPrev = true;
        prevSeason = season - 1;
        prevEpisode = lastEpisode; // fallback: last ep of previous season
    }

    // Next episode logic
    let hasNext = false;
    let nextSeason = season, nextEpisode = episode + 1;
    if (episode < lastEpisode) {
        hasNext = true;
    } else if (season < lastSeason) {
        hasNext = true;
        nextSeason = season + 1;
        nextEpisode = 1;
    }

    prevEpisodeBtn.style.display = hasPrev ? 'flex' : 'none';
    nextEpisodeBtn.style.display = hasNext ? 'flex' : 'none';

    // Set click handlers
    prevEpisodeBtn.onclick = () => {
        openPlayer('tv', id, prevSeason, prevEpisode);
    };
    nextEpisodeBtn.onclick = () => {
        openPlayer('tv', id, nextSeason, nextEpisode);
    };
}

// Modify openPlayer to accept episode and update arrows
function openPlayer(type, id, season = 1, episode = 1) {
    const progressData = localStorage.getItem(`progress_${id}_${type}`);
    let last_season = season;
    let last_episode = episode;
    let timestamp = null;

    if (progressData) {
        try {
            const saved = JSON.parse(progressData);
            if (type === 'tv') {
                last_season = saved.season || season;
                last_episode = saved.episode || episode;
            }
            timestamp = saved.timestamp || null;
        } catch (e) {
            // ignore
        }
    }

    const voSources = SOURCES.VO || [];
    const vfSources = SOURCES.VF || [];

    function getEmbedUrl(seasonArg, episodeArg) {
        if (activeType === 'VF') {
            const src = vfSources[activeVFIdx];
            if (!src) return '';
            if (type === 'movie') {
                return src.movies.replace(/\$\{id\}/g, id);
            } else {
                return src.shows.replace(/\$\{id\}/g, id)
                    .replace(/\$\{season\}/g, seasonArg)
                    .replace(/\$\{episode\}/g, episodeArg);
            }
        } else {
            const src = voSources[activeVOIdx];
            if (!src) return '';
            if (type === 'movie') {
                return src.movies.replace(/\$\{id\}/g, id);
            } else {
                return src.shows.replace(/\$\{id\}/g, id)
                    .replace(/\$\{season\}/g, seasonArg)
                    .replace(/\$\{episode\}/g, episodeArg);
            }
        }
    }

    showServerIndicators(
        () => openPlayer(type, id, last_season, last_episode),
        () => openPlayer(type, id, last_season, last_episode)
    );

    // Inject iframe only (do not inject duplicate arrow buttons)
    if (playerContent) {
        playerContent.innerHTML = `
            <iframe src="${getEmbedUrl(season, episode)}" width="100%" height="100%" frameborder="0" allowfullscreen allow="autoplay; fullscreen; encrypted-media"></iframe>
        `;
    }

    // Update arrows based on the current (requested) season/episode.
    // For TV, fetch the last season/episode info then call updateEpisodeArrows.
    if (type === 'tv') {
        getTVLastEpisodeInfo(id).then(info => {
            const lastSeasonVal = info.lastSeason || season;
            const lastEpisodeVal = info.lastEpisode || episode;
            updateEpisodeArrows({
                type,
                id,
                season: Number(season),
                episode: Number(episode),
                lastSeason: lastSeasonVal,
                lastEpisode: lastEpisodeVal
            });
        }).catch(() => {
            // Fallback: still call updateEpisodeArrows with what we have
            updateEpisodeArrows({ type, id, season: Number(season), episode: Number(episode), lastSeason: season, lastEpisode: episode });
        });
    } else {
        updateEpisodeArrows({ type, id });
    }

    // Create / update a placeholder progress entry so Continue Watching populates immediately
    ensureProgressPlaceholder({ type, id, season, episode });
    // Refresh the Continue Watching UI right away
    try { loadContinueWatching(); } catch (e) { console.warn('Could not refresh Continue Watching:', e); }

    if (playerContainer) playerContainer.style.display = 'block';
    if (searchContainer) searchContainer.style.display = 'none';

    const key = `progress_${id}_${type}`;
    let progressEntry = null;
    if (progressData) {
        try {
            progressEntry = JSON.parse(progressData);
        } catch (e) { }
    }
    if (progressEntry) {
        progressEntry.updatedAt = Date.now();
        localStorage.setItem(key, JSON.stringify(progressEntry));
    } else {
        // If no entry, ensureProgressPlaceholder will create one with updatedAt
    }
}

// Listen for toggle changes and reload player if open
if (voVfToggle) {
    voVfToggle.addEventListener('change', function () {
        // If player is open, reload with new source
        if (playerContainer && playerContainer.style.display === 'block') {
            // Try to extract current id/type/season/episode from the iframe src
            const iframe = playerContent.querySelector('iframe');
            if (!iframe) return;
            const src = iframe.src;
            let type, id, season = 1, episode = 1;
            if (/videasy\.net\/movie\/(\d+)/.test(src) || /frembed\.mom\/api\/film\.php\?id=(\d+)/.test(src)) {
                type = 'movie';
                id = (src.match(/movie\/(\d+)/) || src.match(/film\.php\?id=(\d+)/))[1];
            } else if (/videasy\.net\/tv\/(\d+)\/(\d+)\/(\d+)/.test(src) || /frembed\.mom\/api\/serie\.php\?id=(\d+)&sa=(\d+)&epi=(\d+)/.test(src)) {
                type = 'tv';
                let m = src.match(/tv\/(\d+)\/(\d+)\/(\d+)/) || src.match(/serie\.php\?id=(\d+)&sa=(\d+)&epi=(\d+)/);
                id = m[1];
                season = m[2];
                episode = m[3];
            }
            if (id && type) openPlayer(type, id, season, episode);
        }
    });
}

// Robust message parsing helpers
function tryParseJSON(str) {
    try {
        return JSON.parse(str);
    } catch (e) {
        const first = str.indexOf('{');
        const last = str.lastIndexOf('}');
        if (first !== -1 && last !== -1 && last > first) {
            try { return JSON.parse(str.slice(first, last + 1)); } catch { }
        }
        return null;
    }
}

function extractPayload(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.payload && typeof obj.payload === 'object') return obj.payload;
    if (obj.data && typeof obj.data === 'object') return obj.data;
    if (obj.message && typeof obj.message === 'object') return obj.message;
    return obj;
}
// Add TMDB helpers to resolve the last available TV episode (cached for 24h)
const TV_LAST_CACHE_TTL = 24 * 60 * 60 * 1000;
async function getTVLastEpisodeInfo(tvId) {
    const key = `tv_last_${tvId}`;
    try {
        const cached = JSON.parse(localStorage.getItem(key) || 'null');
        if (cached && (Date.now() - (cached.cachedAt || 0)) < TV_LAST_CACHE_TTL) {
            return cached;
        }
    } catch { }
    const url = `https://api.themoviedb.org/3/tv/${tvId}?api_key=${apiKey}`;
    try {
        const res = await fetch(url);
        if (res.ok) {
            const j = await res.json();
            const seasons = (j.seasons || []).filter(s => (s && typeof s.season_number === 'number' && s.season_number > 0));
            seasons.sort((a, b) => b.season_number - a.season_number);
            const last = seasons[0] || null;
            const info = {
                lastSeason: last?.season_number ?? null,
                lastEpisode: last?.episode_count ?? null,
                cachedAt: Date.now()
            };
            localStorage.setItem(key, JSON.stringify(info));
            return info;
        }
    } catch { }
    return { lastSeason: null, lastEpisode: null, cachedAt: Date.now() };
}
async function maybeAutoRemoveFromWatchLater(data, frac) {
    if (!WATCH_LATER_POLICY) return;
    const threshold = WATCH_LATER_POLICY.removeWhenProgressGte;
    const onStart = !!WATCH_LATER_POLICY.removeOnStart;
    const id = data.id;
    const type = data.mediaType || data.type;
    if (!id || !type) return;
    if (!isInWatchLater(id, type)) return;

    if (onStart) { removeFromWatchLater(id, type); return; }
    if (!(typeof frac === 'number' && frac >= threshold)) return;

    if (type !== 'tv') { removeFromWatchLater(id, type); return; }

    // TV: only remove if last available ep of last season
    const watchedSeason = data.season ?? data.season_number ?? null;
    const watchedEpisode = data.episode ?? data.episode_number ?? null;
    if (!watchedSeason || !watchedEpisode) return;

    // Try hints from the payload first
    let lastSeason = data.lastSeason ?? data.last_season ?? null;
    let lastEpisode = data.lastEpisode ?? data.last_episode ?? null;

    if (!lastSeason || !lastEpisode) {
        const meta = await getTVLastEpisodeInfo(id);
        lastSeason = lastSeason || meta.lastSeason;
        lastEpisode = lastEpisode || meta.lastEpisode;
    }
    if (lastSeason && lastEpisode && watchedSeason === lastSeason && watchedEpisode === lastEpisode) {
        removeFromWatchLater(id, type);
    }
}

// Compute fractional progress from stored data (0..1), robust to 0..100 inputs
function fractionFromProgress(data) {
    if (!data) return null;
    const p = data.progress;
    if (typeof p === 'number') {
        const f = p > 1 ? p / 100 : p;
        if (Number.isFinite(f)) return Math.max(0, Math.min(1, f));
    }
    const { timestamp, duration } = data;
    if (Number.isFinite(timestamp) && Number.isFinite(duration) && duration > 0) {
        const f = timestamp / duration;
        if (Number.isFinite(f)) return Math.max(0, Math.min(1, f));
    }
    return null;
}

function removeFromContinueWatching(id, type) {
    if (!id || !type) return;
    const canon = canonicalType(type);
    const aliases = aliasesForCanonical(canon);
    // Remove any alias key to prevent the entry coming back
    for (const a of aliases) {
        localStorage.removeItem(`progress_${id}_${a}`);
    }
}

function maybeAutoRemoveFromContinueWatching(data, frac) {
    const threshold = WATCH_LATER_POLICY?.removeWhenProgressGte;
    if (!(typeof threshold === 'number')) return;
    const f = (typeof frac === 'number') ? frac : fractionFromProgress(data);
    if (typeof f === 'number' && f >= threshold) {
        removeFromContinueWatching(data.id, data.mediaType || data.type);
    }
}

window.addEventListener("message", function (event) {
    try {
        // Accept messages from any origin (or restrict if needed)
        let parsed = typeof event.data === "string" ? (tryParseJSON(event.data) || event.data) : event.data;
        if (typeof parsed === 'string') parsed = tryParseJSON(parsed) || parsed;
        parsed = extractPayload(parsed);

        // Try to extract id/type/progress from multiple possible formats
        let id = parsed?.id ?? parsed?.contentId ?? parsed?.content_id ?? null;
        let type = parsed?.type ?? parsed?.mediaType ?? parsed?.media_type ?? null;
        let progressNum = (typeof parsed?.progress === 'number') ? parsed.progress
            : (typeof parsed?.percent === 'number' ? parsed.percent : null);
        let timestamp = (typeof parsed?.timestamp === 'number') ? parsed.timestamp
            : (typeof parsed?.currentTime === 'number' ? parsed.currentTime : null);

        // Fallback: try to extract from event.data if not found
        if (!id && event.data?.id) id = event.data.id;
        if (!type && event.data?.type) type = event.data.type;
        if (progressNum === null && typeof event.data?.progress === 'number') progressNum = event.data.progress;
        if (timestamp === null && typeof event.data?.timestamp === 'number') timestamp = event.data.timestamp;

        // If still missing, try to parse from iframe src (for known servers)
        // ...existing fallback code...

        // Canonicalize type to avoid multiple keys for same content (tv vs serie/series/show)
        type = canonicalType(type);

        if (!id || !type || (progressNum === null && timestamp === null)) return;

        const toStore = {
            id: id,
            type: type,
            mediaType: type,
            progress: progressNum,
            timestamp: timestamp,
            duration: parsed.duration ?? parsed.totalDuration ?? null,
            season: parsed.season ?? parsed.season_number ?? null,
            episode: parsed.episode ?? parsed.episode_number ?? null,
            lastSeason: parsed.lastSeason ?? parsed.last_season ?? null,
            lastEpisode: parsed.lastEpisode ?? parsed.last_episode ?? null,
            title: parsed.title ?? parsed.name ?? null,
            poster_path: parsed.poster_path ?? parsed.posterPath ?? parsed.poster ?? null,
            updatedAt: Date.now()
        };

        const key = `progress_${id}_${type}`;
        localStorage.setItem(key, JSON.stringify(toStore));

        // Compute fractional progress once
        let frac = null;
        if (typeof progressNum === 'number') {
            frac = progressNum > 1 ? progressNum / 100 : progressNum;
        }
        if ((frac == null || isNaN(frac)) && toStore.duration && typeof timestamp === 'number' && toStore.duration > 0) {
            frac = timestamp / toStore.duration;
        }

        // TV-aware auto-remove policy (Watch Later)
        if (WATCH_LATER_POLICY && (WATCH_LATER_POLICY.removeOnStart || WATCH_LATER_POLICY.removeWhenProgressGte != null)) {
            // fire-and-forget
            void maybeAutoRemoveFromWatchLater(toStore, frac);
        }

        // Apply same threshold to Continue Watching: remove progress entry when >= threshold
        if (WATCH_LATER_POLICY && WATCH_LATER_POLICY.removeWhenProgressGte != null) {
            maybeAutoRemoveFromContinueWatching(toStore, frac);
        }

        // If the player is open and this message contains TV season/episode info,
        // refresh the prev/next arrows so they reflect the current episode.
        try {
            const curSeason = toStore.season ? Number(toStore.season) : 1;
            const curEpisode = toStore.episode ? Number(toStore.episode) : 1;
            const curType = (toStore.mediaType || toStore.type) || type;
            if (playerContainer && playerContainer.style.display === 'block' && curType === 'tv') {
                getTVLastEpisodeInfo(toStore.id).then(info => {
                    updateEpisodeArrows({
                        type: 'tv',
                        id: toStore.id,
                        season: curSeason,
                        episode: curEpisode,
                        lastSeason: info.lastSeason || curSeason,
                        lastEpisode: info.lastEpisode || curEpisode
                    });
                }).catch(() => {
                    updateEpisodeArrows({
                        type: 'tv',
                        id: toStore.id,
                        season: curSeason,
                        episode: curEpisode,
                        lastSeason: curSeason,
                        lastEpisode: curEpisode
                    });
                });
            }
        } catch (e) {
            // ignore arrow-update errors
        }
    } catch (e) {
        console.warn("[player message] parse/save error:", e);
    }
});

if (closePlayer) {
    closePlayer.addEventListener('click', () => {
        if (playerContainer) playerContainer.style.display = 'none';
        if (searchContainer) searchContainer.style.display = 'flex';
        if (playerContent) playerContent.innerHTML = '';
        setTimeout(() => {
            try { loadContinueWatching(); } catch (e) { console.warn('Error refreshing continue watching:', e); }
            try { loadWatchLater(); } catch (e) { console.warn('Error refreshing watch later:', e); }
        }, 100);
    });
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// Build poster card. If withPreview=true, include preview box below the poster.
function buildPosterCard({ id, mediaType, poster, title, year, date, overview, isTV, lastSeasonNum, lastSeasonEpisodes, onClick, withPreview }) {
    const posterDiv = document.createElement('div');
    posterDiv.className = 'poster';
    if (onClick) posterDiv.onclick = onClick;

    const img = document.createElement('img');
    img.src = poster;
    img.alt = title || 'Poster';
    // NEW: safe fallback if remote/local poster fails to load
    img.onerror = () => { img.src = placeholderImage; };
    posterDiv.appendChild(img);

    if (withPreview) {
        const infoDiv = document.createElement('div');
        infoDiv.className = 'poster-info';

        const safeTitle = title || '';
        const rightLabel = year;
        const saved = isInWatchLater(id, mediaType);
        // Use Material Symbols (playlist_add, playlist_add_check)
        const btnSymbol = saved
            ? '<span class="material-symbols-outlined" aria-hidden="true">playlist_add_check</span>'
            : '<span class="material-symbols-outlined" aria-hidden="true">playlist_add</span>';
        const labelText = saved ? 'Remove from Watch Later' : 'Add to Watch Later';

        infoDiv.innerHTML = `
            <div class="poster-info-inner" style="position:relative; padding-bottom:44px;">
                <div class="info-header" style="display:flex;align-items:center;justify-content:space-between;gap:0px;">
                    <div class="preview-title" style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${safeTitle}</div>
                    ${rightLabel ? `<div class="preview-year" style="opacity:.85;white-space:nowrap;">${rightLabel}</div>` : ''}
                </div>
                ${isTV && lastSeasonNum ? `
                    <div class="preview-tvinfo" style="margin-top:8px;color:#e02735;">
                        Season ${lastSeasonNum}${lastSeasonEpisodes ? `, ${lastSeasonEpisodes} Episodes` : ''}
                    </div>` : ''
            }
                ${overview ? `<div class="preview-overview" style="margin-top:8px;font-family:'OumaTrialLight'">${truncateOverview(overview)}</div>` : ''}
                <div style="margin-top:8px;display:flex;gap:8px;">
                    <button class="card-play-btn"
                        style="width:36px;height:36px;background-color:transparent;border-style:none;color:#e02735;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;line-height:1;cursor:pointer;">
                        <span class="material-symbols-outlined" style="font-size:30px;line-height:1;">play_circle</span>
                    </button>
                    <button class="show-more-poster-info-btn"
                        style="width:36px;height:36px;background-color:transparent;border-style:none;color:#e02735;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;line-height:1;cursor:pointer;">
                        <span class="material-symbols-outlined" style="font-size:30px;line-height:1;">info</span>
                    </button>
                </div>
                <button class="watch-later-btn"
                    aria-label="${labelText}"
                    title="${labelText}"
                    style="position:absolute; right:0px; bottom:8px; width:36px; height:36px; border-radius:50%;
                           background:transparent; color:#e02735; border:0px solid #e02735; display:flex;
                           align-items:center; justify-content:center; font-size:22px; font-weight:700; line-height:1;
                           cursor:pointer; box-shadow:0 2px 6px rgba(0,0,0,.4);">
                    ${btnSymbol}
                </button>
                <span class="watch-later-label"
                      style="position:absolute; right:44px; bottom:14px; color:#e02735; font-size:12px; font-weight:600;
                             opacity:0; transform:translateX(6px); transition:opacity .15s ease, transform .15s ease;
                             pointer-events:none; white-space:nowrap;">
                    ${labelText}
                </span>
            </div>
        `;
        posterDiv.appendChild(infoDiv);

        // Show More button event
        const showMoreBtn = infoDiv.querySelector('.show-more-poster-info-btn');
        if (showMoreBtn) {
            showMoreBtn.onclick = (e) => {
                e.stopPropagation();
                // Just pass the existing poster URL; no fetch/HEAD here
                showMorePosterInfo({
                    id,
                    mediaType,
                    poster,      // same as card image
                    title,
                    year,
                    date,
                    overview,
                    isTV
                });
            };
        }

        // Card Play button event (calls openPlayer)
        const cardPlayBtn = infoDiv.querySelector('.card-play-btn');
        if (cardPlayBtn) {
            cardPlayBtn.onclick = (e) => {
                e.stopPropagation();
                e.preventDefault();

                const type = mediaType === 'tv' ? 'tv' : 'movie';

                // For TV, prefer lastSeasonNum (if available); for movies, season 1
                const seasonToOpen = type === 'tv'
                    ? (lastSeasonNum || 1)
                    : 1;

                openPlayer(type, id, seasonToOpen, 1);
            };
            const wlBtn = infoDiv.querySelector('.watch-later-btn');
            const wlLabel = infoDiv.querySelector('.watch-later-label');

            const updateWatchLaterUI = (isSaved) => {
                // set the icon html per state
                wlBtn.innerHTML = isSaved
                    ? '<span class="material-symbols-outlined" aria-hidden="true">playlist_add_check</span>'
                    : '<span class="material-symbols-outlined" aria-hidden="true">playlist_add</span>';
                const text = isSaved ? 'Remove from Watch Later' : 'Add to Watch Later';
                wlBtn.title = text;
                wlBtn.setAttribute('aria-label', text);
                wlLabel.textContent = text;
            };

            if (wlBtn && wlLabel) {
                wlBtn.addEventListener('mouseenter', () => {
                    wlLabel.style.opacity = '1';
                    wlLabel.style.transform = 'translateX(0)';
                });
                wlBtn.addEventListener('mouseleave', () => {
                    wlLabel.style.opacity = '0';
                    wlLabel.style.transform = 'translateX(6px)';
                });
                wlBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const nowSaved = toggleWatchLater({
                        id,
                        mediaType,
                        title: safeTitle,
                        poster,
                        date: date || '',
                        year: year || ''
                    });
                    updateWatchLaterUI(nowSaved);
                    wlBtn.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 200 });
                });
            }
        }
    }

    return posterDiv;
}

// Helper to fetch full TMDB details and credits for more poster info
async function fetchMorePosterInfo(id, mediaType) {
    const apiType = mediaType === 'tv' ? 'tv' : 'movie';
    const detailsUrl = `https://api.themoviedb.org/3/${apiType}/${id}?api_key=${apiKey}`;
    const creditsUrl = `https://api.themoviedb.org/3/${apiType}/${id}/credits?api_key=${apiKey}`;

    let details = {};
    let credits = {};

    try {
        const [detailsRes, creditsRes] = await Promise.all([
            fetch(detailsUrl).then(r => r.json()),
            fetch(creditsUrl).then(r => r.json())
        ]);
        details = detailsRes || {};
        credits = creditsRes || {};
    } catch (e) {
        // fallback: empty objects
    }

    // Parse genres
    const genres = (details.genres || []).map(g => g.name).join(', ');
    // Vote average
    const voteAverage = details.vote_average || '';
    // Runtime
    const runtime = mediaType === 'tv'
        ? (details.episode_run_time && details.episode_run_time.length ? details.episode_run_time[0] : '')
        : details.runtime || '';
    // Seasons/Episodes
    const numSeasons = details.number_of_seasons || '';
    const numEpisodes = details.number_of_episodes || '';
    // Backdrop
    const backdrop = details.backdrop_path ? `https://image.tmdb.org/t/p/original${details.backdrop_path}` : '';
    // Cast (first 6)
    const castArr = (credits.cast || []).slice(0, 6);
    // Crew (directors/writers)
    const crew = (credits.crew || []).filter(c => ['Director', 'Writer', 'Screenplay'].includes(c.job)).map(c => `${c.name} (${c.job})`).join(', ');

    // NEW: networks (for TV) / production companies (for movies) with logos
    const networks = Array.isArray(details.networks) ? details.networks : [];
    const productionCompanies = Array.isArray(details.production_companies) ? details.production_companies : [];

    return {
        genres,
        voteAverage,
        runtime,
        numSeasons,
        numEpisodes,
        backdrop,
        castArr,
        crew,
        networks,
        productionCompanies
    };
}

// Update showMorePosterInfo to style Play button as a red circle and move Watch Later below Play
async function showMorePosterInfo({ id, mediaType, poster, title, year, date, overview, isTV }) {
    // 1. Start with the exact poster used in search/grid
    let posterUrl = poster || '';

    // 2. Local generated path, used only as a fallback in onerror
    const localGeneratedPoster = `posters/${mediaType === 'tv' ? 'tv' : 'movie'}_${id}.png`;

    // 3. Fetch extra info (unchanged)
    const extra = await fetchMorePosterInfo(id, mediaType);

    // Build / show dimmer (unchanged) ...
    let dimmer = document.getElementById('player-dimmer');
    if (!dimmer) {
        dimmer = document.createElement('div');
        dimmer.id = 'player-dimmer';
        dimmer.style.position = 'fixed';
        dimmer.style.top = '0';
        dimmer.style.left = '0';
        dimmer.style.width = '100vw';
        dimmer.style.height = '100vh';
        dimmer.style.background = 'rgba(0,0,0,0.95)';
        dimmer.style.zIndex = '9998';
        dimmer.style.transition = 'background 0.2s';
        document.body.appendChild(dimmer);
    } else {
        dimmer.style.display = 'block';
    }

    const modal = document.createElement('div');
    modal.id = 'more-poster-info-modal';
    modal.style.position = 'fixed';
    modal.style.top = '50%';
    modal.style.left = '50%';
    // Start fully hidden and scaled down
    modal.style.opacity = '0';
    modal.style.transform = 'translate(-50%, -50%) scale(0)';
    modal.style.transition = 'opacity 0.45s cubic-bezier(.4,0,.2,1), transform 0.45s cubic-bezier(.4,0,.2,1), background 2s';
    modal.style.width = '900px';
    modal.style.minHeight = '520px';
    modal.style.background = 'rgba(0,0,0,0.85)';
    modal.style.borderRadius = '0px';
    modal.style.boxShadow = '0 4px 24px rgba(0,0,0,0.25)';
    modal.style.padding = '36px 36px 24px 36px';
    modal.style.overflowY = 'auto';
    modal.style.zIndex = '9999';

    // ...existing code for backdrop, innerHTML, etc...
    if (extra.backdrop) {
        modal.style.backgroundImage = `linear-gradient(to bottom, rgba(0,0,0,0.85) 60%, rgba(0,0,0,0.98)), url('${extra.backdrop}')`;
        modal.style.backgroundSize = 'cover';
        modal.style.backgroundPosition = 'center';
    }

    document.body.appendChild(modal);

    // Animate scale and opacity in
    requestAnimationFrame(() => {
        modal.style.opacity = '1';
        modal.style.transform = 'translate(-50%, -50%) scale(1)';
    });


    // Cast HTML (unchanged skeleton)
    let castHtml = '';
    if (extra.castArr && extra.castArr.length) {
        castHtml = `<div style="display:flex;gap:24px;margin-top:18px;margin-bottom:8px;">`;
        extra.castArr.forEach(person => {
            const profile = person.profile_path
                ? `https://image.tmdb.org/t/p/w185${person.profile_path}`
                : placeholderImage;
            castHtml += `
              <div style="display:flex;flex-direction:column;align-items:center;width:90px;">
                <img src="${profile}" alt="${person.name}" style="width:90px;height:90px;object-fit:cover;border-radius:50%;box-shadow:0 2px 6px #000;">
                <div style="margin-top:6px;font-size:0.7rem;text-align:center;color:#fff;">${person.name}</div>
              </div>`;
        });
        castHtml += `</div>`;
    }

    const isSaved = isInWatchLater(id, mediaType);
    const playBtnId = 'more-poster-play-btn';
    const wlBtnId = 'more-poster-watchlater-btn';
    const wlLabelId = 'more-poster-watchlater-label';
    const wlBtnSymbol = isSaved
        ? '<span class="material-symbols-outlined" aria-hidden="true">playlist_add_check</span>'
        : '<span class="material-symbols-outlined" aria-hidden="true">playlist_add</span>';
    const wlLabelText = isSaved ? 'Remove from Watch Later' : 'Add to Watch Later';

    modal.innerHTML = `
        <button id="close-more-poster-info" style="position:absolute;top:18px;right:18px;background:none;border:none;cursor:pointer;color:#FFF;z-index:2;">
          <span class="material-symbols-outlined" style="font-size:2em;">close_small</span>
        </button>
        <div style="display:flex;gap:36px;">
            <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;">
                <img id="modal-poster" src="${posterUrl}" alt="${title}" style="width:180px;border-radius:0px;object-fit:cover;box-shadow:0 2px 12px #000;">
                <div style="display:flex;flex-direction:column;align-items:center;width:100%;margin-top:18px;">
                    <button id="${playBtnId}"
                        style="width:36px;height:36px;background-color:transparent;border-style:none;color:#e02735;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;line-height:1;cursor:pointer;">
                        <span class="material-symbols-outlined" style="font-size:30px;line-height:1;">play_circle</span>
                    </button>
                    <div style="display:flex;flex-direction:column;align-items:center;">
                        <button id="${wlBtnId}"
                            aria-label="${wlLabelText}"
                            title="${wlLabelText}"
                            style="width:36px;height:36px;border-radius:50%;background:none;color:#e02735;border-style:none;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;line-height:1;cursor:pointer;">
                            ${wlBtnSymbol}
                        </button>
                        <span id="${wlLabelId}"
                            style="margin-top:6px;color:#e02735;font-size:12px; font-weight:600;opacity:1;pointer-events:none;white-space:nowrap;">
                            ${wlLabelText}
                        </span>
                    </div>
                </div>
            </div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:2em;font-weight:700;color:#fff;text-shadow:0 2px 8px #000;">${title}</div>
                <div style="color:#e02735;font-weight:600;margin-bottom:6px;font-size:1.1em;">${year || ''} ${isTV ? 'TV Show' : 'Movie'}</div>
                <div style="margin-bottom:14px;color:#fff;font-size:1.08em;font-family:'OumaTrialLight';">${overview || 'No description available.'}</div>
                <div style="font-size:1.08em;color:#FFF;margin-bottom:10px;">
                    ${(extra.genres ? extra.genres.split(',').map(g => `<span class="showcase-tag">${g.trim()}</span>`).join(' ') : '<span class="showcase-tag">N/A</span>')}<br><br>
                    <b>Release Date:</b> ${date || 'N/A'}  ${extra.runtime ? `<b>&nbsp;Runtime:</b> ${extra.runtime + ' min'} ` : ''}<b>&nbsp;Rating:</b> ${extra.voteAverage || 'N/A'}<br><br>
                    ${isTV ? `<b>Seasons:</b> ${extra.numSeasons || 'N/A'} <b>&nbsp;Episodes:</b> ${extra.numEpisodes || 'N/A'}<br>` : ''}<br>
                </div>
                <div style="font-size:1.08em;color:#e02735;margin-bottom:8px;"><b>Cast:</b></div>
                ${castHtml}
                <div style="font-size:1.08em;color:#e02735;margin-top:10px;">
                    ${extra.crew ? `<b>Crew:</b> <span style="color:#FFF">${extra.crew}</span>` : ''}
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // 4. Robust onerror chain: TMDB → local file → placeholder
    const modalPoster = modal.querySelector('#modal-poster');
    if (modalPoster) {
        let triedLocal = false;
        modalPoster.onerror = () => {
            if (!triedLocal) {
                // First failure: try local generated poster
                triedLocal = true;
                modalPoster.src = localGeneratedPoster;
            } else {
                // Second failure: give up and use placeholder
                modalPoster.src = placeholderImage;
            }
        };
    }

    const closeBtn = modal.querySelector('#close-more-poster-info');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.remove();
            if (dimmer) dimmer.style.display = 'none';
        });
    }
    dimmer.onclick = () => {
        modal.remove();
        if (dimmer) dimmer.style.display = 'none';
    };

    // Play button
    const playBtn = modal.querySelector(`#${playBtnId}`);
    if (playBtn) {
        playBtn.addEventListener('click', () => {
            openPlayer(mediaType, id, 1);
            modal.remove();
            if (dimmer) dimmer.style.display = 'none';
        });
    }

    // Watch Later toggle
    const wlBtnEl = modal.querySelector(`#${wlBtnId}`);
    const wlLabelEl = modal.querySelector(`#${wlLabelId}`);
    if (wlBtnEl) {
        wlBtnEl.addEventListener('click', () => {
            const added = toggleWatchLater({ id, mediaType, title, poster: posterUrl, poster_path: posterUrl, year, date });
            wlBtnEl.innerHTML = added
                ? '<span class="material-symbols-outlined" aria-hidden="true">playlist_add_check</span>'
                : '<span class="material-symbols-outlined" aria-hidden="true">playlist_add</span>';
            if (wlLabelEl) wlLabelEl.textContent = added ? 'Remove from Watch Later' : 'Add to Watch Later';
        });
    }
}

// --- RESTORED: sources + grids + watch-later/continue helpers ---

let SOURCES = { VO: [], VF: [] };

async function loadSources() {
    try {
        const res = await fetch('sources.json');
        const arr = await res.json();
        SOURCES.VO = arr[0]?.VO || [];
        SOURCES.VF = arr[1]?.VF || [];
    } catch (e) {
        console.warn('Could not load sources.json:', e);
        SOURCES = { VO: [], VF: [] };
    }
}
loadSources();

function showServerIndicators(onSwitchVO, onSwitchVF) {
    if (!playerContainer) return;
    let container = playerContainer.querySelector('#server-indicators');
    if (!container) {
        container = document.createElement('div');
        container.id = 'server-indicators';
        playerContainer.prepend(container);
    }
    container.innerHTML = '';

    const addGroup = (labelText, list, isActive, onClick, marginLeft = '0') => {
        const label = document.createElement('span');
        label.textContent = labelText;
        label.style.color = '#fff';
        label.style.fontWeight = '600';
        label.style.marginLeft = marginLeft;
        label.style.marginRight = '8px';
        container.appendChild(label);

        (list || []).forEach((srv, idx) => {
            const ind = document.createElement('div');
            ind.className = 'indicator' + (isActive(idx) ? ' active' : '');
            ind.title = srv.name;
            ind.style.display = 'inline-block';
            ind.onclick = () => onClick(idx);
            container.appendChild(ind);
        });
    };

    addGroup('VO : ', SOURCES.VO, (idx) => activeType === 'VO' && activeVOIdx === idx, (idx) => {
        activeType = 'VO'; activeVOIdx = idx; onSwitchVO(idx);
    });

    addGroup('  VF : ', SOURCES.VF, (idx) => activeType === 'VF' && activeVFIdx === idx, (idx) => {
        activeType = 'VF'; activeVFIdx = idx; onSwitchVF(idx);
    }, '16px');

    container.style.display = 'flex';
    container.style.alignItems = 'center';
}

function loadGrid(jsonPath, gridId) {
    fetch(jsonPath)
        .then(res => res.json())
        .then(data => {
            const shows = [...(data.movies || []), ...(data.tv_shows || [])];
            shuffle(shows);
            const grid = document.getElementById(gridId);
            if (!grid) return;
            grid.innerHTML = '';

            const today = new Date();
            const upcoming = [];

            shows.forEach(show => {
                const tmdb_id = show.id;
                const mediaType = show.media_type || (show.seasons ? 'tv' : 'movie');
                const poster = show.poster_path
                    ? `posters/${mediaType === 'tv' ? 'tv' : 'movie'}_${tmdb_id}.png`
                    : placeholderImage;
                const title = show.title || show.name || '';
                const date = show.release_date || show.first_air_date || '';
                const year = date ? date.slice(0, 4) : '';
                const overview = show.overview || '';
                const isTV = mediaType === 'tv';
                const lastSeason = isTV && show.seasons ? show.seasons[show.seasons.length - 1] : null;
                const lastSeasonNum = lastSeason?.season_number || '';
                const lastSeasonEpisodes = lastSeason?.episode_count || '';

                if (!tmdb_id) return;
                if (!poster || poster === placeholderImage) return; // Skip if no poster

                if (date) {
                    const releaseDate = new Date(date);
                    if (releaseDate > today) {
                        upcoming.push(show);
                        return;
                    }
                }

                const last_season = isTV && show.seasons ? (show.seasons[show.seasons.length - 1]?.season_number || 1) : 1;

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
                    onClick: () => openPlayer(mediaType, tmdb_id, last_season),
                    withPreview: gridId
                });

                grid.appendChild(card);
            });

            // window.upcomingList = upcoming; // reserved if needed
        })
        .catch(err => console.warn('loadGrid error:', err));
}

// Watch Later storage helpers
function getWatchLater() {
    try { return JSON.parse(localStorage.getItem('watchLater') || '[]'); } catch { return []; }
}
function setWatchLater(list) {
    localStorage.setItem('watchLater', JSON.stringify(list));
}

// NEW: stable key + normalization/dedupe helpers
function wlKey(id, mediaType) {
    const mid = String(id ?? '').trim();
    const mtype = String(mediaType ?? '').toLowerCase().trim();
    return mid && mtype ? `${mid}:${mtype}` : '';
}
function itemKey(it) {
    return wlKey(it?.id, it?.mediaType ?? it?.type);
}
function normalizeAndDedupeWatchLater(list) {
    const map = new Map();
    for (const it of Array.isArray(list) ? list : []) {
        const id = String(it?.id ?? '').trim();
        const mediaType = String((it?.mediaType ?? it?.type ?? '')).toLowerCase().trim();
        if (!id || !mediaType) continue;

        const key = wlKey(id, mediaType);
        const updatedAt = it?.updatedAt ?? it?.updated_at ?? it?.addedAt ?? 0;

        const normalized = {
            id,
            mediaType,
            title: it?.title ?? it?.name ?? '',
            poster: it?.poster ?? '',
            poster_path: it?.poster_path ?? it?.posterPath ?? it?.poster ?? '',
            date: it?.date ?? '',
            year: it?.year ?? '',
            updatedAt
        };

        const prev = map.get(key);
        if (!prev || (updatedAt || 0) > (prev.updatedAt || 0)) {
            map.set(key, normalized);
        }
    }
    return Array.from(map.values());
}

// Normalize-once migration to clean any past duplicates
(function migrateWatchLaterStoreOnce() {
    try {
        if (localStorage.getItem('watchLater_migrated_v2') === '1') return;
        const fixed = normalizeAndDedupeWatchLater(getWatchLater());
        setWatchLater(fixed);
        localStorage.setItem('watchLater_migrated_v2', '1');
    } catch { }
})();

function removeFromWatchLater(id, mediaType) {
    const targetKey = wlKey(id, mediaType);
    const list = getWatchLater().filter(x => itemKey(x) !== targetKey);
    setWatchLater(list);
    try { loadWatchLater(); } catch { }
}
function isInWatchLater(id, mediaType) {
    const key = wlKey(id, mediaType);
    if (!key) return false;
    return getWatchLater().some(x => itemKey(x) === key);
}
function toggleWatchLater(item) {
    const list = getWatchLater();
    const key = wlKey(item?.id, item?.mediaType);
    const idx = list.findIndex(x => itemKey(x) === key);
    let added;

    if (idx >= 0) {
        // Remove existing
        list.splice(idx, 1);
        added = false;
    } else {
        // Add normalized
        const toAdd = {
            id: String(item.id),
            mediaType: String(item.mediaType).toLowerCase(),
            title: item.title || '',
            poster: item.poster || '',
            poster_path: item.poster_path || '',
            date: item.date || '',
            year: item.year || '',
            updatedAt: Date.now()
        };
        list.push(toAdd);
        added = true;
    }

    // Ensure no dupes get saved even under race conditions
    setWatchLater(normalizeAndDedupeWatchLater(list));
    try { loadWatchLater(); } catch { }
    return added;
}

// Safely truncate overview text
function truncateOverview(text, maxLength = 120) {
    if (!text || typeof text !== 'string') return '';
    return text.length > maxLength ? text.slice(0, maxLength).trim() + '...' : text;
}

// filepath: /home/akr/Desktop/scripts/atishramkhe.github.io/movies/search.js
// Continue Watching loader (unchanged behavior, respects auto-remove threshold)
function loadContinueWatching() {
    // Try known ids first
    let section = document.getElementById('continueSection')
        || document.getElementById('continueWatchingSection');

    // Fallback: find section whose h2 text matches "Continue Watching"
    if (!section) {
        section = Array.from(document.querySelectorAll('section')).find(s => {
            const h2 = s.querySelector('h2');
            return h2 && h2.textContent.trim().toLowerCase() === 'continue watching';
        }) || null;
    }

    const continueGrid = document.getElementById('continueGrid');
    if (!continueGrid) return;

    // Always show the section (don’t hide it when empty)
    if (section) section.style.display = 'block';
    continueGrid.innerHTML = '';

    // --- Add Show All/Less and Clear Button to header row, both right-aligned ---
    let headerRow = section.querySelector('.section-header-row');
    if (!headerRow) {
        const heading = section.querySelector('h2, h3, .section-title, .title');
        headerRow = document.createElement('div');
        headerRow.className = 'section-header-row';
        headerRow.style.display = 'flex';
        headerRow.style.alignItems = 'center';
        headerRow.style.justifyContent = 'space-between';
        headerRow.style.marginBottom = '8px';
        if (heading) {
            section.insertBefore(headerRow, heading);
            heading.style.margin = '0';
            headerRow.appendChild(heading);
        } else {
            const t = document.createElement('span');
            t.className = 'section-title';
            t.textContent = 'Continue Watching';
            t.style.fontWeight = '600';
            t.style.fontSize = '1.1rem';
            headerRow.appendChild(t);
            section.insertBefore(headerRow, section.firstChild);
        }
    }

    // --- Create a right-aligned button group ---
    let buttonGroup = headerRow.querySelector('.continue-btn-group');
    if (!buttonGroup) {
        buttonGroup = document.createElement('div');
        buttonGroup.className = 'continue-btn-group';
        buttonGroup.style.display = 'flex';
        buttonGroup.style.gap = '8px';
        buttonGroup.style.alignItems = 'center';
        buttonGroup.style.marginLeft = 'auto';
        headerRow.appendChild(buttonGroup);
    }

    // --- Show All/Less Button ---
    let showAllBtn = buttonGroup.querySelector('#continueShowAllBtn');
    // Do not read 'expanded' here to avoid redeclaration/TDZ; compute toggle state at click time.
    if (!showAllBtn) {
        showAllBtn = document.createElement('button');
        showAllBtn.id = 'continueShowAllBtn';
        showAllBtn.style.background = 'transparent';
        showAllBtn.style.font = 'inherit';
        showAllBtn.style.border = '1px solid #444444ff';
        showAllBtn.style.color = '#444444ff';
        showAllBtn.style.padding = '4px 10px';
        showAllBtn.style.borderRadius = '4px';
        showAllBtn.style.cursor = 'pointer';
        showAllBtn.style.fontSize = '0.9em';
        showAllBtn.onclick = () => {
            continueShowAllExpanded = !continueShowAllExpanded;
            loadContinueWatching();
        };
        buttonGroup.appendChild(showAllBtn);
    }
    // The button text and visibility will be set later after items are computed (where 'expanded' is declared once).

    // --- Clear Button ---
    let clearBtn = buttonGroup.querySelector('#continueClearBtn');
    if (!clearBtn) {
        clearBtn = document.createElement('button');
        clearBtn.id = 'continueClearBtn';
        clearBtn.textContent = 'Clear';
        clearBtn.style.background = 'transparent';
        clearBtn.style.font = 'inherit';
        clearBtn.style.border = '1px transparent';
        clearBtn.style.color = '#444444ff';
        clearBtn.style.padding = '4px 10px';
        clearBtn.style.borderRadius = '4px';
        clearBtn.style.cursor = 'pointer';
        clearBtn.style.fontSize = '0.9em';
        clearBtn.title = 'Clear all Continue Watching data';
        clearBtn.onmouseover = function () {
            clearBtn.style.color = '#e02735';
        };
        clearBtn.onmouseout = function () {
            clearBtn.style.color = '#444444ff';
        };
        clearBtn.onclick = function () {
            if (window.confirm('Are you sure you want to clear all Continue Watching data? This cannot be undone.')) {
                // Remove all progress_* keys from localStorage
                const keysToRemove = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith('progress_')) keysToRemove.push(key);
                }
                keysToRemove.forEach(k => localStorage.removeItem(k));
                loadContinueWatching();
            }
        };
        buttonGroup.appendChild(clearBtn);
    }

    const byKey = new Map();
    const threshold = WATCH_LATER_POLICY?.removeWhenProgressGte;

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('progress_')) continue;
        try {
            const raw = JSON.parse(localStorage.getItem(key));
            const norm = normalizeProgress(raw, key);
            if (!norm || !norm.id || !norm.mediaType) continue;

            // Auto-remove if >= threshold
            if (typeof threshold === 'number') {
                const frac = fractionFromProgress(norm);
                if (frac != null && frac >= threshold) {
                    removeFromContinueWatching(norm.id, norm.mediaType);
                    continue;
                }
            }

            const composite = `${norm.id}:${norm.mediaType}`;
            const prev = byKey.get(composite);
            if (!prev || (norm.updatedAt || 0) > (prev.updatedAt || 0)) {
                byKey.set(composite, norm);
            }
        } catch { }
    }

    const all = Array.from(byKey.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    // If still empty, show placeholder text
    if (all.length === 0) {
        continueGrid.innerHTML = `
            <div style="grid-column:1 / -1; padding:24px; text-align:center; opacity:.7; font-family:inherit; font-size:1.05em;">
                Start watching a movie or episode and it will appear here...
            </div>
        `;
        // No toggle button when empty
        return;
    }

    const expanded = continueShowAllExpanded;
    if (showAllBtn) {
        showAllBtn.textContent = expanded ? 'Show Less' : 'Show All';
        showAllBtn.style.display = all.length > SECTION_SHOW_LIMIT ? 'inline-block' : 'none';
    }

    const renderItems = expanded ? all : all.slice(0, SECTION_SHOW_LIMIT);

    const posterPromises = renderItems.map(async data => {
        let poster = `posters/${data.mediaType === 'tv' ? 'tv' : 'movie'}_${data.id}.png`;
        let title = data.title || data.name || 'Unknown Title';

        const localOk = await fetch(poster, { method: 'HEAD' }).then(r => r.ok).catch(() => false);
        if (!localOk) {
            if (data.poster_path) {
                poster = `https://image.tmdb.org/t/p/w500${data.poster_path}`;
            } else {
                const tmdbUrl = data.mediaType === 'movie'
                    ? `https://api.themoviedb.org/3/movie/${data.id}?api_key=${apiKey}`
                    : `https://api.themoviedb.org/3/tv/${data.id}?api_key=${apiKey}`;
                try {
                    const r = await fetch(tmdbUrl);
                    if (r.ok) {
                        const j = await r.json();
                        if (j.poster_path) poster = `https://image.tmdb.org/t/p/w500${j.poster_path}`;
                        if (j.title || j.name) title = j.title || j.name;
                    }
                } catch { }
            }
        }
        if (!poster) poster = placeholderImage;

        return { data, poster, title };
    });

    Promise.all(posterPromises).then(results => {
        results.forEach(({ data, poster, title }) => {
            const div = document.createElement('div');
            div.className = 'poster';
            div.style.position = 'relative';

            let percent = 0;
            if (typeof data.progress === 'number') {
                percent = data.progress <= 1 ? Math.round(data.progress * 100) : Math.round(data.progress);
            } else if (data.duration && data.timestamp) {
                percent = Math.round((data.timestamp / data.duration) * 100);
            }
            percent = Math.min(100, Math.max(0, percent));

            div.innerHTML = `
                <img src="${poster}" alt="${title}">
                <div style="width:100%;height:6px;background:#222;margin-top:4px;overflow:hidden;">
                    <div style="width:${percent}%;height:100%;background:#e02735;"></div>
                </div>
            `;

            div.onclick = () => openPlayer(
                data.mediaType,
                data.id,
                (data.season ?? data.lastSeason ?? 1),
                (data.episode ?? 1)
            );

            const removeBtn = document.createElement('button');
            removeBtn.innerHTML = '&times;';
            removeBtn.title = 'Remove';
            Object.assign(removeBtn.style, {
                position: 'absolute',
                top: '6px',
                right: '8px',
                background: 'rgba(0,0,0,0.7)',
                color: '#fff',
                border: 'none',
                fontSize: '1.5em',
                cursor: 'pointer',
                padding: '0 6px',
                borderRadius: '50%',
                display: 'none',
                zIndex: '2'
            });
            div.addEventListener('mouseenter', () => { removeBtn.style.display = 'block'; });
            div.addEventListener('mouseleave', () => { removeBtn.style.display = 'none'; });
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                removeFromContinueWatching(data.id, data.mediaType);
                loadContinueWatching();
            };
            div.appendChild(removeBtn);
            continueGrid.appendChild(div);
        });
    });
}

// filepath: /home/akr/Desktop/scripts/atishramkhe.github.io/movies/search.js
// Watch Later loader (uses deduped store)
function loadWatchLater() {
    const section = document.getElementById('watchLaterSection');
    const grid = document.getElementById('watchLaterGrid');
    if (!section || !grid) return;

    const rawList = getWatchLater();
    // Sort so newest (highest updatedAt) is first -> appears at left
    const list = normalizeAndDedupeWatchLater(rawList)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (!list.length) {
        grid.innerHTML = `
            <div style="grid-column:1 / -1; padding:24px; text-align:center; opacity:.7; font-family:inherit; font-size:1.05em;">
                Add a movie or episode to Watch Later and it will appear here...
            </div>
        `;
        // No toggle button when empty
        return;
    }
    section.style.display = 'block';
    grid.innerHTML = '';

    const expanded = watchLaterShowAllExpanded;
    ensureSectionToggleButton(section, {
        buttonId: 'watchLaterShowAllBtn',
        onClick: () => {
            watchLaterShowAllExpanded = !watchLaterShowAllExpanded;
            loadWatchLater();
        },
        shouldShow: list.length > SECTION_SHOW_LIMIT,
        isExpanded: expanded,
        fallbackTitle: 'Watch Later'
    });

    const renderItems = expanded ? list : list.slice(0, SECTION_SHOW_LIMIT);

    const posterPromises = renderItems.map(async (it) => {
        const id = it.id;
        const mediaType = it.mediaType;
        let poster = `posters/${mediaType === 'tv' ? 'tv' : 'movie'}_${id}.png`;
        let title = it.title || 'Unknown Title';

        // Only HEAD-check local poster file (relative path => safe)
        const localOk = await fetch(poster, { method: 'HEAD' }).then(r => r.ok).catch(() => false);

        if (!localOk) {
            const tmdbPath = it.poster_path || it.poster;

            if (tmdbPath && !isRemoteUrl(tmdbPath)) {
                poster = `${imageBaseUrl}${tmdbPath}`;
            } else if (tmdbPath && isRemoteUrl(tmdbPath)) {
                poster = tmdbPath;
            } else {
                poster = placeholderImage;
            }
        }

        return { it, poster, title };
    });

    Promise.all(posterPromises).then(cards => {
        cards.forEach(({ it, poster, title }) => {
            if (!poster || poster === placeholderImage) return;
            const div = document.createElement('div');
            div.className = 'poster';
            div.style.position = 'relative';
            div.innerHTML = `<img src="${poster}" alt="${title}">`;
            div.onclick = () => openPlayer(it.mediaType, it.id, (it.season ?? it.lastSeason ?? 1), (it.episode ?? 1));

            const removeBtn = document.createElement('button');
            removeBtn.innerHTML = '&times;';
            removeBtn.title = 'Remove';
            Object.assign(removeBtn.style, {
                position: 'absolute',
                top: '6px',
                right: '8px',
                background: 'rgba(0,0,0,0.7)',
                color: '#fff',
                border: 'none',
                fontSize: '1.5em',
                cursor: 'pointer',
                padding: '0 6px',
                borderRadius: '50%',
                display: 'none',
                zIndex: '2'
            });

            div.addEventListener('mouseenter', () => { removeBtn.style.display = 'block'; });
            div.addEventListener('mouseleave', () => { removeBtn.style.display = 'none'; });

            removeBtn.onclick = (e) => {
                e.stopPropagation();
                removeFromWatchLater(it.id, it.mediaType);
            };

            div.appendChild(removeBtn);
            grid.appendChild(div);
        });
    });
}

// filepath: /home/akr/Desktop/scripts/atishramkhe.github.io/movies/search.js
function initHome() {
    loadGrid('titles/netflix_xmas_2025.json', 'netflixXmasGrid');
    loadGrid('titles/best_xmas.json', 'bestXmasGrid');
    loadGrid('titles/trending.json', 'trendingGrid');
    loadGrid('titles/new.json', 'newGrid');
    loadGrid('titles/netflixfrance.json', 'netflixfranceGrid');
    loadGrid('titles/bollywood.json', 'bollywoodGrid');
    loadGrid('titles/kdramas.json', 'kdramaGrid');

    // New genre sections
    loadGrid('titles/horror.json', 'horrorGrid');
    loadGrid('titles/animation.json', 'animationGrid');
    loadGrid('titles/action.json', 'actionGrid');
    loadGrid('titles/fantasy.json', 'fantasyGrid');
    loadGrid('titles/drama.json', 'dramaGrid');
    loadGrid('titles/thriller.json', 'thrillerGrid');
    loadGrid('titles/adventure.json', 'adventureGrid');
    loadGrid('titles/romance.json', 'romanceGrid');
    loadGrid('titles/scifi.json', 'scifiGrid');
    loadGrid('titles/family.json', 'familyGrid');
    loadGrid('titles/crime.json', 'crimeGrid');
    loadGrid('titles/comedy.json', 'comedyGrid');

    // New country grids
    loadGrid('titles/thailand.json', 'thailandGrid');
    loadGrid('titles/china.json', 'chinaGrid');
    loadGrid('titles/taiwan.json', 'taiwanGrid');
    loadGrid('titles/philippines.json', 'philippinesGrid');
    loadGrid('titles/japan.json', 'japanGrid');
    loadGrid('titles/hongkong.json', 'hongkongGrid');

    loadContinueWatching();
    loadWatchLater();
}

// --- Home initialization (simple, single-run) ---

(function startHomeInit() {
    // Defensive: if this file is loaded as a module or in an unusual scope,
    // expose the loaders so other inline scripts (or future calls) can reach them.
    try {
        if (typeof window !== 'undefined') {
            window.loadGrid = window.loadGrid || loadGrid;
            window.loadContinueWatching = window.loadContinueWatching || loadContinueWatching;
            window.loadWatchLater = window.loadWatchLater || loadWatchLater;
        }
    } catch { }

    const start = () => {
        // Run once
        if (start._ran) /* prevent double-run */ return;
        start._ran = true;
        initHome();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        // DOM is already parsed; schedule after current task

        setTimeout(start, 0);
    }
})();

// --- Platform Section Logic ---
const platformButtons = document.querySelectorAll('.platform-btn');
const platformSection = document.getElementById('platform-section');
const platformTitle = document.getElementById('platform-title');
const platformTrendingGrid = document.getElementById('platformTrendingGrid');
const platformNewGrid = document.getElementById('platformNewGrid');

// TMDB network/platform IDs (update as needed)
const platformTMDB = {
    netflix: 213,
    prime: 1024,
    disneyplus: 2739,
    hbomax: 8304,
    paramountplus: 2076,
    hulu: 453,
    peacock: 3353,
    appletv: 2552,
    amcplus: 4661,
    mgmplus: 6219
};

const platformNames = {
    netflix: 'Netflix',
    prime: 'Prime Video',
    disneyplus: 'Disney+',
    hbomax: 'HBO Max',
    paramountplus: 'Paramount+',
    hulu: 'Hulu',
    peacock: 'Peacock',
    appletv: 'Apple TV',
    amcplus: 'AMC+',
    mgmplus: 'MGM+'
};

// Helper: fetch TMDB discover for a network/platform
async function fetchPlatformData(networkId, sortBy, limit) {
    if (!networkId) return [];
    const url = `https://api.themoviedb.org/3/discover/tv?api_key=${apiKey}&with_networks=${networkId}&sort_by=${sortBy}&language=en-US`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        return (data.results || []).slice(0, limit);
    } catch (e) {
        console.warn('TMDB fetch error:', e);
        return [];
    }
}

// Helper: render grid with TMDB results
function renderPlatformGrid(results, gridEl) {
    gridEl.innerHTML = '';
    const today = new Date();
    results
        .filter(item => {
            const dateStr = item.first_air_date || item.release_date || '';
            if (!dateStr) return false;
            const releaseDate = new Date(dateStr);
            return releaseDate <= today;
        })
        .forEach(item => {
            const id = item.id;
            const mediaType = 'tv'; // All are TV shows for network filter
            const title = item.name || item.title || 'Untitled';
            const date = item.first_air_date || item.release_date || '';
            const year = date ? date.slice(0, 4) : '';
            const overview = item.overview || '';
            const poster = item.poster_path ? `${imageBaseUrl}${item.poster_path}` : placeholderImage;
            const card = buildPosterCard({
                id,
                mediaType,
                poster,
                title,
                year,
                date,
                overview,
                isTV: true,
                lastSeasonNum: null,
                lastSeasonEpisodes: null,
                onClick: () => openPlayer(mediaType, id, 1),
                withPreview: true
            });
            gridEl.appendChild(card);
        });
}

// Main button click logic
platformButtons.forEach(btn => {
    btn.addEventListener('click', async function () {
        platformButtons.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        const platform = btn.getAttribute('data-platform');
        if (platform === 'all') {
            platformSection.style.display = 'none';
            platformTrendingGrid.innerHTML = '';
            platformNewGrid.innerHTML = '';
            platformTitle.textContent = '';
            return;
        }
        platformSection.style.display = '';
        platformTitle.textContent = platformNames[platform] || platform;

        // Shadowz: fallback to empty or custom logic
        if (!platformTMDB[platform]) {
            platformTrendingGrid.innerHTML = '<div style="padding:24px;">No data available for Shadowz.</div>';
            platformNewGrid.innerHTML = '';
            return;
        }

        // Fetch and render trending (popularity) and new (recent first air date)
        platformTrendingGrid.innerHTML = '<div style="padding:24px;">Loading...</div>';
        platformNewGrid.innerHTML = '<div style="padding:24px;">Loading...</div>';
        const [trending, newest] = await Promise.all([
            fetchPlatformData(platformTMDB[platform], 'popularity.desc', 70),
            fetchPlatformData(platformTMDB[platform], 'first_air_date.desc', 15)
        ]);
        renderPlatformGrid(trending, platformTrendingGrid);
        renderPlatformGrid(newest, platformNewGrid);
    });
});

// ...place this helper near other utility functions (before openPlayer) ...

function ensureProgressPlaceholder({ type, id, season = 1, episode = 1 }) {
    if (!id || !type) return;
    type = canonicalType(type);
    const key = `progress_${id}_${type}`;
    // If an entry already exists, update season/episode if TV, but don't overwrite existing progress > 0
    let existing = null;
    try { existing = JSON.parse(localStorage.getItem(key) || 'null'); } catch { }
    const now = Date.now();

    if (existing) {
        let changed = false;
        if (type === 'tv') {
            if (Number(existing.season) !== Number(season)) { existing.season = Number(season); changed = true; }
            if (Number(existing.episode) !== Number(episode)) { existing.episode = Number(episode); changed = true; }
        }
        if (changed) {
            existing.updatedAt = now;
            localStorage.setItem(key, JSON.stringify(existing));
        }
        return;
    }

    const placeholder = {
        id,
        type,
        mediaType: type,
        progress: 0,
        timestamp: 0,
        duration: null,
        season: type === 'tv' ? Number(season) : null,
        episode: type === 'tv' ? Number(episode) : null,
        title: null,
        poster_path: null,
        updatedAt: now
    };
    localStorage.setItem(key, JSON.stringify(placeholder));
}

// Normalize a stored progress record into a consistent shape for Continue Watching
function normalizeProgress(raw, key) {
    if (!raw || typeof raw !== 'object') return null;

    // Extract id/type from key as fallback (progress_<id>_<type>)
    let idFromKey = '';
    let typeFromKey = '';
    const m = /^progress_(\d+)_([a-z]+)/i.exec(key || '');
    if (m) {
        idFromKey = m[1];
        typeFromKey = m[2];
    }

    const id = String(raw.id ?? raw.contentId ?? idFromKey ?? '').trim();
    const mediaTypeRaw = String(raw.mediaType ?? raw.type ?? typeFromKey ?? '').toLowerCase().trim();
    const mediaType = canonicalType(mediaTypeRaw);
    if (!id || !mediaType) return null;

    // Progress can be fractional (0..1) or percent (0..100)
    let progress = null;
    if (typeof raw.progress === 'number') {
        progress = raw.progress;
    } else if (typeof raw.percent === 'number') {
        progress = raw.percent > 1 ? raw.percent / 100 : raw.percent;
    }

    // Timestamp/duration alternative representation
    const timestamp = Number(raw.timestamp ?? raw.currentTime ?? NaN);
    const duration = Number(raw.duration ?? raw.totalDuration ?? NaN);

    // Season / episode info (TV)
    const season = raw.season ?? raw.season_number ?? null;
    const episode = raw.episode ?? raw.episode_number ?? null;
    const lastSeason = raw.lastSeason ?? raw.last_season ?? null;
    const lastEpisode = raw.lastEpisode ?? raw.last_episode ?? null;

    // Title / poster fallbacks
    const title = raw.title ?? raw.name ?? null;
    const poster_path = raw.poster_path ?? raw.posterPath ?? raw.poster ?? null;

    // updatedAt fallback
    const updatedAt = raw.updatedAt ?? raw.updateAt ?? raw.savedAt ?? Date.now();

    return {
        id,
        mediaType,
        progress,
        timestamp: Number.isFinite(timestamp) ? timestamp : null,
        duration: Number.isFinite(duration) ? duration : null,
        season,
        episode,
        lastSeason,
        lastEpisode,
        title,
        poster_path,
        updatedAt
    };
}

(function initShowcase() {
    const showcase = document.getElementById('showcase');
    if (!showcase) return;

    const logoImg = document.getElementById('showcase-logo');
    const titleEl = document.getElementById('showcase-title');
    const yearEl = document.getElementById('showcase-year');
    const ratingEl = document.getElementById('showcase-rating');
    const runtimeEl = document.getElementById('showcase-runtime');
    const platformEl = document.getElementById('showcase-platform');
    const overviewEl = document.getElementById('showcase-overview');
    const tagsEl = document.getElementById('showcase-tags');
    const playBtn = document.getElementById('play-featured');
    const moreBtn = document.getElementById('showcase-more');

    // Helper: pick the "showcase list" from existing JSON
    async function loadShowcaseCandidates() {
        try {
            // Reuse your curated trending titles file
            const res = await fetch('titles/trending.json');
            const data = await res.json();
            const shows = [
                ...(data.movies || []),
                ...(data.tv_shows || [])
            ].filter(item => item && item.id);

            // Top 10 (or fewer if not enough)
            return shows.slice(0, 10);
        } catch (e) {
            console.warn('initShowcase: could not load trending.json:', e);
            return [];
        }
    }

    // Turn a local "show" item into a base featured object
    function buildBaseFeatured(show) {
        const tmdbId = show.id;
        const mediaType = show.media_type || (show.seasons ? 'tv' : 'movie');
        const date = show.release_date || show.first_air_date || '';
        const year = date ? date.slice(0, 4) : '';
        const title = show.title || show.name || 'Untitled';

        return {
            id: tmdbId,
            mediaType,
            title,
            year,
            rating: show.vote_average ? `${show.vote_average.toFixed(1)}` : '',
            runtime: '',
            overview: show.overview || '',
            localPoster: show.poster_path
                ? `posters/${mediaType === 'tv' ? 'tv' : 'movie'}_${tmdbId}.png`
                : placeholderImage,
            // generic fallback; hydrateWithTmdb will try TMDB network/production logos
            platformLogo: 'assets/platform_logos/default.svg',
            tags: []
        };
    }

    async function hydrateWithTmdb(featuredBase) {
        // Use your existing helper to fetch details & credits
        const details = await fetchMorePosterInfo(featuredBase.id, featuredBase.mediaType);

        const runtimeLabel = featuredBase.mediaType === 'tv'
            ? (details.runtime ? `${details.runtime} min` : '')
            : (details.runtime ? `${details.runtime} min` : '');

        // Convert genre string ("Drama, Sci-Fi") into tags array
        const tags = (details.genres || '')
            .split(',')
            .map(g => g.trim())
            .filter(Boolean);

        // Try to build a platform logo from TMDB data
        let platformLogo = featuredBase.platformLogo; // fallback
        if (featuredBase.mediaType === 'tv' && details.networks && details.networks.length) {
            const firstNetWithLogo = details.networks.find(n => n.logo_path) || details.networks[0];
            if (firstNetWithLogo && firstNetWithLogo.logo_path) {
                platformLogo = `https://image.tmdb.org/t/p/w154${firstNetWithLogo.logo_path}`;
            }
        } else if (featuredBase.mediaType === 'movie' && details.productionCompanies && details.productionCompanies.length) {
            const firstCompanyWithLogo = details.productionCompanies.find(c => c.logo_path) || details.productionCompanies[0];
            if (firstCompanyWithLogo && firstCompanyWithLogo.logo_path) {
                platformLogo = `https://image.tmdb.org/t/p/w154${firstCompanyWithLogo.logo_path}`;
            }
        }

        return {
            ...featuredBase,
            runtime: runtimeLabel,
            backdrop: details.backdrop || null,
            voteAverage: details.voteAverage || null,
            tags: tags.length ? tags : featuredBase.tags,
            platformLogo
        };
    }

    function renderShowcase(featured) {
        const bg = featured.backdrop
            ? `url('${featured.backdrop}')`
            : `url('${featured.localPoster}')`;

        const showcase = document.getElementById('showcase');
        if (showcase) {
            showcase.style.setProperty('--showcase-backdrop', bg);
        }

        const heroWrapper = document.getElementById('hero-wrapper');
        if (heroWrapper) {
            heroWrapper.style.backgroundImage = bg;
            heroWrapper.classList.add('showcase-has-bg');
        }

        // Logo / title area
        if (logoImg) {
            const wrapper = logoImg.parentElement;

            // If we have a proper TMDB logo, show it
            if (featured.logoUrl) {
                if (wrapper) {
                    wrapper.innerHTML = '';
                    const img = document.createElement('img');
                    img.src = featured.logoUrl;
                    img.alt = featured.title || '';
                    img.style.objectFit = 'contain';
                    img.style.filter = 'drop-shadow(0 4px 14px rgba(0,0,0,0.8))';
                    wrapper.appendChild(img);
                }
            } else {
                // Fallback: text-based title logo
                if (wrapper) {
                    wrapper.innerHTML = `
                    <div style="
                        font-family: 'OumaTrialBold', sans-serif;
                        font-size: clamp(2.2em, 4.8vw, 3.6em);
                        letter-spacing: 2px;
                        text-transform: uppercase;
                        color: #ffffff;
                        text-shadow: 0 6px 18px rgba(0,0,0,0.9);
                        line-height: 1;
                    ">
                        ${featured.title}
                    </div>
                `;
                }
            }
        }

        // Text
        titleEl.textContent = featured.title;
        yearEl.textContent = featured.year || '';
        ratingEl.textContent = featured.rating || (featured.voteAverage ? `${featured.voteAverage.toFixed(1)}` : '');
        runtimeEl.textContent = featured.runtime || '';
        overviewEl.textContent = truncateOverview(featured.overview) || 'No description available.';
        platformEl.innerHTML = `<img src="${featured.platformLogo}" alt="Platform" style="height:22px;">`;

        // Tags
        tagsEl.innerHTML = '';
        (featured.tags || []).slice(0, 5).forEach(t => {
            const span = document.createElement('span');
            span.className = 'showcase-tag';
            span.textContent = t;
            tagsEl.appendChild(span);
        });

        // Ensure overview starts in collapsed/long mode
        overviewEl.classList.add('long');
        overviewEl.classList.remove('expanded');
        moreBtn.setAttribute('aria-expanded', 'false');
        moreBtn.innerHTML = '<span class="material-symbols-outlined">expand_content</span> Show More';

        // Wire Show More -> showMorePosterInfo modal
        moreBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (typeof showMorePosterInfo === 'function') {
                showMorePosterInfo({
                    id: featured.id,
                    mediaType: featured.mediaType,
                    poster: null,
                    title: featured.title,
                    year: featured.year,
                    date: null,
                    overview: featured.overview,
                    isTV: featured.mediaType === 'tv'
                });
            }
        };

        // Wire Play -> openPlayer
        playBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (typeof openPlayer === 'function') {
                const isTV = featured.mediaType === 'tv';
                const seasonToOpen = isTV
                    ? (featured.lastSeason || 1)
                    : 1;
                openPlayer(featured.mediaType, featured.id, seasonToOpen, 1);
            }
        };
    }

    // Main async init
    (async () => {
        try {
            const candidates = await loadShowcaseCandidates();
            if (!candidates.length) {
                console.warn('initShowcase: no candidates found for showcase');
                return;
            }

            // Pick a random item from the top 10
            const top10 = candidates.slice(0, 10);
            const chosen = top10[Math.floor(Math.random() * top10.length)];

            const base = buildBaseFeatured(chosen);

            // Enrich with TMDB details
            let featured = base;
            try {
                featured = await hydrateWithTmdb(base);
            } catch (e) {
                console.warn('initShowcase: TMDB enrichment failed, using base data:', e);
            }

            // NEW: fetch TMDB logo for this title
            try {
                const logoUrl = await fetchTitleLogo(featured.id, featured.mediaType);
                if (logoUrl) {
                    featured.logoUrl = logoUrl;
                }
            } catch (e) {
                console.warn('initShowcase: logo fetch failed:', e);
            }

            renderShowcase(featured);
        } catch (e) {
            console.warn('initShowcase: failed to init showcase:', e);
        }
    })();
})();

// Fetch TMDB title logo (PNG/SVG) for a given movie/TV id
async function fetchTitleLogo(id, mediaType = 'movie') {
    if (!id) return null;

    // Use 'movie' or 'tv'
    const apiType = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `https://api.themoviedb.org/3/${apiType}/${id}/images?api_key=${apiKey}&include_image_language=en,null`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.warn('fetchTitleLogo: bad response', res.status);
            return null;
        }
        const data = await res.json();
        const logos = data.logos || [];
        if (!logos.length) return null;

        // Pick an English logo if possible, otherwise the first one
        const enLogos = logos.filter(l => l.iso_639_1 === 'en');
        const chosen = enLogos[0] || logos[0];

        if (!chosen.file_path) return null;
        return `https://image.tmdb.org/t/p/original${chosen.file_path}`;
    } catch (e) {
        console.warn('fetchTitleLogo error:', e);
        return null;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Define your sections: id and label
    const sections = [
        { id: 'netflixXmasGrid', label: 'Netflix XMas 2025' },
        { id: 'bestXmasGrid', label: 'The Best of Xmas' },
        { id: 'trendingGrid', label: 'Trending' },
        { id: 'netflixfranceGrid', label: 'Netflix France' },
        { id: 'newGrid', label: 'New Releases' },
        { id: 'bollywoodGrid', label: 'Bollywood' },
        { id: 'kdramaGrid', label: 'K-Dramas' },
        { id: 'animationGrid', label: 'Animation' },
        { id: 'familyGrid', label: 'Family' },
        { id: 'comedyGrid', label: 'Comedy' },
        { id: 'adventureGrid', label: 'Adventure' },
        { id: 'fantasyGrid', label: 'Fantasy' },
        { id: 'scifiGrid', label: 'Science Fiction' },
        { id: 'actionGrid', label: 'Action' },
        { id: 'thrillerGrid', label: 'Thriller' },
        { id: 'crimeGrid', label: 'Crime' },
        { id: 'horrorGrid', label: 'Horror' },
        { id: 'dramaGrid', label: 'Drama' },
        { id: 'romanceGrid', label: 'Romance' },
        { id: 'thailandGrid', label: 'Thailand' },
        { id: 'philippinesGrid', label: 'Philippines' },
        { id: 'chinaGrid', label: 'China' },
        { id: 'taiwanGrid', label: 'Taiwan' },
        { id: 'hongkongGrid', label: 'Hong Kong' },
        { id: 'japanGrid', label: 'Japan' }

        // Add more as needed
    ];

    document.getElementById('continue-btn').onclick = function () {
        document.getElementById('continueSection').scrollIntoView({ behavior: 'smooth' });
    };
    document.getElementById('watchlater-btn').onclick = function () {
        document.getElementById('watchLaterSection').scrollIntoView({ behavior: 'smooth' });
    };
    document.getElementById('backtotop-btn').onclick = function () {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const navList = document.getElementById('section-nav-list');
    if (navList) {
        navList.innerHTML = '';

        // --- Remaining sections as before ---
        sections.forEach(sec => {
            const btn = document.createElement('button');
            btn.textContent = sec.label;
            btn.setAttribute('data-target', sec.id);
            btn.style.display = 'flex';
            btn.style.width = '100%';
            btn.style.textAlign = 'right';
            btn.style.background = 'transparent';
            btn.style.border = 'none';
            btn.style.color = '#ffffff';
            btn.style.padding = '4px 0';
            btn.style.cursor = 'pointer';
            btn.style.font = 'inherit';
            btn.onmouseover = () => { btn.style.color = '#e02735'; };
            btn.onmouseout = () => { btn.style.color = '#ffffff'; };

            btn.addEventListener('click', () => {
                const el = document.getElementById(sec.id);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });

            navList.appendChild(btn);
        });
    }

    // Show nav list on hover
    const navToggle = document.getElementById('section-nav-toggle');

    if (navToggle && navList) {
        navToggle.addEventListener('mouseenter', () => {
            navList.style.display = 'grid';
        });

        navToggle.addEventListener('mouseleave', () => {
            // Hide only if mouse is not moving to navList
            setTimeout(() => {
                if (!navList.matches(':hover')) {
                    navList.style.display = 'none';
                }
            }, 100);
        });

        navList.addEventListener('mouseleave', () => {
            navList.style.display = 'none';
        });
    }
});

// Add this small helper near your other utils
function isRemoteUrl(u) {
    return /^https?:\/\//i.test(String(u || ''));
}

