import { STATIC_CATALOG } from '../assets/catalog.js';

const PLAYLIST_STORAGE_KEY = 'ateaish_music_playlists';

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function readJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
}

export class MusicApi {
  constructor() {
    this.catalogPromise = null;
  }

  async loadCatalog() {
    if (!this.catalogPromise) {
      this.catalogPromise = Promise.resolve(STATIC_CATALOG);
    }
    return this.catalogPromise;
  }

  getLocalPlaylists() {
    return readJson(PLAYLIST_STORAGE_KEY, []);
  }

  saveLocalPlaylists(playlists) {
    writeJson(PLAYLIST_STORAGE_KEY, playlists);
  }

  async health() {
    return {
      ok: true,
      providers: {
        catalog: 'curated-static',
        playback: 'youtube-embed',
        storage: 'local-storage'
      }
    };
  }

  async featured() {
    const items = await this.loadCatalog();
    return {
      items,
      providers: {
        catalog: 'curated-static',
        playback: 'youtube-embed',
        storage: 'local-storage'
      }
    };
  }

  async search(query) {
    const items = await this.loadCatalog();
    const needle = normalizeText(query);
    const filtered = items.filter((track) => normalizeText([track.title, track.album, ...(track.artists || [])].join(' ')).includes(needle));
    return {
      items: filtered,
      providers: {
        catalog: 'curated-static',
        playback: 'youtube-embed',
        storage: 'local-storage'
      }
    };
  }

  async resolve(spotifyId) {
    const items = await this.loadCatalog();
    const track = items.find((item) => item.spotifyId === spotifyId);
    if (!track) {
      throw new Error('Track not found in static catalog.');
    }

    return {
      track,
      match: {
        spotifyId: track.spotifyId,
        youtubeVideoId: track.youtubeVideoId || null,
        matchedTitle: `${track.artists?.[0] || ''} - ${track.title}`.trim(),
        matchedChannel: track.artists?.[0] || '',
        durationMs: track.durationMs,
        confidence: Number(track.matchConfidence || 0.95),
        resolver: 'curated-static',
        status: track.youtubeVideoId ? 'accepted' : 'unresolved',
        lastValidatedAt: new Date().toISOString()
      }
    };
  }

  async resolveQueue(spotifyIds) {
    const items = await Promise.all((spotifyIds || []).map((spotifyId) => this.resolve(spotifyId)));
    return { items };
  }

  async getPlaylists() {
    return { items: this.getLocalPlaylists() };
  }

  async createPlaylist(name, tracks = []) {
    const playlists = this.getLocalPlaylists();
    const now = new Date().toISOString();
    const playlist = {
      id: `pl_${Math.random().toString(36).slice(2, 10)}`,
      name: String(name || '').trim() || 'Untitled Playlist',
      tracks: Array.isArray(tracks) ? tracks : [],
      createdAt: now,
      updatedAt: now
    };
    playlists.unshift(playlist);
    this.saveLocalPlaylists(playlists);
    return playlist;
  }

  async updatePlaylist(id, payload) {
    const playlists = this.getLocalPlaylists();
    const index = playlists.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('Playlist not found.');
    const next = {
      ...playlists[index],
      ...payload,
      updatedAt: new Date().toISOString()
    };
    playlists[index] = next;
    this.saveLocalPlaylists(playlists);
    return next;
  }

  async deletePlaylist(id) {
    const playlists = this.getLocalPlaylists().filter((item) => item.id !== id);
    this.saveLocalPlaylists(playlists);
    return null;
  }
}