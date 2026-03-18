const STORAGE_KEYS = {
  queue: 'ateaish_music_queue',
  favorites: 'ateaish_music_favorites',
  recents: 'ateaish_music_recents'
};

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

function dedupeTracks(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(item?.spotifyId || item?.id || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createStore() {
  const listeners = new Set();
  let state = {
    feedback: 'Search the catalog or start with featured tracks.',
    results: [],
    queue: readJson(STORAGE_KEYS.queue, []),
    favorites: readJson(STORAGE_KEYS.favorites, []),
    recents: readJson(STORAGE_KEYS.recents, []),
    playlists: [],
    currentTrack: null,
    currentMatch: null,
    isPlaying: false
  };

  function emit() {
    listeners.forEach((listener) => listener(state));
  }

  function setState(patch) {
    state = { ...state, ...patch };
    writeJson(STORAGE_KEYS.queue, state.queue);
    writeJson(STORAGE_KEYS.favorites, state.favorites);
    writeJson(STORAGE_KEYS.recents, state.recents);
    emit();
  }

  return {
    getState() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    setFeedback(feedback) {
      setState({ feedback });
    },
    setResults(results) {
      setState({ results });
    },
    setPlaylists(playlists) {
      setState({ playlists });
    },
    setCurrent(track, match) {
      setState({ currentTrack: track, currentMatch: match, isPlaying: Boolean(match?.youtubeVideoId) });
    },
    setPlaying(isPlaying) {
      setState({ isPlaying });
    },
    enqueue(track) {
      setState({ queue: [...state.queue, track] });
    },
    dequeue(spotifyId) {
      setState({ queue: state.queue.filter((item) => item.spotifyId !== spotifyId) });
    },
    shiftQueue() {
      const [next, ...rest] = state.queue;
      setState({ queue: rest });
      return next || null;
    },
    toggleFavorite(track) {
      const exists = state.favorites.some((item) => item.spotifyId === track.spotifyId);
      setState({
        favorites: exists
          ? state.favorites.filter((item) => item.spotifyId !== track.spotifyId)
          : dedupeTracks([track, ...state.favorites]).slice(0, 50)
      });
    },
    addRecent(track) {
      setState({ recents: dedupeTracks([track, ...state.recents]).slice(0, 20) });
    }
  };
}