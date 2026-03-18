# Ateaish Music Architecture

## Goal

Build `Ateaish Music` as a web app that:

- uses Spotify for search and metadata
- uses YouTube for playback availability
- supports a backend matching layer
- can optionally use `yt-dlp` as a non-primary resolver for stream inspection or fallback workflows

The clean separation is:

- Spotify = catalog truth
- YouTube = playable source
- Ateaish backend = matching, caching, queues, playlists, normalization

## Recommended Product Shape

`Ateaish Music` should behave like a metadata-first music player, not a raw downloader.

User flow:

1. User searches for a track, artist, or album.
2. Backend queries Spotify and returns normalized metadata.
3. Backend finds or reuses a matched YouTube video.
4. Frontend plays the matched YouTube source.
5. Local app state stores queue, favorites, recents, and playlists.

## Provider Responsibilities

### Spotify API

Use Spotify for:

- track metadata
- artist metadata
- album metadata
- cover art
- durations
- popularity and preview attributes when available
- recommendations or related-track seeding

Do not rely on Spotify for general playback unless you are building strictly within Spotify's platform constraints.

### YouTube

Use YouTube for:

- locating playable versions of songs
- rendering playback in the frontend via the official player
- returning video metadata for matching confidence

Prefer:

- YouTube Data API for search metadata
- YouTube IFrame Player API for playback

### yt-dlp Backend

Treat `yt-dlp` as an optional backend capability, not the primary app contract.

Use it only for tasks like:

- validating that a candidate video still resolves
- extracting richer media details for internal ranking
- fallback matching when YouTube API quota is constrained

Avoid designing the frontend around direct media URLs from `yt-dlp`. That will be brittle and harder to maintain.

## System Architecture

### Frontend

Recommended route:

- `music/index.html`
- `music/styles.css`
- `music/app.js`

Frontend responsibilities:

- search UI
- playback controls
- queue management
- playlist management
- recent history
- favorite tracks
- optimistic rendering using cached matches

Frontend modules:

- `ui/search.js`
- `ui/player.js`
- `ui/queue.js`
- `ui/library.js`
- `services/api.js`
- `state/store.js`

### Backend

Recommended as a separate service, not GitHub Pages-only.

Preferred stack:

- Node.js with Express or Fastify

Alternative:

- Python FastAPI if you want tighter control over `yt-dlp` integration

Backend responsibilities:

- Spotify token management
- Spotify search proxy
- YouTube search proxy
- track-to-video matching
- cache storage
- playlist persistence
- optional user auth later
- rate limiting and retry logic

### Storage

Start simple:

- SQLite for MVP

Scale path:

- Postgres if multi-user sync becomes important

Cache layers:

- in-memory LRU cache for hot search requests
- SQLite/Postgres for durable track mappings

## Core Data Model

### Normalized Track

```json
{
  "id": "spotify:track:abc123",
  "source": "spotify",
  "title": "Blinding Lights",
  "artists": ["The Weeknd"],
  "album": "After Hours",
  "durationMs": 200040,
  "image": "https://...",
  "explicit": false,
  "popularity": 92,
  "spotifyId": "abc123",
  "youtubeVideoId": "fHI8X4OXluQ",
  "matchConfidence": 0.94
}
```

### Video Match

```json
{
  "spotifyId": "abc123",
  "youtubeVideoId": "fHI8X4OXluQ",
  "matchedTitle": "The Weeknd - Blinding Lights (Official Audio)",
  "matchedChannel": "The Weeknd",
  "durationMs": 200000,
  "confidence": 0.94,
  "resolver": "youtube-data-api",
  "lastValidatedAt": "2026-03-18T10:00:00Z"
}
```

### Playlist

```json
{
  "id": "pl_001",
  "name": "Late Night",
  "tracks": ["spotify:track:abc123", "spotify:track:def456"],
  "createdAt": "2026-03-18T10:00:00Z",
  "updatedAt": "2026-03-18T10:00:00Z"
}
```

## API Design

### Search

`GET /api/music/search?q=blinding+lights`

Returns:

- Spotify-normalized tracks
- cached YouTube match if available

### Resolve Track

`GET /api/music/resolve/:spotifyId`

Flow:

1. Look up cached mapping.
2. If missing or stale, run YouTube matching.
3. Persist best candidate.
4. Return playable metadata.

### Queue Metadata

`POST /api/music/queue/resolve`

Request body:

```json
{
  "spotifyIds": ["abc123", "def456"]
}
```

Use this to pre-resolve an entire queue before playback reaches the next track.

### Playlists

- `GET /api/music/playlists`
- `POST /api/music/playlists`
- `PATCH /api/music/playlists/:id`
- `DELETE /api/music/playlists/:id`

## Matching Pipeline

This is the critical backend logic.

### Input

- Spotify title
- primary artist
- featured artists
- album name
- duration

### Search Query Construction

Generate ranked query variants:

1. `artist title official audio`
2. `artist title`
3. `artist title topic`
4. `artist title album`

### Candidate Collection

From YouTube, collect top 5 to 10 candidates with:

- title
- channel
- duration
- publish date
- video id

### Scoring

Suggested score formula:

$$
score = titleSimilarity * 0.45 + artistSimilarity * 0.30 + durationSimilarity * 0.20 + channelTrust * 0.05
$$

Apply penalties for noisy variants:

- `live`
- `lyrics`
- `slowed`
- `sped up`
- `nightcore`
- `remix`
- `cover`
- `reaction`

Duration similarity can be computed as:

$$
durationSimilarity = max(0, 1 - |spotifyDuration - youtubeDuration| / 12000)
$$

That gives strong penalties for candidates off by more than about 12 seconds.

### Acceptance Rules

- accept automatically if confidence is `>= 0.90`
- mark as `needs_review` if confidence is between `0.75` and `0.89`
- reject below `0.75`

### Background Repair Job

Run a scheduled task that:

- revalidates stale mappings
- repairs removed videos
- upgrades low-confidence matches when better candidates appear

## Playback Strategy

### MVP Playback

Use YouTube IFrame Player API.

Benefits:

- stable embed model
- lower maintenance
- works in browser without handing raw media URLs to the client

### Optional Enhanced Resolver Layer

If you want backend-assisted validation, use `yt-dlp` to inspect video metadata server-side.

Recommended boundary:

- backend receives `youtubeVideoId`
- backend validates metadata via `yt-dlp` only when needed
- frontend still plays through the official player path

## Authentication Model

### MVP

- no user accounts
- localStorage for favorites, recents, queue snapshots
- backend anonymous access with rate limiting

### Later

- GitHub login or email magic link
- server-side playlists
- synced history across devices

## Suggested Folder Layout

Inside this repo:

```text
music/
  index.html
  styles.css
  app.js
  components/
    search-view.js
    player-shell.js
    queue-panel.js
    library-panel.js
  services/
    music-api.js
    youtube-player.js
  state/
    store.js
  assets/
```

Backend as separate app:

```text
ateaish_music_api/
  src/
    server.ts
    routes/
      search.ts
      resolve.ts
      playlists.ts
    providers/
      spotify.ts
      youtube.ts
      ytdlp.ts
    services/
      matcher.ts
      cache.ts
      queue.ts
    db/
      schema.sql
      client.ts
```

## Recommended Provider Interfaces

Define provider adapters so you can swap implementations without rewriting the app.

### Spotify Provider

Methods:

- `searchTracks(query)`
- `getTrack(spotifyId)`
- `getRecommendations(seedTrackIds)`

### YouTube Provider

Methods:

- `searchVideos(query)`
- `getVideo(videoId)`
- `getPlayableEmbed(videoId)`

### Resolver Provider

Methods:

- `inspectVideo(videoId)`
- `validateMapping(spotifyId, videoId)`

This keeps `yt-dlp`, YouTube Data API, and fallback sources isolated behind stable contracts.

## Caching Strategy

Cache these separately:

- search results by query string
- Spotify track details by `spotifyId`
- resolved YouTube matches by `spotifyId`
- video validation status by `youtubeVideoId`

Suggested TTLs:

- search cache: 15 minutes
- track metadata: 24 hours
- video match: 7 days
- failed match attempts: 6 hours

## Failure Handling

### Spotify Failure

- return cached results if available
- otherwise show degraded search state

### YouTube Failure

- keep metadata visible
- mark track as temporarily unplayable
- allow retry or alternate candidate selection

### yt-dlp Failure

- do not block main playback if official YouTube embed still works
- log validation error and continue

## Implementation Phases

### Phase 1: Architecture MVP

- build `music/index.html` UI shell
- add search input and results list
- connect backend search endpoint
- display Spotify metadata only

### Phase 2: Playback

- integrate YouTube player shell
- add queue and next-track playback
- resolve track-to-video mapping on demand

### Phase 3: Persistence

- favorites
- recents
- playlists
- cached resolved tracks

### Phase 4: Quality

- improve matching score
- add background repair jobs
- add stale mapping revalidation

### Phase 5: Accounts

- user sync
- cross-device library
- private playlists

## Recommended MVP Decision

If the goal is to ship quickly, build this exact version first:

- Spotify metadata search
- backend resolve endpoint
- YouTube embed playback
- local favorites and playlists
- SQLite mapping cache

Do not start with:

- advanced auth
- direct media extraction
- multi-provider audio pipelines
- heavy recommendation systems

## Practical Verdict

Yes, you can combine YouTube, Spotify API, and a `yt-dlp`-assisted backend.

The durable architecture is:

- Spotify as metadata authority
- YouTube as playback source
- Ateaish backend as resolver and cache
- `yt-dlp` as an optional internal utility layer, not the public playback contract

That gives you a system that is simpler to ship, easier to maintain, and less likely to break when a provider changes behavior.

## Built MVP

The repo now includes:

- `music/index.html` static frontend shell
- `music/styles.css` custom UI styling
- `music/app.js` frontend controller
- `music/components/*` modular UI renderers
- `music/services/music-api.js` frontend API client
- `music/services/youtube-player.js` YouTube IFrame player integration
- `music/state/store.js` local queue, favorites, and recents state
- `ateaish_music_api/` separate Node backend

Implemented backend capabilities:

- Spotify metadata search through client credentials when configured
- demo catalog fallback when Spotify credentials are missing
- YouTube Data API search and match scoring when configured
- optional `yt-dlp` inspection hook for server-side validation
- SQLite persistence for search cache, track cache, video matches, and playlists
- queue pre-resolution endpoint
- playlist CRUD endpoints

## GitHub Pages Mode

The app now also runs without a backend, which is the mode you should use on `github.io`.

In GitHub Pages mode:

- the frontend loads a curated static catalog from `music/assets/catalog.json`
- search runs entirely in the browser
- playback uses the YouTube IFrame player with curated video ids
- playlists are stored in browser localStorage
- favorites, recents, and queue remain local-first

This avoids exposing Spotify or YouTube server credentials in a static deployment.

### Practical Constraint

Pure GitHub Pages cannot safely hold Spotify client credentials or a YouTube Data API key for backend-style matching.

Because of that, the GitHub Pages build is intentionally:

- static catalog first
- YouTube embed playback only
- localStorage persistence only
- optional backend later if you want live resolver features

## Quick Start

### 1. Install backend dependencies

From the repo root:

```bash
cd ateaish_music_api
npm install
```

### 2. Configure environment

Copy the example file and fill in the providers you want active:

```bash
cp .env.example .env
```

Environment variables:

- `PORT`: backend port, defaults to `8787`
- `SPOTIFY_CLIENT_ID`: Spotify app client id
- `SPOTIFY_CLIENT_SECRET`: Spotify app client secret
- `YOUTUBE_API_KEY`: YouTube Data API key
- `YTDLP_ENABLED`: set to `1` to enable optional inspection
- `YTDLP_PATH`: optional custom `yt-dlp` binary path
- `FRONTEND_ORIGIN`: allowed browser origin for CORS

### 3. Start backend

From the repo root:

```bash
npm run music:api:start
```

For watch mode during development:

```bash
npm run music:api
```

### 4. Open the frontend

Open `music/index.html` through a local web server so module imports work cleanly.

Examples:

```bash
python -m http.server 5500
```

Then open:

- `http://127.0.0.1:5500/music/`

If you are deploying on GitHub Pages, leave the `Optional API base` field blank.

For a GitHub Pages deployment, the frontend works directly as a static app.

## Current Behavior

### Search

- with Spotify credentials: live metadata search through Spotify
- without Spotify credentials: demo track catalog fallback so the app remains usable
- on GitHub Pages with no backend: curated static catalog search in the browser

### Playback resolution

- with YouTube API key: YouTube candidates are scored against Spotify metadata
- without YouTube API key: demo tracks with known mappings still play, other tracks remain unresolved

### Persistence

- queue, favorites, and recents are stored in browser localStorage
- playlists and match cache are stored in backend SQLite
- in GitHub Pages mode, playlists are also stored in browser localStorage

## API Endpoints

- `GET /health`
- `GET /api/music/search?q=...`
- `GET /api/music/resolve/:spotifyId`
- `POST /api/music/queue/resolve`
- `GET /api/music/playlists`
- `POST /api/music/playlists`
- `PATCH /api/music/playlists/:id`
- `DELETE /api/music/playlists/:id`

## Practical Notes

- The frontend is intentionally metadata-first. It does not request raw media URLs.
- The backend accepts partial provider configuration and degrades instead of crashing.
- The YouTube embed is driven through the official IFrame player.
- The matching formula and acceptance thresholds follow the design in this document, but can still be tuned with more real-world usage.
- The GitHub Pages build is intentionally static-first because a secret-bearing resolver cannot live securely on `github.io`.