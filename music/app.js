import { renderLibraryPanel } from './components/library-panel.js';
import { renderPlayerShell } from './components/player-shell.js';
import { renderQueuePanel } from './components/queue-panel.js';
import { renderSearchView } from './components/search-view.js';
import { MusicApi } from './services/music-api.js';
import { YouTubePlayerController } from './services/youtube-player.js';
import { createStore } from './state/store.js';

const store = createStore();
const api = new MusicApi();

const elements = {
  searchForm: document.getElementById('search-form'),
  searchInput: document.getElementById('search-input'),
  searchFeedback: document.getElementById('search-feedback'),
  resultsContainer: document.getElementById('results-container'),
  playerShell: document.getElementById('player-shell'),
  queueContainer: document.getElementById('queue-container'),
  libraryContainer: document.getElementById('library-container'),
  nextTrackButton: document.getElementById('next-track-button'),
  playlistForm: document.getElementById('playlist-form'),
  playlistNameInput: document.getElementById('playlist-name-input'),
  saveQueuePlaylistButton: document.getElementById('save-queue-playlist-button')
};

let playerController = null;
let renderedTrackId = '';
let playerIsPlaying = false;

function formatProviderSummary(providers = {}) {
  if (providers.catalog || providers.playback || providers.storage) {
    return `Catalog: ${providers.catalog || 'unknown'} · Playback: ${providers.playback || 'unknown'} · Storage: ${providers.storage || 'unknown'}`;
  }
  return `Spotify: ${providers.spotify || 'unknown'} · YouTube: ${providers.youtube || 'unknown'} · yt-dlp: ${providers.ytdlp || 'unknown'}`;
}

async function refreshHealth() {
  try {
    const payload = await api.health();
    return formatProviderSummary(payload.providers);
  } catch (error) {
    return error.message;
  }
}

async function loadFeaturedTracks() {
  try {
    const payload = await api.featured();
    store.setResults(payload.items || []);
    store.setFeedback('Featured tracks loaded. Search the catalog or press play.');
  } catch (error) {
    store.setFeedback(`Catalog failed to load: ${error.message}`);
  }
}

async function refreshPlaylists() {
  try {
    const payload = await api.getPlaylists();
    store.setPlaylists(payload.items || []);
  } catch (error) {
    store.setFeedback(`Playlist sync unavailable: ${error.message}`);
  }
}

function findTrackBySpotifyId(spotifyId) {
  const state = store.getState();
  return [state.currentTrack, ...state.results, ...state.queue, ...state.favorites, ...state.recents]
    .filter(Boolean)
    .find((item) => item.spotifyId === spotifyId) || null;
}

async function ensurePlayerController() {
  if (playerController) return playerController;
  playerController = new YouTubePlayerController('youtube-player', {
    onStateChange: () => {
    },
    onEnded: () => {
      playerIsPlaying = false;
      void playNextFromQueue();
    }
  });
  return playerController;
}

async function playResolvedTrack(track) {
  store.setFeedback(`Resolving ${track.title}...`);
  try {
    const payload = await api.resolve(track.spotifyId);
    store.setCurrent(payload.track, payload.match);
    store.addRecent(payload.track);
    if (payload.match?.youtubeVideoId) {
      const controller = await ensurePlayerController();
      await controller.load(payload.match.youtubeVideoId);
      playerIsPlaying = true;
      store.setFeedback(`Playing ${payload.track.title}.`);
    } else {
      playerIsPlaying = false;
      store.setFeedback(`No playable YouTube video is attached to ${payload.track.title}.`);
    }
  } catch (error) {
    playerIsPlaying = false;
    store.setFeedback(`Playback failed for ${track.title}: ${error.message}`);
  }
}

async function playTrackById(spotifyId) {
  const track = findTrackBySpotifyId(spotifyId);
  if (!track) return;
  await playResolvedTrack(track);
}

async function playNextFromQueue() {
  const next = store.shiftQueue();
  if (!next) {
    store.setFeedback('Queue finished.');
    return;
  }
  await playResolvedTrack(next);
}

async function handleSearchSubmit(event) {
  event.preventDefault();
  const formData = new FormData(elements.searchForm);
  const query = String(formData.get('query') || '').trim();
  if (!query) return;

  store.setFeedback(`Searching for “${query}”...`);
  try {
    const payload = await api.search(query);
    store.setResults(payload.items || []);
    store.setFeedback(`${payload.items?.length || 0} tracks found for “${query}”.`);
  } catch (error) {
    store.setResults([]);
    store.setFeedback(`Search failed: ${error.message}`);
  }
}

async function handleResultsClick(event) {
  const button = event.target.closest('button[data-action]');
  const card = event.target.closest('[data-spotify-id]');
  if (!button || !card) return;
  const track = findTrackBySpotifyId(card.dataset.spotifyId);
  if (!track) return;

  if (button.dataset.action === 'play') await playResolvedTrack(track);
  if (button.dataset.action === 'queue') store.enqueue(track);
  if (button.dataset.action === 'favorite') store.toggleFavorite(track);
}

async function handleQueueClick(event) {
  const button = event.target.closest('button[data-action]');
  const card = event.target.closest('[data-spotify-id]');
  if (!button || !card) return;
  const spotifyId = card.dataset.spotifyId;

  if (button.dataset.action === 'play') await playTrackById(spotifyId);
  if (button.dataset.action === 'remove') store.dequeue(spotifyId);
}

async function handleLibraryClick(event) {
  const trackButton = event.target.closest('button[data-action="play-library"]');
  if (trackButton) {
    await playTrackById(trackButton.dataset.spotifyId);
    return;
  }

  const playlistArticle = event.target.closest('[data-playlist-id]');
  const playlistButton = event.target.closest('button[data-action]');
  if (!playlistArticle || !playlistButton) return;

  const playlist = store.getState().playlists.find((item) => item.id === playlistArticle.dataset.playlistId);
  if (!playlist) return;

  if (playlistButton.dataset.action === 'load-playlist') {
    playlist.tracks.forEach((track) => store.enqueue(track));
    store.setFeedback(`Loaded ${playlist.name} into queue.`);
  }

  if (playlistButton.dataset.action === 'delete-playlist') {
    await api.deletePlaylist(playlist.id);
    await refreshPlaylists();
    store.setFeedback(`Deleted playlist ${playlist.name}.`);
  }
}

async function handlePlayerClick(event) {
  if (event.target.id === 'player-toggle-button') {
    const controller = await ensurePlayerController();
    if (playerIsPlaying) {
      await controller.pause();
      playerIsPlaying = false;
    } else {
      await controller.play();
      playerIsPlaying = true;
    }
  }

  const state = store.getState();
  if (event.target.id === 'player-favorite-button' && state.currentTrack) {
    store.toggleFavorite(state.currentTrack);
  }

  if (event.target.id === 'player-queue-button' && state.currentTrack) {
    store.enqueue(state.currentTrack);
  }
}

async function handlePlaylistSubmit(event) {
  event.preventDefault();
  const formData = new FormData(elements.playlistForm);
  const name = String(formData.get('name') || '').trim();
  if (!name) return;
  await api.createPlaylist(name, []);
  elements.playlistForm.reset();
  await refreshPlaylists();
  store.setFeedback(`Created playlist ${name}.`);
}

async function handleSaveQueuePlaylist() {
  const queue = store.getState().queue;
  if (!queue.length) {
    store.setFeedback('Queue is empty.');
    return;
  }
  const name = window.prompt('Playlist name', `Queue ${new Date().toLocaleString()}`);
  if (!name) return;
  await api.createPlaylist(name, queue);
  await refreshPlaylists();
  store.setFeedback(`Saved queue as ${name}.`);
}

function bindStaticEvents() {
  elements.searchForm.addEventListener('submit', handleSearchSubmit);
  elements.resultsContainer.addEventListener('click', (event) => {
    void handleResultsClick(event);
  });
  elements.queueContainer.addEventListener('click', (event) => {
    void handleQueueClick(event);
  });
  elements.libraryContainer.addEventListener('click', (event) => {
    void handleLibraryClick(event);
  });
  elements.playerShell.addEventListener('click', (event) => {
    void handlePlayerClick(event);
  });
  elements.nextTrackButton.addEventListener('click', () => {
    void playNextFromQueue();
  });
  elements.playlistForm.addEventListener('submit', (event) => {
    void handlePlaylistSubmit(event);
  });
  elements.saveQueuePlaylistButton.addEventListener('click', () => {
    void handleSaveQueuePlaylist();
  });
}

function render(state) {
  const nextTrackId = state.currentTrack?.spotifyId || '';
  const shouldRenderPlayer = nextTrackId !== renderedTrackId || !elements.playerShell.hasChildNodes();
  if (nextTrackId !== renderedTrackId) {
    playerController = null;
  }
  renderedTrackId = nextTrackId;
  elements.searchFeedback.textContent = state.feedback;
  renderSearchView(elements.resultsContainer, state);
  if (shouldRenderPlayer) renderPlayerShell(elements.playerShell, state);
  renderQueuePanel(elements.queueContainer, state);
  renderLibraryPanel(elements.libraryContainer, state);
}

async function bootstrap() {
  bindStaticEvents();
  store.subscribe(render);
  await refreshHealth();
  await refreshPlaylists();
  await loadFeaturedTracks();
}

void bootstrap();