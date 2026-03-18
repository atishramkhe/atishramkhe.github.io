CREATE TABLE IF NOT EXISTS search_cache (
  query TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS track_cache (
  spotify_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS video_matches (
  spotify_id TEXT PRIMARY KEY,
  youtube_video_id TEXT,
  matched_title TEXT,
  matched_channel TEXT,
  duration_ms INTEGER,
  confidence REAL,
  resolver TEXT,
  status TEXT,
  payload TEXT NOT NULL,
  last_validated_at TEXT,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tracks_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);