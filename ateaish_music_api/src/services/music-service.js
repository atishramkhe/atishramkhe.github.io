import { randomUUID } from 'node:crypto';
import { matchTrackToVideo } from './matcher.js';
import { resolveQueueTracks } from './queue.js';

const MATCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class MusicService {
  constructor({ db, spotifyProvider, youtubeProvider, ytDlpProvider }) {
    this.db = db;
    this.spotifyProvider = spotifyProvider;
    this.youtubeProvider = youtubeProvider;
    this.ytDlpProvider = ytDlpProvider;
  }

  async search(query) {
    const items = await this.spotifyProvider.searchTracks(query);
    return items.map((item) => {
      const match = this.db.getMatch(item.spotifyId);
      return match
        ? { ...item, youtubeVideoId: match.youtubeVideoId, matchConfidence: match.confidence }
        : item;
    });
  }

  async getTrack(spotifyId) {
    return this.spotifyProvider.getTrack(spotifyId);
  }

  async resolveTrack(spotifyId) {
    const track = await this.getTrack(spotifyId);
    if (!track) return null;

    const cachedMatch = this.db.getMatch(spotifyId);
    if (cachedMatch && cachedMatch.status !== 'unresolved') {
      return {
        track: {
          ...track,
          youtubeVideoId: cachedMatch.youtubeVideoId,
          matchConfidence: cachedMatch.confidence
        },
        match: cachedMatch
      };
    }

    const match = await matchTrackToVideo(track, {
      youtubeProvider: this.youtubeProvider,
      ytDlpProvider: this.ytDlpProvider
    });
    this.db.setMatch(match, MATCH_TTL_MS);

    return {
      track: {
        ...track,
        youtubeVideoId: match.youtubeVideoId,
        matchConfidence: match.confidence
      },
      match
    };
  }

  async resolveQueue(spotifyIds) {
    return resolveQueueTracks(spotifyIds, async (spotifyId) => this.resolveTrack(spotifyId));
  }

  listPlaylists() {
    return this.db.listPlaylists();
  }

  createPlaylist({ name, tracks }) {
    const now = new Date().toISOString();
    return this.db.createPlaylist({
      id: `pl_${randomUUID().slice(0, 8)}`,
      name: String(name || '').trim() || 'Untitled Playlist',
      tracks: Array.isArray(tracks) ? tracks : [],
      createdAt: now,
      updatedAt: now
    });
  }

  updatePlaylist(id, { name, tracks }) {
    return this.db.updatePlaylist(id, {
      name,
      tracks,
      updatedAt: new Date().toISOString()
    });
  }

  deletePlaylist(id) {
    return this.db.deletePlaylist(id);
  }

  getStatus() {
    return {
      spotify: this.spotifyProvider.status,
      youtube: this.youtubeProvider.status,
      ytdlp: this.ytDlpProvider.status
    };
  }
}