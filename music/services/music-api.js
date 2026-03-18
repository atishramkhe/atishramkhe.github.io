import { STATIC_CATALOG } from '../assets/catalog.js';

const PLAYLIST_STORAGE_KEY = 'ateaish_music_playlists';

function isRecoverableBackendError(error) {
  const message = String(error?.message || '');
  return error instanceof TypeError || /failed to fetch|networkerror|load failed|err_connection_refused/i.test(message);
}

function buildUrl(baseUrl, pathname) {
  return `${baseUrl.replace(/\/+$/, '')}${pathname}`;
}

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
  constructor(getBaseUrl) {
    this.getBaseUrl = getBaseUrl;
    this.catalogPromise = null;
  }

  usingBackend() {
    return Boolean(this.getBaseUrl());
  }

  async request(pathname, options = {}) {
    const response = await fetch(buildUrl(this.getBaseUrl(), pathname), {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...options
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Request failed with ${response.status}`);
    }
    if (response.status === 204) return null;
    return response.json();
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
    if (this.usingBackend()) {
      return this.request('/health');
    }
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
    if (this.usingBackend()) {
      try {
        return await this.request(`/api/music/search?q=${encodeURIComponent(query)}`);
      } catch (error) {
        if (!isRecoverableBackendError(error)) throw error;
      }
    }

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
    if (this.usingBackend()) {
      try {
        return await this.request(`/api/music/resolve/${encodeURIComponent(spotifyId)}`);
      } catch (error) {
        if (!isRecoverableBackendError(error)) throw error;
      }
    }

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
    if (this.usingBackend()) {
      try {
        return await this.request('/api/music/queue/resolve', {
          method: 'POST',
          body: JSON.stringify({ spotifyIds })
        });
      } catch (error) {
        if (!isRecoverableBackendError(error)) throw error;
      }
    }

    const items = await Promise.all((spotifyIds || []).map((spotifyId) => this.resolve(spotifyId)));
    return { items };
  }

  async getPlaylists() {
    if (this.usingBackend()) {
      try {
        return await this.request('/api/music/playlists');
      } catch (error) {
        if (!isRecoverableBackendError(error)) throw error;
      }
    }
    return { items: this.getLocalPlaylists() };
  }

  async createPlaylist(name, tracks = []) {
    if (this.usingBackend()) {
      try {
        return await this.request('/api/music/playlists', {
          method: 'POST',
          body: JSON.stringify({ name, tracks })
        });
      } catch (error) {
        if (!isRecoverableBackendError(error)) throw error;
      }
    }

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
    if (this.usingBackend()) {
      try {
        return await this.request(`/api/music/playlists/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
      } catch (error) {
        if (!isRecoverableBackendError(error)) throw error;
      }
    }

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
    if (this.usingBackend()) {
      try {
        return await this.request(`/api/music/playlists/${encodeURIComponent(id)}`, {
          method: 'DELETE'
        });
      } catch (error) {
        if (!isRecoverableBackendError(error)) throw error;
      }
    }

    const playlists = this.getLocalPlaylists().filter((item) => item.id !== id);
    this.saveLocalPlaylists(playlists);
    return null;
  }
}