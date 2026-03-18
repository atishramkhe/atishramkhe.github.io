function queueItem(track) {
  return `
    <article class="queue-item" data-spotify-id="${track.spotifyId}">
      <div>
        <h3 class="track-title">${track.title}</h3>
        <p class="track-meta">${track.artists.join(', ')} · ${track.album}</p>
      </div>
      <div class="inline-actions">
        <button class="secondary-button" data-action="play">Play now</button>
        <button class="chip-button" data-action="remove">Remove</button>
      </div>
    </article>
  `;
}

export function renderQueuePanel(container, state) {
  if (!state.queue.length) {
    container.innerHTML = '<div class="empty-state">Queue is empty. Add a few tracks from search results or favorites.</div>';
    return;
  }
  container.innerHTML = `<div class="stack-grid">${state.queue.map(queueItem).join('')}</div>`;
}