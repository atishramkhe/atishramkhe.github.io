import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function createDatabaseClient({ rootDir }) {
  const dataDir = path.join(rootDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'music.db');
  const db = new Database(dbPath);
  const schemaPath = path.join(rootDir, 'src', 'db', 'schema.sql');
  db.exec(fs.readFileSync(schemaPath, 'utf8'));

  const statements = {
    getSearchCache: db.prepare('SELECT payload, expires_at FROM search_cache WHERE query = ?'),
    setSearchCache: db.prepare(`
      INSERT INTO search_cache (query, payload, fetched_at, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(query) DO UPDATE SET
        payload = excluded.payload,
        fetched_at = excluded.fetched_at,
        expires_at = excluded.expires_at
    `),
    getTrackCache: db.prepare('SELECT payload, expires_at FROM track_cache WHERE spotify_id = ?'),
    setTrackCache: db.prepare(`
      INSERT INTO track_cache (spotify_id, payload, fetched_at, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(spotify_id) DO UPDATE SET
        payload = excluded.payload,
        fetched_at = excluded.fetched_at,
        expires_at = excluded.expires_at
    `),
    getMatch: db.prepare('SELECT payload, expires_at FROM video_matches WHERE spotify_id = ?'),
    setMatch: db.prepare(`
      INSERT INTO video_matches (
        spotify_id,
        youtube_video_id,
        matched_title,
        matched_channel,
        duration_ms,
        confidence,
        resolver,
        status,
        payload,
        last_validated_at,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(spotify_id) DO UPDATE SET
        youtube_video_id = excluded.youtube_video_id,
        matched_title = excluded.matched_title,
        matched_channel = excluded.matched_channel,
        duration_ms = excluded.duration_ms,
        confidence = excluded.confidence,
        resolver = excluded.resolver,
        status = excluded.status,
        payload = excluded.payload,
        last_validated_at = excluded.last_validated_at,
        expires_at = excluded.expires_at
    `),
    listPlaylists: db.prepare('SELECT id, name, tracks_json, created_at, updated_at FROM playlists ORDER BY updated_at DESC'),
    getPlaylist: db.prepare('SELECT id, name, tracks_json, created_at, updated_at FROM playlists WHERE id = ?'),
    insertPlaylist: db.prepare('INSERT INTO playlists (id, name, tracks_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'),
    updatePlaylist: db.prepare('UPDATE playlists SET name = ?, tracks_json = ?, updated_at = ? WHERE id = ?'),
    deletePlaylist: db.prepare('DELETE FROM playlists WHERE id = ?'),
    purgeExpiredSearchCache: db.prepare('DELETE FROM search_cache WHERE expires_at < ?'),
    purgeExpiredTrackCache: db.prepare('DELETE FROM track_cache WHERE expires_at < ?'),
    purgeExpiredMatches: db.prepare('DELETE FROM video_matches WHERE expires_at < ? AND status = ?')
  };

  function isFresh(row) {
    return row && Number(row.expires_at) > Date.now();
  }

  function toPlaylist(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      tracks: parseJson(row.tracks_json, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  return {
    purgeExpired() {
      const now = Date.now();
      statements.purgeExpiredSearchCache.run(now);
      statements.purgeExpiredTrackCache.run(now);
      statements.purgeExpiredMatches.run(now, 'rejected');
    },
    getSearchCache(query) {
      const row = statements.getSearchCache.get(query);
      return isFresh(row) ? parseJson(row.payload, []) : null;
    },
    setSearchCache(query, payload, ttlMs) {
      const now = Date.now();
      statements.setSearchCache.run(query, JSON.stringify(payload), now, now + ttlMs);
    },
    getTrackCache(spotifyId) {
      const row = statements.getTrackCache.get(spotifyId);
      return isFresh(row) ? parseJson(row.payload, null) : null;
    },
    setTrackCache(track, ttlMs) {
      const now = Date.now();
      statements.setTrackCache.run(track.spotifyId, JSON.stringify(track), now, now + ttlMs);
    },
    getMatch(spotifyId) {
      const row = statements.getMatch.get(spotifyId);
      return isFresh(row) ? parseJson(row.payload, null) : null;
    },
    setMatch(match, ttlMs) {
      const expiresAt = Date.now() + ttlMs;
      statements.setMatch.run(
        match.spotifyId,
        match.youtubeVideoId || null,
        match.matchedTitle || null,
        match.matchedChannel || null,
        match.durationMs || null,
        match.confidence || 0,
        match.resolver || null,
        match.status || 'unresolved',
        JSON.stringify(match),
        match.lastValidatedAt || null,
        expiresAt
      );
    },
    listPlaylists() {
      return statements.listPlaylists.all().map(toPlaylist);
    },
    createPlaylist({ id, name, tracks, createdAt, updatedAt }) {
      statements.insertPlaylist.run(id, name, JSON.stringify(tracks), createdAt, updatedAt);
      return this.getPlaylist(id);
    },
    getPlaylist(id) {
      return toPlaylist(statements.getPlaylist.get(id));
    },
    updatePlaylist(id, { name, tracks, updatedAt }) {
      const current = this.getPlaylist(id);
      if (!current) return null;
      const next = {
        id: current.id,
        name: typeof name === 'string' && name.trim() ? name.trim() : current.name,
        tracks: Array.isArray(tracks) ? tracks : current.tracks,
        createdAt: current.createdAt,
        updatedAt
      };
      statements.updatePlaylist.run(next.name, JSON.stringify(next.tracks), next.updatedAt, id);
      return this.getPlaylist(id);
    },
    deletePlaylist(id) {
      return statements.deletePlaylist.run(id);
    }
  };
}