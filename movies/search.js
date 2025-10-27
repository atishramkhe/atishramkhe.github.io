const searchInput = document.getElementById('search-input');
const resultsContainer = document.getElementById('results');
const searchContainer = document.getElementById('search-container');
const playerContainer = document.getElementById('player-container');
const playerContent = document.getElementById('player-content');
const closePlayer = document.getElementById('close-player');

const apiKey = '792f6fa1e1c53d234af7859d10bdf833';
const tmdbEndpoint = 'https://api.themoviedb.org/3/search/multi';
const imageBaseUrl = 'https://image.tmdb.org/t/p/w500';
const placeholderImage = 'https://via.placeholder.com/92x138.png?text=No+Image';

// Clear search button is now selected from HTML
const clearSearchBtn = document.getElementById('clear-search-btn');

// Make sure searchContainer is positioned relatively
searchContainer.style.position = 'relative';

searchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    if (searchTerm.length < 2) {
        resultsContainer.innerHTML = '';
        return;
    }

    fetch(`${tmdbEndpoint}?api_key=${apiKey}&query=${searchTerm}`)
        .then(response => response.json())
        .then(data => {
            displayResults(data.results);
        })
        .catch(error => {
            console.error("Error fetching data from TMDB:", error);
            resultsContainer.innerHTML = "Error fetching data. Please try again later.";
        });
});

// Handle clear button click
clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    resultsContainer.innerHTML = '';
    searchContainer.style.display = 'flex'; // or your original display value
    playerContainer.style.display = 'none';
});

function displayResults(results) {
    if (results.length === 0) {
        resultsContainer.innerHTML = 'No results found.';
        return;
    }

    resultsContainer.innerHTML = ''; // Clear previous results

    results.forEach(item => {
        if (item.media_type !== 'movie' && item.media_type !== 'tv') {
            return;
        }

        const title = item.title || item.name;
        const posterPath = item.poster_path ? `${imageBaseUrl}${item.poster_path}` : placeholderImage;
        const year = (item.release_date || item.first_air_date || '').slice(0, 4);
        const overview = item.overview || '';
        const isTV = item.media_type === 'tv';
        const lastSeasonNum = isTV && item.seasons ? item.seasons[item.seasons.length - 1]?.season_number : '';
        const lastSeasonEpisodes = isTV && item.seasons ? item.seasons[item.seasons.length - 1]?.episode_count : '';

        const resultItem = document.createElement('div');
        resultItem.classList.add('result-item');
        resultItem.dataset.id = item.id;
        resultItem.dataset.type = item.media_type;

        resultItem.innerHTML = `
            <img src="${posterPath}" alt="${title}">
            <span>${title}</span>
        `;

        resultItem.addEventListener('click', () => {
            openPlayer(item.media_type, item.id);
        });

        // Hover preview logic (same as trending/new)
        resultItem.addEventListener('mouseenter', (e) => {
            const preview = document.getElementById('posterPreview');
            preview.innerHTML = `
                <img src="${posterPath}" alt="${title}">
                <div class="preview-title">${title}
                    <span class="preview-year">${year}</span>
                </div>
                <div class="preview-overview">${truncateOverview(overview)}</div>
                ${isTV && lastSeasonNum ? `<div class="preview-tvinfo">Season ${lastSeasonNum}, ${lastSeasonEpisodes} Episodes</div>` : ''}
            `;
            preview.style.display = 'block';
            preview.style.opacity = '1';
            preview.style.width = '260px';
            preview.style.maxWidth = '260px';
            preview.style.position = 'absolute';

            setTimeout(() => {
                const posterRect = resultItem.getBoundingClientRect();
                const previewRect = preview.getBoundingClientRect();
                const scrollX = window.scrollX;
                const scrollY = window.scrollY;
                const margin = 8;

                // Center preview horizontally above poster
                let left = posterRect.left + scrollX + (posterRect.width / 2) - (previewRect.width / 2);
                let top = posterRect.top + scrollY - previewRect.height - margin;

                // Prevent overflow left
                left = Math.max(scrollX + margin, left);
                // Prevent overflow right
                left = Math.min(scrollX + window.innerWidth - previewRect.width - margin, left);
                // Prevent preview going above viewport
                top = Math.max(scrollY + margin, top);

                preview.style.left = `${left}px`;
                preview.style.top = `${top}px`;
            }, 0);
        });

        resultItem.addEventListener('mouseleave', () => {
            const preview = document.getElementById('posterPreview');
            preview.style.display = 'none';
            preview.style.opacity = '0';
        });

        resultsContainer.appendChild(resultItem);
    });
}

function openPlayer(type, id, last_season = 1) {
    // Try to load saved progress
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
            // Ignore parse errors
        }
    }

    let embedUrl;
    if (type === 'movie') {
        embedUrl = `https://player.videasy.net/movie/${id}?nextEpisode=true&autoplayNextEpisode=true&episodeSelector=true&overlay=true&color=e02735&autoplay=true`;
        // https://www.vidking.net/embed/movie/
        // ?color=e02735&autoPlay=true&nextEpisode=true&episodeSelector=true
        //if (progress) {
        //    embedUrl += `&progress=${Math.floor(progress)}`;
        //}
    } else { // tv
        embedUrl = `https://player.videasy.net/tv/${id}/${season}/${episode}?nextEpisode=true&autoplayNextEpisode=true&episodeSelector=true&overlay=true&color=e02735&autoplay=true`;
        // https://www.vidking.net/embed/tv/
        //if (progress) {
        //    embedUrl += `&progress=${Math.floor(progress)}`;
        //}
    }

    playerContent.innerHTML = `<iframe src="${embedUrl}" width="100%" height="100%" frameborder="0" allowfullscreen allow="autoplay; fullscreen; encrypted-media"></iframe>`;
    playerContainer.style.display = 'block';
    searchContainer.style.display = 'none';
}

// Replace the existing window.message handler with this more robust version

function tryParseJSON(str) {
    try {
        return JSON.parse(str);
    } catch (e) {
        // try to extract JSON-looking substring if double-encoded or wrapped
        const first = str.indexOf('{');
        const last = str.lastIndexOf('}');
        if (first !== -1 && last !== -1 && last > first) {
            try {
                return JSON.parse(str.slice(first, last + 1));
            } catch (e2) {
                return null;
            }
        }
        return null;
    }
}

function extractPayload(obj) {
    // Some players wrap the useful data under .data, .payload, or .message
    if (!obj || typeof obj !== 'object') return null;
    if (obj.payload && typeof obj.payload === 'object') return obj.payload;
    if (obj.data && typeof obj.data === 'object') return obj.data;
    if (obj.message && typeof obj.message === 'object') return obj.message;
    return obj;
}

window.addEventListener("message", function (event) {
    try {
        let parsed;
        if (typeof event.data === "string") {
            parsed = tryParseJSON(event.data) || event.data;
        } else {
            parsed = event.data;
        }

        if (typeof parsed === 'string') {
            parsed = tryParseJSON(parsed) || parsed;
        }

        parsed = extractPayload(parsed);

        console.debug("[player message] raw:", event.data, "parsed:", parsed);

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
        console.debug("[player message] saved localStorage key:", key, toStore);

        // NOTE: Do NOT refresh the continue-watching UI here while the player is open.
        // Frequent refreshes cause visual/jank issues. The UI will be updated on page load
        // and when the player is closed (see closePlayer handler).
    } catch (e) {
        console.warn("[player message] parse/save error:", e);
    }
});

closePlayer.addEventListener('click', () => {
    playerContainer.style.display = 'none';
    searchContainer.style.display = 'flex'; // or 'grid', depending on your CSS
    playerContent.innerHTML = '';

    // Give the message handler a moment to finish writing final progress to localStorage,
    // then refresh the continue watching UI.
    setTimeout(() => {
        try {
            if (typeof loadContinueWatching === 'function') {
                loadContinueWatching();
            }
        } catch (e) {
            console.warn('Error refreshing continue watching:', e);
        }
    }, 100);
});

function shuffle(array) {
	for (let i = array.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [array[i], array[j]] = [array[j], array[i]];
	}
}

function loadGrid(jsonPath, gridId) {
    fetch(jsonPath)
        .then(res => res.json())
        .then(data => {
            const shows = [...(data.movies || []), ...(data.tv_shows || [])];
            shuffle(shows);
            const grid = document.getElementById(gridId);
            if (!grid) return; // guard if element not in DOM
            grid.innerHTML = '';
            shows.forEach(show => {
                const tmdb_id = show.id;
                const poster = show.poster_path 
                    ? `posters/${show.media_type === 'tv' ? 'tv' : 'movie'}_${tmdb_id}.png`
                    : 'https://via.placeholder.com/92x138.png?text=No+Image';
                const title = show.title || show.name;
                const year = (show.release_date || show.first_air_date || '').slice(0, 4);
                const overview = show.overview || '';
                const isTV = show.media_type === 'tv';
                const lastSeason = isTV && show.seasons ? show.seasons[show.seasons.length - 1] : null;
                const lastSeasonNum = lastSeason?.season_number || '';
                const lastSeasonEpisodes = lastSeason?.episode_count || '';

                if (!tmdb_id) return;
                if (!poster || poster === 'https://via.placeholder.com/92x138.png?text=No+Image') return; // Skip if no poster

                const posterDiv = document.createElement('div');
                posterDiv.className = 'poster';
                posterDiv.onclick = () => {
                    const last_season = show.seasons ? show.seasons[show.seasons.length - 1]?.season_number || 1 : 1;
                    openPlayer(show.media_type || 'tv', tmdb_id, last_season);
                };
                const img = document.createElement('img');
                img.src = poster;
                img.alt = title;
                posterDiv.appendChild(img);

                // Hover preview logic (skip for continue watching grid)
                if (gridId !== 'continueGrid') {
                    posterDiv.addEventListener('mouseenter', (e) => {
                        const preview = document.getElementById('posterPreview');
                        preview.innerHTML = `
                            <img src="${poster}" alt="${title}">
                            <div class="preview-title">${title}
                                <span class="preview-year">${year}</span>
                            </div>
                            <div class="preview-overview">${truncateOverview(overview)}</div>
                            ${isTV && lastSeasonNum ? `<div class="preview-tvinfo">Season ${lastSeasonNum}, ${lastSeasonEpisodes} Episodes</div>` : ''}
                        `;
                        preview.style.display = 'block';
                        preview.style.opacity = '1';
                        preview.style.width = '260px';
                        preview.style.maxWidth = '260px';
                        preview.style.position = 'absolute';

                        setTimeout(() => {
                            const posterRect = posterDiv.getBoundingClientRect();
                            const previewRect = preview.getBoundingClientRect();
                            const scrollX = window.scrollX;
                            const scrollY = window.scrollY;
                            const margin = 8;

                            // Center preview horizontally above poster
                            let left = posterRect.left + scrollX + (posterRect.width / 2) - (previewRect.width / 2);
                            let top = posterRect.top + scrollY - previewRect.height - margin;

                            // Prevent overflow left
                            left = Math.max(scrollX + margin, left);
                            // Prevent overflow right
                            left = Math.min(scrollX + window.innerWidth - previewRect.width - margin, left);
                            // Prevent preview going above viewport
                            top = Math.max(scrollY + margin, top);

                            preview.style.left = `${left}px`;
                            preview.style.top = `${top}px`;
                        }, 0);
                    });

                    posterDiv.addEventListener('mouseleave', () => {
                        const preview = document.getElementById('posterPreview');
                        preview.style.display = 'none';
                        preview.style.opacity = '0';
                    });
                }

                grid.appendChild(posterDiv);
            });
        });
}
loadGrid('titles/trending.json', 'trendingGrid');
loadGrid('titles/new.json', 'newGrid');
loadGrid('titles/bollywood.json', 'bollywoodGrid');
loadGrid('titles/kdramas.json', 'kdramasGrid');

function loadContinueWatching() {
    const continueGrid = document.getElementById('continueGrid');
    continueGrid.innerHTML = '';

    // Collect all progress keys and their data
    const continueItems = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('progress_')) {
            try {
                const raw = JSON.parse(localStorage.getItem(key));
                const norm = normalizeProgress(raw);
                if (norm && norm.id && norm.mediaType) continueItems.push(norm);
            } catch (e) {}
        }
    }

    // Sort by most recent updatedAt
    continueItems.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    // Only show the 7 most recent
    const itemsToShow = continueItems.slice(0, 7);

    // Prepare poster fetch promises to preserve order
    const posterPromises = itemsToShow.map(async data => {
        let poster = `posters/${data.mediaType === 'tv' ? 'tv' : 'movie'}_${data.id}.png`;
        let title = data.title || data.name || 'Unknown Title';

        // Try local poster first
        let localPosterExists = await fetch(poster, { method: 'HEAD' }).then(res => res.ok).catch(() => false);

        if (localPosterExists) {
            return { data, poster, title };
        }

        // If poster_path exists, use TMDB image
        if (data.poster_path) {
            poster = `https://image.tmdb.org/t/p/w500${data.poster_path}`;
            return { data, poster, title };
        }

        // If poster_path missing, fetch from TMDB API
        let tmdbUrl;
        if (data.mediaType === 'movie') {
            tmdbUrl = `https://api.themoviedb.org/3/movie/${data.id}?api_key=${apiKey}`;
        } else {
            tmdbUrl = `https://api.themoviedb.org/3/tv/${data.id}?api_key=${apiKey}`;
        }

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
        } catch (e) {
            poster = placeholderImage;
        }

        return { data, poster, title };
    });

    Promise.all(posterPromises).then(items => {
        items.forEach(({ data, poster, title }) => {
            if (!poster || poster === placeholderImage) return; // Skip if no poster
            addContinueItem(continueGrid, data, poster, title);
        });
        // Fill with dummy posters if less than 7 (dummies go to the right)
        for (let i = continueGrid.children.length; i < 7; i++) {
            addDummyContinueItem(continueGrid);
        }
    });
}

function addContinueItem(grid, data, poster, title) {
    const div = document.createElement('div');
    div.className = 'poster';
    div.style.position = 'relative';

    // Calculate progress percentage
    let percent = 0;
    if (typeof data.progress === "number") {
        percent = Math.min(100, Math.round(data.progress));
    } else if (data.duration && data.timestamp) {
        percent = Math.min(100, Math.round((data.timestamp / data.duration) * 100));
    }

    // Remove button (hidden by default, shown on hover)
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

    // Show/hide remove button on hover
    div.addEventListener('mouseenter', () => {
        removeBtn.style.display = 'block';
    });
    div.addEventListener('mouseleave', () => {
        removeBtn.style.display = 'none';
    });

    // Remove from localStorage on click
    removeBtn.onclick = (e) => {
        e.stopPropagation();
        // remove both possible key variants to be safe
        localStorage.removeItem(`progress_${data.id}_${data.mediaType}`);
        localStorage.removeItem(`progress_${data.id}_${data.type || data.mediaType}`);
        loadContinueWatching(); // Refresh the grid to fill up to 7 items
    };

    div.innerHTML = `
        <img src="${poster}" alt="${title}">
        <div style="width:100%;height:6px;background:#222;margin-top:4px;overflow:hidden;">
            <div style="width:${percent}%;height:100%;background:#e02735;"></div>
        </div>
    `;
    div.onclick = () => openPlayer(data.mediaType, data.id, data.season || 1);

    div.appendChild(removeBtn);
    grid.appendChild(div);
}

function addDummyContinueItem(grid) {
    const div = document.createElement('div');
    div.className = 'poster';
    div.innerHTML = `
        <img src="assets/no_poster.png" alt="No Image">
        <div style="width:100%;height:0px;background:#000;margin-top:4px;overflow:hidden;">
            <div style="width:0%;height:100%;background:#e02735;"></div>
        </div>
    `;
    grid.appendChild(div);
}

// Call on page load
document.addEventListener('DOMContentLoaded', () => {
    loadGrid('titles/trending.json', 'trendingGrid');
    loadGrid('titles/new.json', 'newGrid');
    loadGrid('titles/bollywood.json', 'bollywoodGrid');
    loadGrid('titles/kdramas.json', 'kdramaGrid');
    loadContinueWatching();
});

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

function showPosterPreview(e, posterData) {
    const preview = document.getElementById('posterPreview');
    preview.style.display = 'block';
    preview.innerHTML = `
        <img src="${posterData.img}" alt="${posterData.title}">
        <div class="preview-title">${posterData.title}</div>
        <div class="preview-year">${posterData.year || ''}</div>
        <div class="preview-overview">${posterData.overview || ''}</div>
        ${posterData.tvinfo ? `<div class="preview-tvinfo">${posterData.tvinfo}</div>` : ''}
    `;

    // Calculate position
    const padding = 16;
    const previewRect = preview.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let left = e.clientX + padding;
    let top = e.clientY + padding;

    // Adjust if preview would overflow right edge
    if (left + previewRect.width > viewportWidth) {
        left = viewportWidth - previewRect.width - padding;
    }
    // Adjust if preview would overflow bottom edge
    if (top + previewRect.height > viewportHeight) {
        top = viewportHeight - previewRect.height - padding;
    }

    preview.style.left = left + 'px';
    preview.style.top = top + 'px';
}

function truncateOverview(text, maxLength = 120) {
    if (!text) return '';
    return text.length > maxLength
        ? text.slice(0, maxLength).trim() + '...'
        : text;
}
