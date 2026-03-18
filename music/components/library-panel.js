function renderTrackButtons(items, action) {
  if (!items.length) return '<div class="empty-state">Nothing stored yet.</div>';
  return `
    <div class="library-list">
      ${items.map((track) => `
        <button class="ghost-button" data-action="${action}" data-spotify-id="${track.spotifyId}">
          ${track.title} · ${track.artists.join(', ')}
        </button>
      `).join('')}
    </div>
  `;
}

function playlistItem(playlist) {
  return `
    <article class="playlist-item" data-playlist-id="${playlist.id}">
      <div>
        <h3 class="track-title">${playlist.name}</h3>
        <p class="track-meta">${playlist.tracks.length} tracks</p>
      </div>
      <div class="inline-actions">
        <button class="secondary-button" data-action="load-playlist">Load</button>
        <button class="chip-button" data-action="delete-playlist">Delete</button>
      </div>
    </article>
  `;
}

export function renderLibraryPanel(container, state) {
  container.innerHTML = `
    <div class="library-columns">
      <section class="library-card">
        <h3 class="section-title">Favorites</h3>
        <p class="meta-copy">Stored locally for quick replay.</p>
        ${renderTrackButtons(state.favorites, 'play-library')}
      </section>
      <section class="library-card">
        <h3 class="section-title">Recents</h3>
        <p class="meta-copy">Last resolved tracks.</p>
        ${renderTrackButtons(state.recents, 'play-library')}
      </section>
      <section class="library-card">
        <h3 class="section-title">Playlists</h3>
        <p class="meta-copy">Stored locally in your browser.</p>
        ${state.playlists.length ? `<div class="playlist-stack">${state.playlists.map(playlistItem).join('')}</div>` : '<div class="empty-state">No playlists yet.</div>'}
      </section>
    </div>
  `;
}