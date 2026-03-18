function formatDuration(durationMs) {
  const totalSeconds = Math.round(Number(durationMs || 0) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function trackCard(track, favorites) {
  const isFavorite = favorites.some((item) => item.spotifyId === track.spotifyId);
  const confidence = Number(track.matchConfidence || 0);
  const sourceLabel = track.source === 'spotify'
    ? 'Spotify catalog'
    : track.source === 'curated'
      ? 'Curated catalog'
      : 'Catalog';
  return `
    <article class="track-card" data-spotify-id="${track.spotifyId}">
      ${track.image ? `<img class="artwork" src="${track.image}" alt="${track.title}">` : '<div class="artwork-placeholder"></div>'}
      <div>
        <div class="inline-actions">
          <span class="provider-pill">${sourceLabel}</span>
          ${confidence ? `<span class="confidence-pill">Match ${(confidence * 100).toFixed(0)}%</span>` : ''}
        </div>
        <h3 class="track-title">${track.title}</h3>
        <p class="track-meta">${track.artists.join(', ')}<br>${track.album} · ${formatDuration(track.durationMs)}</p>
        <div class="track-actions">
          <button class="primary-button" data-action="play">Play</button>
          <button class="secondary-button" data-action="queue">Add to queue</button>
          <button class="chip-button" data-action="favorite">${isFavorite ? 'Unfavorite' : 'Favorite'}</button>
        </div>
      </div>
    </article>
  `;
}

export function renderSearchView(container, state) {
  if (!state.results.length) {
    container.innerHTML = '<div class="empty-state">No matching tracks. Try another search or use the featured catalog.</div>';
    return;
  }
  container.innerHTML = state.results.map((track) => trackCard(track, state.favorites)).join('');
}