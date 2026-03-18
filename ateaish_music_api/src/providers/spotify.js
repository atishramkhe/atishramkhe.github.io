const SEARCH_TTL_MS = 15 * 60 * 1000;
const TRACK_TTL_MS = 24 * 60 * 60 * 1000;

const DEMO_TRACKS = [
  {
    id: 'spotify:track:demo-blinding-lights',
    source: 'spotify',
    title: 'Blinding Lights',
    artists: ['The Weeknd'],
    album: 'After Hours',
    durationMs: 200040,
    image: 'https://i.scdn.co/image/ab67616d0000b2730d52b6f6e0f0d1b2d0f8f739',
    explicit: false,
    popularity: 92,
    spotifyId: 'demo-blinding-lights',
    youtubeVideoId: '4NRXx6U8ABQ',
    matchConfidence: 0.97
  },
  {
    id: 'spotify:track:demo-get-lucky',
    source: 'spotify',
    title: 'Get Lucky',
    artists: ['Daft Punk', 'Pharrell Williams', 'Nile Rodgers'],
    album: 'Random Access Memories',
    durationMs: 248413,
    image: 'https://i.scdn.co/image/ab67616d0000b273d6c4d0d6dcb2ce6505248f8f',
    explicit: false,
    popularity: 88,
    spotifyId: 'demo-get-lucky',
    youtubeVideoId: '5NV6Rdv1a3I',
    matchConfidence: 0.96
  },
  {
    id: 'spotify:track:demo-humble',
    source: 'spotify',
    title: 'HUMBLE.',
    artists: ['Kendrick Lamar'],
    album: 'DAMN.',
    durationMs: 177000,
    image: 'https://i.scdn.co/image/ab67616d0000b2730c2f8d7d2c8f4fba83e6e420',
    explicit: true,
    popularity: 86,
    spotifyId: 'demo-humble',
    youtubeVideoId: 'tvTRZJ-4EyI',
    matchConfidence: 0.95
  },
  {
    id: 'spotify:track:demo-bad-guy',
    source: 'spotify',
    title: 'bad guy',
    artists: ['Billie Eilish'],
    album: 'WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?',
    durationMs: 194088,
    image: 'https://i.scdn.co/image/ab67616d0000b27350a3147b4edd7701a876c6ce',
    explicit: false,
    popularity: 89,
    spotifyId: 'demo-bad-guy',
    youtubeVideoId: 'DyDfgMOUjCI',
    matchConfidence: 0.95
  },
  {
    id: 'spotify:track:demo-levitating',
    source: 'spotify',
    title: 'Levitating',
    artists: ['Dua Lipa'],
    album: 'Future Nostalgia',
    durationMs: 203064,
    image: 'https://i.scdn.co/image/ab67616d0000b273f46b9d202509a8f7384b90de',
    explicit: false,
    popularity: 90,
    spotifyId: 'demo-levitating',
    youtubeVideoId: 'TUVcZfQe-Kw',
    matchConfidence: 0.96
  },
  {
    id: 'spotify:track:demo-starboy',
    source: 'spotify',
    title: 'Starboy',
    artists: ['The Weeknd', 'Daft Punk'],
    album: 'Starboy',
    durationMs: 230453,
    image: 'https://i.scdn.co/image/ab67616d0000b2734718e2b124f79258be7bc452',
    explicit: true,
    popularity: 88,
    spotifyId: 'demo-starboy',
    youtubeVideoId: '34Na4j8AVgA',
    matchConfidence: 0.94
  }
];

function normalizeSpotifyTrack(track) {
  return {
    id: `spotify:track:${track.id}`,
    source: 'spotify',
    title: track.name,
    artists: Array.isArray(track.artists) ? track.artists.map((artist) => artist.name) : [],
    album: track.album?.name || '',
    durationMs: track.duration_ms || 0,
    image: track.album?.images?.[0]?.url || '',
    explicit: Boolean(track.explicit),
    popularity: Number(track.popularity || 0),
    spotifyId: track.id,
    youtubeVideoId: null,
    matchConfidence: null
  };
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function searchDemoTracks(query) {
  const needle = normalizeText(query);
  if (!needle) return [];
  return DEMO_TRACKS.filter((track) => {
    const haystack = normalizeText([track.title, track.album, ...track.artists].join(' '));
    return haystack.includes(needle);
  });
}

export class SpotifyProvider {
  constructor({ clientId, clientSecret, db, memoryCache }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.db = db;
    this.memoryCache = memoryCache;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  get status() {
    return this.clientId && this.clientSecret ? 'configured' : 'demo';
  }

  async getAccessToken() {
    if (!this.clientId || !this.clientSecret) return null;
    if (this.token && this.tokenExpiresAt > Date.now() + 5000) return this.token;

    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' })
    });

    if (!response.ok) {
      throw new Error(`Spotify token request failed with ${response.status}`);
    }

    const payload = await response.json();
    this.token = payload.access_token;
    this.tokenExpiresAt = Date.now() + Number(payload.expires_in || 3600) * 1000;
    return this.token;
  }

  async searchTracks(query) {
    const cacheKey = `spotify-search:${normalizeText(query)}`;
    const memoryResult = this.memoryCache.get(cacheKey);
    if (memoryResult) return memoryResult;

    const dbResult = this.db.getSearchCache(normalizeText(query));
    if (dbResult) {
      this.memoryCache.set(cacheKey, dbResult, SEARCH_TTL_MS);
      return dbResult;
    }

    let tracks = [];
    try {
      const token = await this.getAccessToken();
      if (token) {
        const url = new URL('https://api.spotify.com/v1/search');
        url.searchParams.set('q', query);
        url.searchParams.set('type', 'track');
        url.searchParams.set('limit', '12');
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        if (!response.ok) throw new Error(`Spotify search failed with ${response.status}`);
        const payload = await response.json();
        tracks = Array.isArray(payload?.tracks?.items) ? payload.tracks.items.map(normalizeSpotifyTrack) : [];
      }
    } catch (error) {
      console.warn('Spotify search failed, using demo fallback:', error.message);
    }

    if (!tracks.length) {
      tracks = searchDemoTracks(query);
    }

    tracks.forEach((track) => this.db.setTrackCache(track, TRACK_TTL_MS));
    this.db.setSearchCache(normalizeText(query), tracks, SEARCH_TTL_MS);
    this.memoryCache.set(cacheKey, tracks, SEARCH_TTL_MS);
    return tracks;
  }

  async getTrack(spotifyId) {
    const cached = this.db.getTrackCache(spotifyId);
    if (cached) return cached;

    const demoTrack = DEMO_TRACKS.find((track) => track.spotifyId === spotifyId) || null;
    if (demoTrack) {
      this.db.setTrackCache(demoTrack, TRACK_TTL_MS);
      return demoTrack;
    }

    const token = await this.getAccessToken();
    if (!token) return null;

    const response = await fetch(`https://api.spotify.com/v1/tracks/${encodeURIComponent(spotifyId)}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Spotify track request failed with ${response.status}`);
    }

    const payload = await response.json();
    const track = normalizeSpotifyTrack(payload);
    this.db.setTrackCache(track, TRACK_TTL_MS);
    return track;
  }
}

export { DEMO_TRACKS };