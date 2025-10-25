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
                <div class="preview-overview">${overview}</div>
                ${isTV && lastSeasonNum ? `<div class="preview-tvinfo">Season ${lastSeasonNum}, ${lastSeasonEpisodes} Episodes</div>` : ''}
            `;
            preview.style.display = 'block';
            preview.style.opacity = '1';

            // Position logic
            const rect = e.target.getBoundingClientRect();
            const previewWidth = 260; // match your max-width in CSS
            const margin = 16;
            const windowWidth = window.innerWidth;

            let left;
            if (rect.right + previewWidth + margin > windowWidth) {
                // Not enough space on right, show on left
                left = rect.left - previewWidth - margin + window.scrollX;
            } else {
                // Default: show on right
                left = rect.right + margin + window.scrollX;
            }
            preview.style.left = `${left}px`;
            preview.style.top = `${rect.top + window.scrollY}px`;
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
    let progress = null;

    if (progressData) {
        try {
            const saved = JSON.parse(progressData);
            if (type === 'tv') {
                season = saved.season || last_season;
                episode = saved.episode || 1;
            }
            progress = saved.currentTime || null;
        } catch (e) {
            // Ignore parse errors
        }
    }

    let embedUrl;
    if (type === 'movie') {
        embedUrl = `https://www.vidking.net/embed/movie/${id}?color=e02735&autoPlay=true&nextEpisode=true&episodeSelector=true`;
        //if (progress) {
        //    embedUrl += `&progress=${Math.floor(progress)}`;
        //}
    } else { // tv
        embedUrl = `https://www.vidking.net/embed/tv/${id}/${season}/${episode}?color=e02735&autoPlay=true&nextEpisode=true&episodeSelector=true`;
        //if (progress) {
        //    embedUrl += `&progress=${Math.floor(progress)}`;
        //}
    }

    playerContent.innerHTML = `<iframe src="${embedUrl}" width="100%" height="100%" frameborder="0" allowfullscreen allow="autoplay"></iframe>`;
    playerContainer.style.display = 'block';
    searchContainer.style.display = 'none';
}

closePlayer.addEventListener('click', () => {
    playerContainer.style.display = 'none';
    searchContainer.style.display = 'flex'; // or 'grid', depending on your CSS
    playerContent.innerHTML = '';
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
                const posterDiv = document.createElement('div');
                posterDiv.className = 'poster';
                posterDiv.onclick = () => {
                    const last_season = show.seasons ? show.seasons[show.seasons.length - 1]?.season_number || 1 : 1;
                    openPlayer(show.media_type, tmdb_id, last_season);
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
                            <div class="preview-overview">${overview}</div>
                            ${isTV && lastSeasonNum ? `<div class="preview-tvinfo">Season ${lastSeasonNum}, ${lastSeasonEpisodes} Episodes</div>` : ''}
                        `;
                        preview.style.display = 'block';
                        preview.style.opacity = '1';

                        // Position logic
                        const rect = e.target.getBoundingClientRect();
                        const previewWidth = 260; // match your max-width in CSS
                        const margin = 16;
                        const windowWidth = window.innerWidth;

                        let left;
                        if (rect.right + previewWidth + margin > windowWidth) {
                            // Not enough space on right, show on left
                            left = rect.left - previewWidth - margin + window.scrollX;
                        } else {
                            // Default: show on right
                            left = rect.right + margin + window.scrollX;
                        }
                        preview.style.left = `${left}px`;
                        preview.style.top = `${rect.top + window.scrollY}px`;
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

function loadContinueWatching() {
    const continueGrid = document.getElementById('continueGrid');
    continueGrid.innerHTML = '';

    // Collect all progress keys and their data
    const continueItems = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('progress_')) {
            try {
                const data = JSON.parse(localStorage.getItem(key));
                continueItems.push(data);
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
            addContinueItem(continueGrid, data, poster, title);
        });
        // Fill with dummy posters if less than 7 (dummies go to the right)
        for (let i = items.length; i < 7; i++) {
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
    if (data.duration && data.currentTime) {
        percent = Math.min(100, Math.round((data.currentTime / data.duration) * 100));
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
        localStorage.removeItem(`progress_${data.id}_${data.mediaType}`);
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
        <img src="https://via.placeholder.com/92x138.png?text=No+Image" alt="No Image">
        <div style="width:100%;height:0px;background:#000;margin-top:4px;overflow:hidden;">
            <div style="width:0%;height:100%;background:#e02735;"></div>
        </div>
    `;
    grid.appendChild(div);
}

// Call on page load
document.addEventListener('DOMContentLoaded', loadContinueWatching);

window.addEventListener("message", function (event) {
    try {
        const msg = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (msg.type === "PLAYER_EVENT" && msg.data && msg.data.id && msg.data.mediaType) {
            msg.data.updatedAt = Date.now();
            localStorage.setItem(
                `progress_${msg.data.id}_${msg.data.mediaType}`,
                JSON.stringify(msg.data)
            );
        }
        // Optionally display message
        if (typeof event.data === "string") {
            var messageArea = document.querySelector("#messageArea");
            if (messageArea) {
                messageArea.innerText = event.data;
                messageArea.style.display = "block";
            }
        }
    } catch (e) {
        console.warn("Could not parse message from player:", event.data);
    }
});

// Example function to update continue watching
function updateContinueWatching(item) {
    let continueData = JSON.parse(localStorage.getItem('continueWatching')) || [];
    // Remove existing entry if present
    continueData = continueData.filter(i => i.id !== item.id);
    continueData.unshift(item); // Add to front
    localStorage.setItem('continueWatching', JSON.stringify(continueData));
}
