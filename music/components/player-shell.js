function confidenceText(match) {
  if (!match) return '';
  if (match.status === 'accepted') return `Resolved ${(match.confidence * 100).toFixed(0)}% confidence`;
  if (match.status === 'needs_review') return `Review candidate ${(match.confidence * 100).toFixed(0)}% confidence`;
  if (match.status === 'unresolved') return 'Playable source unavailable right now';
  return `Match ${(match.confidence * 100).toFixed(0)}% confidence`;
}

export function renderPlayerShell(container, state) {
  const track = state.currentTrack;
  const match = state.currentMatch;

  if (!track) {
    container.innerHTML = `
      <div class="player-stage">
        <div class="player-frame"><div id="youtube-player"></div></div>
        <div class="empty-state">Pick a track from search results, favorites, recents, or queue.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="player-stage">
      <div class="player-frame"><div id="youtube-player"></div></div>
      <div class="player-meta">
        <div class="inline-actions">
          <span class="provider-pill">${track.source === 'spotify' ? 'Spotify metadata' : 'Catalog track'}</span>
          ${match ? `<span class="${match.status === 'accepted' ? 'confidence-pill' : 'alert-pill'}">${confidenceText(match)}</span>` : ''}
        </div>
        <h3 class="track-title">${track.title}</h3>
        <p class="track-meta">${track.artists.join(', ')}<br>${track.album}</p>
        <div class="track-actions">
          <button id="player-toggle-button" class="primary-button" type="button">Play / Pause</button>
          <button id="player-favorite-button" class="secondary-button" type="button">${state.favorites.some((item) => item.spotifyId === track.spotifyId) ? 'Unfavorite' : 'Favorite'}</button>
          <button id="player-queue-button" class="chip-button" type="button">Queue Again</button>
        </div>
      </div>
    </div>
  `;
}