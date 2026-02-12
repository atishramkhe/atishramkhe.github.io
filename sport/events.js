/**
 * Events Module - Handles Streamed.pk Matches API integration
 * Fetches live events and manages event selection and streaming
 */

class EventsManager {
  constructor(channelListSelector = '#channel-list') {
    this.apiBase = 'https://streamed.pk/api';
    this.originBase = 'https://streamed.pk';
    this.ppvApiBase = 'https://old.ppv.to/api';
    this.channelListSelector = channelListSelector;
    this.currentMatches = [];
    this.selectedMatch = null;
    this.selectedStream = null;
    this.selectedSourceKey = null;
    this.lastEndpoint = 'live';
    this.refreshIntervalMs = 5 * 60 * 1000;
    this.refreshTimer = null;
    this.pastEventCutoffMs = 2 * 60 * 60 * 1000;
    this.serverIndicatorsEl = document.getElementById('server-indicators');
  }

  /**
   * Fetch matches from the Streamed.pk API
   * @param {string} endpoint - API endpoint (e.g., 'live', 'all', 'all-today')
   */
  async fetchMatches(endpoint = 'live') {
    try {
      this.lastEndpoint = endpoint;
      const streamedUrl = `${this.apiBase}/matches/${endpoint}`;
      const ppvUrl = `${this.ppvApiBase}/streams`;
      console.log(`Fetching events from: ${streamedUrl}`);
      console.log(`Fetching events from: ${ppvUrl}`);

      const [streamedResult, ppvResult] = await Promise.allSettled([
        fetch(streamedUrl),
        fetch(ppvUrl)
      ]);

      const streamedMatches = await this.parseStreamedMatches(streamedResult);
      const ppvMatches = await this.parsePpvMatches(ppvResult);

      const combined = [...streamedMatches, ...ppvMatches];
      console.log(`Fetched ${combined.length} events (combined)`);

      const filtered = this.filterMatches(combined);
      this.currentMatches = filtered;
      this.displayMatches(filtered);
      return filtered;
    } catch (error) {
      console.error('Error fetching matches:', error);
      this.showError(`Failed to load events: ${error.message}`);
      return [];
    }
  }

  async parseStreamedMatches(result) {
    if (!result || result.status !== 'fulfilled') return [];
    const response = result.value;
    if (!response || !response.ok) return [];
    try {
      const data = await response.json();
      if (!Array.isArray(data)) return [];
      return data.map(match => ({ ...match, _provider: 'streamed' }));
    } catch (error) {
      console.warn('Failed to parse streamed matches', error);
      return [];
    }
  }

  async parsePpvMatches(result) {
    if (!result || result.status !== 'fulfilled') return [];
    const response = result.value;
    if (!response || !response.ok) return [];
    try {
      const data = await response.json();
      if (!data || !Array.isArray(data.streams)) return [];
      const matches = [];
      data.streams.forEach(category => {
        const categoryName = category?.category || category?.category_name;
        const streams = Array.isArray(category?.streams) ? category.streams : [];
        streams.forEach(stream => {
          matches.push({
            id: `ppv_${stream.id}`,
            title: stream.name,
            category: stream.category_name || categoryName || 'ppv',
            date: stream.starts_at ? stream.starts_at * 1000 : null,
            poster: stream.poster,
            popular: false,
            sources: [
              {
                source: 'ppv',
                id: stream.id,
                iframe: stream.iframe,
                uri_name: stream.uri_name
              }
            ],
            _provider: 'ppv',
            _ppv: stream
          });
        });
      });
      return matches;
    } catch (error) {
      console.warn('Failed to parse PPV streams', error);
      return [];
    }
  }

  filterMatches(matches) {
    const now = Date.now();
    const windowEnd = now + (20 * 60 * 60 * 1000);
    return (matches || [])
      .filter(match => this.hasPlayableSource(match))
      .filter(match => !this.isAlwaysLive(match))
      .filter(match => {
        const dateMs = this.normalizeDateMs(match.date);
        if (!dateMs) return false;
        return dateMs >= (now - this.pastEventCutoffMs) && dateMs <= windowEnd;
      })
      .sort((a, b) => (this.normalizeDateMs(a.date) || 0) - (this.normalizeDateMs(b.date) || 0));
  }

  hasPlayableSource(match) {
    if (!match || !Array.isArray(match.sources) || match.sources.length === 0) return false;
    return match.sources.some(source => {
      if (source.source === 'ppv') {
        return Boolean(source.iframe);
      }
      return Boolean(source.source && source.id);
    });
  }

  isAlwaysLive(match) {
    if (!match) return false;
    if (match._provider === 'ppv' && match._ppv) {
      return match._ppv.always_live === 1;
    }
    return false;
  }

  /**
   * Display matches as channel items in the channel list
   * @param {Array} matches - Array of match objects from the API
   */
  displayMatches(matches) {
    const channelList = document.querySelector(this.channelListSelector);
    if (!channelList) return;

    this.clearErrorBanner();

    channelList.innerHTML = '';

    if (matches.length === 0) {
      channelList.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #999; padding: 20px;">No events available</div>';
      return;
    }

    matches.forEach((match, index) => {
      const channelItem = this.createEventItem(match, index);
      channelList.appendChild(channelItem);
    });
  }

  /**
   * Create a channel item element for an event
   * @param {Object} match - Match object from the API
   * @param {number} index - Match index
   */
  createEventItem(match, index) {
    const item = document.createElement('div');
    item.className = 'channel-item event-item';
    item.style.cursor = 'pointer';
    item.setAttribute('data-match-index', index);
    item.setAttribute('data-match-id', match.id);

    // Create poster container
    const posterContainer = document.createElement('div');
    posterContainer.style.width = '100%';
    posterContainer.style.height = '80px';
    posterContainer.style.marginBottom = '8px';
    posterContainer.style.borderRadius = '4px';
    posterContainer.style.overflow = 'hidden';
    posterContainer.style.backgroundColor = '#1a1a1a';
    posterContainer.style.display = 'flex';
    posterContainer.style.alignItems = 'center';
    posterContainer.style.justifyContent = 'center';

    // Add poster image if available
    const posterUrl = this.getPosterUrl(match);
    if (posterUrl) {
      const posterImg = document.createElement('img');
      posterImg.src = posterUrl;
      posterImg.alt = match.title;
      posterImg.style.width = '100%';
      posterImg.style.height = '100%';
      posterImg.style.objectFit = 'cover';
      posterImg.style.borderRadius = '4px';
      posterImg.onerror = () => {
        const fallbackUrl = this.getPosterFallbackUrl(match);
        if (fallbackUrl && posterImg.dataset.fallback !== '1') {
          posterImg.dataset.fallback = '1';
          posterImg.src = fallbackUrl;
          return;
        }
        posterContainer.style.backgroundColor = '#0a0a0a';
        posterImg.style.display = 'none';
        const badges = this.createBadgesContainer(match);
        if (badges) posterContainer.appendChild(badges);
      };
      posterContainer.appendChild(posterImg);
    } else {
      const badges = this.createBadgesContainer(match);
      if (badges) posterContainer.appendChild(badges);
    }

    item.appendChild(posterContainer);

    // Add title
    const title = document.createElement('div');
    title.style.fontSize = '0.85em';
    title.style.fontWeight = '500';
    title.style.marginBottom = '4px';
    title.style.color = '#fff';
    title.style.textAlign = 'center';
    title.textContent = match.title;
    item.appendChild(title);

    // Add sport/category label
    if (match.category) {
      const category = document.createElement('div');
      category.style.fontSize = '0.7em';
      category.style.color = '#66c8f3';
      category.style.textTransform = 'uppercase';
      category.style.letterSpacing = '0.4px';
      item.style.position = 'relative';

      if (this.isLiveMatch(match)) {
        const liveBadge = document.createElement('div');
        liveBadge.className = 'event-live-badge';
        liveBadge.textContent = 'LIVE';
        item.appendChild(liveBadge);
      }
      category.style.marginBottom = '4px';
      category.textContent = match.category;
      item.appendChild(category);
    }

    // Add date/time
    const dateInfo = document.createElement('div');
    dateInfo.style.fontSize = '0.75em';
    dateInfo.style.color = '#999';
    dateInfo.style.textAlign = 'center';
    const matchDateMs = this.normalizeDateMs(match.date);
    if (matchDateMs) {
      const matchTime = new Date(matchDateMs);
      dateInfo.textContent = matchTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
      dateInfo.textContent = 'TBD';
    }
    item.appendChild(dateInfo);

    // Add popular badge if applicable
    if (match.popular) {
      const popularBadge = document.createElement('div');
      popularBadge.style.position = 'absolute';
      popularBadge.style.top = '4px';
      popularBadge.style.right = '4px';
      popularBadge.style.backgroundColor = '#ff6b6b';
      popularBadge.style.color = '#fff';
      popularBadge.style.fontSize = '0.65em';
      popularBadge.style.padding = '2px 6px';
      popularBadge.style.borderRadius = '3px';
      popularBadge.textContent = 'POPULAR';
      item.style.position = 'relative';
      item.appendChild(popularBadge);
    }

    // Add click handler
    item.addEventListener('click', () => this.selectEvent(match, index));

    return item;
  }

  /**
   * Select an event and load its streams
   * @param {Object} match - The selected match
   * @param {number} index - Match index
   */
  async selectEvent(match, index) {
    try {
      console.log(`Selected event: ${match.title}`);
      this.selectedMatch = match;

      // Update UI to show selected event
      document.querySelectorAll('.event-item').forEach(el => {
        el.style.borderColor = '#666';
        el.style.borderWidth = '1px';
      });
      document.querySelector(`[data-match-index="${index}"]`).style.borderColor = '#66c8f3';
      document.querySelector(`[data-match-index="${index}"]`).style.borderWidth = '2px';

      // Update current channel name
      const channelNameEl = document.getElementById('current-channel-name');
      if (channelNameEl) {
        channelNameEl.textContent = match.title;
        channelNameEl.style.display = 'inline-block';
      }

      // If the match has sources, fetch streams from all sources
      if (match.sources && match.sources.length > 0) {
        this.renderStreamIndicators([], null);
        await this.loadStreamsForAllSources(match.sources);
      } else {
        console.warn('No sources available for this match');
        this.renderStreamIndicators([], null);
        this.showError('No streams available for this event');
      }
    } catch (error) {
      console.error('Error selecting event:', error);
      this.showError(`Failed to load event: ${error.message}`);
    }
  }

  /**
   * Load streams for a specific source of a match
   * @param {Object} source - Source object with {source, id}
   */
  async loadStreamsForSource(source) {
    try {
      if (!source) return;
      this.selectedSourceKey = this.getSourceKey(source);
      const url = `${this.apiBase}/stream/${source.source}/${source.id}`;
      console.log(`Fetching streams from: ${url}`);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Stream API Error: ${response.status}`);
      }

      const streams = await response.json();
      console.log(`Fetched ${streams.length} streams`);

      if (streams.length > 0) {
        // Use the first available stream (preferably HD)
        const selectedStream = streams.find(s => s.hd) || streams[0];
        this.selectedStream = selectedStream;
        this.renderStreamIndicators(streams, this.getStreamKey(selectedStream));
        this.playStream(selectedStream);
      } else {
        this.renderStreamIndicators([], null);
        this.showError('No streams available');
      }
    } catch (error) {
      console.error('Error loading streams:', error);
      this.renderStreamIndicators([], null);
      this.showError(`Failed to load streams: ${error.message}`);
    }
  }

  async loadStreamsForAllSources(sources) {
    if (!Array.isArray(sources) || sources.length === 0) {
      this.renderStreamIndicators([], null);
      this.showError('No streams available for this event');
      return;
    }

    const results = await Promise.allSettled(
      sources.map(source => this.fetchStreamsForSource(source))
    );

    const combined = [];
    results.forEach((res, idx) => {
      if (res.status === 'fulfilled' && Array.isArray(res.value)) {
        const sourceMeta = sources[idx];
        res.value.forEach((stream, sIdx) => {
          combined.push({
            ...stream,
            _sourceKey: this.getSourceKey(sourceMeta),
            _sourceName: sourceMeta?.source || stream.source || 'source',
            _streamIndex: sIdx
          });
        });
      }
    });

    if (combined.length === 0) {
      this.renderStreamIndicators([], null);
      this.showError('No streams available');
      return;
    }

    const selectedStream = this.chooseDefaultStream(combined);
    this.selectedStream = selectedStream;
    this.renderStreamIndicators(combined, this.getStreamKey(selectedStream));
    this.playStream(selectedStream);
  }

  async fetchStreamsForSource(source) {
    if (!source) return [];
    if (source.source === 'ppv') {
      if (!source.iframe) return [];
      return [
        {
          id: `ppv_${source.id}`,
          streamNo: 1,
          language: '',
          hd: false,
          embedUrl: source.iframe,
          source: 'ppv'
        }
      ];
    }
    try {
      const url = `${this.apiBase}/stream/${source.source}/${source.id}`;
      const response = await fetch(url);
      if (!response.ok) return [];
      const streams = await response.json();
      return Array.isArray(streams) ? streams : [];
    } catch (error) {
      console.warn('Failed to fetch streams for source:', source?.source, error);
      return [];
    }
  }

  /**
   * Play a stream using the embedUrl
   * @param {Object} stream - Stream object from the API
   */
  playStream(stream) {
    try {
      console.log(`Playing stream: ${stream.language} (${stream.hd ? 'HD' : 'SD'})`);

      const iframePlayer = document.getElementById('player-iframe');
      const videoPlayer = document.getElementById('player-video');

      if (iframePlayer) {
        iframePlayer.classList.remove('active');
        iframePlayer.src = '';
      }
      if (videoPlayer) {
        videoPlayer.classList.remove('active');
        videoPlayer.src = '';
      }

      // Set the iframe player with the embed URL
      if (iframePlayer && stream.embedUrl) {
        iframePlayer.src = this.withAutoplayParams(stream.embedUrl);
        iframePlayer.classList.add('active');
        console.log(`Loaded stream in iframe: ${iframePlayer.src}`);
      }
    } catch (error) {
      console.error('Error playing stream:', error);
      this.showError(`Failed to play stream: ${error.message}`);
    }
  }

  withAutoplayParams(url) {
    if (!url) return url;
    try {
      const parsed = new URL(url, window.location.href);
      const params = parsed.searchParams;
      if (!params.has('autoplay')) params.set('autoplay', '1');
      if (!params.has('auto')) params.set('auto', '1');
      if (!params.has('mute')) params.set('mute', '1');
      if (!params.has('muted')) params.set('muted', '1');
      return parsed.toString();
    } catch (_) {
      const joiner = url.includes('?') ? '&' : '?';
      return `${url}${joiner}autoplay=1&auto=1&mute=1&muted=1`;
    }
  }

  /**
   * Show error message to user
   * @param {string} message - Error message
   */
  showError(message) {
    const channelList = document.querySelector(this.channelListSelector);
    if (!channelList) return;
    const parent = channelList.parentElement || channelList;
    let errorEl = parent.querySelector('#events-error-banner');
    if (!errorEl) {
      errorEl = document.createElement('div');
      errorEl.id = 'events-error-banner';
      errorEl.style.cssText = 'text-align: center; color: #ff6b6b; padding: 10px 12px; font-size: 0.85em;';
      parent.insertBefore(errorEl, channelList);
    }
    errorEl.textContent = message;
  }

  clearErrorBanner() {
    const channelList = document.querySelector(this.channelListSelector);
    if (!channelList) return;
    const parent = channelList.parentElement || channelList;
    const errorEl = parent.querySelector('#events-error-banner');
    if (errorEl) {
      errorEl.remove();
    }
  }

  /**
   * Switch to different API endpoint
   * @param {string} endpoint - API endpoint name
   */
  async switchEndpoint(endpoint) {
    console.log(`Switching to endpoint: ${endpoint}`);
    await this.fetchMatches(endpoint);
  }

  startAutoRefresh() {
    this.stopAutoRefresh();
    this.refreshTimer = setInterval(() => {
      this.fetchMatches(this.lastEndpoint);
    }, this.refreshIntervalMs);
  }

  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  refreshNow() {
    return this.fetchMatches(this.lastEndpoint);
  }

  getSourceKey(source) {
    if (!source) return '';
    return `${source.source}:${source.id}`;
  }

  chooseDefaultSource(sources) {
    if (!Array.isArray(sources) || sources.length === 0) return null;
    const preferredTokens = ['admin', 'best', 'vip', 'premium'];
    const preferred = sources.find(src => {
      const name = String(src.source || '').toLowerCase();
      return preferredTokens.some(token => name.includes(token));
    });
    return preferred || sources[0];
  }

  chooseDefaultStream(streams) {
    if (!Array.isArray(streams) || streams.length === 0) return null;
    const preferredTokens = ['admin', 'best', 'vip', 'premium'];
    const score = stream => {
      const sourceName = String(stream._sourceName || stream.source || '').toLowerCase();
      const pref = preferredTokens.some(token => sourceName.includes(token)) ? 100 : 0;
      const hd = stream.hd ? 10 : 0;
      return pref + hd;
    };
    return streams.slice().sort((a, b) => score(b) - score(a))[0];
  }

  getStreamKey(stream, idx = 0) {
    if (!stream) return '';
    const key = stream.id || stream.streamNo || idx + 1;
    const sourceKey = stream._sourceKey || stream.source || 'source';
    return `${sourceKey}:${key}`;
  }

  renderStreamIndicators(streams, activeStreamId) {
    const container = this.serverIndicatorsEl || document.getElementById('server-indicators');
    this.serverIndicatorsEl = container;
    if (!container) return;

    container.innerHTML = '';
    if (!Array.isArray(streams) || streams.length === 0) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';
    streams.forEach((stream, idx) => {
      const streamKey = this.getStreamKey(stream, idx);
      const dot = document.createElement('span');
      const isPpv = String(stream._sourceName || stream.source || '').toLowerCase() === 'ppv';
      dot.className = 'indicator' + (isPpv ? ' ppv' : '') + (streamKey === activeStreamId ? ' active' : '');
      const label = stream.language ? ` ${stream.language}` : '';
      const quality = stream.hd ? ' HD' : '';
      const sourceLabel = stream._sourceName || stream.source || 'source';
      dot.title = `Stream ${stream.streamNo ?? idx + 1}${label}${quality} (${sourceLabel})`;
      dot.addEventListener('click', () => {
        this.selectedStream = stream;
        this.renderStreamIndicators(streams, streamKey);
        this.playStream(stream);
      });
      container.appendChild(dot);
    });
  }

  isLiveMatch(match) {
    if (!match) return false;
    const now = Date.now();
    if (match._provider === 'ppv' && match._ppv) {
      if (match._ppv.always_live === 1) return true;
      const start = this.normalizeDateMs(match._ppv.starts_at);
      const end = this.normalizeDateMs(match._ppv.ends_at);
      if (start && end) return now >= start && now <= end;
      if (start) return now >= start;
    }

    if (match.date) {
      const start = this.normalizeDateMs(match.date);
      const liveWindowMs = 2 * 60 * 60 * 1000;
      return start ? now >= start && now <= start + liveWindowMs : false;
    }
    return false;
  }

  normalizeDateMs(value) {
    if (value == null) return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return num < 1e12 ? num * 1000 : num;
  }

  getPosterUrl(match) {
    if (!match || !match.poster) return null;
    const poster = String(match.poster);
    if (/^https?:\/\//i.test(poster)) return poster;
    if (poster.startsWith('/')) return `${this.originBase}${poster}`;
    if (poster.includes('api/images/') || poster.includes('images/')) {
      return `${this.originBase}/${poster.replace(/^\/+/, '')}`;
    }
    return `${this.originBase}/api/images/proxy/${poster}.webp`;
  }

  getPosterFallbackUrl(match) {
    const homeBadge = match?.teams?.home?.badge;
    const awayBadge = match?.teams?.away?.badge;
    if (!homeBadge || !awayBadge) return null;
    return `${this.originBase}/api/images/poster/${homeBadge}/${awayBadge}.webp`;
  }

  createBadgesContainer(match) {
    if (!match?.teams?.home?.badge && !match?.teams?.away?.badge) return null;
    const badgesContainer = document.createElement('div');
    badgesContainer.style.display = 'flex';
    badgesContainer.style.alignItems = 'center';
    badgesContainer.style.gap = '8px';
    badgesContainer.style.padding = '0 8px';

    if (match.teams?.home?.badge) {
      const homeBadge = document.createElement('img');
      homeBadge.src = `${this.apiBase}/images/badge/${match.teams.home.badge}.webp`;
      homeBadge.alt = match.teams.home.name || 'Home';
      homeBadge.style.width = '40px';
      homeBadge.style.height = '40px';
      homeBadge.style.objectFit = 'contain';
      badgesContainer.appendChild(homeBadge);
    }

    const vsText = document.createElement('span');
    vsText.textContent = 'VS';
    vsText.style.color = '#999';
    vsText.style.fontSize = '0.8em';
    badgesContainer.appendChild(vsText);

    if (match.teams?.away?.badge) {
      const awayBadge = document.createElement('img');
      awayBadge.src = `${this.apiBase}/images/badge/${match.teams.away.badge}.webp`;
      awayBadge.alt = match.teams.away.name || 'Away';
      awayBadge.style.width = '40px';
      awayBadge.style.height = '40px';
      awayBadge.style.objectFit = 'contain';
      badgesContainer.appendChild(awayBadge);
    }

    return badgesContainer;
  }
}

// Export for use in main HTML
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EventsManager;
}
