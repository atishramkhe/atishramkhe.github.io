const searchInput = document.getElementById('search-input');
const resultsContainer = document.getElementById('results');
const searchContainer = document.getElementById('search-container');
const playerContainer = document.getElementById('player-container');
const playerContent = document.getElementById('player-content');
const closePlayer = document.getElementById('close-player');
const clearSearchBtn = document.getElementById('clear-search-btn');
const searchTools = document.getElementById('search-tools');
const searchStatus = document.getElementById('search-status');
const seriesToggleBtn = document.getElementById('series-toggle');
const movieToggleBtn = document.getElementById('movie-toggle');
const adultToggleBtn = document.getElementById('adult-toggle');

const JIKAN_BASE = 'https://api.jikan.moe/v4';
const ANILIST_GRAPHQL = 'https://graphql.anilist.co';
const TMDB_API_KEY = '792f6fa1e1c53d234af7859d10bdf833';
const TMDB_SEARCH_MOVIE = 'https://api.themoviedb.org/3/search/movie';
const NINE_ANIME_BASE = 'https://9animetv.to';
const NINE_ANIME_DIRECT_ID_PREFIX = '9anime:';
const ANIME_API_BRIDGE_SOURCE = 'ateaish-anime-api';

// Continue Watching (anime) - stored separately from /movies
const ANIME_PROGRESS_TYPE = 'anime';
const ANIME_PROGRESS_KEY_PREFIX = 'anime_progress_';
const ANIME_LEGACY_PROGRESS_KEY_PREFIX = 'progress_';
const ANIME_CONTINUE_SHOW_LIMIT = 24;
let animeContinueShowAllExpanded = false;
const ANIME_WATCHED_LIST_KEY = 'animeWatchedList';
const DEFAULT_SEARCH_TYPE = 'series';

let activeBrowseMedia = 'series';
let adultContentEnabled = false;
let activeSearchType = DEFAULT_SEARCH_TYPE;
let searchUiExpanded = false;

const SEARCH_FILTER_IDS = [
    'search-status-filter',
    'search-rating-filter',
    'search-genre-filter',
    'search-theme-filter',
    'search-demographic-filter',
    'search-year-filter',
    'search-season-filter',
    'search-score-filter',
    'search-sort-filter'
];

const EXPLICIT_GENRE_NAMES = ['ecchi', 'erotica', 'hentai', 'adult cast'];
const ADULT_GENRE_IDS = ['9', '12', '49'];
const NINE_ANIME_ADULT_BROWSE_GENRES = ['ecchi', 'harem', 'romance'];
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NEW_ANIME_WINDOW_DAYS = 31;
const NEW_EPISODE_WINDOW_DAYS = 31;

function getSearchFilterElement(id) {
    return document.getElementById(id);
}

function getSearchFilterValue(id) {
    const element = getSearchFilterElement(id);
    return element ? String(element.value || '').trim() : '';
}

function setSearchStatus(text = '') {
    if (searchStatus) searchStatus.textContent = text;
}

function getAllBrowseSections() {
    return Array.from(document.querySelectorAll('section[data-media]'));
}

function isAnimeMovieType(anime) {
    return String(anime?.type || '').toLowerCase() === 'movie';
}

function isAdultAnime(anime) {
    const rating = String(anime?.rating || '').toLowerCase();
    if (rating.includes('rx') || rating.includes('hentai') || rating.includes('r+')) return true;

    const directMeta = `${String(anime?._nineAnimeMetaText || '').toLowerCase()} ${String(anime?.title || '').toLowerCase()}`.trim();
    if (directMeta && EXPLICIT_GENRE_NAMES.some((term) => directMeta.includes(term))) return true;

    const buckets = [];
    if (Array.isArray(anime?.genres)) buckets.push(...anime.genres);
    if (Array.isArray(anime?.themes)) buckets.push(...anime.themes);
    if (Array.isArray(anime?.demographics)) buckets.push(...anime.demographics);

    return buckets.some((entry) => {
        const name = String(entry?.name || '').toLowerCase();
        const id = String(entry?.mal_id || '').trim();
        return EXPLICIT_GENRE_NAMES.some((term) => name.includes(term)) || ADULT_GENRE_IDS.includes(id);
    });
}

function animeMatchesAdultSetting(anime) {
    return adultContentEnabled || !isAdultAnime(anime);
}

function animeMatchesBrowseMedia(anime) {
    return activeBrowseMedia === 'movie' ? isAnimeMovieType(anime) : !isAnimeMovieType(anime);
}

function applyBrowseVisibility() {
    getAllBrowseSections().forEach((section) => {
        const media = section.dataset.media || 'all';
        const adult = section.dataset.adult || 'all';
        const mediaMatch = media === 'all' || media === activeBrowseMedia;
        const adultMatch = adult === 'all' || adultContentEnabled || adult !== 'adult';
        section.hidden = !(mediaMatch && adultMatch);
    });

    if (seriesToggleBtn) seriesToggleBtn.classList.toggle('active', activeBrowseMedia === 'series');
    if (movieToggleBtn) movieToggleBtn.classList.toggle('active', activeBrowseMedia === 'movie');
    if (adultToggleBtn) {
        adultToggleBtn.classList.toggle('active', adultContentEnabled);
        adultToggleBtn.dataset.state = adultContentEnabled ? 'on' : 'off';
        adultToggleBtn.textContent = adultContentEnabled ? 'Adult ON' : 'Adult OFF';
    }
}

function setActiveSearchType(nextType) {
    activeSearchType = nextType || DEFAULT_SEARCH_TYPE;
    if (!searchTools) return;
    searchTools.querySelectorAll('.search-filter-chip[data-search-type]').forEach((chip) => {
        chip.classList.toggle('active', chip.dataset.searchType === activeSearchType);
    });
}

function setSearchUiExpanded(expanded) {
    searchUiExpanded = !!expanded;
    if (searchTools) searchTools.classList.toggle('visible', searchUiExpanded);
}

function buildSearchParams(query) {
    const params = new URLSearchParams();
    params.set('q', query);
    params.set('limit', '24');

    const typeMap = {
        series: 'tv',
        movie: 'movie',
        ova: 'ova',
        special: 'special'
    };
    const activeType = typeMap[activeSearchType];
    if (activeType) params.set('type', activeType);

    const status = getSearchFilterValue('search-status-filter');
    if (status) params.set('status', status);

    const rating = getSearchFilterValue('search-rating-filter');
    if (rating) params.set('rating', rating);

    const genre = getSearchFilterValue('search-genre-filter');
    const theme = getSearchFilterValue('search-theme-filter');
    const demographic = getSearchFilterValue('search-demographic-filter');
    const genres = [genre, theme, demographic].filter(Boolean);
    if (genres.length) params.set('genres', genres.join(','));

    if (!adultContentEnabled) params.set('genres_exclude', ADULT_GENRE_IDS.join(','));

    const score = getSearchFilterValue('search-score-filter');
    if (score) params.set('min_score', score);

    const year = getSearchFilterValue('search-year-filter');
    if (year === '2020s') {
        params.set('start_date', '2020-01-01');
        params.set('end_date', '2029-12-31');
    } else if (year === '2010s') {
        params.set('start_date', '2010-01-01');
        params.set('end_date', '2019-12-31');
    } else if (year === '2000s') {
        params.set('start_date', '2000-01-01');
        params.set('end_date', '2009-12-31');
    } else if (year === 'classic') {
        params.set('end_date', '1999-12-31');
    } else if (year) {
        params.set('start_date', `${year}-01-01`);
        params.set('end_date', `${year}-12-31`);
    }

    const season = getSearchFilterValue('search-season-filter');
    if (season) {
        const currentYear = /^\d{4}$/.test(year) ? year : String(new Date().getFullYear());
        const seasonRange = {
            winter: [`${currentYear}-01-01`, `${currentYear}-03-31`],
            spring: [`${currentYear}-04-01`, `${currentYear}-06-30`],
            summer: [`${currentYear}-07-01`, `${currentYear}-09-30`],
            fall: [`${currentYear}-10-01`, `${currentYear}-12-31`]
        }[season];
        if (seasonRange) {
            params.set('start_date', seasonRange[0]);
            params.set('end_date', seasonRange[1]);
        }
    }

    const sortValue = getSearchFilterValue('search-sort-filter');
    const sortMap = {
        score_desc: ['score', 'desc'],
        popularity: ['popularity', 'asc'],
        favorites: ['favorites', 'desc'],
        start_date_desc: ['start_date', 'desc'],
        start_date_asc: ['start_date', 'asc'],
        title_asc: ['title', 'asc']
    };
    const mappedSort = sortMap[sortValue] || ['score', 'desc'];
    params.set('order_by', mappedSort[0]);
    params.set('sort', mappedSort[1]);

    return params;
}

let animeApiBridgeReady = false;
let animeApiBridgeReadyResolve = null;
const animeApiBridgeReadyPromise = new Promise((resolve) => {
    animeApiBridgeReadyResolve = resolve;
});
let animeApiBridgeRequestId = 0;
const animeApiBridgePending = new Map();
let animeProtectedRemoteCheckComplete = false;
let aniListApiUnavailable = false;
let aniListApiUnavailableLogged = false;

window.addEventListener('message', (event) => {
    const message = event && event.data;
    if (!message || message.source !== ANIME_API_BRIDGE_SOURCE) return;

    if (message.type === 'ready') {
        animeApiBridgeReady = true;
        animeProtectedRemoteCheckComplete = true;
        if (animeApiBridgeReadyResolve) animeApiBridgeReadyResolve(true);
        return;
    }

    if (message.type !== 'response') return;

    const pending = animeApiBridgePending.get(message.id);
    if (!pending) return;
    animeApiBridgePending.delete(message.id);
    clearTimeout(pending.timeoutId);

    if (message.error || !Number.isFinite(Number(message.status)) || Number(message.status) < 200 || Number(message.status) >= 400) {
        pending.reject(new Error(`Anime API bridge request failed (${message.status || 0})`));
        return;
    }

    pending.resolve(String(message.body || ''));
});

function pingAnimeApiBridge() {
    try {
        window.postMessage({ source: ANIME_API_BRIDGE_SOURCE, type: 'ping' }, '*');
    } catch { }
}

async function waitForAnimeApiBridge(timeoutMs = 2000) {
    if (animeApiBridgeReady) return true;
    pingAnimeApiBridge();
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs));
    return Promise.race([animeApiBridgeReadyPromise, timeoutPromise]);
}

function fetchTextViaAnimeApiBridge(url, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const id = ++animeApiBridgeRequestId;
        const timeoutId = setTimeout(() => {
            animeApiBridgePending.delete(id);
            reject(new Error('Anime API bridge request timeout'));
        }, timeoutMs);

        animeApiBridgePending.set(id, { resolve, reject, timeoutId });
        try {
            window.postMessage({ source: ANIME_API_BRIDGE_SOURCE, type: 'request', id, url }, '*');
        } catch (error) {
            clearTimeout(timeoutId);
            animeApiBridgePending.delete(id);
            reject(error);
        }
    });
}

function isLocalAnimeDev() {
    const host = String(location.hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1';
}

function hasAnimeProtectedRemoteAccess() {
    return animeApiBridgeReady || isLocalAnimeDev();
}

async function canUseAnimeProtectedRemoteSources(timeoutMs = 1200) {
    if (hasAnimeProtectedRemoteAccess()) return true;
    if (animeProtectedRemoteCheckComplete) return false;
    const ready = await waitForAnimeApiBridge(timeoutMs);
    animeProtectedRemoteCheckComplete = true;
    return ready;
}

async function fetchAnimeRemoteText(url, timeoutMs = 15000) {
    if (animeApiBridgeReady || await waitForAnimeApiBridge(1500)) {
        return fetchTextViaAnimeApiBridge(url, timeoutMs);
    }

    if (isLocalAnimeDev()) {
        const proxied = `/proxy?url=${encodeURIComponent(url)}`;
        const response = await fetch(proxied, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Local proxy HTTP ${response.status}`);
        return response.text();
    }

    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
}

async function fetchAnimeRemoteJson(url, timeoutMs = 15000) {
    const text = await fetchAnimeRemoteText(url, timeoutMs);
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`Invalid JSON response for ${url}: ${error.message}`);
    }
}

// Current open player session info (used to validate postMessage progress updates)
let currentAnimePlayerSession = null;
let _animeProgressMessageListenerInstalled = false;

function ensureAnimeProgressMessageListener() {
    if (_animeProgressMessageListenerInstalled) return;
    _animeProgressMessageListenerInstalled = true;

    window.addEventListener('message', (event) => {
        const session = currentAnimePlayerSession;
        if (!session || !session.malId) return;

        const msg = event && event.data;
        if (!msg || typeof msg !== 'object') return;

        let eventName = null;
        let currentTime = null;
        let duration = null;
        let playerHost = session.playerHost || null;
        let seasonValue = session.currentSeason ?? null;
        let episodeValue = session.currentEpisode ?? null;
        let bypassThrottle = false;

        if (msg.type === 'ateaish_player_progress' || msg.type === 'ateaish_player_ended') {
            if (!session.token) return;
            if (String(msg.token || '') !== String(session.token)) return;
            if (String(msg.malId || '') !== String(session.malId)) return;

            eventName = msg.type === 'ateaish_player_ended' ? 'complete' : 'time';
            currentTime = Number(msg.currentTime);
            duration = Number(msg.duration);
            playerHost = msg.host ? String(msg.host).toLowerCase() : playerHost;
        } else if (msg.type === 'PLAYER_EVENT') {
            const origin = String(event.origin || '').toLowerCase();
            if (!session.playerOrigin || origin !== String(session.playerOrigin).toLowerCase()) return;

            const data = msg.data;
            if (!data || typeof data !== 'object') return;

            eventName = String(data.event || '').toLowerCase();
            if (eventName !== 'time' && eventName !== 'pause' && eventName !== 'complete') return;

            if (data.mediaType && String(data.mediaType).toLowerCase() === 'movie' && !session.isMovie) return;
            if (data.mediaType && String(data.mediaType).toLowerCase() === 'tv' && session.isMovie) return;

            currentTime = Number(data.currentTime);
            duration = Number(data.duration);
            if (Number.isFinite(Number(data.season)) && Number(data.season) > 0) {
                seasonValue = `saison${Math.floor(Number(data.season))}`;
            } else if (data.season != null && data.season !== '') {
                seasonValue = String(data.season);
            }
            if (Number.isFinite(Number(data.episode)) && Number(data.episode) > 0) {
                episodeValue = Math.floor(Number(data.episode));
            }
            bypassThrottle = eventName === 'pause' || eventName === 'complete';
        } else {
            return;
        }

        if (seasonValue != null) session.currentSeason = String(seasonValue);
        if (Number.isFinite(Number(episodeValue)) && Number(episodeValue) > 0) {
            session.currentEpisode = Math.floor(Number(episodeValue));
        }

        if (eventName === 'complete') {
            const completedAt = Date.now();
            upsertAnimeProgressRecord(session.malId, {
                season: session.isMovie ? null : (session.currentSeason ?? null),
                episode: session.isMovie ? null : (session.currentEpisode ?? null),
                timestamp: Number.isFinite(duration) && duration > 0
                    ? duration
                    : (Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : null),
                duration: Number.isFinite(duration) && duration > 0 ? duration : null,
                progress: 1,
                playerHost: playerHost,
                updatedAt: completedAt
            });
            try { loadAnimeContinueWatching(); } catch { }
            try { addAnimeToWatched(session.malId); } catch { }
            // Auto-next is only meaningful for series (not movies)
            if (session.isMovie) return;
            if (typeof session.onAutoNext !== 'function') return;

            const autoNextAt = Date.now();
            if (session._lastAutoNextAt && autoNextAt - session._lastAutoNextAt < 3000) return;
            session._lastAutoNextAt = autoNextAt;

            try { session.onAutoNext(); } catch { }
            return;
        }

        const ts = Number(currentTime);
        const dur = Number(duration);
        const host = playerHost;

        if (!Number.isFinite(ts) || ts < 0) return;
        if (!Number.isFinite(dur) || dur <= 0) return;

        const playbackEpisodeKey = session.isMovie
            ? 'movie'
            : `${String(session.currentSeason || '')}:${Number(session.currentEpisode || 0)}`;
        if (session._playbackStartedFor !== playbackEpisodeKey) {
            session._playbackStartedFor = playbackEpisodeKey;
            try {
                if (typeof session.onPlaybackStart === 'function') {
                    session.onPlaybackStart({
                        season: session.currentSeason ?? null,
                        episode: session.currentEpisode ?? null,
                        currentTime: ts,
                        duration: dur,
                        playerHost: host || null,
                    });
                }
            } catch { }
        }

        // Throttle writes to avoid hammering localStorage
        const savedAt = Date.now();
        if (!bypassThrottle && session._lastSaveAt && savedAt - session._lastSaveAt < 1500) return;
        session._lastSaveAt = savedAt;

        const frac = Math.min(1, Math.max(0, ts / dur));
        upsertAnimeProgressRecord(session.malId, {
            season: session.isMovie ? null : (session.currentSeason ?? null),
            episode: session.isMovie ? null : (session.currentEpisode ?? null),
            timestamp: ts,
            duration: dur,
            progress: frac,
            playerHost: host,
            updatedAt: savedAt
        });
        try { maybeAddAnimeToWatched(session.malId, frac); } catch { }
        try { loadAnimeContinueWatching(); } catch { }
    }, false);
}

function animeProgressKey(malId) {
    const id = String(malId ?? '').trim();
    return id ? `${ANIME_PROGRESS_KEY_PREFIX}${id}` : '';
}

function animeLegacyProgressKey(malId) {
    const id = String(malId ?? '').trim();
    return id ? `${ANIME_LEGACY_PROGRESS_KEY_PREFIX}${id}_${ANIME_PROGRESS_TYPE}` : '';
}

function isAnimeProgressStorageKey(key) {
    const text = String(key || '').trim();
    return text.startsWith(ANIME_PROGRESS_KEY_PREFIX) || /^progress_.+_anime$/i.test(text);
}

function getAnimeProgressIdFromStorageKey(key) {
    const text = String(key || '').trim();
    if (!text) return '';
    if (text.startsWith(ANIME_PROGRESS_KEY_PREFIX)) {
        return text.slice(ANIME_PROGRESS_KEY_PREFIX.length).trim();
    }
    const legacyMatch = text.match(/^progress_(.+)_anime$/i);
    return legacyMatch ? String(legacyMatch[1] || '').trim() : '';
}

function getAnimeProgressRecord(malId) {
    const key = animeProgressKey(malId);
    const legacyKey = animeLegacyProgressKey(malId);
    if (!key) return null;
    try {
        let raw = JSON.parse(localStorage.getItem(key) || 'null');
        if ((!raw || typeof raw !== 'object') && legacyKey) {
            raw = JSON.parse(localStorage.getItem(legacyKey) || 'null');
            if (raw && typeof raw === 'object') {
                try {
                    localStorage.setItem(key, JSON.stringify(raw));
                    localStorage.removeItem(legacyKey);
                } catch { }
            }
        }
        if (!raw || typeof raw !== 'object') return null;
        return raw;
    } catch {
        return null;
    }
}

function upsertAnimeProgressRecord(malId, patch) {
    const key = animeProgressKey(malId);
    if (!key) return;
    const existing = getAnimeProgressRecord(malId) || {};
    const nextUpdatedAt = patch && patch.updatedAt != null ? patch.updatedAt : Date.now();
    const next = {
        id: String(malId),
        type: ANIME_PROGRESS_TYPE,
        mediaType: ANIME_PROGRESS_TYPE,
        ...existing,
        ...patch,
        updatedAt: nextUpdatedAt
    };
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { }
}

function removeFromAnimeContinueWatching(malId) {
    const key = animeProgressKey(malId);
    const legacyKey = animeLegacyProgressKey(malId);
    if (!key) return;
    try { localStorage.removeItem(key); } catch { }
    try { if (legacyKey) localStorage.removeItem(legacyKey); } catch { }
    scheduleSuggestedAnimeReload();
}

function getAnimeWatchedList() {
    try { return JSON.parse(localStorage.getItem(ANIME_WATCHED_LIST_KEY) || '[]'); } catch { return []; }
}

function setAnimeWatchedList(list) {
    try { localStorage.setItem(ANIME_WATCHED_LIST_KEY, JSON.stringify(Array.isArray(list) ? list : [])); } catch { }
}

function normalizeAndDedupeAnimeWatched(list) {
    const map = new Map();
    for (const it of Array.isArray(list) ? list : []) {
        const id = String(it?.id ?? '').trim();
        if (!id) continue;
        const updatedAt = it?.updatedAt ?? it?.watchedAt ?? 0;
        const normalized = {
            id,
            title: it?.title ?? '',
            poster: it?.poster ?? '',
            year: it?.year ?? '',
            updatedAt,
            watchedAt: it?.watchedAt ?? updatedAt,
            playerGroup: it?.playerGroup ?? null,
            playerHost: it?.playerHost ?? null
        };
        const prev = map.get(id);
        if (!prev || (updatedAt || 0) > (prev.updatedAt || 0)) map.set(id, normalized);
    }
    return Array.from(map.values());
}

function addAnimeToWatched(malId) {
    const id = String(malId ?? '').trim();
    if (!id) return;
    const record = getAnimeProgressRecord(id);
    if (!record) return;
    const list = getAnimeWatchedList();
    list.push({
        id,
        title: record.title || '',
        poster: record.poster || '',
        year: record.year || '',
        updatedAt: Date.now(),
        watchedAt: Date.now(),
        playerGroup: record.playerGroup || null,
        playerHost: record.playerHost || null
    });
    setAnimeWatchedList(normalizeAndDedupeAnimeWatched(list));
    try { loadAnimeWatched(); } catch { }
    scheduleSuggestedAnimeReload();
}

function maybeAddAnimeToWatched(malId, frac = null) {
    if (frac != null && (!(Number.isFinite(frac)) || frac < 0.9)) return;
    addAnimeToWatched(malId);
}

function removeFromAnimeWatched(malId) {
    const id = String(malId ?? '').trim();
    if (!id) return;
    const list = getAnimeWatchedList().filter(x => String(x?.id ?? '').trim() !== id);
    setAnimeWatchedList(list);
    try { loadAnimeWatched(); } catch { }
    scheduleSuggestedAnimeReload();
}

function loadAnimeWatched() {
    const section = document.getElementById('watchedSection');
    const grid = document.getElementById('watchedGrid');
    if (!section || !grid) return;

    const list = normalizeAndDedupeAnimeWatched(getAnimeWatchedList())
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (!list.length) {
        grid.innerHTML = '';
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    grid.innerHTML = '';

    list.forEach((it) => {
        const div = document.createElement('div');
        div.className = 'poster';
        div.style.position = 'relative';
        const title = it.title || 'Unknown';
        const poster = it.poster || '';
        div.innerHTML = `
            <img src="${poster}" alt="${escapeHtml(title)}">
            ${buildPosterTitleMarkup(title, it.year ? String(it.year) : '')}
        `;
        div.onclick = () => openAnimeByMalId(it.id);

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
            removeFromAnimeWatched(it.id);
        };
        div.appendChild(removeBtn);
        grid.appendChild(div);
    });
}

function estimateAnimeProgressFraction(record) {
    if (!record || typeof record !== 'object') return 0;
    // Prefer real timing when available
    const ts = Number(record.timestamp);
    const dur = Number(record.duration);
    if (Number.isFinite(ts) && Number.isFinite(dur) && dur > 0) {
        return Math.min(1, Math.max(0, ts / dur));
    }
    if (typeof record.progress === 'number') {
        const p = record.progress;
        return p > 1 ? Math.min(1, Math.max(0, p / 100)) : Math.min(1, Math.max(0, p));
    }
    const ep = Number(record.episode);
    const total = Number(record.episodesTotal);
    if (Number.isFinite(ep) && Number.isFinite(total) && total > 0) {
        return Math.min(1, Math.max(0, ep / total));
    }
    return 0;
}

function estimateSeriesProgressFraction(record) {
    const episodeNumber = Number(record?.episode);
    const totalEpisodes = Number(record?.episodesTotal);
    if (!Number.isFinite(episodeNumber) || episodeNumber <= 0) return null;
    if (!Number.isFinite(totalEpisodes) || totalEpisodes <= 0) return null;
    const episodeFrac = estimateAnimeProgressFraction(record);
    const progressed = Math.max(0, episodeNumber - 1) + episodeFrac;
    return Math.min(1, Math.max(0, progressed / totalEpisodes));
}

function buildLabeledProgressBarMarkup(label, percent, color) {
    const safePercent = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
    return `
        <div style="display:flex; flex-direction:column; gap:4px;">
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#f3f3f3; text-transform:uppercase; letter-spacing:.05em;">
                <span>${escapeHtml(label)}</span>
                <span>${safePercent}%</span>
            </div>
            <div style="width:100%; height:6px; background:rgba(255,255,255,0.14); overflow:hidden; border-radius:999px;">
                <div style="width:${safePercent}%; height:100%; background:${escapeHtml(color)};"></div>
            </div>
        </div>
    `;
}

function getAnimeContinueWatchingItems() {
    const items = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!isAnimeProgressStorageKey(key)) continue;
        try {
            const raw = JSON.parse(localStorage.getItem(key) || 'null');
            if (!raw || typeof raw !== 'object') continue;
            const id = String(raw.id ?? getAnimeProgressIdFromStorageKey(key) ?? '').trim();
            if (!id) continue;
            items.push({
                id,
                title: raw.title || 'Unknown',
                poster: raw.poster || '',
                year: raw.year || '',
                season: raw.season ?? null,
                episode: raw.episode ?? null,
                episodesTotal: raw.episodesTotal ?? null,
                timestamp: raw.timestamp ?? null,
                duration: raw.duration ?? null,
                playerHost: raw.playerHost ?? null,
                playerGroup: raw.playerGroup ?? null,
                updatedAt: raw.updatedAt ?? Date.now(),
                progress: raw.progress ?? null
            });
        } catch { }
    }

    return items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

const animeReleaseSnapshotCache = new Map();
const animeRecommendationCache = new Map();
let suggestedAnimeReloadTimer = null;

async function fetchAnimeReleaseSnapshot(malId) {
    const key = String(malId || '').trim();
    if (!key) return null;
    if (animeReleaseSnapshotCache.has(key)) return animeReleaseSnapshotCache.get(key);

    const pending = (async () => {
        let anime = null;
        try {
            const detail = await fetchJson(`${JIKAN_BASE}/anime/${key}`, 2);
            anime = detail?.data || null;
        } catch {
            anime = null;
        }

        let latestEpisode = null;
        let latestAiredAt = null;
        try {
            const page1 = await fetchJson(`${JIKAN_BASE}/anime/${key}/episodes?page=1`, 2);
            const lastPage = Number(page1?.pagination?.last_visible_page) || 1;
            const finalPage = lastPage > 1
                ? await fetchJson(`${JIKAN_BASE}/anime/${key}/episodes?page=${lastPage}`, 2)
                : page1;
            const episodes = Array.isArray(finalPage?.data) ? finalPage.data : [];
            const released = episodes
                .map((entry) => ({
                    number: Number(entry?.mal_id || entry?.number || 0),
                    airedAt: parseAnimeDate(entry?.aired)
                }))
                .filter((entry) => Number.isFinite(entry.number) && entry.number > 0 && entry.airedAt && entry.airedAt.getTime() <= Date.now())
                .sort((a, b) => a.number - b.number);
            const latest = released[released.length - 1] || null;
            latestEpisode = latest?.number || null;
            latestAiredAt = latest?.airedAt || null;
        } catch {
            latestEpisode = null;
            latestAiredAt = null;
        }

        return { anime, latestEpisode, latestAiredAt };
    })();

    animeReleaseSnapshotCache.set(key, pending);
    return pending;
}

async function annotateContinueWatchingCards(items) {
    const grid = document.getElementById('continueGrid');
    if (!grid) return;

    await Promise.allSettled((Array.isArray(items) ? items : []).map(async (item) => {
        const card = grid.querySelector(`[data-continue-id="${CSS.escape(String(item.id))}"]`);
        if (!card) return;
        const badgeHost = card.querySelector('.continue-card-badges');
        if (!badgeHost) return;

        const snapshot = await fetchAnimeReleaseSnapshot(item.id);
        const badges = [];
        if (snapshot?.anime && isNewAnimeRelease(snapshot.anime)) {
            badges.push({ label: 'New', tone: 'new' });
        }

        const watchedEpisode = Number(item?.episode);
        if (
            Number.isFinite(watchedEpisode) && watchedEpisode > 0
            && Number.isFinite(Number(snapshot?.latestEpisode))
            && Number(snapshot.latestEpisode) > watchedEpisode
            && snapshot.latestAiredAt
            && Date.now() - snapshot.latestAiredAt.getTime() <= NEW_EPISODE_WINDOW_DAYS * MS_PER_DAY
        ) {
            badges.push({ label: 'New Ep', tone: 'accent' });
        }

        renderPosterBadgeHost(badgeHost, badges);
    }));
}

function scheduleSuggestedAnimeReload() {
    if (suggestedAnimeReloadTimer) clearTimeout(suggestedAnimeReloadTimer);
    suggestedAnimeReloadTimer = setTimeout(() => {
        loadSuggestedAnime();
    }, 220);
}

async function fetchAnimeRecommendationsForMalId(malId) {
    const key = String(malId || '').trim();
    if (!key) return [];
    if (animeRecommendationCache.has(key)) return animeRecommendationCache.get(key);

    const pending = (async () => {
        try {
            const data = await fetchJson(`${JIKAN_BASE}/anime/${key}/recommendations`, 2);
            const rows = Array.isArray(data?.data) ? data.data : [];
            return rows
                .map((entry) => ({
                    malId: Number(entry?.entry?.mal_id || 0),
                    votes: Number(entry?.votes || 0)
                }))
                .filter((entry) => Number.isFinite(entry.malId) && entry.malId > 0);
        } catch (error) {
            console.warn('Failed to fetch anime recommendations', key, error);
            return [];
        }
    })();

    animeRecommendationCache.set(key, pending);
    return pending;
}

async function loadSuggestedAnime() {
    const section = document.getElementById('suggestedSection');
    const grid = document.getElementById('suggestedGrid');
    if (!section || !grid) return;

    const continueSeeds = getAnimeContinueWatchingItems().slice(0, 4).map((item) => ({ id: item.id, weight: 3 }));
    const watchLaterSeeds = normalizeAndDedupeAnimeWatchLater(getAnimeWatchLater()).slice(0, 4).map((item) => ({ id: item.id, weight: 2 }));
    const watchedSeeds = normalizeAndDedupeAnimeWatched(getAnimeWatchedList()).slice(0, 4).map((item) => ({ id: item.id, weight: 1 }));
    const seedMap = new Map();
    [...continueSeeds, ...watchLaterSeeds, ...watchedSeeds].forEach((seed) => {
        const key = String(seed.id || '').trim();
        if (!key) return;
        const existing = seedMap.get(key) || 0;
        seedMap.set(key, Math.max(existing, seed.weight));
    });

    const seedEntries = Array.from(seedMap.entries()).map(([id, weight]) => ({ id, weight }));
    if (!seedEntries.length) {
        grid.innerHTML = '';
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    grid.innerHTML = 'Loading...';

    const recommendationScores = new Map();
    await Promise.all(seedEntries.slice(0, 6).map(async (seed) => {
        const recommendations = await fetchAnimeRecommendationsForMalId(seed.id);
        recommendations.slice(0, 12).forEach((entry, index) => {
            const key = String(entry.malId);
            if (!key || seedMap.has(key)) return;
            const score = (seed.weight * 100) + Math.max(0, 40 - index * 3) + Math.min(30, Number(entry.votes) || 0);
            recommendationScores.set(key, (recommendationScores.get(key) || 0) + score);
        });
    }));

    const rankedIds = Array.from(recommendationScores.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 18)
        .map(([id]) => id);

    if (!rankedIds.length) {
        grid.innerHTML = '<div style="grid-column:1 / -1; opacity:.72; padding:24px; text-align:center;">Watch a few shows and suggestions will start appearing here.</div>';
        return;
    }

    const suffix = adultContentEnabled ? '' : '?sfw';
    const detailed = await Promise.all(rankedIds.map(async (id) => {
        try {
            const payload = await fetchJson(`${JIKAN_BASE}/anime/${id}${suffix}`, 2);
            return payload?.data || null;
        } catch {
            return null;
        }
    }));

    const available = await Promise.all(detailed.filter(Boolean).map(async (anime) => ({
        anime,
        profile: await getAnimePlaybackProfile(anime)
    })));

    const picks = available
        .filter(({ anime, profile }) => profile && profile.playable && animeMatchesAdultSetting(anime) && animeMatchesBrowseMedia(anime))
        .map(({ anime }) => anime)
        .slice(0, 24);

    if (!picks.length) {
        grid.innerHTML = '<div style="grid-column:1 / -1; opacity:.72; padding:24px; text-align:center;">No suggestions available for the current filters.</div>';
        return;
    }

    grid.innerHTML = '';
    picks.forEach((anime) => {
        grid.appendChild(createPosterCard(anime, openAnimeFromJikan, { badges: [{ label: 'Suggested', tone: 'info' }] }));
    });
}

function loadAnimeContinueWatching() {
    const section = document.getElementById('continueSection') || document.getElementById('continueWatchingSection');
    const grid = document.getElementById('continueGrid');
    if (!grid) return;

    if (section) section.style.display = 'block';
    grid.innerHTML = '';

    const items = getAnimeContinueWatchingItems();

    if (!items.length) {
        grid.innerHTML = `
            <div style="grid-column:1 / -1; padding:24px; text-align:center; opacity:.7; font-family:inherit; font-size:1.05em;">
                Start watching an anime and it will appear here...
            </div>
        `;
        return;
    }

    // Header controls (Show All/Less + Clear) like /movies
    if (section) {
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

        let showAllBtn = buttonGroup.querySelector('#continueShowAllBtn');
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
                animeContinueShowAllExpanded = !animeContinueShowAllExpanded;
                loadAnimeContinueWatching();
            };
            buttonGroup.appendChild(showAllBtn);
        }

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
            clearBtn.onmouseover = () => { clearBtn.style.color = '#f1892f'; };
            clearBtn.onmouseout = () => { clearBtn.style.color = '#444444ff'; };
            clearBtn.onclick = () => {
                if (!window.confirm('Are you sure you want to clear all Continue Watching data? This cannot be undone.')) return;
                const keysToRemove = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (isAnimeProgressStorageKey(k)) keysToRemove.push(k);
                }
                keysToRemove.forEach(k => localStorage.removeItem(k));
                loadAnimeContinueWatching();
            };
            buttonGroup.appendChild(clearBtn);
        }

        showAllBtn.textContent = animeContinueShowAllExpanded ? 'Show Less' : 'Show All';
        showAllBtn.style.display = items.length > ANIME_CONTINUE_SHOW_LIMIT ? 'inline-block' : 'none';
    }

    const renderItems = animeContinueShowAllExpanded ? items : items.slice(0, ANIME_CONTINUE_SHOW_LIMIT);

    renderItems.forEach((data) => {
        const div = document.createElement('div');
        div.className = 'poster';
        div.style.position = 'relative';
        div.dataset.continueId = String(data.id);

        const poster = data.poster || 'https://via.placeholder.com/300x450.png?text=No+Image';
        const title = data.title || 'Unknown';
        const frac = estimateAnimeProgressFraction(data);
        const percent = Math.min(100, Math.max(0, Math.round(frac * 100)));
        const seriesFrac = estimateSeriesProgressFraction(data);
        const seriesPercent = seriesFrac == null ? null : Math.min(100, Math.max(0, Math.round(seriesFrac * 100)));
        const watchedEpisode = Number(data.episode);
        const totalEpisodes = Number(data.episodesTotal);

        div.innerHTML = `
            <img src="${poster}" alt="${escapeHtml(title)}">
            ${buildPosterTitleMarkup(title, percent > 0 ? `${percent}% watched` : (data.year ? String(data.year) : ''))}
            <div class="continue-card-badges" style="position:absolute;top:10px;left:10px;display:flex;flex-direction:column;gap:6px;z-index:3;"></div>
            <div style="display:flex;flex-direction:column;gap:8px;padding:8px 0 2px 0;">
                ${buildLabeledProgressBarMarkup('Episode', percent, '#f1892f')}
                ${seriesPercent != null && Number.isFinite(totalEpisodes) && totalEpisodes > 0
                    ? buildLabeledProgressBarMarkup(`Series ${Number.isFinite(watchedEpisode) && watchedEpisode > 0 ? watchedEpisode : 1}/${totalEpisodes}`, seriesPercent, '#14d9b7')
                    : ''}
            </div>
        `;

        div.onclick = () => openAnimeByMalId(data.id);

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
            removeFromAnimeContinueWatching(data.id);
            loadAnimeContinueWatching();
        };
        div.appendChild(removeBtn);
        grid.appendChild(div);
    });

    annotateContinueWatchingCards(renderItems);
}

// Skip Settings (anime) - stored per anime
const ANIME_SKIP_SETTINGS_PREFIX = 'animeSkipSettings_';

function getAnimeSkipSettings(malId) {
    if (!malId) return { skipIntro: true, skipOutro: true };
    try {
        const key = `${ANIME_SKIP_SETTINGS_PREFIX}${malId}`;
        const raw = JSON.parse(localStorage.getItem(key) || 'null');
        if (!raw || typeof raw !== 'object') return { skipIntro: true, skipOutro: true };
        return {
            skipIntro: raw.skipIntro !== false,
            skipOutro: raw.skipOutro !== false,
        };
    } catch {
        return { skipIntro: true, skipOutro: true };
    }
}

function setAnimeSkipSettings(malId, settings) {
    if (!malId) return;
    try {
        const key = `${ANIME_SKIP_SETTINGS_PREFIX}${malId}`;
        localStorage.setItem(key, JSON.stringify({
            skipIntro: !!settings.skipIntro,
            skipOutro: !!settings.skipOutro,
        }));
    } catch { }
}

function sendAnimePlayerHook(data) {
    // Resolve absolute episode: prefer explicit, then global, then per-season fallback
    const absEp = data.absoluteEpisodeNumber
        || window.currentAbsoluteEpisodeNumber
        || data.episodeNumber;

    const payload = {
        type: 'ateaish_anime_player_info',
        malId: data.malId || null,
        aniListId: data.aniListId,
        episodeNumber: data.episodeNumber,
        absoluteEpisodeNumber: absEp,
        seasonNumber: data.seasonNumber,
        skipIntro: data.skipIntro,
        skipOutro: data.skipOutro,
    };

    // Send to same window (for userscript running on parent page)
    try {
        window.postMessage(payload, '*');
    } catch { }

    // Also relay to iframe (for userscript running inside embedded player like sibnet)
    try {
        const iframe = document.getElementById('anime-player-iframe');
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage(payload, '*');
        }
    } catch { }
    
    // Also expose data as attributes on hidden video element for direct access by userscripts
    updateAnimePlayerDataElement({ ...data, absoluteEpisodeNumber: absEp });
}

function updateAnimePlayerDataElement(data) {
    // Find or create hidden video element that stores current anime player state
    let vidElement = document.getElementById('ateaish-anime-data');
    if (!vidElement) {
        vidElement = document.createElement('video');
        vidElement.id = 'ateaish-anime-data';
        vidElement.style.display = 'none';
        vidElement.style.visibility = 'hidden';
        document.documentElement.appendChild(vidElement);
    }
    
    // Update data attributes
    if (data.malId !== null && data.malId !== undefined) {
        vidElement.setAttribute('data-mal-id', String(data.malId));
    }
    if (data.aniListId !== null && data.aniListId !== undefined) {
        vidElement.setAttribute('data-anilist-id', String(data.aniListId));
    }
    if (data.episodeNumber !== null && data.episodeNumber !== undefined) {
        vidElement.setAttribute('data-episode', String(data.episodeNumber));
    }
    if (data.absoluteEpisodeNumber !== null && data.absoluteEpisodeNumber !== undefined) {
        vidElement.setAttribute('data-absolute-episode', String(data.absoluteEpisodeNumber));
    }
    if (data.seasonNumber !== null && data.seasonNumber !== undefined) {
        vidElement.setAttribute('data-season', String(data.seasonNumber));
    }
}

// Watch Later (anime)
const ANIME_WATCH_LATER_KEY = 'animeWatchLater';

function getAnimeWatchLater() {
    try { return JSON.parse(localStorage.getItem(ANIME_WATCH_LATER_KEY) || '[]'); } catch { return []; }
}
function setAnimeWatchLater(list) {
    try { localStorage.setItem(ANIME_WATCH_LATER_KEY, JSON.stringify(Array.isArray(list) ? list : [])); } catch { }
}
function wlKeyAnime(id) {
    const mid = String(id ?? '').trim();
    return mid ? `anime:${mid}` : '';
}
function normalizeAndDedupeAnimeWatchLater(list) {
    const map = new Map();
    for (const it of Array.isArray(list) ? list : []) {
        const id = String(it?.id ?? '').trim();
        if (!id) continue;
        const key = wlKeyAnime(id);
        const updatedAt = it?.updatedAt ?? it?.updated_at ?? it?.addedAt ?? 0;
        const normalized = {
            id,
            title: it?.title ?? '',
            poster: it?.poster ?? '',
            year: it?.year ?? '',
            type: it?.type ?? '',
            episodes: it?.episodes ?? '',
            overview: it?.overview ?? '',
            updatedAt
        };
        const prev = map.get(key);
        if (!prev || (updatedAt || 0) > (prev.updatedAt || 0)) map.set(key, normalized);
    }
    return Array.from(map.values());
}
function isInAnimeWatchLater(id) {
    const key = wlKeyAnime(id);
    if (!key) return false;
    return getAnimeWatchLater().some(x => wlKeyAnime(x?.id) === key);
}
function toggleAnimeWatchLater(item) {
    const list = getAnimeWatchLater();
    const key = wlKeyAnime(item?.id);
    if (!key) return false;
    const idx = list.findIndex(x => wlKeyAnime(x?.id) === key);
    let added;
    if (idx >= 0) {
        list.splice(idx, 1);
        added = false;
    } else {
        list.push({
            id: String(item.id),
            title: item.title || '',
            poster: item.poster || '',
            year: item.year || '',
            type: item.type || '',
            episodes: item.episodes ?? '',
            overview: item.overview || '',
            updatedAt: Date.now()
        });
        added = true;
    }
    setAnimeWatchLater(normalizeAndDedupeAnimeWatchLater(list));
    try { loadAnimeWatchLater(); } catch { }
    scheduleSuggestedAnimeReload();
    return added;
}
function removeFromAnimeWatchLater(id) {
    const key = wlKeyAnime(id);
    if (!key) return;
    const list = getAnimeWatchLater().filter(x => wlKeyAnime(x?.id) !== key);
    setAnimeWatchLater(list);
    try { loadAnimeWatchLater(); } catch { }
    scheduleSuggestedAnimeReload();
}

async function openAnimeByMalId(malId) {
    if (!malId) return;
    const directWatchId = parseNineAnimeSyntheticId(malId);
    if (directWatchId) {
        const progressRecord = getAnimeProgressRecord(malId) || {};
        const watchLaterItem = getAnimeWatchLater().find((item) => String(item?.id || '').trim() === String(malId).trim()) || {};
        const title = String(progressRecord.title || watchLaterItem.title || '').trim() || `9anime ${directWatchId}`;
        const poster = String(progressRecord.poster || watchLaterItem.poster || '').trim();
        const year = String(progressRecord.year || watchLaterItem.year || '').trim();
        const episodesTotal = progressRecord.episodesTotal || watchLaterItem.episodes || '?';
        const inferredType = Number(episodesTotal) === 1 ? 'Movie' : 'TV';
        await openAnimeFromJikan({
            mal_id: String(malId),
            title,
            title_english: title,
            year,
            episodes: episodesTotal,
            type: inferredType,
            images: {
                jpg: {
                    image_url: poster,
                    small_image_url: poster,
                    large_image_url: poster
                }
            },
            _nineAnimeDirect: true,
            _nineAnimeWatchId: directWatchId,
            _nineAnimeWatchPath: ''
        });
        return;
    }

    try {
        const suffix = adultContentEnabled ? '' : '?sfw';
        const data = await fetchJson(`${JIKAN_BASE}/anime/${malId}${suffix}`);
        const anime = data && data.data ? data.data : null;
        if (anime) openAnimeFromJikan(anime);
    } catch (e) {
        console.warn('Failed to open anime by MAL id', malId, e);
    }
}

function loadAnimeWatchLater() {
    const section = document.getElementById('watchLaterSection');
    const grid = document.getElementById('watchLaterGrid');
    if (!section || !grid) return;

    const raw = getAnimeWatchLater();
    const list = normalizeAndDedupeAnimeWatchLater(raw)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (!list.length) {
        // keep hidden when empty
        grid.innerHTML = '';
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    grid.innerHTML = '';

    list.forEach((it) => {
        const div = document.createElement('div');
        div.className = 'poster';
        div.style.position = 'relative';
        const title = it.title || 'Unknown';
        const poster = it.poster || '';
        div.innerHTML = `
            <img src="${poster}" alt="${escapeHtml(title)}">
            ${buildPosterTitleMarkup(title, it.year ? String(it.year) : '')}
        `;
        div.onclick = () => openAnimeByMalId(it.id);

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
            removeFromAnimeWatchLater(it.id);
        };
        div.appendChild(removeBtn);
        grid.appendChild(div);
    });
}

// Continue Watching scroll button
const continueBtn = document.getElementById('continue-btn');
if (continueBtn) {
    continueBtn.addEventListener('click', () => {
        const el = document.getElementById('continueSection') || document.getElementById('continueWatchingSection');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

// --- Anime-sama SQLite database (anime_sama.db) ---
let animeSamaDb = null;
let animeSamaDbReady = null;

if (typeof initSqlJs === 'function') {
    animeSamaDbReady = (async () => {
        try {
            const SQL = await initSqlJs({
                locateFile: (file) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.9.0/${file}`
            });

            const res = await fetch('anime_sama.db');
            if (!res.ok) throw new Error(`Failed to load anime_sama.db: HTTP ${res.status}`);

            const buffer = await res.arrayBuffer();
            animeSamaDb = new SQL.Database(new Uint8Array(buffer));
        } catch (e) {
            console.error('Failed to initialize anime_sama.db', e);
            animeSamaDb = null;
        }
    })();
} else {
    // sql.js not available; keep promise resolved so callers can await safely
    animeSamaDbReady = Promise.resolve();
}

searchContainer.style.position = 'relative';

function truncate(text, maxLen = 260) {
    if (!text) return '';
    return text.length > maxLen ? text.slice(0, maxLen - 3) + '...' : text;
}

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildYear(anime) {
    if (anime.year) return anime.year;
    const from = anime.aired && anime.aired.prop && anime.aired.prop.from;
    return from && from.year ? from.year : '';
}

function parseAnimeDate(value) {
    if (!value) return null;
    try {
        const parsed = new Date(value);
        return Number.isFinite(parsed.getTime()) ? parsed : null;
    } catch {
        return null;
    }
}

function isNewAnimeRelease(anime, days = NEW_ANIME_WINDOW_DAYS) {
    const airedFrom = parseAnimeDate(anime?.aired?.from);
    if (!airedFrom) return false;
    const age = Date.now() - airedFrom.getTime();
    return age >= 0 && age <= days * MS_PER_DAY;
}

function isReleasedAnime(anime) {
    if (!anime) return false;

    const status = String(anime.status || '').toLowerCase();
    if (status.includes('not yet aired') || status.includes('upcoming')) return false;

    const fromRaw = anime && anime.aired && anime.aired.from ? anime.aired.from : null;
    if (fromRaw) {
        try {
            const from = new Date(fromRaw);
            if (Number.isFinite(from.getTime())) return from.getTime() <= Date.now();
        } catch {
            // fall through
        }
    }

    // If we can't reliably determine start date, assume released unless explicitly upcoming.
    return true;
}

function buildPoster(anime) {
    // Prefer a reasonably sized poster for grids (use srcset for higher quality where possible)
    return buildPosterVariants(anime).medium;
}

function getPreferredAnimeTitle(entry, fallback = 'Unknown') {
    const candidates = [
        entry?.title_english,
        entry?.titleEnglish,
        entry?.title,
        entry?.name,
        entry?.title_japanese,
        entry?.titleJapanese
    ];
    for (const candidate of candidates) {
        const text = String(candidate || '').trim();
        if (text) return text;
    }
    return fallback;
}

function buildPosterTitleMarkup(title, metaText = '') {
    return `
        <div class="poster-title-strip">
            <div class="poster-title-main">${escapeHtml(title || 'Unknown')}</div>
            ${metaText ? `<div class="poster-title-meta">${escapeHtml(metaText)}</div>` : ''}
        </div>
    `;
}

function buildPosterVariants(anime) {
    const webp = anime && anime.images && anime.images.webp ? anime.images.webp : null;
    const jpg = anime && anime.images && anime.images.jpg ? anime.images.jpg : null;

    const small =
        (webp && (webp.small_image_url || webp.image_url)) ||
        (jpg && (jpg.small_image_url || jpg.image_url)) ||
        '';

    const medium =
        (webp && (webp.image_url || webp.small_image_url)) ||
        (jpg && (jpg.image_url || jpg.small_image_url)) ||
        '';

    const large =
        (webp && (webp.large_image_url || webp.image_url)) ||
        (jpg && (jpg.large_image_url || jpg.image_url)) ||
        '';

    const fallback = 'https://via.placeholder.com/300x450.png?text=No+Image';

    return {
        small: small || medium || large || fallback,
        medium: medium || large || small || fallback,
        large: large || medium || small || fallback
    };
}

function createPosterBadgeElement(badge) {
    const span = document.createElement('span');
    const tone = String(badge?.tone || 'default').toLowerCase();
    const palette = {
        new: { background: '#f1892f', color: '#000' },
        accent: { background: '#14d9b7', color: '#001612' },
        info: { background: '#1b75ff', color: '#fff' },
        default: { background: 'rgba(0,0,0,0.78)', color: '#fff' }
    }[tone] || { background: 'rgba(0,0,0,0.78)', color: '#fff' };
    span.textContent = String(badge?.label || '').trim();
    span.style.background = palette.background;
    span.style.color = palette.color;
    span.style.fontSize = '11px';
    span.style.fontWeight = '700';
    span.style.padding = '4px 8px';
    span.style.borderRadius = '999px';
    span.style.letterSpacing = '0.04em';
    span.style.textTransform = 'uppercase';
    span.style.boxShadow = '0 2px 10px rgba(0,0,0,0.35)';
    span.style.pointerEvents = 'none';
    return span;
}

function renderPosterBadgeHost(host, badges) {
    if (!host) return;
    host.innerHTML = '';
    (Array.isArray(badges) ? badges : []).forEach((badge) => {
        if (!badge || !badge.label) return;
        host.appendChild(createPosterBadgeElement(badge));
    });
}

function buildPosterCardBadges(anime, options = {}) {
    const badges = [];
    if (isNewAnimeRelease(anime)) badges.push({ label: 'New', tone: 'new' });
    if (Array.isArray(options.badges)) {
        options.badges.forEach((badge) => {
            if (badge && badge.label) badges.push(badge);
        });
    }
    return badges;
}

function createPosterCard(anime, onClick, options = {}) {
    const posters = buildPosterVariants(anime);
    const title = getPreferredAnimeTitle(anime);
    const year = buildYear(anime);
    const overview = anime.synopsis || '';
    const malId = anime.mal_id;

    const clickable = options && options.clickable === false ? false : typeof onClick === 'function';

    const posterDiv = document.createElement('div');
    posterDiv.className = 'poster';
    if (clickable) {
        posterDiv.onclick = () => onClick(anime);
    } else {
        posterDiv.style.cursor = 'default';
    }

    const img = document.createElement('img');
    img.src = posters.medium;
    // Give the browser higher-res options for sharper posters on HiDPI screens
    const srcsetParts = [];
    if (posters.small) srcsetParts.push(`${posters.small} 92w`);
    if (posters.medium) srcsetParts.push(`${posters.medium} 184w`);
    if (posters.large) srcsetParts.push(`${posters.large} 368w`);
    if (srcsetParts.length) {
        img.srcset = srcsetParts.join(', ');
        // Match /movies card sizing (grid uses ~200px columns; smaller on mobile)
        img.sizes = '(max-width: 600px) 33vw, 200px';
    }
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = title;
    posterDiv.appendChild(img);

    const badgeHost = document.createElement('div');
    badgeHost.className = 'poster-badges';
    badgeHost.style.position = 'absolute';
    badgeHost.style.top = '10px';
    badgeHost.style.left = '10px';
    badgeHost.style.display = 'flex';
    badgeHost.style.flexDirection = 'column';
    badgeHost.style.gap = '6px';
    badgeHost.style.zIndex = '3';
    renderPosterBadgeHost(badgeHost, buildPosterCardBadges(anime, options));
    if (badgeHost.childElementCount) posterDiv.appendChild(badgeHost);

    const metaParts = [];
    if (anime.type) metaParts.push(String(anime.type));
    if (year) metaParts.push(String(year));
    const titleStrip = document.createElement('div');
    titleStrip.innerHTML = buildPosterTitleMarkup(title, metaParts.join(' • '));
    posterDiv.appendChild(titleStrip.firstElementChild);


    // Hover info box (matches /movies CSS)
    const info = document.createElement('div');
    info.className = 'poster-info';

    const isSaved = malId ? isInAnimeWatchLater(malId) : false;
    const labelText = isSaved ? 'Remove from Watch Later' : 'Add to Watch Later';
    const btnSymbol = isSaved
        ? '<span class="material-symbols-outlined" aria-hidden="true">playlist_add_check</span>'
        : '<span class="material-symbols-outlined" aria-hidden="true">playlist_add</span>';

    info.innerHTML = `
        <div style="font-family:'OumaTrialBold';">
            ${escapeHtml(title)}
            ${year ? `<span style="float:right; opacity:0.7;">${escapeHtml(year)}</span>` : ''}
        </div>
        ${overview ? `<div style="margin-top:8px;font-family:'OumaTrialLight'">${escapeHtml(truncate(overview, 120))}</div>` : ''}
        <div style="margin-top:8px; color:#f1892f;">${escapeHtml(anime.type || '')} • ${escapeHtml(anime.episodes || '?')} eps</div>
        <button class="watch-later-btn"
            aria-label="${escapeHtml(labelText)}"
            title="${escapeHtml(labelText)}"
            style="position:absolute; right:0px; bottom:8px; width:36px; height:36px; border-radius:50%;
                   background:transparent; color:#f1892f; border:0px solid #f1892f; display:flex;
                   align-items:center; justify-content:center; font-size:22px; font-weight:700; line-height:1;
                   cursor:pointer; box-shadow:0 2px 6px rgba(0,0,0,.4);">
            ${btnSymbol}
        </button>
        <span class="watch-later-label"
              style="position:absolute; right:44px; bottom:14px; color:#f1892f; font-size:12px; font-weight:600;
                     opacity:0; transform:translateX(6px); transition:opacity .15s ease, transform .15s ease;
                     pointer-events:none; white-space:nowrap;">
            ${escapeHtml(labelText)}
        </span>
    `;

    const wlBtn = info.querySelector('.watch-later-btn');
    const wlLabel = info.querySelector('.watch-later-label');

    const updateWatchLaterUI = (saved) => {
        if (!wlBtn || !wlLabel) return;
        wlBtn.innerHTML = saved
            ? '<span class="material-symbols-outlined" aria-hidden="true">playlist_add_check</span>'
            : '<span class="material-symbols-outlined" aria-hidden="true">playlist_add</span>';
        const text = saved ? 'Remove from Watch Later' : 'Add to Watch Later';
        wlBtn.title = text;
        wlBtn.setAttribute('aria-label', text);
        wlLabel.textContent = text;
    };

    if (wlBtn && wlLabel && malId) {
        wlBtn.addEventListener('mouseenter', () => {
            wlLabel.style.opacity = '1';
            wlLabel.style.transform = 'translateX(0)';
        });
        wlBtn.addEventListener('mouseleave', () => {
            wlLabel.style.opacity = '0';
            wlLabel.style.transform = 'translateX(6px)';
        });
        wlBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const nowSaved = toggleAnimeWatchLater({
                id: malId,
                title,
                poster: posters.medium,
                year,
                type: anime.type || '',
                episodes: anime.episodes || '',
                overview
            });
            updateWatchLaterUI(nowSaved);
            try {
                wlBtn.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 200 });
            } catch { }
        });
    }

    posterDiv.appendChild(info);
    return posterDiv;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const JIKAN_MIN_INTERVAL_MS = 900;
let jikanRequestQueue = Promise.resolve();
let jikanLastRequestAt = 0;
const ANILIST_MIN_INTERVAL_MS = 900;
let aniListRequestQueue = Promise.resolve();
let aniListLastRequestAt = 0;

function isJikanUrl(url) {
    return String(url || '').startsWith(JIKAN_BASE);
}

function enqueueJikanRequest(task) {
    const next = jikanRequestQueue
        .catch(() => undefined)
        .then(async () => {
            const waitMs = Math.max(0, JIKAN_MIN_INTERVAL_MS - (Date.now() - jikanLastRequestAt));
            if (waitMs > 0) await sleep(waitMs);
            jikanLastRequestAt = Date.now();
            return task();
        });

    jikanRequestQueue = next.then(() => undefined, () => undefined);
    return next;
}

function disableAniListApi(reason, error = null) {
    aniListApiUnavailable = true;
    if (aniListApiUnavailableLogged) return;
    aniListApiUnavailableLogged = true;
    if (error) {
        console.warn(reason, error);
        return;
    }
    console.warn(reason);
}

function enqueueAniListRequest(task) {
    const next = aniListRequestQueue
        .catch(() => undefined)
        .then(async () => {
            const waitMs = Math.max(0, ANILIST_MIN_INTERVAL_MS - (Date.now() - aniListLastRequestAt));
            if (waitMs > 0) await sleep(waitMs);
            aniListLastRequestAt = Date.now();
            return task();
        });

    aniListRequestQueue = next.then(() => undefined, () => undefined);
    return next;
}

async function fetchAniListGraphQL(query, variables = {}, timeoutMs = 15000) {
    if (aniListApiUnavailable) return null;

    const canUseProtectedRemote = await canUseAnimeProtectedRemoteSources(600);
    if (!canUseProtectedRemote && !isLocalAnimeDev()) {
        disableAniListApi('AniList requests are disabled on this host without the anime helper bridge.');
        return null;
    }

    const params = new URLSearchParams({
        query,
        variables: JSON.stringify(variables || {})
    });

    try {
        return await enqueueAniListRequest(() => fetchAnimeRemoteJson(`${ANILIST_GRAPHQL}/?${params.toString()}`, timeoutMs));
    } catch (error) {
        const message = String(error && error.message ? error.message : error || '');
        if (message.includes('429') || message.includes('Failed to fetch') || message.includes('timeout')) {
            disableAniListApi('AniList requests are temporarily unavailable; continuing without AniList mapping.', error);
            return null;
        }
        console.warn('AniList request failed', error);
        return null;
    }
}

// Wrap fetch with simple retry & backoff to be kinder to Jikan API
async function fetchJson(url, maxRetries = 4) {
    let delay = 800;
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const res = isJikanUrl(url)
                ? await enqueueJikanRequest(() => fetch(url))
                : await fetch(url);
            if (res.status === 429) {
                // Rate limited: respect Retry-After if present, otherwise backoff
                if (attempt === maxRetries) throw new Error(`HTTP 429`);
                const retryAfter = res.headers.get('Retry-After');
                const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay;
                await sleep(waitMs + Math.random() * 200);
                delay *= 2;
                continue;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            lastError = e;
            if (attempt === maxRetries) throw lastError;
            await sleep(delay);
            delay *= 2;
        }
    }
    throw lastError || new Error('Unknown fetch error');
}

const animeEpisodeCountCache = new Map();

async function resolveAnimeEpisodeCount(anime) {
    const malId = Number(anime?.mal_id);
    if (!Number.isFinite(malId) || malId <= 0) return null;

    const directCount = Number(anime?.episodes);
    if (Number.isFinite(directCount) && directCount > 0) return directCount;

    if (animeEpisodeCountCache.has(malId)) {
        return animeEpisodeCountCache.get(malId);
    }

    let resolvedCount = null;

    try {
        const details = await fetchJson(`${JIKAN_BASE}/anime/${malId}?sfw`, 2);
        const detailCount = Number(details?.data?.episodes);
        if (Number.isFinite(detailCount) && detailCount > 0) {
            resolvedCount = detailCount;
        }
    } catch (e) {
        console.warn('Failed to resolve anime episode count from details endpoint', malId, e);
    }

    if (!resolvedCount) {
        try {
            const page1 = await fetchJson(`${JIKAN_BASE}/anime/${malId}/episodes?page=1`, 2);
            const itemsTotal = Number(page1?.pagination?.items?.total);
            if (Number.isFinite(itemsTotal) && itemsTotal > 0) {
                resolvedCount = itemsTotal;
            } else {
                const lastPage = Number(page1?.pagination?.last_visible_page);
                const firstPageLen = Array.isArray(page1?.data) ? page1.data.length : 0;

                const perPage = Number(page1?.pagination?.items?.per_page);
                const inferredPerPage = Number.isFinite(perPage) && perPage > 0
                    ? perPage
                    : firstPageLen;

                if (Number.isFinite(lastPage) && lastPage > 1 && inferredPerPage > 0) {
                    const lastPageData = await fetchJson(`${JIKAN_BASE}/anime/${malId}/episodes?page=${lastPage}`, 2);
                    const lastPageLen = Array.isArray(lastPageData?.data) ? lastPageData.data.length : 0;
                    resolvedCount = lastPageLen > 0
                        ? ((lastPage - 1) * inferredPerPage) + lastPageLen
                        : lastPage * inferredPerPage;
                } else if (firstPageLen > 0) {
                    resolvedCount = firstPageLen;
                }
            }
        } catch (e) {
            console.warn('Failed to resolve anime episode count from episodes endpoint', malId, e);
        }
    }

    const normalizedCount = Number.isFinite(Number(resolvedCount)) && Number(resolvedCount) > 0
        ? Number(resolvedCount)
        : null;
    animeEpisodeCountCache.set(malId, normalizedCount);
    return normalizedCount;
}

// Ensure search results use the exact same grid sizing as the homepage grids
let _resultsGridRO = null;
function setupResultsGridLayout() {
    if (!resultsContainer) return;
    resultsContainer.style.display = 'grid';

    const trending = document.getElementById('trendingGrid');

    const applyFromTrending = () => {
        if (!trending) return 0;
        const firstCard = trending.querySelector('.poster') || trending.firstElementChild;
        const el = firstCard ? (firstCard.querySelector('img') || firstCard) : null;
        const rect = el ? el.getBoundingClientRect() : null;
        const w = rect ? Math.round(rect.width) : 0;

        const cs = window.getComputedStyle(trending);
        const gap = cs.gap || cs.columnGap || '8px';
        const align = cs.alignItems || 'start';
        resultsContainer.style.gap = gap;
        resultsContainer.style.alignItems = align;

        if (w > 0 && Number.isFinite(w)) {
            resultsContainer.style.gridTemplateColumns = `repeat(auto-fill, minmax(${w}px, 1fr))`;
            return w;
        }
        return 0;
    };

    const appliedWidth = applyFromTrending();
    if (appliedWidth === 0) {
        resultsContainer.style.gridTemplateColumns = 'repeat(auto-fill, minmax(200px, 1fr))';
        if (trending && !_resultsGridRO) {
            _resultsGridRO = new ResizeObserver(() => {
                const w = applyFromTrending();
                if (w > 0) {
                    _resultsGridRO.disconnect();
                    _resultsGridRO = null;
                }
            });
            _resultsGridRO.observe(trending);
        }
    }
}

function renderAnimeCardsIntoGrid(grid, items, { clickable = true } = {}) {
    grid.innerHTML = '';
    items.forEach((anime) => {
        const card = createPosterCard(anime, openAnimeFromJikan, { clickable });
        grid.appendChild(card);
    });
}

function renderNineAnimeBrowseCardsIntoGrid(grid, items) {
    grid.innerHTML = '';
    items.forEach((anime) => {
        const card = createPosterCard(anime, openAnimeFromBrowseEntry);
        grid.appendChild(card);
    });
}

async function fetchJikanSearchEntries(query) {
    const params = buildSearchParams(query);
    let url = `${JIKAN_BASE}/anime?${params.toString()}`;
    if (!adultContentEnabled) url += '&sfw';

    const data = await fetchJson(url, 2);
    return (Array.isArray(data?.data) ? data.data : []).filter((anime) => {
        if (!animeMatchesSearchType(anime)) return false;
        if (!animeMatchesSearchYear(anime)) return false;
        if (!animeMatchesAdultSetting(anime)) return false;
        return true;
    });
}

async function fetchJikanAdultEntries({ movie = false, count = 24 } = {}) {
    const collected = new Map();
    const page = String(randomPage(10));
    const variants = [
        { order_by: 'popularity', sort: 'desc', limit: '50', page },
        { order_by: 'members', sort: 'desc', limit: '50', page: '1' }
    ];

    for (const variant of variants) {
        const params = new URLSearchParams(variant);
        if (movie) params.set('type', 'movie');

        try {
            const data = await fetchJson(`${JIKAN_BASE}/anime?${params.toString()}`, 2);
            const picks = Array.isArray(data?.data) ? data.data : [];
            picks.forEach((anime) => {
                const key = String(anime?.mal_id || '').trim();
                if (!key || collected.has(key)) return;
                if (!isReleasedAnime(anime)) return;
                if (!isAdultAnime(anime)) return;
                if (movie ? !isAnimeMovieType(anime) : isAnimeMovieType(anime)) return;
                collected.set(key, anime);
            });
            if (collected.size >= count) break;
        } catch (error) {
            console.warn('Failed to fetch Jikan adult entries', movie ? 'movie' : 'series', error);
        }
    }

    return Array.from(collected.values()).slice(0, count);
}

const sectionRetryCounts = new Map();

function scheduleSectionRetry(url, gridId, options, delayMs, maxRetries = 1) {
    const key = `${gridId}:${url}`;
    const attempts = Number(sectionRetryCounts.get(key) || 0);
    if (attempts >= maxRetries) return false;
    sectionRetryCounts.set(key, attempts + 1);
    setTimeout(() => loadSection(url, gridId, options), delayMs);
    return true;
}

async function loadSection(url, gridId, options = {}) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    grid.innerHTML = '';
    try {
        const data = await fetchJson(url, 5);
        sectionRetryCounts.delete(`${gridId}:${url}`);
        const list = data.data || [];
        const filtered = list.filter((anime) => {
            if (options.releasedOnly !== false && !isReleasedAnime(anime)) return false;
            if (options.media === 'series' && isAnimeMovieType(anime)) return false;
            if (options.media === 'movie' && !isAnimeMovieType(anime)) return false;
            if (options.adultOnly && !isAdultAnime(anime)) return false;
            if (!options.adultOnly && !animeMatchesAdultSetting(anime)) return false;
            return true;
        });
        renderAnimeCardsIntoGrid(grid, filtered, { clickable: options.clickable !== false });
    } catch (e) {
        console.error('Failed to load section', gridId, e);
        const msg = e && e.message ? String(e.message) : '';
        if (msg.includes('429')) {
            const retrying = scheduleSectionRetry(url, gridId, options, 8000, 1);
            grid.innerHTML = retrying ? '<div>Rate limited, retrying once...</div>' : '<div>Rate limited. Try again later.</div>';
        } else {
            const retrying = scheduleSectionRetry(url, gridId, options, 3000, 1);
            grid.innerHTML = retrying ? '<div>Failed to load. Retrying once...</div>' : '<div>Failed to load.</div>';
        }
    }
}

async function searchAnime(query) {
    if (query.length < 2) {
        resultsContainer.innerHTML = '';
        setSearchStatus('');
        return;
    }
    setupResultsGridLayout();
    resultsContainer.innerHTML = 'Searching...';
    setSearchStatus('Searching...');
    try {
        const unsupportedDirectFilters = hasUnsupportedDirectSearchFilters();
        const canUseDirectNineAnime = !unsupportedDirectFilters && await canUseAnimeProtectedRemoteSources();

        if (canUseDirectNineAnime) {
            const directResults = await fetchNineAnimeSearchEntries(query);
            const directList = sortNineAnimeSearchEntries(
                directResults.filter((anime) => animeMatchesSearchType(anime) && animeMatchesSearchYear(anime) && animeMatchesAdultSetting(anime)),
                query
            );

            if (directList.length) {
                resultsContainer.innerHTML = '';
                directList.forEach((anime) => {
                    const card = createPosterCard(anime, openAnimeFromBrowseEntry);
                    resultsContainer.appendChild(card);
                });
                setSearchStatus(`${directList.length} direct 9anime results${adultContentEnabled ? ' including adult titles' : ''}.`);
                return;
            }
        }

        const jikanResults = await fetchJikanSearchEntries(query);
        if (!jikanResults.length) {
            resultsContainer.textContent = 'No results found.';
            setSearchStatus('No matching anime found for the current filters.');
            return;
        }

        resultsContainer.innerHTML = '';
        renderAnimeCardsIntoGrid(resultsContainer, jikanResults, { clickable: true });

        const reason = unsupportedDirectFilters
            ? 'Advanced filters are using Jikan search.'
            : (!canUseDirectNineAnime && !isLocalAnimeDev() ? 'Using Jikan because direct 9anime search is unavailable here.' : 'Using Jikan search.');
        setSearchStatus(`${jikanResults.length} Jikan results. ${reason}`);
    } catch (e) {
        console.error('Search failed', e);
        resultsContainer.textContent = 'Error fetching data. Please try again later.';
        setSearchStatus('Search failed. Please try again.');
    }
}

async function malToAniListId(malId) {
    if (!malId) return null;
    try {
        const json = await fetchAniListGraphQL(
            'query ($idMal: Int) { Media(idMal: $idMal, type: ANIME) { id } }',
            { idMal: Number(malId) }
        );
        return json && json.data && json.data.Media && json.data.Media.id ? json.data.Media.id : null;
    } catch (e) {
        console.error('Failed to resolve AniList id for MAL', malId, e);
        return null;
    }
}

// Player performance caches
const MAL_TO_ANILIST_CACHE_PREFIX = 'anime_mal_to_anilist:';
const malToAniListCache = new Map();
const animeSamaSeasonsCache = new Map();
let currentAnimePlayerOpenToken = null;

function getCachedAniListId(malId) {
    if (!malId) return null;
    if (malToAniListCache.has(malId)) return malToAniListCache.get(malId);
    try {
        const raw = localStorage.getItem(`${MAL_TO_ANILIST_CACHE_PREFIX}${malId}`);
        if (!raw) return null;
        const parsed = parseInt(raw, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
            malToAniListCache.set(malId, parsed);
            return parsed;
        }
    } catch { }
    return null;
}

function setCachedAniListId(malId, aniListId) {
    if (!malId || !aniListId) return;
    malToAniListCache.set(malId, aniListId);
    try {
        localStorage.setItem(`${MAL_TO_ANILIST_CACHE_PREFIX}${malId}`, String(aniListId));
    } catch { }
}

async function getAnimeSamaSeasonsEpisodesCached(aniListId) {
    if (!aniListId) return null;
    if (animeSamaSeasonsCache.has(aniListId)) return animeSamaSeasonsCache.get(aniListId);
    const data = await getAnimeSamaSeasonsEpisodes(aniListId);
    animeSamaSeasonsCache.set(aniListId, data);
    return data;
}

// Cache TMDB ids per MAL id so we don't re-query
const tmdbIdCache = {};

async function getTmdbIdForAnimeMovie(anime) {
    const malId = anime && anime.mal_id;
    const key = malId ? `mal:${malId}` : (anime && anime.title) || 'unknown';
    if (tmdbIdCache[key] !== undefined) return tmdbIdCache[key];

    const year = buildYear(anime);
    const candidates = [];
    if (anime.title_english) candidates.push(anime.title_english);
    if (anime.title) candidates.push(anime.title);
    if (anime.title_japanese) candidates.push(anime.title_japanese);

    for (const title of candidates) {
        try {
            const params = new URLSearchParams({
                api_key: TMDB_API_KEY,
                query: title
            });
            if (year) params.set('year', String(year));
            const res = await fetch(`${TMDB_SEARCH_MOVIE}?${params.toString()}`);
            if (!res.ok) continue;
            const json = await res.json();
            const results = Array.isArray(json.results) ? json.results : [];
            if (results.length) {
                const id = results[0].id;
                tmdbIdCache[key] = id;
                return id;
            }
        } catch (e) {
            console.warn('TMDB movie search failed for', title, e);
        }
    }
    tmdbIdCache[key] = null;
    return null;
}

// For sequels/spin-offs, walk AniList relations to find the first-season/base id
async function resolveBaseAniListId(aniListId, maxDepth = 4) {
    if (!aniListId) return null;
    if (aniListApiUnavailable) return aniListId;
    let currentId = aniListId;
    const visited = new Set();

    for (let depth = 0; depth < maxDepth; depth++) {
        if (visited.has(currentId)) break;
        visited.add(currentId);
        try {
            const json = await fetchAniListGraphQL(
                `query ($id: Int) {
                    Media(id: $id, type: ANIME) {
                        id
                        relations {
                            edges {
                                relationType
                                node { id }
                            }
                        }
                    }
                }`,
                { id: Number(currentId) }
            );
            if (!json || !json.data || !json.data.Media) {
                break;
            }
            const media = json && json.data && json.data.Media;
            const edges = media && media.relations && Array.isArray(media.relations.edges)
                ? media.relations.edges
                : [];
            const prequelEdge = edges.find(e => e && e.relationType === 'PREQUEL' && e.node && e.node.id);
            if (!prequelEdge) break;
            const prequelId = prequelEdge.node.id;
            if (!prequelId || visited.has(prequelId)) break;
            currentId = prequelId;
        } catch (e) {
            console.warn('Failed to resolve base AniList id', aniListId, e);
            break;
        }
    }
    return currentId;
}

const animePlaybackProfileCache = new Map();
const nineAnimeSearchCache = new Map();
const nineAnimeSearchResultCache = new Map();
const nineAnimeEpisodeListCache = new Map();
const nineAnimeEpisodeSourceCache = new Map();
const nineAnimeBrowseCache = new Map();

function normalizeAnimeMatchText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function tokenizeAnimeMatchText(value) {
    const normalized = normalizeAnimeMatchText(value);
    return normalized ? normalized.split(/\s+/).filter(Boolean) : [];
}

function getAnimeTitleCandidates(anime) {
    const titles = [];
    const pushTitle = (value) => {
        const text = String(value || '').trim();
        if (!text || titles.includes(text)) return;
        titles.push(text);
    };

    pushTitle(anime?.title_english);
    pushTitle(anime?.title);
    pushTitle(anime?.title_japanese);
    (anime?.title_synonyms || []).forEach(pushTitle);
    (anime?.titles || []).forEach((entry) => pushTitle(entry?.title));

    return titles;
}

function scoreNineAnimeCandidate(candidate, titleCandidates) {
    const candidateTitle = candidate?.title || candidate?.slug || '';
    const candidateNorm = normalizeAnimeMatchText(candidateTitle);
    const candidateTokens = new Set(tokenizeAnimeMatchText(candidateTitle));
    if (!candidateNorm) return 0;

    let bestScore = 0;
    titleCandidates.forEach((title) => {
        const titleNorm = normalizeAnimeMatchText(title);
        if (!titleNorm) return;
        if (candidateNorm === titleNorm) {
            bestScore = Math.max(bestScore, 1000);
            return;
        }
        if (candidateNorm.includes(titleNorm) || titleNorm.includes(candidateNorm)) {
            bestScore = Math.max(bestScore, 820 - Math.abs(candidateNorm.length - titleNorm.length));
        }

        const titleTokens = tokenizeAnimeMatchText(title);
        if (!titleTokens.length) return;
        let overlap = 0;
        titleTokens.forEach((token) => {
            if (candidateTokens.has(token)) overlap += 1;
        });
        const ratio = overlap / Math.max(candidateTokens.size || 1, titleTokens.length);
        bestScore = Math.max(bestScore, Math.round(ratio * 700));
    });

    return bestScore;
}

function buildNineAnimeSyntheticId(watchId) {
    const numericWatchId = Number(watchId);
    return Number.isFinite(numericWatchId) && numericWatchId > 0
        ? `${NINE_ANIME_DIRECT_ID_PREFIX}${numericWatchId}`
        : '';
}

function parseNineAnimeSyntheticId(value) {
    const match = String(value || '').trim().match(/^9anime:(\d+)$/i);
    if (!match) return null;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function inferNineAnimeEntryType({ movie = false, title = '', metaText = '' } = {}) {
    const haystack = `${String(title || '')} ${String(metaText || '')}`.toLowerCase();
    if (movie || /\bmovie\b|\bfilm\b/.test(haystack)) return 'Movie';
    if (/\bova\b/.test(haystack)) return 'OVA';
    if (/\bspecial\b/.test(haystack)) return 'Special';
    return 'TV';
}

function buildNineAnimeParsedEntry({ resolvedUrl, watchId, slug = '', title = '', poster = '', metaText = '', movie = false, searchResult = false } = {}) {
    const normalizedTitle = String(title || '').replace(/\s+/g, ' ').trim();
    if (!normalizedTitle || !resolvedUrl || !watchId) return null;

    const normalizedMeta = String(metaText || '').replace(/\s+/g, ' ').trim();
    const yearMatch = normalizedMeta.match(/(?:19|20)\d{2}/);
    const episodeMatch = normalizedMeta.match(/Ep\s+([^\s!]+)/i);
    const type = inferNineAnimeEntryType({ movie, title: normalizedTitle, metaText: normalizedMeta });
    const syntheticId = buildNineAnimeSyntheticId(watchId);

    return {
        mal_id: syntheticId || null,
        title: normalizedTitle,
        title_english: normalizedTitle,
        synopsis: '',
        type,
        episodes: episodeMatch ? episodeMatch[1] : '?',
        year: yearMatch ? yearMatch[0] : '',
        images: {
            jpg: {
                image_url: poster,
                small_image_url: poster,
                large_image_url: poster
            }
        },
        _nineAnimeBrowse: true,
        _nineAnimeDirect: true,
        _nineAnimeSearchResult: !!searchResult,
        _nineAnimeWatchId: Number(watchId),
        _nineAnimeWatchPath: String(resolvedUrl.pathname || '').trim(),
        _nineAnimeSlug: String(slug || '').trim(),
        _nineAnimeMetaText: normalizedMeta,
    };
}

function parseNineAnimeBrowseResults(html, { movie = false, searchResult = false } = {}) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const results = new Map();

    Array.from(doc.querySelectorAll('.flw-item, .item, .film_list-wrap .flw-item')).forEach((card) => {
        const anchor = card.querySelector('a[href*="/watch/"]');
        if (!anchor) return;

        const href = String(anchor.getAttribute('href') || '').trim();
        if (!href) return;

        let resolvedUrl = null;
        try {
            resolvedUrl = new URL(href, NINE_ANIME_BASE);
        } catch {
            return;
        }

        const match = resolvedUrl.pathname.match(/^\/watch\/([^/?#]+?)-(\d+)\/?$/);
        if (!match) return;

        const titleNode = card.querySelector('.film-name, .dynamic-name, .film-title, a[title]');
        const title = String(anchor.getAttribute('title') || titleNode?.getAttribute('title') || titleNode?.textContent || anchor.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!title) return;

        const img = card.querySelector('img');
        const poster = String(img?.getAttribute('data-src') || img?.getAttribute('data-original') || img?.getAttribute('src') || '').trim();
        const metaText = String(card.textContent || '').replace(/\s+/g, ' ').trim();
        const parsedEntry = buildNineAnimeParsedEntry({
            resolvedUrl,
            watchId: Number(match[2]),
            slug: match[1],
            title,
            poster,
            metaText,
            movie,
            searchResult,
        });
        if (parsedEntry) results.set(resolvedUrl.pathname, parsedEntry);
    });

    return Array.from(results.values());
}

async function fetchNineAnimeBrowseEntries({ genre = 'ecchi', genres = null, movie = false, count = 24 } = {}) {
    if (!await canUseAnimeProtectedRemoteSources()) return [];

    const genreList = Array.isArray(genres) && genres.length
        ? genres.map((value) => String(value || '').trim()).filter(Boolean)
        : [String(genre || '').trim()].filter(Boolean);
    const pageCeiling = movie ? 8 : 19;
    const pageOrder = Array.from(new Set([randomPage(pageCeiling), 1]));
    const collected = new Map();

    for (const genreName of genreList) {
        for (const page of pageOrder) {
            const cacheKey = `${genreName}:${movie ? 'movie' : 'series'}:${page}`;
            if (nineAnimeBrowseCache.has(cacheKey)) {
                const cached = await nineAnimeBrowseCache.get(cacheKey);
                (cached || []).forEach((item) => {
                    const key = String(item?._nineAnimeWatchPath || item?.url || item?.mal_id || '').trim();
                    if (key && !collected.has(key)) collected.set(key, item);
                });
                if (collected.size >= count) return Array.from(collected.values()).slice(0, count);
                continue;
            }

            const pending = (async () => {
                const url = new URL(`${NINE_ANIME_BASE}/genre/${genreName}`);
                if (page > 1) url.searchParams.set('page', String(page));
                if (movie) url.searchParams.set('type', 'movie');

                const html = await fetchAnimeRemoteText(url.toString(), 15000);
                let items = parseNineAnimeBrowseResults(html, { movie });
                if (movie && items.length) {
                    items = items.filter((item) => String(item.type || '').toLowerCase() === 'movie');
                }
                return items;
            })().catch((error) => {
                console.warn('Failed to fetch 9animetv browse entries', genreName, movie ? 'movie' : 'series', page, error);
                return [];
            });

            nineAnimeBrowseCache.set(cacheKey, pending);
            const items = await pending;
            (items || []).forEach((item) => {
                const key = String(item?._nineAnimeWatchPath || item?.url || item?.mal_id || '').trim();
                if (key && !collected.has(key)) collected.set(key, item);
            });
            if (collected.size >= count) return Array.from(collected.values()).slice(0, count);
        }
    }

    return Array.from(collected.values()).slice(0, count);
}

async function resolveBrowseEntryToJikan(entry) {
    const title = String(entry?.title || '').trim();
    if (!title) return null;

    try {
        const params = new URLSearchParams({ q: title, limit: '12' });
        if (String(entry?.type || '').toLowerCase() === 'movie') params.set('type', 'movie');

        const data = await fetchJson(`${JIKAN_BASE}/anime?${params.toString()}`, 4);
        const results = Array.isArray(data?.data) ? data.data : [];
        const playable = await Promise.all(results.map(async (anime) => ({
            anime,
            score: scoreNineAnimeCandidate({ title }, getAnimeTitleCandidates(anime)),
            profile: await getAnimePlaybackProfile(anime)
        })));

        const best = playable
            .filter((item) => item.profile && item.profile.playable && item.score >= 420)
            .sort((a, b) => b.score - a.score)[0];

        return best ? best.anime : null;
    } catch (error) {
        console.warn('Failed to resolve browse entry to Jikan', title, error);
        return null;
    }
}

async function openAnimeFromBrowseEntry(entry) {
    if (!entry) return;
    if (entry._nineAnimeSearchResult) {
        await openAnimeFromJikan(entry);
        return;
    }

    const resolved = await resolveBrowseEntryToJikan(entry);
    if (resolved) {
        await openAnimeFromJikan(resolved);
        return;
    }

    const title = String(entry.title || '').trim();
    if (searchInput && title) searchInput.value = title;
    if (clearSearchBtn) clearSearchBtn.style.display = title ? 'flex' : 'none';
    if (title) {
        setSearchStatus(`Could not auto-resolve ${title}; showing search results instead.`);
        await searchAnime(title);
    }
}

function parseNineAnimeSearchResults(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const results = new Map(parseNineAnimeBrowseResults(html, { searchResult: true }).map((entry) => [entry._nineAnimeWatchPath, entry]));

    Array.from(doc.querySelectorAll('a[href*="/watch/"]')).forEach((anchor) => {
        const href = String(anchor.getAttribute('href') || '').trim();
        if (!href) return;

        let resolvedUrl = null;
        try {
            resolvedUrl = new URL(href, NINE_ANIME_BASE);
        } catch {
            return;
        }

        const match = resolvedUrl.pathname.match(/^\/watch\/([^/?#]+?)-(\d+)\/?$/);
        if (!match) return;

        let title = String(anchor.getAttribute('title') || '').trim();
        if (!title) title = String(anchor.textContent || '').replace(/\s+/g, ' ').trim();
        if (!title) {
            const card = anchor.closest('.flw-item, .item, .film-detail, .film-poster');
            const titleNode = card && card.querySelector('.film-name, .dynamic-name, .film-title, a[title]');
            if (titleNode) title = String(titleNode.getAttribute('title') || titleNode.textContent || '').replace(/\s+/g, ' ').trim();
        }
        if (!title) title = match[1].replace(/-/g, ' ');

        const card = anchor.closest('.flw-item, .item, .film-detail, .film-poster, .film_list-wrap .flw-item');
        const img = card && card.querySelector('img');
        const poster = String(img?.getAttribute('data-src') || img?.getAttribute('data-original') || img?.getAttribute('src') || '').trim();
        const metaText = String(card?.textContent || anchor.textContent || '').replace(/\s+/g, ' ').trim();
        const parsedEntry = buildNineAnimeParsedEntry({
            resolvedUrl,
            watchId: Number(match[2]),
            slug: match[1],
            title,
            poster,
            metaText,
            searchResult: true,
        });
        if (!parsedEntry) return;

        const existing = results.get(resolvedUrl.pathname);
        if (!existing || String(parsedEntry.title || '').length > String(existing.title || '').length) {
            results.set(resolvedUrl.pathname, parsedEntry);
        }
    });

    return Array.from(results.values());
}

function animeMatchesSearchType(anime) {
    const type = String(anime?.type || '').toLowerCase();
    if (activeSearchType === 'movie') return type === 'movie';
    if (activeSearchType === 'ova') return type === 'ova';
    if (activeSearchType === 'special') return type === 'special';
    return type !== 'movie';
}

function animeMatchesSearchYear(anime) {
    const yearFilter = getSearchFilterValue('search-year-filter');
    if (!yearFilter) return true;

    const year = Number(anime?.year || anime?.aired?.prop?.from?.year || 0);
    if (!Number.isFinite(year) || year <= 0) return false;
    if (/^\d{4}$/.test(yearFilter)) return year === Number(yearFilter);
    if (yearFilter === '2020s') return year >= 2020 && year <= 2029;
    if (yearFilter === '2010s') return year >= 2010 && year <= 2019;
    if (yearFilter === '2000s') return year >= 2000 && year <= 2009;
    if (yearFilter === 'classic') return year <= 1999;
    return true;
}

function hasUnsupportedDirectSearchFilters() {
    return [
        'search-status-filter',
        'search-rating-filter',
        'search-genre-filter',
        'search-theme-filter',
        'search-demographic-filter',
        'search-season-filter',
        'search-score-filter'
    ].some((id) => getSearchFilterValue(id));
}

function sortNineAnimeSearchEntries(items, query) {
    const titleCandidates = [String(query || '').trim()].filter(Boolean);
    const sortValue = getSearchFilterValue('search-sort-filter');
    const ranked = [...items].sort((a, b) => {
        const scoreDiff = scoreNineAnimeCandidate(b, titleCandidates) - scoreNineAnimeCandidate(a, titleCandidates);
        if (scoreDiff) return scoreDiff;

        const yearDiff = Number(b?.year || 0) - Number(a?.year || 0);
        if (sortValue === 'start_date_desc' && yearDiff) return yearDiff;
        if (sortValue === 'start_date_asc' && yearDiff) return -yearDiff;

        return String(a?.title || '').localeCompare(String(b?.title || ''), undefined, { numeric: true, sensitivity: 'base' });
    });

    if (sortValue === 'title_asc') {
        ranked.sort((a, b) => String(a?.title || '').localeCompare(String(b?.title || ''), undefined, { numeric: true, sensitivity: 'base' }));
    }

    return ranked;
}

async function fetchNineAnimeSearchEntries(query) {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) return [];
    if (!await canUseAnimeProtectedRemoteSources()) return [];
    if (nineAnimeSearchResultCache.has(normalizedQuery)) return nineAnimeSearchResultCache.get(normalizedQuery);

    const pending = (async () => {
        const html = await fetchAnimeRemoteText(`${NINE_ANIME_BASE}/search?keyword=${encodeURIComponent(query)}`);
        return parseNineAnimeSearchResults(html);
    })().catch((error) => {
        console.warn('9animetv direct search failed', query, error);
        return [];
    });

    nineAnimeSearchResultCache.set(normalizedQuery, pending);
    return pending;
}

async function resolveDirectNineAnimeSourceData(anime) {
    if (!await canUseAnimeProtectedRemoteSources()) return null;

    const watchId = Number(anime?._nineAnimeWatchId || parseNineAnimeSyntheticId(anime?.mal_id));
    if (!Number.isFinite(watchId) || watchId <= 0) return null;

    const episodeList = await resolveNineAnimeEpisodeList(watchId);
    if (!episodeList || !episodeList.totalEpisodes) return null;

    return {
        provider: '9animetv',
        watchId,
        watchPath: String(anime?._nineAnimeWatchPath || '').trim(),
        title: String(anime?.title || anime?.title_english || '').trim(),
        episodesByNumber: episodeList.episodesByNumber,
        totalEpisodes: episodeList.totalEpisodes
    };
}

async function resolveNineAnimeEpisodeList(watchId) {
    if (!watchId) return null;
    if (!await canUseAnimeProtectedRemoteSources()) return null;
    if (nineAnimeEpisodeListCache.has(watchId)) return nineAnimeEpisodeListCache.get(watchId);

    const pending = (async () => {
        const payload = await fetchAnimeRemoteJson(`${NINE_ANIME_BASE}/ajax/episode/list/${watchId}`);
        if (!payload || payload.status !== true || !payload.html) return null;

        const doc = new DOMParser().parseFromString(payload.html, 'text/html');
        const episodesByNumber = new Map();
        Array.from(doc.querySelectorAll('.ep-item[data-number][data-id]')).forEach((element) => {
            const number = Number(element.getAttribute('data-number'));
            const episodeId = Number(element.getAttribute('data-id'));
            if (!Number.isFinite(number) || number <= 0 || !Number.isFinite(episodeId) || episodeId <= 0) return;
            episodesByNumber.set(number, {
                number,
                episodeId,
                title: String(element.getAttribute('title') || '').trim(),
                href: String(element.getAttribute('href') || '').trim()
            });
        });

        const totalEpisodes = episodesByNumber.size
            ? Math.max(...Array.from(episodesByNumber.keys()))
            : 0;

        return {
            watchId,
            episodesByNumber,
            totalEpisodes
        };
    })().catch((error) => {
        console.warn('Failed to resolve 9animetv episode list', watchId, error);
        return null;
    });

    nineAnimeEpisodeListCache.set(watchId, pending);
    return pending;
}

async function resolveNineAnimeSourceData(anime) {
    if (!await canUseAnimeProtectedRemoteSources()) return null;

    const cacheKey = String(anime?.mal_id || anime?.title || anime?.title_english || anime?.title_japanese || 'unknown');
    if (nineAnimeSearchCache.has(cacheKey)) return nineAnimeSearchCache.get(cacheKey);

    const pending = (async () => {
        const titleCandidates = getAnimeTitleCandidates(anime);
        if (!titleCandidates.length) return null;

        const resultMap = new Map();
        for (const title of titleCandidates.slice(0, 3)) {
            try {
                const html = await fetchAnimeRemoteText(`${NINE_ANIME_BASE}/search?keyword=${encodeURIComponent(title)}`);
                parseNineAnimeSearchResults(html).forEach((result) => {
                    if (!resultMap.has(result.watchPath)) resultMap.set(result.watchPath, result);
                });
            } catch (error) {
                console.warn('9animetv search failed for title', title, error);
            }
        }

        const ranked = Array.from(resultMap.values())
            .map((result) => ({ ...result, score: scoreNineAnimeCandidate(result, titleCandidates) }))
            .sort((a, b) => b.score - a.score);

        const bestMatch = ranked[0];
        if (!bestMatch || bestMatch.score < 420) return null;

        const episodeList = await resolveNineAnimeEpisodeList(bestMatch.watchId);
        if (!episodeList || !episodeList.totalEpisodes) return null;

        return {
            provider: '9animetv',
            watchId: bestMatch.watchId,
            watchPath: bestMatch.watchPath,
            title: bestMatch.title,
            episodesByNumber: episodeList.episodesByNumber,
            totalEpisodes: episodeList.totalEpisodes
        };
    })().catch((error) => {
        console.warn('Failed to resolve 9animetv fallback for anime', anime?.title || anime?.mal_id, error);
        return null;
    });

    nineAnimeSearchCache.set(cacheKey, pending);
    return pending;
}

function mapNineAnimeServerTypeToGroup(type) {
    const normalized = String(type || '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'dub' || normalized === 'mixed') return { key: 'va', label: 'VA' };
    if (normalized === 'sub') return { key: 'vosta', label: 'VOSTA' };
    return null;
}

function appendNineAnimeAutoplay(url) {
    if (!url) return url;
    try {
        const parsed = new URL(url);
        if (!parsed.searchParams.has('autoPlay')) parsed.searchParams.set('autoPlay', 'true');
        if (!parsed.searchParams.has('oa')) parsed.searchParams.set('oa', '0');
        return parsed.toString();
    } catch {
        const sep = url.includes('?') ? '&' : '?';
        return `${url}${sep}autoPlay=true&oa=0`;
    }
}

async function resolveNineAnimeEpisodeGroups(nineAnimeSourceData, seasonKey, episodeNumber) {
    if (!nineAnimeSourceData || String(seasonKey) !== 'saison1') return [];
    const episode = nineAnimeSourceData.episodesByNumber.get(Number(episodeNumber));
    if (!episode || !episode.episodeId) return [];

    const cacheKey = `${nineAnimeSourceData.watchId}:${episode.episodeId}`;
    if (nineAnimeEpisodeSourceCache.has(cacheKey)) return nineAnimeEpisodeSourceCache.get(cacheKey);

    const pending = (async () => {
        const serversPayload = await fetchAnimeRemoteJson(`${NINE_ANIME_BASE}/ajax/episode/servers?episodeId=${episode.episodeId}`);
        if (!serversPayload || serversPayload.status !== true || !serversPayload.html) return [];

        const doc = new DOMParser().parseFromString(serversPayload.html, 'text/html');
        const serverItems = Array.from(doc.querySelectorAll('.server-item[data-id]'))
            .map((element) => ({
                type: String(element.getAttribute('data-type') || '').trim().toLowerCase(),
                sourceId: String(element.getAttribute('data-id') || '').trim(),
                serverId: String(element.getAttribute('data-server-id') || '').trim(),
                name: String(element.textContent || '').replace(/\s+/g, ' ').trim()
            }))
            .filter((item) => item.sourceId);

        const resolvedLinks = await Promise.all(serverItems.map(async (item) => {
            try {
                const payload = await fetchAnimeRemoteJson(`${NINE_ANIME_BASE}/ajax/episode/sources?id=${encodeURIComponent(item.sourceId)}`);
                const link = String(payload?.link || '').trim();
                if (!link) return null;
                return { ...item, link: appendNineAnimeAutoplay(link) };
            } catch (error) {
                console.warn('Failed to resolve 9animetv episode source', item.sourceId, error);
                return null;
            }
        }));

        const grouped = new Map();
        resolvedLinks.filter(Boolean).forEach((item) => {
            const group = mapNineAnimeServerTypeToGroup(item.type);
            if (!group) return;
            if (!grouped.has(group.key)) {
                grouped.set(group.key, { key: group.key, label: group.label, urls: [] });
            }
            const entry = grouped.get(group.key);
            if (!entry.urls.includes(item.link)) entry.urls.push(item.link);
        });

        return Array.from(grouped.values()).filter((group) => group.urls.length > 0);
    })().catch((error) => {
        console.warn('Failed to resolve 9animetv episode groups', cacheKey, error);
        return [];
    });

    nineAnimeEpisodeSourceCache.set(cacheKey, pending);
    return pending;
}

function sortSeasonKeys(keys) {
    return [...(Array.isArray(keys) ? keys : [])].sort((a, b) => {
        const aNum = parseInt(String(a).replace(/\D/g, ''), 10);
        const bNum = parseInt(String(b).replace(/\D/g, ''), 10);
        if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum !== bNum) return aNum - bNum;
        return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
    });
}

function getSortedEpisodeNumbersForSeason(sourceData, seasonKey) {
    const season = sourceData && typeof sourceData === 'object' ? sourceData[seasonKey] : null;
    return Object.keys(season || {})
        .map((key) => Number(key))
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b);
}

function animeSamaLangToGroup(lang) {
    const normalized = String(lang || '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized.includes('vf') || normalized.includes('dub') || normalized === 'fr') {
        return { key: 'va', label: 'VF' };
    }
    if (normalized.includes('vost') || normalized.includes('sub') || normalized === 'vo') {
        return { key: 'vosta', label: 'VOSTFR' };
    }
    return { key: normalized, label: normalized.toUpperCase() };
}

function buildSeriesSourceGroupsFromData(sourceData, seasonKey, episodeNumber) {
    if (!sourceData || typeof sourceData !== 'object') return [];
    const season = sourceData[seasonKey];
    const episode = season && typeof season === 'object' ? season[String(episodeNumber)] || season[episodeNumber] : null;
    if (!episode || typeof episode !== 'object') return [];

    const grouped = new Map();
    Object.entries(episode).forEach(([lang, urls]) => {
        const group = animeSamaLangToGroup(lang);
        if (!group) return;
        const list = Array.isArray(urls) ? urls.filter(Boolean) : [urls].filter(Boolean);
        if (!list.length) return;
        if (!grouped.has(group.key)) {
            grouped.set(group.key, { key: group.key, label: group.label, urls: [] });
        }
        const entry = grouped.get(group.key);
        list.forEach((url) => {
            if (!entry.urls.includes(url)) entry.urls.push(url);
        });
    });

    return Array.from(grouped.values()).filter((group) => group.urls.length > 0);
}

function hasAnySeriesSources(sourceData) {
    return sortSeasonKeys(Object.keys(sourceData || {})).some((seasonKey) => {
        const episodeNumbers = getSortedEpisodeNumbersForSeason(sourceData, seasonKey);
        return episodeNumbers.some((episodeNumber) => buildSeriesSourceGroupsFromData(sourceData, seasonKey, episodeNumber).length > 0);
    });
}

async function resolveSeriesSourceData(aniListId) {
    if (!aniListId) {
        return { aniListId: null, sourceAniListId: null, sourceData: null };
    }

    let sourceAniListId = aniListId;
    let sourceData = await getAnimeSamaSeasonsEpisodesCached(sourceAniListId);
    if (!sourceData) {
        const baseAniListId = await resolveBaseAniListId(aniListId);
        if (baseAniListId && baseAniListId !== aniListId) {
            const baseData = await getAnimeSamaSeasonsEpisodesCached(baseAniListId);
            if (baseData) {
                sourceAniListId = baseAniListId;
                sourceData = baseData;
            }
        }
    }

    return { aniListId, sourceAniListId, sourceData };
}

async function getAnimePlaybackProfile(anime) {
    const cacheKey = String(anime?.mal_id || anime?.title || anime?.title_english || anime?.title_japanese || 'unknown');
    if (animePlaybackProfileCache.has(cacheKey)) {
        return animePlaybackProfileCache.get(cacheKey);
    }

    const pending = (async () => {
        const isMovie = (anime?.type || '').toLowerCase() === 'movie';
        const directNineAnimeSourceData = await resolveDirectNineAnimeSourceData(anime);
        if (isMovie) {
            const nineAnimeSourceData = directNineAnimeSourceData || await resolveNineAnimeSourceData(anime);
            const tmdbId = await getTmdbIdForAnimeMovie(anime);
            return {
                isMovie: true,
                playable: Boolean((nineAnimeSourceData && nineAnimeSourceData.totalEpisodes) || tmdbId),
                tmdbId,
                aniListId: null,
                sourceAniListId: null,
                seriesSourceData: null,
                nineAnimeSourceData
            };
        }

        const malId = anime?.mal_id;
        const aniListId = getCachedAniListId(malId) || await resolveAniListId(malId);
        if (aniListId) setCachedAniListId(malId, aniListId);
        const resolved = await resolveSeriesSourceData(aniListId);
        const animeSamaPlayable = hasAnySeriesSources(resolved.sourceData);
        const nineAnimeSourceData = animeSamaPlayable ? null : (directNineAnimeSourceData || await resolveNineAnimeSourceData(anime));
        const vidsrcPlayable = Boolean(malId || resolved.aniListId);
        return {
            isMovie: false,
            playable: animeSamaPlayable || Boolean(nineAnimeSourceData && nineAnimeSourceData.totalEpisodes) || vidsrcPlayable,
            tmdbId: null,
            aniListId: resolved.aniListId,
            sourceAniListId: resolved.sourceAniListId,
            seriesSourceData: resolved.sourceData,
            nineAnimeSourceData
        };
    })();

    animePlaybackProfileCache.set(cacheKey, pending);
    return pending;
}

// Query anime_sama.db for all available seasons/episodes and sources for a given AniList id
async function getAnimeSamaSeasonsEpisodes(aniListId) {
    if (!aniListId || !animeSamaDbReady) return null;
    try {
        await animeSamaDbReady;
        if (!animeSamaDb) return null;
        // 1) Find internal anime.id from anime.anilist_id
        const animeStmt = animeSamaDb.prepare(`
            SELECT id FROM anime WHERE anilist_id = ? LIMIT 1
        `);
        animeStmt.bind([aniListId]);
        let animeId = null;
        if (animeStmt.step()) {
            const row = animeStmt.getAsObject();
            animeId = row.id;
        }
        animeStmt.free();
        if (!animeId) return null;

        // 2) Get all available (season, episode, lang, url)
        const stmt = animeSamaDb.prepare(`
            SELECT season, episode, lang, url
            FROM episode_sources
            WHERE anime_id = ?
            ORDER BY season, episode, lang, url
        `);
        stmt.bind([animeId]);

        // Structure: { [season]: { [episode]: { [lang]: url[] } } }
        const data = {};
        function hostPriority(u) {
            if (!u) return 0;
            const url = u.toLowerCase();
            if (url.includes('sibnet.ru')) return 3;
            if (url.includes('sendvid.com')) return 2;
            return 1;
        }
        while (stmt.step()) {
            const row = stmt.getAsObject();
            const season = row.season || 'saison1';
            const episode = row.episode;
            const lang = (row.lang || '').toLowerCase();
            const url = row.url || '';
            if (!url) continue;
            if (!data[season]) data[season] = {};
            if (!data[season][episode]) data[season][episode] = {};
            if (!data[season][episode][lang]) data[season][episode][lang] = [];
            // Keep unique URLs; we'll sort by host priority afterwards
            if (!data[season][episode][lang].includes(url)) {
                data[season][episode][lang].push(url);
            }
        }
        stmt.free();
        // Sort each language's URLs so best hosts come first
        Object.keys(data).forEach(season => {
            const eps = data[season] || {};
            Object.keys(eps).forEach(ep => {
                const langs = eps[ep] || {};
                Object.keys(langs).forEach(lang => {
                    const arr = Array.isArray(langs[lang]) ? langs[lang] : [langs[lang]].filter(Boolean);
                    arr.sort((a, b) => hostPriority(b) - hostPriority(a));
                    langs[lang] = arr;
                });
            });
        });
        return data; // { saison1: { 1: { vostfr: url, vf: url }, ... }, ... }
    } catch (e) {
        console.error('Failed to query anime_sama.db for AniList id', aniListId, e);
        return null;
    }
}

function renderSkipCheckboxes(malId) {
    const settings = getAnimeSkipSettings(malId);
    
    let container = playerContainer.querySelector('#anime-skip-controls');
    if (container) container.remove();

    let footer = playerContent.querySelector('.anime-player-footer');
    if (!footer) {
        footer = document.createElement('div');
        footer.className = 'anime-player-footer';
        playerContent.appendChild(footer);
    }
    
    container = document.createElement('div');
    container.id = 'anime-skip-controls';
    
    const skipToggleButton = document.createElement('button');
    skipToggleButton.type = 'button';
    skipToggleButton.className = 'anime-skip-toggle';

    const applySkipToggleState = (nextSettings) => {
        const enabled = !!(nextSettings && nextSettings.skipIntro && nextSettings.skipOutro);
        skipToggleButton.classList.toggle('active', enabled);
        skipToggleButton.textContent = enabled ? 'Auto Skip Intro/Outro ON' : 'Auto Skip Intro/Outro OFF';
        skipToggleButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    };

    applySkipToggleState(settings);
    skipToggleButton.addEventListener('click', () => {
        const currentSettings = getAnimeSkipSettings(malId);
        const enabled = !!(currentSettings && currentSettings.skipIntro && currentSettings.skipOutro);
        const newSettings = {
            skipIntro: !enabled,
            skipOutro: !enabled
        };
        setAnimeSkipSettings(malId, newSettings);
        applySkipToggleState(newSettings);
        sendAnimePlayerHook({
            malId,
            aniListId: window.currentAniListId,
            episodeNumber: window.currentEpisodeNumber,
            seasonNumber: window.currentSeasonNumber,
            ...newSettings,
        });
        if (activeSelection && activeSelection.group) {
            switchToSelection(activeSelection, { persistLastUsed: false });
        }
    });

    container.appendChild(skipToggleButton);
    
    footer.appendChild(container);
}

async function openAnimeFromJikan(anime) {
    const malId = anime.mal_id;
    const isMovie = (anime.type || '').toLowerCase() === 'movie';
    const openToken = Symbol('anime-player-open');
    currentAnimePlayerOpenToken = openToken;

    let resolvedEpisodes = Number.isFinite(Number(anime.episodes)) ? Number(anime.episodes) : null;
    const resolvedEpisodesPromise = !isMovie
        ? (Number.isFinite(Number(resolvedEpisodes)) && Number(resolvedEpisodes) > 0
            ? Promise.resolve(Number(resolvedEpisodes))
            : resolveAnimeEpisodeCount(anime))
        : Promise.resolve(resolvedEpisodes);

    // Install message listener once (for timing capture via userscript)
    ensureAnimeProgressMessageListener();

    // Continue Watching: create/update a placeholder entry immediately (like /movies)
    const postersForProgress = buildPosterVariants(anime);
    const titleForProgress = getPreferredAnimeTitle(anime);
    const yearForProgress = buildYear(anime);
    const episodesTotalForProgress = resolvedEpisodes;

    // If a progress entry exists, we'll resume season/episode + preferred player later.
    const resumeProgress = getAnimeProgressRecord(malId);
    const resumeSeasonWanted = resumeProgress && resumeProgress.season ? String(resumeProgress.season) : null;
    const resumeEpisodeWanted = resumeProgress && resumeProgress.episode ? parseInt(resumeProgress.episode, 10) : null;
    const resumePlayerGroupWanted = resumeProgress && resumeProgress.playerGroup ? String(resumeProgress.playerGroup) : null;
    const resumePlayerHostWanted = resumeProgress && resumeProgress.playerHost ? String(resumeProgress.playerHost).toLowerCase() : null;
    let resumeSeekWanted = resumeProgress && Number.isFinite(Number(resumeProgress.timestamp)) ? Number(resumeProgress.timestamp) : null;

    // New per-open session token for postMessage validation
    const progressToken = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    currentAnimePlayerSession = {
        malId: String(malId),
        token: progressToken,
        isMovie: !!isMovie,
        currentSeason: resumeSeasonWanted || 'saison1',
        currentEpisode: !isMovie ? (Number.isFinite(resumeEpisodeWanted) && resumeEpisodeWanted > 0 ? resumeEpisodeWanted : 1) : null,
        playerHost: resumePlayerHostWanted,
        playerOrigin: null,
        onAutoNext: null,
        onPlaybackStart: null,
        _playbackStartedFor: null,
        _preloadedNextKey: null,
        _lastAutoNextAt: 0,
        _lastSaveAt: 0
    };

    playerContainer.style.display = 'block';
    searchContainer.style.display = 'none';
    playerContent.innerHTML = `
        <div class="anime-player-stage">
            <div class="anime-player-loading">
                <div class="anime-player-loading-card">
                    <div class="anime-player-loading-figure" aria-hidden="true">
                        <img src="assets/ateaish_anime%20default.png" alt="">
                        <div class="anime-player-loading-beam"></div>
                    </div>
                    <div class="anime-player-loading-copy">
                        <div class="anime-player-loading-kicker">Ateaish Anime</div>
                        <div class="anime-player-loading-title">Charging the next stream</div>
                        <div class="anime-player-loading-subtitle">Kamehameha mode engaged while the player loads in the background.</div>
                        <div class="anime-player-loading-progress" aria-hidden="true"></div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Remove any previous dynamic controls right away so the shell is clean while loading.
    playerContainer.querySelectorAll('#season-episode-selector, #anime-player-controls, #anime-settings-btn, #anime-source-indicators, #anime-prev-episode, #anime-next-episode').forEach(el => el.remove());

    const playbackProfilePromise = getAnimePlaybackProfile(anime);
    const cachedAniListId = getCachedAniListId(malId);
    let aniListId = cachedAniListId || null;
    const aniListIdPromise = cachedAniListId
        ? Promise.resolve(cachedAniListId)
        : resolveAniListId(malId).then((resolvedAniListId) => {
            if (resolvedAniListId) setCachedAniListId(malId, resolvedAniListId);
            return resolvedAniListId;
        }).catch(() => null);

    upsertAnimeProgressRecord(malId, {
        title: titleForProgress,
        poster: postersForProgress.medium,
        year: yearForProgress,
        episodesTotal: episodesTotalForProgress,
        season: resumeSeasonWanted || 'saison1',
        episode: !isMovie ? (Number.isFinite(resumeEpisodeWanted) && resumeEpisodeWanted > 0 ? resumeEpisodeWanted : 1) : null,
        playerGroup: resumePlayerGroupWanted,
        playerHost: resumePlayerHostWanted,
        progress: 0
    });
    try { loadAnimeContinueWatching(); } catch { }

    let seriesSourceData = null;
    let nineAnimeSourceData = null;
    const playbackProfile = await playbackProfilePromise;
    if (currentAnimePlayerOpenToken !== openToken) return;
    resolvedEpisodes = await resolvedEpisodesPromise;
    if (currentAnimePlayerOpenToken !== openToken) return;
    const resolvedAniListId = await aniListIdPromise;
    if (currentAnimePlayerOpenToken !== openToken) return;
    if (resolvedAniListId) aniListId = resolvedAniListId;
    if (playbackProfile && playbackProfile.aniListId) {
        aniListId = playbackProfile.aniListId;
    }
    if (playbackProfile && playbackProfile.sourceAniListId) {
        aniListId = playbackProfile.sourceAniListId;
    }
    if (!playbackProfile || !playbackProfile.playable) {
        playerContent.innerHTML = `
            <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#fff;font-family:inherit;text-align:center;padding:24px;">
                No playable source is available for this anime right now.
            </div>
        `;
        return;
    }
    seriesSourceData = playbackProfile.seriesSourceData || null;
    nineAnimeSourceData = playbackProfile.nineAnimeSourceData || null;

    let nineAnimeLookupPromise = null;
    async function ensureNineAnimeSourceData() {
        if (nineAnimeSourceData) return nineAnimeSourceData;
        if (!nineAnimeLookupPromise) {
            nineAnimeLookupPromise = resolveNineAnimeSourceData(anime)
                .then((resolvedNineAnimeData) => {
                    nineAnimeSourceData = resolvedNineAnimeData || null;
                    return nineAnimeSourceData;
                })
                .catch((error) => {
                    console.warn('Failed to lazily resolve 9animetv source data', anime?.title || anime?.mal_id, error);
                    return null;
                });
        }
        return nineAnimeLookupPromise;
    }

    // State
    let tmdbId = playbackProfile.tmdbId || null;

    // Build season/episode lists directly from Jikan episode metadata.
    let seasons = sortSeasonKeys(Object.keys(seriesSourceData || {}));
    if (!seasons.length && nineAnimeSourceData && nineAnimeSourceData.totalEpisodes > 0) {
        seasons = ['saison1'];
    }
    if (!seasons.length) seasons = ['saison1'];
    let currentSeason = seasons.includes(resumeSeasonWanted) ? resumeSeasonWanted : seasons[0];
    let currentEpisode = 1;

    // Apply resume episode early.
    if (!isMovie && Number.isFinite(resumeEpisodeWanted) && resumeEpisodeWanted > 0) {
        currentEpisode = resumeEpisodeWanted;
    }

    // Source preference + last used tracking
    const PRIMARY_SOURCE_KEY = 'animePlayerPrimarySource';
    const LAST_USED_SOURCE_KEY = 'animePlayerLastUsedSource';

    function groupKeyFromLabel(label) {
        if (!label) return null;
        const v = String(label).trim().toUpperCase();
        if (v === 'VO') return 'vo';
        if (v === 'VF') return 'vf';
        if (v === 'VOSTA') return 'vosta';
        if (v === 'VA') return 'va';
        if (v === 'VOSTFR') return 'vostfr';
        return null;
    }

    function labelFromGroupKey(key) {
        if (!key) return isMovie ? 'VO' : 'VOSTA';
        if (key === 'vo') return 'VO';
        if (key === 'vf') return 'VF';
        if (key === 'vosta') return 'VOSTA';
        if (key === 'va') return 'VA';
        if (key === 'vostfr') return 'VOSTFR';
        return isMovie ? 'VO' : 'VOSTA';
    }

    function getPrimaryGroupKey() {
        // New key
        try {
            const raw = localStorage.getItem(PRIMARY_SOURCE_KEY);
            const key = groupKeyFromLabel(raw) || String(raw || '').trim();
            if (key) return key;
        } catch { }

        // Back-compat: old key stored as JSON {group, idx} or as label string
        try {
            const raw = localStorage.getItem('animePlayerPreferredSource');
            if (!raw) return null;
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && parsed.group) {
                    // Migrate once to primary group
                    try { localStorage.setItem(PRIMARY_SOURCE_KEY, parsed.group); } catch { }
                    return parsed.group;
                }
            } catch { }
            const mapped = groupKeyFromLabel(raw);
            if (mapped) {
                try { localStorage.setItem(PRIMARY_SOURCE_KEY, mapped); } catch { }
                return mapped;
            }
        } catch { }
        return null;
    }

    function setPrimaryGroupKey(key) {
        if (!key) return;
        try { localStorage.setItem(PRIMARY_SOURCE_KEY, key); } catch { }
    }

    function getLastUsed() {
        try {
            const raw = localStorage.getItem(LAST_USED_SOURCE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && parsed.group) return parsed;
        } catch { }
        return null;
    }

    function setLastUsed(group, url) {
        if (!group || !url) return;
        let host = null;
        try { host = new URL(url).hostname.toLowerCase(); } catch { host = null; }
        try {
            localStorage.setItem(LAST_USED_SOURCE_KEY, JSON.stringify({ group, host }));
        } catch { }
    }

    function setLastUsedHost(group, host) {
        if (!group || !host) return;
        try {
            localStorage.setItem(LAST_USED_SOURCE_KEY, JSON.stringify({ group, host: String(host).toLowerCase() }));
        } catch { }
    }

    function decoratePlayerUrl(rawUrl, { seekSeconds = null } = {}) {
        if (!rawUrl) return rawUrl;
        const absEp = computeAbsoluteEpisode(currentSeason, currentEpisode);
        const skipSettings = getAnimeSkipSettings(malId);
        const shouldSkipIntro = !!(skipSettings && skipSettings.skipIntro);
        const shouldSkipOutro = !!(skipSettings && skipSettings.skipOutro);
        try {
            const u = new URL(rawUrl);
            u.searchParams.set('ateaish_mal', String(malId));
            u.searchParams.set('ateaish_ep', String(absEp));
            u.searchParams.set('ateaish_token', String(progressToken));
            if (shouldSkipIntro) {
                u.searchParams.set('ateaish_skip_intro', '1');
                u.searchParams.set('autoSkipIntro', 'true');
            } else {
                u.searchParams.delete('ateaish_skip_intro');
                u.searchParams.delete('autoSkipIntro');
            }
            if (shouldSkipOutro) {
                u.searchParams.set('ateaish_skip_outro', '1');
            } else {
                u.searchParams.delete('ateaish_skip_outro');
            }
            if (seekSeconds != null && Number.isFinite(Number(seekSeconds)) && Number(seekSeconds) > 0) {
                u.searchParams.set('ateaish_seek', String(Math.floor(Number(seekSeconds))));
            }
            return u.toString();
        } catch {
            const sep = rawUrl.includes('?') ? '&' : '?';
            let out = `${rawUrl}${sep}ateaish_mal=${encodeURIComponent(String(malId))}&ateaish_ep=${encodeURIComponent(String(absEp))}&ateaish_token=${encodeURIComponent(String(progressToken))}`;
            if (shouldSkipIntro) {
                out += `&ateaish_skip_intro=1`;
                out += `&autoSkipIntro=true`;
            }
            if (shouldSkipOutro) {
                out += `&ateaish_skip_outro=1`;
            }
            if (seekSeconds != null && Number.isFinite(Number(seekSeconds)) && Number(seekSeconds) > 0) {
                out += `&ateaish_seek=${encodeURIComponent(String(Math.floor(Number(seekSeconds))))}`;
            }
            return out;
        }
    }

    function getResumeSeekForCurrentEpisode() {
        if (!Number.isFinite(Number(resumeSeekWanted)) || Number(resumeSeekWanted) <= 0) return null;
        if (Number.isFinite(Number(resumeEpisodeWanted)) && Number(currentEpisode) !== Number(resumeEpisodeWanted)) return null;
        if (resumeSeasonWanted && String(currentSeason) !== String(resumeSeasonWanted)) return null;
        return resumeSeekWanted;
    }

    function clearResumeSeekIfDifferent() {
        if (!Number.isFinite(Number(resumeEpisodeWanted))) return;
        if (Number(currentEpisode) !== Number(resumeEpisodeWanted) || (resumeSeasonWanted && String(currentSeason) !== String(resumeSeasonWanted))) {
            resumeSeekWanted = null;
        }
    }

    function resetResumeSeekForAutoNext() {
        resumeSeekWanted = null;
        if (isMovie) return;
        upsertAnimeProgressRecord(malId, {
            season: String(currentSeason),
            episode: Number(currentEpisode),
            timestamp: 0,
            progress: 0,
            updatedAt: Date.now()
        });
        try { loadAnimeContinueWatching(); } catch { }
    }

    // Helper to get max episode for a season
    function getMaxEpisode(season) {
        if (isMovie) return 1;
        const sourceEpisodes = getSortedEpisodeNumbersForSeason(seriesSourceData, season);
        const nineAnimeMax = (nineAnimeSourceData && String(season) === 'saison1')
            ? Number(nineAnimeSourceData.totalEpisodes) || 0
            : 0;
        if (sourceEpisodes.length || nineAnimeMax > 0) {
            return Math.max(sourceEpisodes.length ? sourceEpisodes[sourceEpisodes.length - 1] : 0, nineAnimeMax);
        }
        const jikanEpisodes = resolvedEpisodes;
        const floor = Math.max(1, Number.isFinite(Number(currentEpisode)) ? Number(currentEpisode) : 1);
        return Math.max(jikanEpisodes || 1, floor);
    }

    function computeAbsoluteEpisode(seasonKey, episodeNum) {
        if (!isMovie && seriesSourceData) {
            let offset = 0;
            for (const key of sortSeasonKeys(Object.keys(seriesSourceData || {}))) {
                if (String(key) === String(seasonKey)) break;
                const seasonEpisodes = getSortedEpisodeNumbersForSeason(seriesSourceData, key);
                if (seasonEpisodes.length) offset += seasonEpisodes.length;
            }
            return offset + (Number(episodeNum) || 1);
        }
        return Number(episodeNum) || 1;
    }

    function updateGlobalAbsoluteEpisode() {
        window.currentAbsoluteEpisodeNumber = computeAbsoluteEpisode(currentSeason, currentEpisode);
    }

    function normalizeUrls(val) {
        if (!val) return [];
        if (Array.isArray(val)) return val.filter(Boolean);
        return [val].filter(Boolean);
    }

    function getSourceDisplayName(url, fallbackLabel, index) {
        try {
            const parsed = new URL(url);
            return parsed.hostname.replace(/^www\./i, '');
        } catch {
            return `${fallbackLabel || 'Source'} ${Number(index) + 1}`;
        }
    }

    async function buildSourceGroups(season, episode) {
        if (isMovie) {
            const resolvedNineAnimeSourceData = await ensureNineAnimeSourceData();
            if (resolvedNineAnimeSourceData) {
                const nineAnimeGroups = await resolveNineAnimeEpisodeGroups(resolvedNineAnimeSourceData, 'saison1', 1);
                if (nineAnimeGroups.length) return nineAnimeGroups;
            }
            if (tmdbId) {
                return [
                    { key: 'vo', label: 'VO', urls: [`https://vidsrc.cc/v2/embed/movie/${tmdbId}?autoPlay=true`] },
                    { key: 'vf', label: 'VF', urls: [`https://vidsrc.cc/v2/embed/movie/${tmdbId}?autoPlay=true&lang=fr`] }
                ];
            }
            return [];
        }

        // Series mode
        const animeSamaGroups = buildSeriesSourceGroupsFromData(seriesSourceData, season, episode);
        if (animeSamaGroups.length) {
            return animeSamaGroups;
        }
        const resolvedNineAnimeSourceData = await ensureNineAnimeSourceData();
        if (resolvedNineAnimeSourceData) {
            const nineAnimeGroups = await resolveNineAnimeEpisodeGroups(resolvedNineAnimeSourceData, season, episode);
            if (nineAnimeGroups.length) return nineAnimeGroups;
        }
        const vidsrcAnimeId = malId ? String(malId) : `ani${aniListId}`;
        const vidsrcSub = `https://vidsrc.cc/v2/embed/anime/${vidsrcAnimeId}/${episode}/sub?autoPlay=true`;
        const vidsrcDub = `https://vidsrc.cc/v2/embed/anime/${vidsrcAnimeId}/${episode}/dub?autoPlay=true`;

        return [
            { key: 'vosta', label: 'VOSTA', urls: [vidsrcSub].filter(Boolean) },
            { key: 'va', label: 'VA', urls: [vidsrcDub].filter(Boolean) }
        ].filter(g => g.urls && g.urls.length);
    }

    function seasonLabelFromKey(seasonKey) {
        const n = parseInt(String(seasonKey).replace(/\D/g, ''), 10);
        return Number.isFinite(n) && n > 0 ? String(n) : String(seasonKey);
    }

    currentEpisode = Math.min(currentEpisode, getMaxEpisode(currentSeason));
    let sourceIndicatorRenderToken = 0;

    function renderSeasonEpisodeSelector() {
        let selectorBar = playerContainer.querySelector('#season-episode-selector');
        if (selectorBar) selectorBar.remove();

        selectorBar = document.createElement('div');
        selectorBar.id = 'season-episode-selector';

        const seasonSelect = document.createElement('select');
        const episodeSelect = document.createElement('select');

        // Seasons
        seasons.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = `Season ${seasonLabelFromKey(s)}`;
            if (s === currentSeason) opt.selected = true;
            seasonSelect.appendChild(opt);
        });

        // Episodes
        const maxEp = getMaxEpisode(currentSeason);
        for (let e = 1; e <= maxEp; e++) {
            const opt = document.createElement('option');
            opt.value = String(e);
            opt.textContent = `Episode ${e}`;
            if (e === Number(currentEpisode)) opt.selected = true;
            episodeSelect.appendChild(opt);
        }

        seasonSelect.onchange = () => {
            currentSeason = seasonSelect.value;
            currentEpisode = 1;
            clearResumeSeekIfDifferent();
            window.currentSeasonNumber = currentSeason;
            window.currentEpisodeNumber = 1;
            updateGlobalAbsoluteEpisode();
            renderSeasonEpisodeSelector();
            renderAnimeSourceIndicators();
            updateEpisodeArrows();
            // Send hook to userscript
            const settings = getAnimeSkipSettings(malId);
            sendAnimePlayerHook({
                malId,
                aniListId: window.currentAniListId,
                episodeNumber: 1,
                seasonNumber: currentSeason,
                ...settings,
            });
        };
        episodeSelect.onchange = () => {
            currentEpisode = parseInt(episodeSelect.value, 10);
            clearResumeSeekIfDifferent();
            window.currentEpisodeNumber = currentEpisode;
            updateGlobalAbsoluteEpisode();
            renderAnimeSourceIndicators();
            updateEpisodeArrows();
            // Send hook to userscript
            const settings = getAnimeSkipSettings(malId);
            sendAnimePlayerHook({
                malId,
                aniListId: window.currentAniListId,
                episodeNumber: currentEpisode,
                seasonNumber: currentSeason,
                ...settings,
            });
        };

        selectorBar.appendChild(seasonSelect);
        selectorBar.appendChild(episodeSelect);
        playerContainer.appendChild(selectorBar);
    }

    function getSettingsGroups() {
        const labels = Array.from(new Set((currentGroups || []).map((group) => group.label).filter(Boolean)));
        if (labels.length) return labels;
        return isMovie ? ['VO', 'VF'] : ['VOSTFR', 'VF'];
    }

    // Settings modal HTML
    function buildSettingsModal(selected) {
        const groups = getSettingsGroups();
        return `
        <div id="anime-settings-modal" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center;">
            <div style="background:#000;color:#fff;padding:1.5em 1.5em 1em 1.5em;border:none;min-width:320px;max-width:90vw;box-shadow:0 2px 16px #0008;">
                <h3 style="margin-top:0;margin-bottom:1em;color:#fff;">Player Settings</h3>
                <label for="anime-source-select">Preferred Source:</label>
                <select id="anime-source-select" style="margin-left:1em;font-size:1em;background:#000;color:#fff;border:1px solid #fff;">
                    ${groups.map(l => `<option value="${l}"${l === selected ? ' selected' : ''}>${l}</option>`).join('')}
                </select>
                <div style="margin-top:2em;text-align:right;">
                    <button id="anime-settings-save" style="margin-right:1em;background:#000;color:#fff;border:1px solid #fff;padding:6px 10px;">Save</button>
                    <button id="anime-settings-cancel" style="background:#000;color:#fff;border:1px solid #fff;padding:6px 10px;">Cancel</button>
                </div>
            </div>
        </div>
        `;
    }

    // Initial render (iframe + overlay controls)
    playerContent.innerHTML = `
        <div class="anime-player-stage">
            <iframe id="anime-player-iframe" src="about:blank" frameborder="0" allowfullscreen allow="autoplay; fullscreen; encrypted-media"></iframe>
            <div id="anime-player-loading" class="anime-player-loading">
                <div class="anime-player-loading-card">
                    <div class="anime-player-loading-figure" aria-hidden="true">
                        <img src="assets/ateaish_anime%20default.png" alt="">
                        <div class="anime-player-loading-beam"></div>
                    </div>
                    <div class="anime-player-loading-copy">
                        <div class="anime-player-loading-kicker">Ateaish Anime</div>
                        <div class="anime-player-loading-title">Charging the next stream</div>
                        <div class="anime-player-loading-subtitle">Kamehameha mode engaged while the player loads in the background.</div>
                        <div class="anime-player-loading-progress" aria-hidden="true"></div>
                    </div>
                </div>
            </div>
        </div>
        <div class="anime-player-footer"></div>
    `;

    function ensureSettingsButton() {
        let btn = playerContainer.querySelector('#anime-settings-btn');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'anime-settings-btn';
            btn.className = 'anime-settings-btn';
            btn.type = 'button';
            btn.setAttribute('aria-label', 'Settings');
            btn.textContent = '⚙️';
            playerContainer.appendChild(btn);
        }
        return btn;
    }

    // Add controls (styled like /movies)
    const settingsBtn = ensureSettingsButton();
    if (!isMovie) {
        renderSeasonEpisodeSelector();
    } else {
        // Movies: no season/episode selector
        playerContainer.querySelectorAll('#season-episode-selector').forEach(el => el.remove());
    }
    
    // Add skip intro/outro checkboxes
    renderSkipCheckboxes(malId);
    
    // Store player info globally for postMessage hook
    window.currentAniListId = aniListId;
    window.currentEpisodeNumber = currentEpisode;
    window.currentSeasonNumber = currentSeason;
    updateGlobalAbsoluteEpisode();
    
    // Send initial hook to userscript
    const initialSkipSettings = getAnimeSkipSettings(malId);
    sendAnimePlayerHook({
        malId,
        aniListId,
        episodeNumber: currentEpisode,
        seasonNumber: currentSeason,
        ...initialSkipSettings,
    });

    function ensureEpisodeArrows() {
        let prevBtn = playerContainer.querySelector('#anime-prev-episode');
        if (!prevBtn) {
            prevBtn = document.createElement('button');
            prevBtn.id = 'anime-prev-episode';
            prevBtn.className = 'episode-arrow';
            prevBtn.type = 'button';
            prevBtn.setAttribute('aria-label', 'Previous episode');
            prevBtn.textContent = '‹';
            playerContainer.appendChild(prevBtn);
        }

        let nextBtn = playerContainer.querySelector('#anime-next-episode');
        if (!nextBtn) {
            nextBtn = document.createElement('button');
            nextBtn.id = 'anime-next-episode';
            nextBtn.className = 'episode-arrow';
            nextBtn.type = 'button';
            nextBtn.setAttribute('aria-label', 'Next episode');
            nextBtn.textContent = '›';
            playerContainer.appendChild(nextBtn);
        }
        return { prevBtn, nextBtn };
    }

    const iframe = document.getElementById('anime-player-iframe');
    const playerLoadingOverlay = document.getElementById('anime-player-loading');
    let currentGroups = [];
    let activeSelection = null;
    let sessionUserSelection = null;
    const arrows = isMovie ? null : ensureEpisodeArrows();
    let iframeLoadVersion = 0;

    function syncActiveAnimePlayerHook() {
        const settings = getAnimeSkipSettings(malId);
        sendAnimePlayerHook({
            malId,
            aniListId: window.currentAniListId,
            episodeNumber: currentEpisode,
            seasonNumber: currentSeason,
            absoluteEpisodeNumber: computeAbsoluteEpisode(currentSeason, currentEpisode),
            ...settings,
        });
    }

    function showPlayerLoading() {
        if (playerLoadingOverlay) playerLoadingOverlay.classList.remove('hidden');
    }

    function hidePlayerLoading() {
        if (playerLoadingOverlay) playerLoadingOverlay.classList.add('hidden');
    }

    iframe.addEventListener('load', () => {
        hidePlayerLoading();
        syncActiveAnimePlayerHook();
        setTimeout(syncActiveAnimePlayerHook, 250);
        setTimeout(syncActiveAnimePlayerHook, 1200);
    });

    function persistContinueWatchingFromSelection(groupKey, url) {
        let host = null;
        try { host = new URL(url).hostname.toLowerCase(); } catch { host = null; }
        const ep = !isMovie ? Number(currentEpisode) : null;
        const frac = (!isMovie && episodesTotalForProgress && ep)
            ? Math.min(1, Math.max(0, ep / episodesTotalForProgress))
            : 0;
        upsertAnimeProgressRecord(malId, {
            title: titleForProgress,
            poster: postersForProgress.medium,
            year: yearForProgress,
            episodesTotal: episodesTotalForProgress,
            season: !isMovie ? String(currentSeason) : null,
            episode: ep,
            playerGroup: groupKey || null,
            playerHost: host,
            progress: frac,
            updatedAt: Date.now()
        });
        try { loadAnimeContinueWatching(); } catch { }
    }

    function ensureAnimeIndicatorsContainer() {
        let container = playerContainer.querySelector('#anime-source-indicators');
        if (!container) {
            container = document.createElement('div');
            container.id = 'anime-source-indicators';
            playerContainer.prepend(container);
        }
        return container;
    }

    function selectionLabelForSettings(sel) {
        if (!sel || !sel.group) return isMovie ? 'VO' : 'VOSTA';
        const group = (currentGroups || []).find((item) => item.key === sel.group);
        if (group && group.label) return group.label;
        const g = sel.group;
        if (g === 'vo') return 'VO';
        if (g === 'vf') return 'VF';
        if (g === 'vosta') return 'VOSTA';
        if (g === 'va') return 'VA';
        if (g === 'vostfr') return 'VOSTFR';
        return isMovie ? 'VO' : 'VOSTA';
    }

    function buildSelectionFromSettingsLabel(label) {
        const directMatch = (currentGroups || []).find((group) => group.label === label);
        if (directMatch) return { group: directMatch.key, idx: 0 };
        if (label === 'VO') return { group: 'vo', idx: 0 };
        if (label === 'VF') return { group: 'vf', idx: 0 };
        if (label === 'VOSTA') return { group: 'vosta', idx: 0 };
        if (label === 'VA') return { group: 'va', idx: 0 };
        if (label === 'VOSTFR') return { group: 'vostfr', idx: 0 };
        return null;
    }

    function pickBestAvailableSelection(sel, groups) {
        const gList = groups || [];
        if (!gList.length) return null;
        if (sel && sel.group) {
            const grp = gList.find(g => g.key === sel.group);
            if (grp && grp.urls && grp.urls.length) {
                const idx = Number.isInteger(sel.idx) ? sel.idx : 0;
                return { group: sel.group, idx: Math.min(Math.max(idx, 0), grp.urls.length - 1) };
            }
        }
        // Default order
        const preferredOrder = isMovie
            ? ['vo', 'vf']
            : ['vosta', 'va'];
        for (const key of preferredOrder) {
            const grp = gList.find(g => g.key === key);
            if (grp && grp.urls && grp.urls.length) return { group: key, idx: 0 };
        }
        // Fallback: first available
        return { group: gList[0].key, idx: 0 };
    }

    function pickIndexByHost(urls, preferredHost) {
        if (!preferredHost || !Array.isArray(urls)) return null;
        const host = String(preferredHost).toLowerCase();
        for (let i = 0; i < urls.length; i++) {
            try {
                const u = new URL(urls[i]);
                if ((u.hostname || '').toLowerCase() === host) return i;
            } catch { }
        }
        return null;
    }

    function getNextEpisodeTarget() {
        if (isMovie) return null;
        const maxEp = getMaxEpisode(currentSeason);
        if (currentEpisode < maxEp) {
            return { season: currentSeason, episode: currentEpisode + 1 };
        }
        const seasonIdx = seasons.indexOf(currentSeason);
        if (seasonIdx !== -1 && seasonIdx + 1 < seasons.length) {
            return { season: seasons[seasonIdx + 1], episode: 1 };
        }
        return null;
    }

    async function preloadNextEpisodeSources() {
        const target = getNextEpisodeTarget();
        if (!target) return;
        const preloadKey = `${String(target.season)}:${Number(target.episode)}`;
        if (currentAnimePlayerSession && currentAnimePlayerSession._preloadedNextKey === preloadKey) return;

        if (currentAnimePlayerSession) {
            currentAnimePlayerSession._preloadedNextKey = preloadKey;
        }

        try {
            await buildSourceGroups(target.season, target.episode);
        } catch (error) {
            if (currentAnimePlayerSession && currentAnimePlayerSession._preloadedNextKey === preloadKey) {
                currentAnimePlayerSession._preloadedNextKey = null;
            }
            console.warn('Failed to preload next anime sources', error);
        }
    }

    function switchToSelection(sel, { persistLastUsed = true } = {}) {
        const grp = (currentGroups || []).find(g => g.key === sel.group);
        if (!grp || !grp.urls || !grp.urls.length) return;
        const idx = Math.min(Math.max(sel.idx || 0, 0), grp.urls.length - 1);
        let url = grp.urls[idx];
        if (!/[?&]autoplay=1/.test(url)) url += (url.includes('?') ? '&' : '?') + 'autoplay=1';

        // Decorate the URL so the userscript can report timing, and pass seek for resume.
        iframeLoadVersion += 1;
        iframe.dataset.loadVersion = String(iframeLoadVersion);
        showPlayerLoading();
        iframe.src = decoratePlayerUrl(url, { seekSeconds: getResumeSeekForCurrentEpisode() });
        activeSelection = { group: grp.key, idx };
        try {
            const parsed = new URL(grp.urls[idx]);
            if (currentAnimePlayerSession) {
                currentAnimePlayerSession.playerHost = (parsed.hostname || '').toLowerCase() || null;
                currentAnimePlayerSession.playerOrigin = parsed.origin || null;
                currentAnimePlayerSession.currentSeason = isMovie ? null : String(currentSeason);
                currentAnimePlayerSession.currentEpisode = isMovie ? null : Number(currentEpisode);
            }
        } catch {
            if (currentAnimePlayerSession) {
                currentAnimePlayerSession.currentSeason = isMovie ? null : String(currentSeason);
                currentAnimePlayerSession.currentEpisode = isMovie ? null : Number(currentEpisode);
            }
        }
        if (persistLastUsed) {
            sessionUserSelection = { group: grp.key, idx };
            setLastUsed(grp.key, grp.urls[idx]);
        }

        syncActiveAnimePlayerHook();

        // Continue Watching: remember the exact player used (hostname + group)
        persistContinueWatchingFromSelection(grp.key, grp.urls[idx]);

        // Update active dot UI
        const container = ensureAnimeIndicatorsContainer();
        const dots = container.querySelectorAll('.indicator');
        dots.forEach(dot => {
            const g = dot.dataset.group;
            const i = parseInt(dot.dataset.idx || '0', 10);
            if (g === activeSelection.group && i === activeSelection.idx) dot.classList.add('active');
            else dot.classList.remove('active');
        });
    }

    async function renderAnimeSourceIndicators() {
        const container = ensureAnimeIndicatorsContainer();
        const renderToken = ++sourceIndicatorRenderToken;
        container.innerHTML = '<span class="group-label first">Loading sources...</span>';
        showPlayerLoading();
        const nextGroups = await buildSourceGroups(currentSeason, currentEpisode);
        if (currentAnimePlayerOpenToken !== openToken || renderToken !== sourceIndicatorRenderToken) return;
        currentGroups = nextGroups;
        container.innerHTML = '';

        if (!currentGroups.length) {
            iframe.src = 'about:blank';
            hidePlayerLoading();
            const emptyLabel = document.createElement('span');
            emptyLabel.className = 'group-label first';
            emptyLabel.textContent = 'No sources available';
            container.appendChild(emptyLabel);
            return;
        }

        currentGroups.forEach((group, groupIdx) => {
            const label = document.createElement('span');
            label.className = 'group-label' + (groupIdx === 0 ? ' first' : '');
            label.textContent = `${group.label} : `;
            container.appendChild(label);

            (group.urls || []).forEach((u, idx) => {
                const dot = document.createElement('div');
                dot.className = 'indicator';
                dot.dataset.group = group.key;
                dot.dataset.idx = String(idx);
                const sourceName = getSourceDisplayName(u, group.label, idx);
                dot.dataset.sourceName = sourceName;
                dot.title = sourceName;
                dot.setAttribute('aria-label', `${group.label} source ${idx + 1}`);
                dot.addEventListener('click', () => switchToSelection({ group: group.key, idx }, { persistLastUsed: true }));
                container.appendChild(dot);
            });
        });

        // 1) If user explicitly chose a source this session, keep it
        if (sessionUserSelection && sessionUserSelection.group) {
            const grp = currentGroups.find(g => g.key === sessionUserSelection.group);
            if (grp && grp.urls && grp.urls.length) {
                const idx = Math.min(sessionUserSelection.idx || 0, grp.urls.length - 1);
                switchToSelection({ group: grp.key, idx }, { persistLastUsed: false });
                return;
            }
        }

        // 2) Stick to current selection while moving between episodes
        if (activeSelection && activeSelection.group) {
            const grp = currentGroups.find(g => g.key === activeSelection.group);
            if (grp && grp.urls && grp.urls.length) {
                const idx = Math.min(activeSelection.idx || 0, grp.urls.length - 1);
                switchToSelection({ group: grp.key, idx }, { persistLastUsed: false });
                return;
            }
        }

        // 3) Fresh open: try the last source saved for this anime.
        if (resumePlayerGroupWanted) {
            const grp = currentGroups.find(g => g.key === resumePlayerGroupWanted);
            if (grp && grp.urls && grp.urls.length) {
                const idx = pickIndexByHost(grp.urls, resumePlayerHostWanted);
                switchToSelection({ group: grp.key, idx: idx == null ? 0 : idx }, { persistLastUsed: false });
                return;
            }
        }

        if (resumePlayerHostWanted) {
            for (const grp of currentGroups) {
                const idx = pickIndexByHost(grp.urls, resumePlayerHostWanted);
                if (idx != null) {
                    switchToSelection({ group: grp.key, idx }, { persistLastUsed: false });
                    return;
                }
            }
        }

        // 4) Fall back to the preferred default order.
        const fallback = pickBestAvailableSelection(null, currentGroups);
        if (fallback) switchToSelection(fallback, { persistLastUsed: false });
    }

    // Initial indicators render
    await renderAnimeSourceIndicators();
    // Settings button logic
    settingsBtn.addEventListener('click', () => {
        // Show modal
        const modalHtml = buildSettingsModal(selectionLabelForSettings(activeSelection));
        const modalDiv = document.createElement('div');
        modalDiv.innerHTML = modalHtml;
        document.body.appendChild(modalDiv.firstElementChild);
        // Modal event listeners
        const modal = document.getElementById('anime-settings-modal');
        const select = document.getElementById('anime-source-select');
        const saveBtn = document.getElementById('anime-settings-save');
        const cancelBtn = document.getElementById('anime-settings-cancel');
        saveBtn.addEventListener('click', () => {
            const nextSel = buildSelectionFromSettingsLabel(select.value);
            if (nextSel) {
                const grp = currentGroups.find(g => g.key === nextSel.group);
                if (grp && grp.urls && grp.urls.length) {
                    const idx = 0;
                    switchToSelection({ group: grp.key, idx }, { persistLastUsed: true });
                } else {
                    // Primary set but not currently available; keep current playback
                }
            }
            // Remove modal
            modal.remove();
        });
        cancelBtn.addEventListener('click', () => {
            modal.remove();
        });
    });

    playerContainer.style.display = 'block';
    searchContainer.style.display = 'none';

    if (isMovie) {
        // Movies: remove arrows too
        playerContainer.querySelectorAll('#anime-prev-episode, #anime-next-episode').forEach(el => el.remove());
        return;
    }

    function updateEpisodeArrows() {
        const maxEp = getMaxEpisode(currentSeason);
        const seasonIdx = seasons.indexOf(currentSeason);
        const hasPrev = (currentEpisode > 1) || (seasonIdx > 0);
        const hasNext = (currentEpisode < maxEp) || (seasonIdx !== -1 && seasonIdx + 1 < seasons.length);
        arrows.prevBtn.disabled = !hasPrev;
        arrows.nextBtn.disabled = !hasNext;
    }

    async function goToNextEpisode() {
        const maxEp = getMaxEpisode(currentSeason);
        if (currentEpisode < maxEp) {
            currentEpisode++;
        } else {
            const idx = seasons.indexOf(currentSeason);
            if (idx !== -1 && idx + 1 < seasons.length) {
                currentSeason = seasons[idx + 1];
                currentEpisode = 1;
            } else {
                return;
            }
        }
        resetResumeSeekForAutoNext();
        clearResumeSeekIfDifferent();
        renderSeasonEpisodeSelector();
        await renderAnimeSourceIndicators();
        updateEpisodeArrows();
    }

    async function goToPrevEpisode() {
        if (currentEpisode > 1) {
            currentEpisode--;
        } else {
            const idx = seasons.indexOf(currentSeason);
            if (idx > 0) {
                currentSeason = seasons[idx - 1];
                currentEpisode = getMaxEpisode(currentSeason);
            } else {
                return;
            }
        }
        clearResumeSeekIfDifferent();
        renderSeasonEpisodeSelector();
        await renderAnimeSourceIndicators();
        updateEpisodeArrows();
    }

    arrows.nextBtn.addEventListener('click', goToNextEpisode);
    arrows.prevBtn.addEventListener('click', goToPrevEpisode);
    updateEpisodeArrows();

    // Wire auto-next from the userscript (iframe sends ateaish_player_ended)
    try {
        if (currentAnimePlayerSession && !currentAnimePlayerSession.isMovie) {
            currentAnimePlayerSession.onAutoNext = goToNextEpisode;
            currentAnimePlayerSession.onPlaybackStart = preloadNextEpisodeSources;
        }
    } catch { }
}

async function resolveAniListId(malId) {
    if (!malId) return null;
    if (parseNineAnimeSyntheticId(malId)) return null;

    // Prefer the direct AniList MAL mapping first (usually faster)
    try {
        const mapped = await malToAniListId(malId);
        if (mapped) return mapped;
    } catch (e) {
        // malToAniListId already logs; continue to fallback
    }

    // First try Jikan full endpoint to read external Anilist link
    try {
        const full = await fetchJson(`${JIKAN_BASE}/anime/${malId}/full`);
        const data = full && full.data;
        const external = data && Array.isArray(data.external) ? data.external : [];
        const anilistEntry = external.find(e => {
            if (!e) return false;
            const name = (e.name || '').toLowerCase();
            const url = (e.url || '').toLowerCase();
            return name.includes('anilist') || url.includes('anilist.co');
        });
        if (anilistEntry && anilistEntry.url) {
            const match = anilistEntry.url.match(/anilist\.co\/anime\/(\d+)/);
            if (match && match[1]) {
                const parsed = parseInt(match[1], 10);
                if (!Number.isNaN(parsed)) {
                    return parsed;
                }
            }
        }
    } catch (e) {
        console.warn('Failed to get Anilist id from Jikan full endpoint for MAL', malId, e);
    }

    return null;
}

closePlayer.addEventListener('click', () => {
    currentAnimePlayerOpenToken = null;
    try {
        if (currentAnimePlayerSession) {
            currentAnimePlayerSession.onAutoNext = null;
        }
    } catch { }
    currentAnimePlayerSession = null;
    playerContainer.style.display = 'none';
    searchContainer.style.display = 'flex';
    playerContent.innerHTML = '';
    const controls = playerContainer.querySelector('#anime-player-controls');
    if (controls) controls.remove();
    const selectorBar = playerContainer.querySelector('#season-episode-selector');
    if (selectorBar) selectorBar.remove();
    const settingsBtn = playerContainer.querySelector('#anime-settings-btn');
    if (settingsBtn) settingsBtn.remove();
    const indicators = playerContainer.querySelector('#anime-source-indicators');
    if (indicators) indicators.remove();
});

let animeSearchTimer = null;

function randomPage(max = 10) {
    return Math.floor(Math.random() * max) + 1;
}

function scheduleSearch(term) {
    if (animeSearchTimer) clearTimeout(animeSearchTimer);
    animeSearchTimer = setTimeout(() => {
        searchAnime(term);
    }, 220);
}

async function loadAdultSection(gridId, { movie = false, count = 24 } = {}) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    grid.innerHTML = 'Loading...';
    try {
        if (await canUseAnimeProtectedRemoteSources(700)) {
            const nineAnimePicks = await fetchNineAnimeBrowseEntries({ genres: NINE_ANIME_ADULT_BROWSE_GENRES, movie, count });
            if (nineAnimePicks.length) {
                renderNineAnimeBrowseCardsIntoGrid(grid, nineAnimePicks);
                return;
            }
        }

        const picks = await fetchJikanAdultEntries({ movie, count });

        if (!picks.length) {
            grid.innerHTML = '<div>No adult anime available.</div>';
            return;
        }
        renderAnimeCardsIntoGrid(grid, picks);
    } catch (e) {
        console.error('Failed to load adult section', gridId, e);
        grid.innerHTML = '<div>Failed to load adult anime.</div>';
    }
}

function bindSearchControls() {
    if (searchInput) {
        searchInput.addEventListener('focus', () => setSearchUiExpanded(true));
        searchInput.addEventListener('click', () => setSearchUiExpanded(true));
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.trim();
            if (clearSearchBtn) clearSearchBtn.style.display = term ? 'flex' : 'none';
            if (!term) {
                resultsContainer.innerHTML = '';
                setSearchStatus('');
                return;
            }
            scheduleSearch(term);
        });
    }

    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            searchInput.value = '';
            resultsContainer.innerHTML = '';
            clearSearchBtn.style.display = 'none';
            setSearchStatus('');
            try { searchInput.focus(); } catch { }
        });
    }

    if (searchTools) {
        searchTools.querySelectorAll('.search-filter-chip[data-search-type]').forEach((chip) => {
            chip.addEventListener('click', () => {
                setActiveSearchType(chip.dataset.searchType || DEFAULT_SEARCH_TYPE);
                const term = String(searchInput?.value || '').trim();
                if (term.length >= 2) scheduleSearch(term);
            });
        });
    }

    SEARCH_FILTER_IDS.forEach((id) => {
        const element = getSearchFilterElement(id);
        if (!element) return;
        element.addEventListener('change', () => {
            const term = String(searchInput?.value || '').trim();
            if (term.length >= 2) scheduleSearch(term);
        });
    });

    document.addEventListener('click', (event) => {
        if (!searchContainer || !searchUiExpanded) return;
        if (searchContainer.contains(event.target)) return;
        setSearchUiExpanded(false);
    });
}

function bindBrowseControls() {
    if (seriesToggleBtn) {
        seriesToggleBtn.addEventListener('click', () => {
            activeBrowseMedia = 'series';
            applyBrowseVisibility();
            setActiveSearchType('series');
            scheduleSuggestedAnimeReload();
        });
    }

    if (movieToggleBtn) {
        movieToggleBtn.addEventListener('click', () => {
            activeBrowseMedia = 'movie';
            applyBrowseVisibility();
            setActiveSearchType('movie');
            scheduleSuggestedAnimeReload();
        });
    }

    if (adultToggleBtn) {
        adultToggleBtn.addEventListener('click', () => {
            adultContentEnabled = !adultContentEnabled;
            applyBrowseVisibility();
            loadSuggestedAnime();
            const term = String(searchInput?.value || '').trim();
            if (term.length >= 2) scheduleSearch(term);
        });
    }
}

function loadHomeSections() {
    setTimeout(() => {
        loadSection(`${JIKAN_BASE}/top/anime?filter=bypopularity&limit=24&page=${randomPage(10)}&sfw`, 'trendingGrid', { media: 'series' });
    }, 400);

    setTimeout(() => {
        loadSuggestedAnime();
    }, 650);

    setTimeout(() => {
        loadSection(`${JIKAN_BASE}/anime?themes=62&order_by=members&sort=desc&limit=24&page=${randomPage(6)}&sfw`, 'isekaiTrendingGrid', { media: 'series' });
    }, 800);

    setTimeout(() => {
        loadSection(`${JIKAN_BASE}/anime?themes=62&order_by=start_date&sort=desc&limit=24&page=1&sfw`, 'isekaiNewGrid', { media: 'series' });
    }, 1050);

    setTimeout(() => {
        loadSection(`${JIKAN_BASE}/top/anime?filter=airing&limit=24&page=${randomPage(10)}&sfw`, 'airingGrid', { media: 'series' });
    }, 900);

    setTimeout(() => {
        loadSection(`${JIKAN_BASE}/top/anime?filter=upcoming&limit=24&page=${randomPage(10)}&sfw`, 'upcomingGrid', { media: 'series', releasedOnly: false, clickable: false });
    }, 1400);

    setTimeout(() => {
        loadSection(`${JIKAN_BASE}/top/anime?limit=24&page=${randomPage(10)}&sfw`, 'topGrid', { media: 'series' });
    }, 1900);

    setTimeout(() => {
        loadSection(`${JIKAN_BASE}/top/anime?type=movie&filter=bypopularity&limit=24&page=${randomPage(10)}&sfw`, 'moviesGrid', { media: 'movie' });
    }, 2400);

    setTimeout(() => {
        loadAdultSection('adultGrid', { movie: false, count: 24 });
    }, 3000);

    setTimeout(() => {
        loadAdultSection('adultMoviesGrid', { movie: true, count: 24 });
    }, 3600);
}

window.addEventListener('DOMContentLoaded', () => {
    void canUseAnimeProtectedRemoteSources(1500);
    bindSearchControls();
    bindBrowseControls();
    setActiveSearchType(DEFAULT_SEARCH_TYPE);
    applyBrowseVisibility();
    loadAnimeContinueWatching();
    loadAnimeWatchLater();
    loadAnimeWatched();
    loadHomeSections();
});
