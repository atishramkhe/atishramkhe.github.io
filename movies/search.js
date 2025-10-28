// Safe DOM lookups
const searchInput = document.getElementById('search-input');
const resultsContainer = document.getElementById('results');
const searchContainer = document.getElementById('search-container');
const playerContainer = document.getElementById('player-container');
const playerContent = document.getElementById('player-content');
const closePlayer = document.getElementById('close-player');
const clearSearchBtn = document.getElementById('clear-search-btn');

const apiKey = '792f6fa1e1c53d234af7859d10bdf833';
const tmdbEndpoint = 'https://api.themoviedb.org/3/search/multi';
const imageBaseUrl = 'https://image.tmdb.org/t/p/w500';
const placeholderImage = 'assets/no_poster.png';

// Watch Later policy
const WATCH_LATER_POLICY = {
    removeOnStart: false,        // do not remove on play
    removeWhenProgressGte: 0.9   // auto-remove when >= 90% watched
};

// Max visible items before Show All is needed
const SECTION_SHOW_LIMIT = 7;

// Helper: truthy check for '1'/'0' or boolean
function isTrue(v) { return v === true || v === '1' || v === 1; }

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
        const searchTerm = e.target.value.toLowerCase();
        if (searchTerm.length < 2) {
            resultsContainer.innerHTML = '';
            return;
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
        searchInput.focus();
    });
}

function displayResults(results) {
    if (!resultsContainer) return;
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

function openPlayer(type, id, last_season = 1) {
    const progressData = localStorage.getItem(`progress_${id}_${type}`);
    let season = last_season;
    let episode = 1;
    let timestamp = null;

    if (progressData) {
        try {
            const saved = JSON.parse(progressData);
            if (type === 'tv') {
                season = saved.season || last_season;
                episode = saved.episode || 1;
            }
            timestamp = saved.timestamp || null;
        } catch (e) {
            // ignore
        }
    }

    let embedUrl;
    if (type === 'movie') {
        embedUrl = `https://player.videasy.net/movie/${id}?nextEpisode=true&autoplayNextEpisode=true&episodeSelector=true&overlay=true&color=e02735&autoplay=true`;
    } else {
        embedUrl = `https://player.videasy.net/tv/${id}/${season}/${episode}?nextEpisode=true&autoplayNextEpisode=true&episodeSelector=true&overlay=true&color=e02735&autoplay=true`;
    }

    if (playerContent) {
        playerContent.innerHTML = `<iframe src="${embedUrl}" width="100%" height="100%" frameborder="0" allowfullscreen allow="autoplay; fullscreen; encrypted-media"></iframe>`;
    }
    if (playerContainer) playerContainer.style.display = 'block';
    if (searchContainer) searchContainer.style.display = 'none';
}

// Robust message parsing helpers
function tryParseJSON(str) {
    try {
        return JSON.parse(str);
    } catch (e) {
        const first = str.indexOf('{');
        const last = str.lastIndexOf('}');
        if (first !== -1 && last !== -1 && last > first) {
            try { return JSON.parse(str.slice(first, last + 1)); } catch {}
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
    } catch {}
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
    } catch {}
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
    localStorage.removeItem(`progress_${id}_${type}`);
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
        let parsed = typeof event.data === "string" ? (tryParseJSON(event.data) || event.data) : event.data;
        if (typeof parsed === 'string') parsed = tryParseJSON(parsed) || parsed;
        parsed = extractPayload(parsed);
        if (!parsed || typeof parsed !== 'object') return;

        const id = parsed.id ?? parsed.contentId ?? parsed.content_id;
        const type = parsed.type ?? parsed.mediaType ?? parsed.media_type;
        const progressNum = (typeof parsed.progress === 'number') ? parsed.progress
                          : (typeof parsed.percent === 'number' ? parsed.percent : null);
        const timestamp = (typeof parsed.timestamp === 'number') ? parsed.timestamp
                          : (typeof parsed.currentTime === 'number' ? parsed.currentTime : null);

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
            // optional hints from player if provided
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
    posterDiv.appendChild(img);

    if (withPreview) {
        const infoDiv = document.createElement('div');
        infoDiv.className = 'poster-info';

        const safeTitle = title || '';
        const rightLabel = year;
        const saved = isInWatchLater(id, mediaType);
        const btnSymbol = saved ? '✓' : '+';
        const labelText = saved ? 'Remove from Watch Later' : 'Add to Watch Later';

        infoDiv.innerHTML = `
            <div class="poster-info-inner" style="position:relative; padding-bottom:44px;">
                <div class="info-header" style="display:flex;align-items:center;justify-content:space-between;gap:0px;">
                    <div class="preview-title" style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${safeTitle}</div>
                    ${rightLabel ? `<div class="preview-year" style="opacity:.85;white-space:nowrap;">${rightLabel}</div>` : ''}
                </div>
                ${overview ? `<div class="preview-overview" style="margin-top:8px;">${truncateOverview(overview)}</div>` : ''}
                ${isTV && lastSeasonNum ? `
                    <div class="preview-tvinfo" style="margin-top:8px;color:#e02735;">
                        Season ${lastSeasonNum}${lastSeasonEpisodes ? `, ${lastSeasonEpisodes} Episodes` : ''}
                    </div>` : ''
                }
                <button class="watch-later-btn"
                    aria-label="${labelText}"
                    title="${labelText}"
                    style="position:absolute; right:0px; bottom:8px; width:36px; height:36px; border-radius:50%;
                           background:transparent; color:#e02735; border:2px solid #e02735; display:flex;
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

        const wlBtn = infoDiv.querySelector('.watch-later-btn');
        const wlLabel = infoDiv.querySelector('.watch-later-label');

        const updateWatchLaterUI = (isSaved) => {
            wlBtn.textContent = isSaved ? '✓' : '+';
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

    return posterDiv;
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
                    withPreview: gridId !== 'continueGrid' // no preview for Continue Watching
                });

                grid.appendChild(card);
            });
        })
        .catch(err => console.warn('loadGrid error:', err));
}

function loadContinueWatching() {
    const section = document.getElementById('continueSection') || document.getElementById('continueWatchingSection') || null;
    const continueGrid = document.getElementById('continueGrid');
    if (!continueGrid) return;
    continueGrid.innerHTML = '';

    // Collect and dedupe by id+mediaType, keeping most recent updatedAt
    const byKey = new Map();
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('progress_')) continue;
        try {
            const raw = JSON.parse(localStorage.getItem(key));
            const norm = normalizeProgress(raw);
            if (norm && norm.id && norm.mediaType) {
                // Auto-remove if progress >= threshold (same as Watch Later policy)
                const threshold = WATCH_LATER_POLICY?.removeWhenProgressGte;
                if (typeof threshold === 'number') {
                    const frac = fractionFromProgress(norm);
                    if (frac != null && frac >= threshold) {
                        try { removeFromContinueWatching(norm.id, norm.mediaType); } catch {}
                        continue; // skip adding to list
                    }
                }

                const k = `${norm.id}:${norm.mediaType}`;
                const prev = byKey.get(k);
                if (!prev || (norm.updatedAt || 0) > (prev.updatedAt || 0)) {
                    byKey.set(k, norm);
                }
            }
        } catch {}
    }

    const continueItems = Array.from(byKey.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (continueItems.length === 0) {
        if (section) section.style.display = 'none';
        return;
    }
    if (section) section.style.display = 'block';

    // Show All / Show Less toggle
    const expanded = isTrue(localStorage.getItem('continue_show_all'));
    ensureSectionToggleButton(section, {
        buttonId: 'continueShowAllBtn',
        onClick: () => {
            const now = !isTrue(localStorage.getItem('continue_show_all'));
            localStorage.setItem('continue_show_all', now ? '1' : '0');
            loadContinueWatching();
        },
        shouldShow: continueItems.length > SECTION_SHOW_LIMIT,
        isExpanded: expanded,
        fallbackTitle: 'Continue Watching'
    });

    const itemsToRender = expanded ? continueItems : continueItems.slice(0, SECTION_SHOW_LIMIT);

    const posterPromises = itemsToRender.map(async data => {
        let poster = `posters/${data.mediaType === 'tv' ? 'tv' : 'movie'}_${data.id}.png`;
        let title = data.title || data.name || 'Unknown Title';

        const localPosterExists = await fetch(poster, { method: 'HEAD' }).then(res => res.ok).catch(() => false);
        if (!localPosterExists) {
            if (data.poster_path) {
                poster = `https://image.tmdb.org/t/p/w500${data.poster_path}`;
            } else {
                const tmdbUrl = (data.mediaType === 'movie')
                    ? `https://api.themoviedb.org/3/movie/${data.id}?api_key=${apiKey}`
                    : `https://api.themoviedb.org/3/tv/${data.id}?api_key=${apiKey}`;
                try {
                    const tmdbRes = await fetch(tmdbUrl);
                    if (tmdbRes.ok) {
                        const tmdbData = await tmdbRes.json();
                        if (tmdbData.poster_path) {
                            poster = `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}`;
                        } else {
                            poster = placeholderImage;
                        }
                        if (tmdbData.title || tmdbData.name) title = tmdbData.title || tmdbData.name;
                    } else {
                        poster = placeholderImage;
                    }
                } catch {
                    poster = placeholderImage;
                }
            }
        }

        return { data, poster, title };
    });

    Promise.all(posterPromises).then(items => {
        items.forEach(({ data, poster, title }) => {
            if (!poster || poster === placeholderImage) return; // Skip if no poster

            const div = document.createElement('div');
            div.className = 'poster';
            div.style.position = 'relative';

            // Progress percentage
            let percent = 0;
            if (typeof data.progress === "number") {
                percent = Math.min(100, Math.round(data.progress));
            } else if (data.duration && data.timestamp) {
                percent = Math.min(100, Math.round((data.timestamp / data.duration) * 100));
            }

            div.innerHTML = `
                <img src="${poster}" alt="${title}">
                <div style="width:100%;height:6px;background:#222;margin-top:4px;overflow:hidden;">
                    <div style="width:${percent}%;height:100%;background:#e02735;"></div>
                </div>
            `;
            div.onclick = () => openPlayer(data.mediaType, data.id, data.season || 1);

            // Remove button
            const removeBtn = document.createElement('button');
            removeBtn.innerHTML = '&times;';
            removeBtn.title = 'Remove';
            removeBtn.style.position = 'absolute';
            removeBtn.style.top = '6px';
            removeBtn.style.right = '8px';
            removeBtn.style.background = 'rgba(0,0,0,0.7)';
            removeBtn.style.color = '#fff';
            removeBtn.style.border = 'none';
            removeBtn.style.fontSize = '1.5em';
            removeBtn.style.cursor = 'pointer';
            removeBtn.style.padding = '0 6px';
            removeBtn.style.borderRadius = '50%';
            removeBtn.style.display = 'none';
            removeBtn.style.zIndex = '2';

            div.addEventListener('mouseenter', () => { removeBtn.style.display = 'block'; });
            div.addEventListener('mouseleave', () => { removeBtn.style.display = 'none'; });

            removeBtn.onclick = (e) => {
                e.stopPropagation();
                localStorage.removeItem(`progress_${data.id}_${data.mediaType}`);
                localStorage.removeItem(`progress_${data.id}_${data.type || data.mediaType}`);
                loadContinueWatching();
            };

            div.appendChild(removeBtn);
            continueGrid.appendChild(div);
        });
    });
}

// Single init to avoid double rendering
document.addEventListener('DOMContentLoaded', function() {
    loadGrid('titles/trending.json', 'trendingGrid');
    loadGrid('titles/new.json', 'newGrid');
    loadGrid('titles/bollywood.json', 'bollywoodGrid');
    loadGrid('titles/kdramas.json', 'kdramaGrid'); // HTML id is kdramaGrid
    loadGrid('titles/horror.json', 'horrorGrid');
    loadContinueWatching();
    loadWatchLater();
});

// Ensure these helpers exist (used by Watch Later)
function getWatchLater() {
    try { return JSON.parse(localStorage.getItem('watchLater') || '[]'); } catch { return []; }
}
function setWatchLater(list) {
    localStorage.setItem('watchLater', JSON.stringify(list));
}
function removeFromWatchLater(id, mediaType) {
    const list = getWatchLater().filter(
        x => !(String(x.id) === String(id) && (x.mediaType || x.type) === mediaType)
    );
    setWatchLater(list);
    try { loadWatchLater(); } catch {}
}
function isInWatchLater(id, mediaType) {
    const list = getWatchLater();
    const key = `${id}:${mediaType}`;
    return list.some(x => `${x.id}:${x.mediaType}` === key);
}
function toggleWatchLater(item) {
    const list = getWatchLater();
    const key = `${item.id}:${item.mediaType}`;
    const idx = list.findIndex(x => `${x.id}:${x.mediaType}` === key);
    let added;
    if (idx >= 0) { 
        list.splice(idx, 1); 
        added = false; 
    } else { 
        // stamp updatedAt so newest appears on the left
        list.push({ ...item, updatedAt: Date.now() }); 
        added = true; 
    }
    setWatchLater(list);
    // refresh Watch Later section after toggle
    try { loadWatchLater(); } catch {}
    return added;
}

// Build Watch Later grid (no preview; same behavior as Continue Watching)
function loadWatchLater() {
    const section = document.getElementById('watchLaterSection');
    const grid = document.getElementById('watchLaterGrid');
    if (!section || !grid) return;

    const list = getWatchLater();
    if (!list.length) {
        section.style.display = 'none';
        grid.innerHTML = '';
        return;
    }
    section.style.display = 'block';
    grid.innerHTML = '';

    // Dedupe by id:mediaType, keep most recent by updatedAt
    const map = new Map();
    for (const it of list) {
        const mediaType = it.mediaType || it.type;
        const id = it.id;
        if (!id || !mediaType) continue;

        const k = `${id}:${mediaType}`;
        const prev = map.get(k);
        const itUpdated = it.updatedAt ?? it.updated_at ?? it.addedAt ?? 0;
        const prevUpdated = prev ? (prev.updatedAt ?? prev.updated_at ?? prev.addedAt ?? 0) : -1;

        if (!prev || itUpdated > prevUpdated) {
            map.set(k, { ...it, mediaType, updatedAt: itUpdated });
        }
    }

    // Sort newest to oldest (left to right)
    const allItems = Array.from(map.values()).sort(
        (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
    );

    // Show All / Show Less toggle
    const expanded = isTrue(localStorage.getItem('watchlater_show_all'));
    ensureSectionToggleButton(section, {
        buttonId: 'watchLaterShowAllBtn',
        onClick: () => {
            const now = !isTrue(localStorage.getItem('watchlater_show_all'));
            localStorage.setItem('watchlater_show_all', now ? '1' : '0');
            loadWatchLater();
        },
        shouldShow: allItems.length > SECTION_SHOW_LIMIT,
        isExpanded: expanded,
        fallbackTitle: 'Watch Later'
    });

    const items = expanded ? allItems : allItems.slice(0, SECTION_SHOW_LIMIT);

    // Resolve posters first to keep DOM insertion order stable
    const posterPromises = items.map(async (data) => {
        const id = data.id;
        const mediaType = data.mediaType;
        let poster = `posters/${mediaType === 'tv' ? 'tv' : 'movie'}_${id}.png`;
        let title = data.title || data.name || 'Unknown Title';

        const localExists = await fetch(poster, { method: 'HEAD' }).then(r => r.ok).catch(() => false);
        if (!localExists) {
            if (data.poster && /^https?:\/\//i.test(data.poster)) {
                poster = data.poster;
            } else if (data.poster_path) {
                poster = `https://image.tmdb.org/t/p/w500${data.poster_path}`;
            } else {
                const tmdbUrl = (mediaType === 'movie')
                    ? `https://api.themoviedb.org/3/movie/${id}?api_key=${apiKey}`
                    : `https://api.themoviedb.org/3/tv/${id}?api_key=${apiKey}`;
                try {
                    const resp = await fetch(tmdbUrl);
                    if (resp.ok) {
                        const j = await resp.json();
                        if (j.title || j.name) title = j.title || j.name;
                        poster = j.poster_path ? `https://image.tmdb.org/t/p/w500${j.poster_path}` : placeholderImage;
                    } else {
                        poster = placeholderImage;
                    }
                } catch {
                    poster = placeholderImage;
                }
            }
        }

        return { data, poster, title };
    });

    Promise.all(posterPromises).then(results => {
        results.forEach(({ data, poster, title }) => {
            const id = data.id;
            const mediaType = data.mediaType;

            const div = document.createElement('div');
            div.className = 'poster';
            div.style.position = 'relative';
            div.innerHTML = `<img src="${poster}" alt="${title}">`;
            div.onclick = () => openPlayer(mediaType, id, data.season || 1);

            // Remove (X) button like Continue Watching
            const removeBtn = document.createElement('button');
            removeBtn.innerHTML = '&times;';
            removeBtn.title = 'Remove';
            removeBtn.style.position = 'absolute';
            removeBtn.style.top = '6px';
            removeBtn.style.right = '8px';
            removeBtn.style.background = 'rgba(0,0,0,0.7)';
            removeBtn.style.color = '#fff';
            removeBtn.style.border = 'none';
            removeBtn.style.fontSize = '1.5em';
            removeBtn.style.cursor = 'pointer';
            removeBtn.style.padding = '0 6px';
            removeBtn.style.borderRadius = '50%';
            removeBtn.style.display = 'none';
            removeBtn.style.zIndex = '2';

            div.addEventListener('mouseenter', () => { removeBtn.style.display = 'block'; });
            div.addEventListener('mouseleave', () => { removeBtn.style.display = 'none'; });

            removeBtn.onclick = (e) => {
                e.stopPropagation();
                const filtered = getWatchLater().filter(x => !(String(x.id) === String(id) && (x.mediaType || x.type) === mediaType));
                setWatchLater(filtered);
                loadWatchLater();
            };

            div.appendChild(removeBtn);
            grid.appendChild(div);
        });
    });
}

function normalizeProgress(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = raw.id ?? raw.movie_id ?? raw.movieId ?? raw.media_id ?? raw.mediaId;
    const mediaType = raw.mediaType ?? raw.type ?? raw.media_type ?? raw.kind;
    const progress = (typeof raw.progress === 'number') ? raw.progress
        : (typeof raw.percent === 'number' ? raw.percent
        : (raw.progressPercent ?? null));
    const timestamp = raw.timestamp ?? raw.currentTime ?? raw.position ?? null;
    const duration = raw.duration ?? raw.totalDuration ?? raw.length ?? null;
    const season = raw.season ?? raw.season_number ?? raw.lastSeason ?? 1;
    const episode = raw.episode ?? raw.episode_number ?? raw.ep ?? 1;
    const title = raw.title ?? raw.name ?? raw.movie_title ?? null;
    const poster_path = raw.poster_path ?? raw.posterPath ?? raw.poster ?? null;
    const updatedAt = raw.updatedAt ?? raw.updated_at ?? raw.lastUpdated ?? Date.now();

    return {
        id,
        mediaType,
        progress,
        timestamp,
        duration,
        season,
        episode,
        title,
        poster_path,
        updatedAt
    };
}

function truncateOverview(text, maxLength = 120) {
    if (!text) return '';
    return text.length > maxLength
        ? text.slice(0, maxLength).trim() + '...'
        : text;
}
