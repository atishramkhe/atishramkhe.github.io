const searchInput = document.getElementById('search-input');
const resultsContainer = document.getElementById('results');
const searchContainer = document.getElementById('search-container');
const playerContainer = document.getElementById('player-container');
const playerContent = document.getElementById('player-content');
const closePlayer = document.getElementById('close-player');
const clearSearchBtn = document.getElementById('clear-search-btn');

const JIKAN_BASE = 'https://api.jikan.moe/v4';
const ANILIST_GRAPHQL = 'https://graphql.anilist.co';
const TMDB_API_KEY = '792f6fa1e1c53d234af7859d10bdf833';
const TMDB_SEARCH_MOVIE = 'https://api.themoviedb.org/3/search/movie';

// Continue Watching (anime) - mirror /movies progress_* storage shape
const ANIME_PROGRESS_TYPE = 'anime';
const ANIME_PROGRESS_KEY_PREFIX = 'progress_';
const ANIME_CONTINUE_SHOW_LIMIT = 24;
let animeContinueShowAllExpanded = false;

// Current open player session info (used to validate postMessage progress updates)
let currentAnimePlayerSession = null;
let _animeProgressMessageListenerInstalled = false;

function ensureAnimeProgressMessageListener() {
    if (_animeProgressMessageListenerInstalled) return;
    _animeProgressMessageListenerInstalled = true;

    window.addEventListener('message', (event) => {
        const msg = event && event.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.type !== 'ateaish_player_progress' && msg.type !== 'ateaish_player_ended') return;

        // Validate current session
        const session = currentAnimePlayerSession;
        if (!session || !session.malId || !session.token) return;
        if (String(msg.token || '') !== String(session.token)) return;
        if (String(msg.malId || '') !== String(session.malId)) return;

        if (msg.type === 'ateaish_player_ended') {
            // Auto-next is only meaningful for series (not movies)
            if (session.isMovie) return;
            if (typeof session.onAutoNext !== 'function') return;

            const now = Date.now();
            if (session._lastAutoNextAt && now - session._lastAutoNextAt < 3000) return;
            session._lastAutoNextAt = now;

            try { session.onAutoNext(); } catch { }
            return;
        }

        const ts = Number(msg.currentTime);
        const dur = Number(msg.duration);
        const host = msg.host ? String(msg.host).toLowerCase() : null;

        if (!Number.isFinite(ts) || ts < 0) return;
        if (!Number.isFinite(dur) || dur <= 0) return;

        // Throttle writes to avoid hammering localStorage
        const now = Date.now();
        if (session._lastSaveAt && now - session._lastSaveAt < 1500) return;
        session._lastSaveAt = now;

        const frac = Math.min(1, Math.max(0, ts / dur));
        upsertAnimeProgressRecord(session.malId, {
            timestamp: ts,
            duration: dur,
            progress: frac,
            playerHost: host,
            updatedAt: now
        });
        try { loadAnimeContinueWatching(); } catch { }
    }, false);
}

function animeProgressKey(malId) {
    const id = String(malId ?? '').trim();
    return id ? `${ANIME_PROGRESS_KEY_PREFIX}${id}_${ANIME_PROGRESS_TYPE}` : '';
}

function getAnimeProgressRecord(malId) {
    const key = animeProgressKey(malId);
    if (!key) return null;
    try {
        const raw = JSON.parse(localStorage.getItem(key) || 'null');
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
    const next = {
        id: String(malId),
        type: ANIME_PROGRESS_TYPE,
        mediaType: ANIME_PROGRESS_TYPE,
        updatedAt: Date.now(),
        ...existing,
        ...patch
    };
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { }
}

function removeFromAnimeContinueWatching(malId) {
    const key = animeProgressKey(malId);
    if (!key) return;
    try { localStorage.removeItem(key); } catch { }
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

function loadAnimeContinueWatching() {
    const section = document.getElementById('continueSection') || document.getElementById('continueWatchingSection');
    const grid = document.getElementById('continueGrid');
    if (!grid) return;

    if (section) section.style.display = 'block';
    grid.innerHTML = '';

    const items = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(ANIME_PROGRESS_KEY_PREFIX)) continue;
        // Only keep anime entries: progress_<id>_anime
        const m = /^progress_(\d+)_anime$/i.exec(key);
        if (!m) continue;
        try {
            const raw = JSON.parse(localStorage.getItem(key) || 'null');
            if (!raw || typeof raw !== 'object') continue;
            const id = String(raw.id ?? m[1] ?? '').trim();
            if (!id) continue;
            items.push({
                id,
                title: raw.title || 'Unknown',
                poster: raw.poster || '',
                year: raw.year || '',
                season: raw.season ?? null,
                episode: raw.episode ?? null,
                episodesTotal: raw.episodesTotal ?? null,
                playerHost: raw.playerHost ?? null,
                playerGroup: raw.playerGroup ?? null,
                updatedAt: raw.updatedAt ?? Date.now(),
                progress: raw.progress ?? null
            });
        } catch { }
    }

    items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

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
                    if (k && /^progress_\d+_anime$/i.test(k)) keysToRemove.push(k);
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

        const poster = data.poster || 'https://via.placeholder.com/300x450.png?text=No+Image';
        const title = data.title || 'Unknown';
        const frac = estimateAnimeProgressFraction(data);
        const percent = Math.min(100, Math.max(0, Math.round(frac * 100)));

        div.innerHTML = `
            <img src="${poster}" alt="${escapeHtml(title)}">
            <div style="width:100%;height:6px;background:#222;margin-top:4px;overflow:hidden;">
                <div style="width:${percent}%;height:100%;background:#f1892f;"></div>
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
    return added;
}
function removeFromAnimeWatchLater(id) {
    const key = wlKeyAnime(id);
    if (!key) return;
    const list = getAnimeWatchLater().filter(x => wlKeyAnime(x?.id) !== key);
    setAnimeWatchLater(list);
    try { loadAnimeWatchLater(); } catch { }
}

async function openAnimeByMalId(malId) {
    if (!malId) return;
    try {
        const data = await fetchJson(`${JIKAN_BASE}/anime/${malId}?sfw`);
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
        div.innerHTML = `<img src="${poster}" alt="${escapeHtml(title)}">`;
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

// --- Movie sources (reuse movies/sources.json with TMDB-based providers) ---
let MOVIE_SOURCES = { VO: [], VF: [] };

async function loadMovieSources() {
    try {
        // anime/ -> ../movies/sources.json
        const res = await fetch('../movies/sources.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arr = await res.json();
        MOVIE_SOURCES.VO = (arr[0] && arr[0].VO) || [];
        MOVIE_SOURCES.VF = (arr[1] && arr[1].VF) || [];
    } catch (e) {
        console.warn('Could not load movie sources.json', e);
        MOVIE_SOURCES = { VO: [], VF: [] };
    }
}
// fire and forget
loadMovieSources();

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

function createPosterCard(anime, onClick, options = {}) {
    const posters = buildPosterVariants(anime);
    const title = anime.title || anime.title_english || anime.title_japanese || 'Unknown';
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

// Wrap fetch with simple retry & backoff to be kinder to Jikan API
async function fetchJson(url, maxRetries = 4) {
    let delay = 800;
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const res = await fetch(url);
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

async function loadSection(url, gridId) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    grid.innerHTML = '';
    try {
        const data = await fetchJson(url, 5);
        const list = data.data || [];
        const filtered = gridId === 'upcomingGrid' ? list : list.filter(isReleasedAnime);
        const clickable = gridId !== 'upcomingGrid';

        filtered.forEach(anime => {
            const card = createPosterCard(anime, openAnimeFromJikan, { clickable });
            grid.appendChild(card);
        });
    } catch (e) {
        console.error('Failed to load section', gridId, e);
        const msg = e && e.message ? String(e.message) : '';
        if (msg.includes('429')) {
            grid.innerHTML = '<div>Rate limited, retrying...</div>';
            setTimeout(() => loadSection(url, gridId), 6000);
        } else {
            grid.innerHTML = '<div>Failed to load. Retrying...</div>';
            setTimeout(() => loadSection(url, gridId), 2500);
        }
    }
}

async function searchAnime(query) {
    if (query.length < 2) {
        resultsContainer.innerHTML = '';
        return;
    }
    setupResultsGridLayout();
    resultsContainer.innerHTML = 'Searching...';
    try {
        const data = await fetchJson(`${JIKAN_BASE}/anime?q=${encodeURIComponent(query)}&limit=20&sfw`);
        const list = (data.data || []).filter(isReleasedAnime);
        if (!list.length) {
            resultsContainer.textContent = 'No results found.';
            return;
        }
        resultsContainer.innerHTML = '';
        // Separate series and movies so series appear first
        const series = list.filter(a => (a.type || '').toLowerCase() !== 'movie');
        const movies = list.filter(a => (a.type || '').toLowerCase() === 'movie');

        function renderGroup(items, groupLabel) {
            if (!items.length) return;
            // Optional small label to visually separate groups
            const labelEl = document.createElement('div');
            labelEl.textContent = groupLabel;
            labelEl.style.width = '100%';
            labelEl.style.gridColumn = '1 / -1';
            labelEl.style.margin = '0.5em 0 0.25em';
            labelEl.style.fontSize = '0.95em';
            labelEl.style.opacity = '0.8';
            resultsContainer.appendChild(labelEl);

            items.forEach(anime => {
                const card = createPosterCard(anime, openAnimeFromJikan);
                resultsContainer.appendChild(card);
            });
        }

        renderGroup(series, 'Series');
        renderGroup(movies, 'Movies');
    } catch (e) {
        console.error('Search failed', e);
        resultsContainer.textContent = 'Error fetching data. Please try again later.';
    }
}

async function malToAniListId(malId) {
    if (!malId) return null;
    try {
        const res = await fetch(ANILIST_GRAPHQL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
                query: 'query ($idMal: Int) { Media(idMal: $idMal, type: ANIME) { id } }',
                variables: { idMal: malId }
            })
        });
        if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
        const json = await res.json();
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
    let currentId = aniListId;
    const visited = new Set();

    for (let depth = 0; depth < maxDepth; depth++) {
        if (visited.has(currentId)) break;
        visited.add(currentId);
        try {
            const res = await fetch(ANILIST_GRAPHQL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                    query: `query ($id: Int) {
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
                    variables: { id: currentId }
                })
            });
            if (!res.ok) {
                console.warn('AniList HTTP for resolveBaseAniListId', res.status);
                break;
            }
            const json = await res.json();
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
            console.error('Failed to resolve base AniList id', aniListId, e);
            break;
        }
    }
    return currentId;
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

async function openAnimeFromJikan(anime) {
    const malId = anime.mal_id;
    const isMovie = (anime.type || '').toLowerCase() === 'movie';
    const openToken = Symbol('anime-player-open');
    currentAnimePlayerOpenToken = openToken;

    // Install message listener once (for timing capture via userscript)
    ensureAnimeProgressMessageListener();

    // Continue Watching: create/update a placeholder entry immediately (like /movies)
    const postersForProgress = buildPosterVariants(anime);
    const titleForProgress = anime.title || anime.title_english || anime.title_japanese || 'Unknown';
    const yearForProgress = buildYear(anime);
    const episodesTotalForProgress = Number.isFinite(Number(anime.episodes)) ? Number(anime.episodes) : null;

    // If a progress entry exists, we'll resume season/episode + preferred player later.
    const resumeProgress = getAnimeProgressRecord(malId);
    const resumeSeasonWanted = resumeProgress && resumeProgress.season ? String(resumeProgress.season) : null;
    const resumeEpisodeWanted = resumeProgress && resumeProgress.episode ? parseInt(resumeProgress.episode, 10) : null;
    const resumePlayerGroupWanted = resumeProgress && resumeProgress.playerGroup ? String(resumeProgress.playerGroup) : null;
    const resumePlayerHostWanted = resumeProgress && resumeProgress.playerHost ? String(resumeProgress.playerHost).toLowerCase() : null;
    const resumeSeekWanted = resumeProgress && Number.isFinite(Number(resumeProgress.timestamp)) ? Number(resumeProgress.timestamp) : null;

    // New per-open session token for postMessage validation
    const progressToken = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    currentAnimePlayerSession = {
        malId: String(malId),
        token: progressToken,
        isMovie: !!isMovie,
        onAutoNext: null,
        _lastAutoNextAt: 0,
        _lastSaveAt: 0
    };

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

    // Open overlay immediately (perceived performance)
    playerContainer.style.display = 'block';
    searchContainer.style.display = 'none';
    playerContent.innerHTML = `
        <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#fff;font-family:inherit;">
            Loading...
        </div>
    `;

    // Remove any previous dynamic controls
    playerContainer.querySelectorAll('#season-episode-selector, #anime-player-controls, #anime-settings-btn, #anime-source-indicators, #anime-prev-episode, #anime-next-episode').forEach(el => el.remove());

    // Kick off movie TMDB lookup early (in parallel)
    const tmdbPromise = isMovie ? getTmdbIdForAnimeMovie(anime) : Promise.resolve(null);

    // Resolve AniList id (cached)
    const cached = getCachedAniListId(malId);
    const aniListId = cached || await resolveAniListId(malId);
    if (currentAnimePlayerOpenToken !== openToken) return;
    if (aniListId) setCachedAniListId(malId, aniListId);
    if (!aniListId) {
        playerContent.innerHTML = `
            <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#fff;font-family:inherit;">
                No streaming source available.
            </div>
        `;
        return;
    }

    // State (filled asynchronously)
    let animeSamaData = null;
    let tmdbId = null;

    // Build season/episode lists (start minimal; expand once anime-sama data loads)
    let seasons = ['saison1'];
    let currentSeason = seasons[0];
    let currentEpisode = 1;

    // Apply resume episode early (season will be applied once anime-sama data is loaded)
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
        try {
            const u = new URL(rawUrl);
            u.searchParams.set('ateaish_mal', String(malId));
            u.searchParams.set('ateaish_token', String(progressToken));
            if (seekSeconds != null && Number.isFinite(Number(seekSeconds)) && Number(seekSeconds) > 0) {
                u.searchParams.set('ateaish_seek', String(Math.floor(Number(seekSeconds))));
            }
            return u.toString();
        } catch {
            const sep = rawUrl.includes('?') ? '&' : '?';
            let out = `${rawUrl}${sep}ateaish_mal=${encodeURIComponent(String(malId))}&ateaish_token=${encodeURIComponent(String(progressToken))}`;
            if (seekSeconds != null && Number.isFinite(Number(seekSeconds)) && Number(seekSeconds) > 0) {
                out += `&ateaish_seek=${encodeURIComponent(String(Math.floor(Number(seekSeconds))))}`;
            }
            return out;
        }
    }

    // Helper to get max episode for a season
    function getMaxEpisode(season) {
        if (!animeSamaData || !animeSamaData[season]) return 1;
        return Math.max(...Object.keys(animeSamaData[season]).map(e => parseInt(e, 10)).filter(e => !isNaN(e)));
    }

    function normalizeUrls(val) {
        if (!val) return [];
        if (Array.isArray(val)) return val.filter(Boolean);
        return [val].filter(Boolean);
    }

    function buildSourceGroups(season, episode) {
        // Movie mode: show VO/VF provider dots (like /movies)
        if (isMovie && tmdbId && (MOVIE_SOURCES.VO.length || MOVIE_SOURCES.VF.length)) {
            const vo = (MOVIE_SOURCES.VO || [])
                .filter(src => src && src.movies)
                .map(src => src.movies.replace(/\$\{id\}/g, tmdbId));
            const vf = (MOVIE_SOURCES.VF || [])
                .filter(src => src && src.movies)
                .map(src => src.movies.replace(/\$\{id\}/g, tmdbId));
            return [
                { key: 'vo', label: 'VO', urls: vo },
                { key: 'vf', label: 'VF', urls: vf }
            ].filter(g => g.urls && g.urls.length);
        }

        // Series mode
        const vidsrcSub = `https://vidsrc.icu/embed/anime/${aniListId}/${episode}/0`;
        const vidsrcDub = `https://vidsrc.icu/embed/anime/${aniListId}/${episode}/1`;
        const videasySub = `https://player.videasy.net/anime/${aniListId}/${episode}?dub=false`;
        const videasyDub = `https://player.videasy.net/anime/${aniListId}/${episode}?dub=true`;

        let vostfrUrls = [];
        let vfUrls = [];
        if (animeSamaData && animeSamaData[season] && animeSamaData[season][episode]) {
            const langs = animeSamaData[season][episode];
            vostfrUrls = normalizeUrls(langs.vostfr);
            vfUrls = normalizeUrls(langs.vf);
        }

        return [
            { key: 'vosta', label: 'VOSTA', urls: [vidsrcSub, videasySub].filter(Boolean) },
            { key: 'va', label: 'VA', urls: [vidsrcDub, videasyDub].filter(Boolean) },
            { key: 'vostfr', label: 'VOSTFR', urls: vostfrUrls },
            { key: 'vf', label: 'VF', urls: vfUrls }
        ].filter(g => g.urls && g.urls.length);
    }

    function seasonLabelFromKey(seasonKey) {
        const n = parseInt(String(seasonKey).replace(/\D/g, ''), 10);
        return Number.isFinite(n) && n > 0 ? String(n) : String(seasonKey);
    }

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
            renderSeasonEpisodeSelector();
            renderAnimeSourceIndicators();
            updateEpisodeArrows();
        };
        episodeSelect.onchange = () => {
            currentEpisode = parseInt(episodeSelect.value, 10);
            renderAnimeSourceIndicators();
            updateEpisodeArrows();
        };

        selectorBar.appendChild(seasonSelect);
        selectorBar.appendChild(episodeSelect);
        playerContainer.appendChild(selectorBar);
    }

    function getSettingsGroups() {
        return isMovie ? ['VO', 'VF'] : ['VOSTA', 'VA', 'VOSTFR', 'VF'];
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
        <iframe id="anime-player-iframe" src="${decoratePlayerUrl(`https://vidsrc.icu/embed/anime/${aniListId}/1/0&autoplay=1`, { seekSeconds: resumeSeekWanted })}" width="100%" height="100%" frameborder="0" allowfullscreen allow="autoplay; fullscreen; encrypted-media"></iframe>
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
    let currentGroups = [];
    let activeSelection = null;
    let sessionUserSelection = null;
    const arrows = isMovie ? null : ensureEpisodeArrows();

    // If we have a per-title remembered player (host/group), try to resume it first.
    if (resumePlayerGroupWanted) {
        sessionUserSelection = { group: resumePlayerGroupWanted, idx: 0 };
        if (resumePlayerHostWanted) setLastUsedHost(resumePlayerGroupWanted, resumePlayerHostWanted);
    }

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
        const g = sel.group;
        if (g === 'vo') return 'VO';
        if (g === 'vf') return 'VF';
        if (g === 'vosta') return 'VOSTA';
        if (g === 'va') return 'VA';
        if (g === 'vostfr') return 'VOSTFR';
        return isMovie ? 'VO' : 'VOSTA';
    }

    function buildSelectionFromSettingsLabel(label) {
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
            : ['vosta', 'va', 'vostfr', 'vf'];
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

    function switchToSelection(sel, { persistLastUsed = true } = {}) {
        const grp = (currentGroups || []).find(g => g.key === sel.group);
        if (!grp || !grp.urls || !grp.urls.length) return;
        const idx = Math.min(Math.max(sel.idx || 0, 0), grp.urls.length - 1);
        let url = grp.urls[idx];
        if (!/[?&]autoplay=1/.test(url)) url += (url.includes('?') ? '&' : '?') + 'autoplay=1';

        // Decorate the URL so the userscript can report timing, and pass seek for resume.
        iframe.src = decoratePlayerUrl(url, { seekSeconds: resumeSeekWanted });
        activeSelection = { group: grp.key, idx };
        if (persistLastUsed) {
            sessionUserSelection = { group: grp.key, idx };
            setLastUsed(grp.key, grp.urls[idx]);
        }

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

    function renderAnimeSourceIndicators() {
        currentGroups = buildSourceGroups(currentSeason, currentEpisode);
        const container = ensureAnimeIndicatorsContainer();
        container.innerHTML = '';

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
                dot.setAttribute('aria-label', `${group.label} source ${idx + 1}`);
                dot.addEventListener('click', () => switchToSelection({ group: group.key, idx }, { persistLastUsed: true }));
                container.appendChild(dot);
            });
        });

        const lastUsed = getLastUsed();

        // 1) If user explicitly chose a source this session, keep it (prefer same host)
        if (sessionUserSelection && sessionUserSelection.group) {
            const grp = currentGroups.find(g => g.key === sessionUserSelection.group);
            if (grp && grp.urls && grp.urls.length) {
                const byHost = pickIndexByHost(grp.urls, lastUsed && lastUsed.group === grp.key ? lastUsed.host : null);
                const idx = byHost !== null ? byHost : Math.min(sessionUserSelection.idx || 0, grp.urls.length - 1);
                switchToSelection({ group: grp.key, idx }, { persistLastUsed: false });
                return;
            }
        }

        // 2) Use primary group from settings (VF stays primary when available)
        const primaryGroup = getPrimaryGroupKey();
        if (primaryGroup) {
            const grp = currentGroups.find(g => g.key === primaryGroup);
            if (grp && grp.urls && grp.urls.length) {
                const byHost = pickIndexByHost(grp.urls, lastUsed && lastUsed.group === grp.key ? lastUsed.host : null);
                const idx = byHost !== null ? byHost : 0;
                switchToSelection({ group: grp.key, idx }, { persistLastUsed: false });
                return;
            }
        }

        // 3) Stick to current (automatic) selection if still available
        if (activeSelection && activeSelection.group) {
            const grp = currentGroups.find(g => g.key === activeSelection.group);
            if (grp && grp.urls && grp.urls.length) {
                const byHost = pickIndexByHost(grp.urls, lastUsed && lastUsed.group === grp.key ? lastUsed.host : null);
                const idx = byHost !== null ? byHost : Math.min(activeSelection.idx || 0, grp.urls.length - 1);
                switchToSelection({ group: grp.key, idx }, { persistLastUsed: false });
                return;
            }
        }

        // 4) Fallback order
        const fallback = pickBestAvailableSelection(null, currentGroups);
        if (fallback) switchToSelection(fallback, { persistLastUsed: false });
    }

    // Initial indicators render
    renderAnimeSourceIndicators();

    // Load anime-sama sources in the background (so the overlay opens fast)
    (async () => {
        let data = await getAnimeSamaSeasonsEpisodesCached(aniListId);
        if (!data) {
            const baseId = await resolveBaseAniListId(aniListId);
            if (baseId && baseId !== aniListId) {
                data = await getAnimeSamaSeasonsEpisodesCached(baseId);
            }
        }
        if (currentAnimePlayerOpenToken !== openToken) return;
        if (!data) return;

        animeSamaData = data;
        seasons = Object.keys(animeSamaData);
        seasons.sort((a, b) => {
            const nA = parseInt(String(a).replace(/\D/g, ''), 10) || 0;
            const nB = parseInt(String(b).replace(/\D/g, ''), 10) || 0;
            return nA - nB;
        });
        if (resumeSeasonWanted && seasons.includes(resumeSeasonWanted)) currentSeason = resumeSeasonWanted;
        if (!seasons.includes(currentSeason)) currentSeason = seasons[0] || 'saison1';
        const maxEp = getMaxEpisode(currentSeason);
        if (currentEpisode > maxEp) currentEpisode = maxEp;

        renderSeasonEpisodeSelector();
        renderAnimeSourceIndicators();
    })();

    // Update movie sources once TMDB id is ready
    tmdbPromise.then(id => {
        if (currentAnimePlayerOpenToken !== openToken) return;
        tmdbId = id;
        renderAnimeSourceIndicators();
    });
    // Settings button logic
    settingsBtn.addEventListener('click', () => {
        // Show modal
        const modalHtml = buildSettingsModal(labelFromGroupKey(getPrimaryGroupKey()) || selectionLabelForSettings(activeSelection));
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
                setPrimaryGroupKey(nextSel.group);
                const grp = currentGroups.find(g => g.key === nextSel.group);
                if (grp && grp.urls && grp.urls.length) {
                    const lastUsed = getLastUsed();
                    const byHost = pickIndexByHost(grp.urls, lastUsed && lastUsed.group === grp.key ? lastUsed.host : null);
                    const idx = byHost !== null ? byHost : 0;
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

    function goToNextEpisode() {
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
        renderSeasonEpisodeSelector();
        renderAnimeSourceIndicators();
        updateEpisodeArrows();
    }

    function goToPrevEpisode() {
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
        renderSeasonEpisodeSelector();
        renderAnimeSourceIndicators();
        updateEpisodeArrows();
    }

    arrows.nextBtn.addEventListener('click', goToNextEpisode);
    arrows.prevBtn.addEventListener('click', goToPrevEpisode);
    updateEpisodeArrows();

    // Wire auto-next from the userscript (iframe sends ateaish_player_ended)
    try {
        if (currentAnimePlayerSession && !currentAnimePlayerSession.isMovie) {
            currentAnimePlayerSession.onAutoNext = goToNextEpisode;
        }
    } catch { }
}

async function resolveAniListId(malId) {
    if (!malId) return null;

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

searchInput.addEventListener('input', (e) => {
    const term = e.target.value.trim();
    if (clearSearchBtn) clearSearchBtn.style.display = term ? 'flex' : 'none';
    searchAnime(term);
});

clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    resultsContainer.innerHTML = '';
    clearSearchBtn.style.display = 'none';
    try { searchInput.focus(); } catch { }
});

async function loadShowcase() {
    const card = document.getElementById('showcase-card');
    if (!card) return;

    const bg = document.getElementById('showcase-bg');
    const posterEl = document.getElementById('showcase-poster');
    const titleEl = document.getElementById('showcase-title');
    const metaEl = document.getElementById('showcase-meta');
    const overviewEl = document.getElementById('showcase-overview');
    const actionsEl = document.getElementById('showcase-actions');
    const playBtn = document.getElementById('showcase-play');
    const wlBtn = document.getElementById('showcase-watchlater');

    if (!bg || !posterEl || !titleEl || !metaEl || !overviewEl || !actionsEl || !playBtn || !wlBtn) return;

    titleEl.textContent = 'Loading...';
    metaEl.textContent = '';
    overviewEl.textContent = '';
    actionsEl.style.display = 'none';

    try {
        const page = randomPage(10);
        const data = await fetchJson(`${JIKAN_BASE}/top/anime?limit=25&page=${page}&sfw`, 5);
        const list = Array.isArray(data.data) ? data.data : [];
        const released = list.filter(isReleasedAnime);
        const pick = released.find(a => (a.synopsis || '').trim().length > 0) || released[0];

        if (!pick) {
            titleEl.textContent = 'No showcase available.';
            return;
        }

        const posters = buildPosterVariants(pick);
        const title = pick.title || pick.title_english || pick.title_japanese || 'Unknown';
        const year = buildYear(pick);
        const malId = pick.mal_id;

        bg.style.backgroundImage = `url("${posters.large}")`;
        posterEl.src = posters.medium;
        posterEl.alt = title;
        titleEl.textContent = title;

        const parts = [];
        if (pick.type) parts.push(String(pick.type));
        if (year) parts.push(String(year));
        if (pick.episodes) parts.push(`${pick.episodes} eps`);
        if (pick.score) parts.push(`★ ${pick.score}`);
        metaEl.textContent = parts.join(' • ');

        overviewEl.textContent = pick.synopsis ? truncate(pick.synopsis, 220) : '';

        const updateWlButton = (saved) => {
            const icon = saved ? 'playlist_add_check' : 'playlist_add';
            const text = saved ? 'In Watch Later' : 'Watch Later';
            wlBtn.innerHTML = `<span class="material-symbols-outlined">${icon}</span>${text}`;
        };

        updateWlButton(malId ? isInAnimeWatchLater(malId) : false);

        playBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            openAnimeFromJikan(pick);
        };

        wlBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!malId) return;
            const saved = toggleAnimeWatchLater({
                id: malId,
                title,
                poster: posters.medium,
                year,
                type: pick.type || '',
                episodes: pick.episodes || '',
                overview: pick.synopsis || ''
            });
            updateWlButton(saved);
            loadAnimeWatchLater();
        };

        card.onclick = () => openAnimeFromJikan(pick);
        actionsEl.style.display = 'flex';
    } catch (e) {
        console.error('Failed to load showcase', e);
        titleEl.textContent = 'Failed to load showcase.';
        actionsEl.style.display = 'none';
    }
}

// --- Featured & Discovery Sections (Jikan-based, rotating) ---
async function loadFeaturedSection(gridId, count = 8) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    grid.innerHTML = 'Loading...';
    try {
        const page = randomPage(10);
        const data = await fetchJson(`${JIKAN_BASE}/top/anime?limit=24&page=${page}&sfw`);
        const list = (data.data || []).filter(isReleasedAnime);
        if (!list.length) {
            grid.innerHTML = '<div>No featured anime available.</div>';
            return;
        }
        // Shuffle in-place
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [list[i], list[j]] = [list[j], list[i]];
        }
        const picks = list.slice(0, count);
        grid.innerHTML = '';
        picks.forEach(anime => {
            const card = createPosterCard(anime, openAnimeFromJikan);
            grid.appendChild(card);
        });
    } catch (e) {
        console.error('Failed to load featured section', e);
        const msg = e && e.message ? String(e.message) : '';
        if (msg.includes('429')) {
            grid.innerHTML = '<div>Rate limited, retrying...</div>';
            setTimeout(() => {
                loadFeaturedSection(gridId, count);
            }, 6000);
        } else {
            grid.innerHTML = '<div>Failed to load featured. Retrying...</div>';
            setTimeout(() => {
                loadFeaturedSection(gridId, count);
            }, 2500);
        }
    }
}

// Discovery: merge several Jikan lists and randomize
async function loadDiscoverySection(gridId, count = 48) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    grid.innerHTML = 'Loading...';
    try {
        // Fetch sequentially instead of in parallel to avoid hitting rate limits
        const top = await fetchJson(`${JIKAN_BASE}/top/anime?limit=24&page=${randomPage(20)}&sfw`);
        const airing = await fetchJson(`${JIKAN_BASE}/top/anime?filter=airing&limit=24&page=${randomPage(10)}&sfw`);
        const upcoming = await fetchJson(`${JIKAN_BASE}/top/anime?filter=upcoming&limit=24&page=${randomPage(10)}&sfw`);
        let list = [];
        if (top && Array.isArray(top.data)) list = list.concat(top.data);
        if (airing && Array.isArray(airing.data)) list = list.concat(airing.data);
        if (upcoming && Array.isArray(upcoming.data)) list = list.concat(upcoming.data);
        list = list.filter(isReleasedAnime);
        if (!list.length) {
            grid.innerHTML = '<div>No discovery anime available.</div>';
            return;
        }
        // Shuffle and slice
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [list[i], list[j]] = [list[j], list[i]];
        }
        const picks = list.slice(0, count);
        grid.innerHTML = '';
        picks.forEach(anime => {
            const card = createPosterCard(anime, openAnimeFromJikan);
            grid.appendChild(card);
        });
    } catch (e) {
        console.error('Failed to load discovery section', e);
        const msg = e && e.message ? String(e.message) : '';
        if (msg.includes('429')) {
            grid.innerHTML = '<div>Rate limited, retrying...</div>';
            setTimeout(() => {
                loadDiscoverySection(gridId, count);
            }, 6000);
        } else {
            grid.innerHTML = '<div>Failed to load discovery. Retrying...</div>';
            setTimeout(() => {
                loadDiscoverySection(gridId, count);
            }, 2500);
        }
    }
}

// Add Featured + Discovery sections on DOM ready
window.addEventListener('DOMContentLoaded', () => {
    const main = document.querySelector('main') || document.body;
    const showsGrid = document.getElementById('showsGrid');

    // Insert new sections after the search/shows area, not above it
    let insertRef = showsGrid ? showsGrid.nextSibling : main.firstChild;

    if (!document.getElementById('featuredGrid')) {
        const featuredSection = document.createElement('section');
        featuredSection.innerHTML = `
            <h2 style="margin-top:1.5em;">Featured</h2>
            <div id="featuredGrid" class="anime-grid"></div>
        `;
        if (insertRef) {
            main.insertBefore(featuredSection, insertRef);
        } else {
            main.appendChild(featuredSection);
        }
    }

    if (!document.getElementById('discoveryGrid')) {
        const discoverySection = document.createElement('section');
        discoverySection.innerHTML = `
            <h2 style="margin-top:1.5em;">Discovery</h2>
            <div id="discoveryGrid" class="anime-grid"></div>
        `;
        const featuredSectionEl = document.getElementById('featuredGrid')
            ? document.getElementById('featuredGrid').parentElement
            : null;
        if (featuredSectionEl && featuredSectionEl.nextSibling) {
            main.insertBefore(discoverySection, featuredSectionEl.nextSibling);
        } else {
            main.appendChild(discoverySection);
        }
    }

    loadFeaturedSection('featuredGrid', 8);
    loadDiscoverySection('discoveryGrid', 48);
    loadShowcase();
    loadAnimeContinueWatching();
    loadAnimeWatchLater();
});

// Random helper for rotating Jikan sections
function randomPage(max = 10) {
    return Math.floor(Math.random() * max) + 1;
}

// Dedicated ecchi section (genre id 9 on Jikan): keep it spicy but not hentai
async function loadEcchiSection(gridId, count = 24) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    grid.innerHTML = 'Loading...';
    try {
        // Ecchi genre (9). Use sfw and filter out anything that looks like hentai.
        const data = await fetchJson(
            `${JIKAN_BASE}/anime?genres=9&order_by=popularity&sort=desc&limit=50&page=${randomPage(10)}&sfw`,
            5
        );
        const list = data.data || [];
        const ecchi = list.filter(a => {
            const rating = (a.rating || '').toLowerCase();
            return !rating.includes('rx') && !rating.includes('hentai') && isReleasedAnime(a);
        });
        if (!ecchi.length) {
            grid.innerHTML = '<div>No ecchi anime available.</div>';
            return;
        }
        // Shuffle and limit
        for (let i = ecchi.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [ecchi[i], ecchi[j]] = [ecchi[j], ecchi[i]];
        }
        const picks = ecchi.slice(0, count);
        grid.innerHTML = '';
        picks.forEach(anime => {
            const card = createPosterCard(anime, openAnimeFromJikan);
            grid.appendChild(card);
        });
    } catch (e) {
        console.error('Failed to load ecchi section', e);
        // If we are rate-limited, retry once after a delay instead of showing a hard error
        const msg = e && e.message ? e.message : '';
        if (msg.includes('429')) {
            grid.innerHTML = 'Rate limited, retrying...';
            setTimeout(() => {
                loadEcchiSection(gridId, count);
            }, 6000);
        } else {
            grid.innerHTML = '<div>Failed to load ecchi anime. Retrying...</div>';
            setTimeout(() => {
                loadEcchiSection(gridId, count);
            }, 2500);
        }
    }
}

// Jikan sections with randomized pages for rotation (staggered to avoid 429s)
setTimeout(() => {
    loadSection(`${JIKAN_BASE}/top/anime?limit=24&page=${randomPage(10)}&sfw`, 'trendingGrid');
}, 800);

setTimeout(() => {
    loadSection(`${JIKAN_BASE}/top/anime?filter=airing&limit=24&page=${randomPage(10)}&sfw`, 'airingGrid');
}, 1400);

setTimeout(() => {
    loadSection(`${JIKAN_BASE}/top/anime?filter=upcoming&limit=24&page=${randomPage(10)}&sfw`, 'upcomingGrid');
}, 2000);

setTimeout(() => {
    loadSection(`${JIKAN_BASE}/top/anime?type=movie&limit=24&page=${randomPage(10)}&sfw`, 'moviesGrid');
}, 2600);

setTimeout(() => {
    loadSection(`${JIKAN_BASE}/top/anime?limit=24&page=${randomPage(10)}&sfw`, 'topGrid');
}, 3200);

// Load ecchi section even later to further reduce rate limiting
setTimeout(() => {
    loadEcchiSection('adultGrid', 24);
}, 8000);

// Add minimal CSS for selectors row if not present
if (!document.getElementById('anime-sel-css')) {
    const style = document.createElement('style');
    style.id = 'anime-sel-css';
    style.textContent = `
    .selectors-row {
        position: absolute;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 101;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 4px 12px;
        border-radius: 999px;
        border: none;
        background: rgba(0,0,0,0.75);
        backdrop-filter: blur(6px);
    }
    .selectors-row label {
        font-size: 0.8rem;
        color: #ddd;
        white-space: nowrap;
    }
    .selectors-row select {
        background: #000;
        color: #fff;
        border: none;
        border-radius: 999px;
        padding: 2px 10px;
        font-family: 'OumaTrialLight', sans-serif;
        font-size: 0.85rem;
        outline: none;
    }
    `;
    document.head.appendChild(style);
}
