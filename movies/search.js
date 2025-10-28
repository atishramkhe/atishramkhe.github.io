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

// Optional positioning for search container
if (searchContainer) {
    searchContainer.style.position = 'relative';
}

// Ensure search results use a proper grid layout (bigger cards, aligned)
function setupResultsGridLayout() {
    if (!resultsContainer) return;
    resultsContainer.style.display = 'grid';
    resultsContainer.style.gridTemplateColumns = 'repeat(auto-fill, minmax(180px, 1fr))'; // bigger cards
    resultsContainer.style.gap = '14px';
    resultsContainer.style.alignItems = 'start';
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
            title: parsed.title ?? parsed.name ?? null,
            poster_path: parsed.poster_path ?? parsed.posterPath ?? parsed.poster ?? null,
            updatedAt: Date.now()
        };

        const key = `progress_${id}_${type}`;
        localStorage.setItem(key, JSON.stringify(toStore));

        // Auto-remove from Watch Later if finished per policy
        if (WATCH_LATER_POLICY.removeOnStart || WATCH_LATER_POLICY.removeWhenProgressGte != null) {
            const inWL = isInWatchLater(id, type);
            if (inWL) {
                if (WATCH_LATER_POLICY.removeOnStart) {
                    removeFromWatchLater(id, type);
                } else {
                    let frac = null;
                    if (typeof progressNum === 'number') {
                        // handle 0-100 or 0-1 inputs
                        frac = progressNum > 1 ? progressNum / 100 : progressNum;
                    }
                    if ((frac == null || isNaN(frac)) && toStore.duration && typeof timestamp === 'number' && toStore.duration > 0) {
                        frac = timestamp / toStore.duration;
                    }
                    if (typeof frac === 'number' && frac >= WATCH_LATER_POLICY.removeWhenProgressGte) {
                        removeFromWatchLater(id, type);
                    }
                }
            }
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
                    style="position:absolute; right:8px; bottom:8px; width:36px; height:36px; border-radius:50%;
                           background:transparent; color:#e02735; border:2px solid #e02735; display:flex;
                           align-items:center; justify-content:center; font-size:22px; font-weight:700; line-height:1;
                           cursor:pointer; box-shadow:0 2px 6px rgba(0,0,0,.4);">
                    ${btnSymbol}
                </button>
                <span class="watch-later-label"
                      style="position:absolute; right:52px; bottom:14px; color:#e02735; font-size:12px; font-weight:600;
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
                const k = `${norm.id}:${norm.mediaType}`;
                const prev = byKey.get(k);
                if (!prev || (norm.updatedAt || 0) > (prev.updatedAt || 0)) {
                    byKey.set(k, norm);
                }
            }
        } catch {}
    }

    const continueItems = Array.from(byKey.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const itemsToShow = continueItems.slice(0, 7);

    const posterPromises = itemsToShow.map(async data => {
        let poster = `posters/${data.mediaType === 'tv' ? 'tv' : 'movie'}_${data.id}.png`;
        let title = data.title || data.name || 'Unknown Title';

        let localPosterExists = await fetch(poster, { method: 'HEAD' }).then(res => res.ok).catch(() => false);
        if (localPosterExists) return { data, poster, title };

        if (data.poster_path) {
            poster = `https://image.tmdb.org/t/p/w500${data.poster_path}`;
            return { data, poster, title };
        }

        let tmdbUrl = (data.mediaType === 'movie')
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
            } else {
                poster = placeholderImage;
            }
        } catch {
            poster = placeholderImage;
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

        // Fill to 7 with dummies
        for (let i = continueGrid.children.length; i < 7; i++) {
            const dummy = document.createElement('div');
            dummy.className = 'poster';
            dummy.innerHTML = `
                <img src="assets/no_poster.png" alt="No Image">
                <div style="width:100%;height:0px;background:#000;margin-top:4px;overflow:hidden;">
                    <div style="width:0%;height:100%;background:#e02735;"></div>
                </div>
            `;
            continueGrid.appendChild(dummy);
        }
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
    if (idx >= 0) { list.splice(idx, 1); added = false; }
    else { list.push(item); added = true; }
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

    // Dedupe by id:mediaType, keep first occurrence
    const map = new Map();
    for (const it of list) {
        const k = `${it.id}:${it.mediaType}`;
        if (!map.has(k)) map.set(k, it);
    }
    const items = Array.from(map.values());

    items.forEach(async (data) => {
        const id = data.id;
        const mediaType = data.mediaType || data.type;
        if (!id || !mediaType) return;

        // Prefer local cached poster, else use stored URL, else TMDB
        let poster = `posters/${mediaType === 'tv' ? 'tv' : 'movie'}_${id}.png`;
        let title = data.title || data.name || 'Unknown Title';

        const localExists = await fetch(poster, { method: 'HEAD' }).then(r => r.ok).catch(() => false);
        if (!localExists) {
            if (data.poster && /^https?:\/\//i.test(data.poster)) {
                poster = data.poster;
            } else if (data.poster_path) {
                poster = `https://image.tmdb.org/t/p/w500${data.poster_path}`;
            } else {
                // fetch TMDB detail to get poster_path
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

        const div = document.createElement('div');
        div.className = 'poster';
        div.style.position = 'relative';

        div.innerHTML = `
            <img src="${poster}" alt="${title}">
        `;
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
            // remove from watch later
            const list = getWatchLater().filter(x => !(String(x.id) === String(id) && (x.mediaType || x.type) === mediaType));
            setWatchLater(list);
            loadWatchLater();
        };

        div.appendChild(removeBtn);
        grid.appendChild(div);
    });
}
