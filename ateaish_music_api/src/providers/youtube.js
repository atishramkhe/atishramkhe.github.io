function parseIsoDurationToMs(value) {
  const match = String(value || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!match) return 0;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return ((hours * 60 * 60) + (minutes * 60) + seconds) * 1000;
}

export class YouTubeProvider {
  constructor({ apiKey }) {
    this.apiKey = apiKey;
  }

  get status() {
    return this.apiKey ? 'configured' : 'limited';
  }

  async searchVideos(query, limit = 5) {
    if (!this.apiKey) return [];

    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('key', this.apiKey);
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('videoCategoryId', '10');
    searchUrl.searchParams.set('maxResults', String(limit));

    const searchResponse = await fetch(searchUrl);
    if (!searchResponse.ok) {
      throw new Error(`YouTube search failed with ${searchResponse.status}`);
    }

    const searchPayload = await searchResponse.json();
    const ids = (searchPayload.items || []).map((item) => item.id?.videoId).filter(Boolean);
    if (!ids.length) return [];

    const detailUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    detailUrl.searchParams.set('key', this.apiKey);
    detailUrl.searchParams.set('part', 'contentDetails,snippet');
    detailUrl.searchParams.set('id', ids.join(','));

    const detailResponse = await fetch(detailUrl);
    if (!detailResponse.ok) {
      throw new Error(`YouTube detail request failed with ${detailResponse.status}`);
    }

    const detailPayload = await detailResponse.json();
    return (detailPayload.items || []).map((item) => ({
      videoId: item.id,
      title: item.snippet?.title || '',
      channelTitle: item.snippet?.channelTitle || '',
      publishedAt: item.snippet?.publishedAt || null,
      durationMs: parseIsoDurationToMs(item.contentDetails?.duration)
    }));
  }

  getPlayableEmbed(videoId) {
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?enablejsapi=1&origin=${encodeURIComponent('http://localhost')}`;
  }
}