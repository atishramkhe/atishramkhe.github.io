const NOISY_TERMS = ['live', 'lyrics', 'slowed', 'sped up', 'nightcore', 'remix', 'cover', 'reaction'];

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeText(value).split(' ').filter(Boolean);
}

function similarity(a, b) {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (!aTokens.size || !bTokens.size) return 0;
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(aTokens.size, bTokens.size);
}

function durationSimilarity(trackDurationMs, videoDurationMs) {
  if (!trackDurationMs || !videoDurationMs) return 0;
  return Math.max(0, 1 - Math.abs(trackDurationMs - videoDurationMs) / 12000);
}

function channelTrust(track, candidate) {
  const artistText = normalizeText(track.artists?.[0] || '');
  const channelText = normalizeText(candidate.channelTitle || '');
  if (!artistText || !channelText) return 0;
  if (channelText.includes(artistText)) return 1;
  if (channelText.includes('topic') || channelText.includes('vevo')) return 0.8;
  return 0.3;
}

function noisyPenalty(candidateTitle) {
  const title = normalizeText(candidateTitle);
  return NOISY_TERMS.reduce((penalty, term) => (title.includes(term) ? penalty + 0.08 : penalty), 0);
}

export function buildQueryVariants(track) {
  const artist = track.artists?.[0] || '';
  const title = track.title || '';
  const album = track.album || '';
  return [
    `${artist} ${title} official audio`,
    `${artist} ${title}`,
    `${artist} ${title} topic`,
    `${artist} ${title} ${album}`
  ].map((value) => value.trim()).filter(Boolean);
}

export function scoreCandidate(track, candidate) {
  const titleScore = similarity(`${track.title} ${track.album}`, candidate.title);
  const artistScore = Math.max(...(track.artists || []).map((artist) => similarity(artist, `${candidate.title} ${candidate.channelTitle}`)), 0);
  const timingScore = durationSimilarity(track.durationMs, candidate.durationMs);
  const trustScore = channelTrust(track, candidate);
  const penalty = noisyPenalty(candidate.title);
  const score = titleScore * 0.45 + artistScore * 0.3 + timingScore * 0.2 + trustScore * 0.05 - penalty;
  return Math.max(0, Math.min(1, score));
}

function classifyScore(confidence) {
  if (confidence >= 0.9) return 'accepted';
  if (confidence >= 0.75) return 'needs_review';
  return 'rejected';
}

export async function matchTrackToVideo(track, { youtubeProvider, ytDlpProvider }) {
  if (track.youtubeVideoId) {
    return {
      spotifyId: track.spotifyId,
      youtubeVideoId: track.youtubeVideoId,
      matchedTitle: `${track.artists?.[0] || ''} - ${track.title}`.trim(),
      matchedChannel: track.artists?.[0] || '',
      durationMs: track.durationMs,
      confidence: Number(track.matchConfidence || 0.92),
      resolver: 'demo-catalog',
      status: classifyScore(Number(track.matchConfidence || 0.92)),
      lastValidatedAt: new Date().toISOString()
    };
  }

  const queries = buildQueryVariants(track);
  const seen = new Set();
  const candidates = [];
  for (const query of queries) {
    const results = await youtubeProvider.searchVideos(query, 5);
    for (const candidate of results) {
      if (!candidate.videoId || seen.has(candidate.videoId)) continue;
      seen.add(candidate.videoId);
      candidates.push(candidate);
    }
  }

  if (!candidates.length) {
    return {
      spotifyId: track.spotifyId,
      youtubeVideoId: null,
      matchedTitle: null,
      matchedChannel: null,
      durationMs: null,
      confidence: 0,
      resolver: 'youtube-data-api',
      status: 'unresolved',
      lastValidatedAt: new Date().toISOString()
    };
  }

  const scored = candidates
    .map((candidate) => ({ candidate, confidence: scoreCandidate(track, candidate) }))
    .sort((left, right) => right.confidence - left.confidence);
  const best = scored[0];
  const inspection = await ytDlpProvider.inspectVideo(best.candidate.videoId);

  return {
    spotifyId: track.spotifyId,
    youtubeVideoId: best.candidate.videoId,
    matchedTitle: inspection?.title || best.candidate.title,
    matchedChannel: inspection?.uploader || best.candidate.channelTitle,
    durationMs: inspection?.durationMs || best.candidate.durationMs,
    confidence: best.confidence,
    resolver: inspection ? 'youtube-data-api+yt-dlp' : 'youtube-data-api',
    status: classifyScore(best.confidence),
    lastValidatedAt: new Date().toISOString()
  };
}