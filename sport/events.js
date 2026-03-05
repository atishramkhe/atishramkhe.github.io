/**
 * Events Module - Handles Streamed.pk Matches API integration
 * Fetches live events and manages event selection and streaming
 */

class EventsManager {
  constructor(channelListSelector = '#channel-list') {
    this.apiBase = 'https://streamed.pk/api';
    this.originBase = 'https://streamed.pk';
    this.ppvApiBase = 'https://old.ppv.to/api';
    this.cdnLiveApiBase = 'https://api.cdn-live.tv/api/v1';
    this.cdnLiveOrigin = 'https://cdn-live.tv';
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
      const cdnLiveUrl = `${this.cdnLiveApiBase}/events/sports/?user=cdnlivetv&plan=free`;
      console.log(`Fetching events from: ${streamedUrl}`);
      console.log(`Fetching events from: ${ppvUrl}`);
      console.log(`Fetching events from: ${cdnLiveUrl}`);

      const [streamedResult, ppvResult, cdnLiveResult] = await Promise.allSettled([
        fetch(streamedUrl),
        fetch(ppvUrl),
        fetch(cdnLiveUrl)
      ]);

      const streamedMatches = await this.parseStreamedMatches(streamedResult);
      const ppvMatches = await this.parsePpvMatches(ppvResult);
      const cdnLiveMatches = await this.parseCdnLiveMatches(cdnLiveResult);

      const combined = [...streamedMatches, ...ppvMatches, ...cdnLiveMatches];
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

  async parseCdnLiveMatches(result) {
    if (!result || result.status !== 'fulfilled') return [];
    const response = result.value;
    if (!response || !response.ok) return [];
    try {
      const data = await response.json();
      if (!data || !data['cdn-live-tv']) return [];
      const sportsData = data['cdn-live-tv'];
      const matches = [];
      const sportCategories = ['Soccer', 'NBA', 'NHL', 'NFL', 'MLB', 'UFC', 'Boxing', 'MMA', 'Tennis', 'F1', 'Cricket'];

      for (const key of Object.keys(sportsData)) {
        const events = sportsData[key];
        if (!Array.isArray(events)) continue;

        events.forEach(event => {
          const channels = Array.isArray(event.channels) ? event.channels : [];
          if (channels.length === 0) return;

          const sources = channels.map((ch, idx) => ({
            source: 'cdnlive',
            id: `${event.gameID}_ch${idx}`,
            iframe: ch.url,
            channel_name: ch.channel_name,
            channel_code: ch.channel_code,
            channel_image: ch.image
          }));

          const startMs = event.start ? new Date(event.start).getTime() : null;
          const endMs = event.end ? new Date(event.end).getTime() : null;

          matches.push({
            id: `cdnlive_${event.gameID}`,
            title: `${event.homeTeam} vs ${event.awayTeam}`,
            category: key,
            date: startMs,
            poster: null,
            popular: false,
            teams: {
              home: { name: event.homeTeam, badge: null, img: event.homeTeamIMG },
              away: { name: event.awayTeam, badge: null, img: event.awayTeamIMG }
            },
            sources: sources,
            _provider: 'cdnlive',
            _cdnlive: {
              ...event,
              startMs,
              endMs,
              tournament: event.tournament,
              country: event.country,
              countryIMG: event.countryIMG
            }
          });
        });
      }

      console.log(`Parsed ${matches.length} CDN Live TV events`);
      return matches;
    } catch (error) {
      console.warn('Failed to parse CDN Live TV events', error);
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
        // Streamed events from the "live" endpoint don't always have accurate dates
        // Keep them if they're from Streamed and we're on the live endpoint
        if (match._provider === 'streamed' && this.lastEndpoint === 'live') {
          console.log(`Keeping Streamed live event: ${match.title}`);
          return true;
        }

        // CDN Live TV events have a status field - keep live and upcoming ones
        if (match._provider === 'cdnlive' && match._cdnlive) {
          const status = match._cdnlive.status;
          if (status === 'live' || status === 'upcoming') {
            console.log(`Keeping CDN Live TV ${status} event: ${match.title}`);
            return true;
          }
        }
        
        const dateMs = this.normalizeDateMs(match.date);
        if (!dateMs) {
          console.log(`Filtering out event with no valid date: ${match.title}`);
          return false;
        }
        const inWindow = dateMs >= (now - this.pastEventCutoffMs) && dateMs <= windowEnd;
        if (!inWindow) {
          console.log(`Filtering out event outside time window: ${match.title}, date: ${new Date(dateMs)}`);
        }
        return inWindow;
      })
      .sort((a, b) => {
        const providerOrder = { streamed: 0, ppv: 1, cdnlive: 2 };
        const aOrder = providerOrder[a._provider] ?? 3;
        const bOrder = providerOrder[b._provider] ?? 3;
        if (aOrder !== bOrder) return aOrder - bOrder;
        const aDate = this.normalizeDateMs(a.date);
        const bDate = this.normalizeDateMs(b.date);
        if (!aDate && !bDate) return 0;
        if (!aDate) return 1;
        if (!bDate) return -1;
        return aDate - bDate;
      });
  }

  hasPlayableSource(match) {
    if (!match || !Array.isArray(match.sources) || match.sources.length === 0) return false;
    return match.sources.some(source => {
      if (source.source === 'ppv' || source.source === 'cdnlive') {
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
    if (match._provider === 'cdnlive' && match._cdnlive) {
      return match._cdnlive.status === 'finished';
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
    item.style.cssText = 'cursor:pointer;position:relative;overflow:hidden;padding:0;justify-content:stretch;align-items:stretch;';
    item.setAttribute('data-match-index', index);
    item.setAttribute('data-match-id', match.id);

    // --- Poster / badges layer (fills entire card) ---
    const posterLayer = document.createElement('div');
    posterLayer.style.cssText = 'position:absolute;inset:0;background:#1a1a1a;display:flex;align-items:center;justify-content:center;border-radius:6px;overflow:hidden;';

    const posterUrl = this.getPosterUrl(match);
    if (posterUrl) {
      const posterImg = document.createElement('img');
      posterImg.src = posterUrl;
      posterImg.alt = match.title;
      posterImg.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      posterImg.onerror = () => {
        const fallbackUrl = this.getPosterFallbackUrl(match);
        if (fallbackUrl && posterImg.dataset.fallback !== '1') {
          posterImg.dataset.fallback = '1';
          posterImg.src = fallbackUrl;
          return;
        }
        posterLayer.style.backgroundColor = '#0a0a0a';
        posterImg.style.display = 'none';
        const badges = this.createBadgesContainer(match);
        if (badges) posterLayer.appendChild(badges);
      };
      posterLayer.appendChild(posterImg);
    } else {
      const badges = this.createBadgesContainer(match);
      if (badges) posterLayer.appendChild(badges);
    }
    item.appendChild(posterLayer);

    // --- Text overlay at the bottom ---
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:relative;z-index:1;margin-top:auto;background:linear-gradient(transparent, rgba(0,0,0,0.85) 30%);padding:6px 6px 5px;border-radius:0 0 6px 6px;';

    // Title
    const title = document.createElement('div');
    title.style.cssText = 'font-size:0.78em;font-weight:600;color:#fff;text-align:center;line-height:1.15;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;';
    title.textContent = match.title;
    overlay.appendChild(title);

    // Category + time row
    const meta = document.createElement('div');
    meta.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:6px;margin-top:2px;font-size:0.65em;';

    if (match.category) {
      const cat = document.createElement('span');
      cat.style.cssText = 'color:#66c8f3;text-transform:uppercase;letter-spacing:0.3px;';
      cat.textContent = match.category;
      meta.appendChild(cat);
    }

    const matchDateMs = this.normalizeDateMs(match.date);
    if (matchDateMs) {
      const timeSpan = document.createElement('span');
      timeSpan.style.color = '#aaa';
      timeSpan.textContent = new Date(matchDateMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      meta.appendChild(timeSpan);
    }
    overlay.appendChild(meta);

    // Tournament line (CDN Live TV)
    if (match._provider === 'cdnlive' && match._cdnlive?.tournament) {
      const tournament = document.createElement('div');
      tournament.style.cssText = 'font-size:0.6em;color:#999;text-align:center;margin-top:1px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;';
      tournament.textContent = match._cdnlive.tournament;
      overlay.appendChild(tournament);
    }

    item.appendChild(overlay);

    // --- Floating badges (top corners) ---
    if (this.isLiveMatch(match)) {
      const liveBadge = document.createElement('div');
      liveBadge.className = 'event-live-badge';
      liveBadge.textContent = 'LIVE';
      item.appendChild(liveBadge);
    }

    if (match.popular) {
      const popularBadge = document.createElement('div');
      popularBadge.style.cssText = 'position:absolute;top:4px;right:4px;z-index:2;background:#ff6b6b;color:#fff;font-size:0.65em;padding:2px 6px;border-radius:3px;';
      popularBadge.textContent = 'POPULAR';
      item.appendChild(popularBadge);
    }

    // Click handler
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
    if (source.source === 'cdnlive') {
      if (!source.iframe) return [];
      return [
        {
          id: `cdnlive_${source.id}`,
          streamNo: 1,
          language: source.channel_name || '',
          hd: false,
          embedUrl: source.iframe,
          source: 'cdnlive',
          channelImage: source.channel_image
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
   * Auto-select the first event that has working streams.
   * Iterates through currentMatches, fetching streams for each until one succeeds.
   */
  async autoSelectFirstEvent() {
    if (!this.currentMatches || this.currentMatches.length === 0) return;

    for (let i = 0; i < this.currentMatches.length; i++) {
      const match = this.currentMatches[i];
      if (!match.sources || match.sources.length === 0) continue;

      // Check if any source returns streams
      const results = await Promise.allSettled(
        match.sources.map(source => this.fetchStreamsForSource(source))
      );

      const hasStreams = results.some(
        res => res.status === 'fulfilled' && Array.isArray(res.value) && res.value.length > 0
      );

      if (hasStreams) {
        console.log(`Auto-selecting event: ${match.title}`);
        this.selectEvent(match, i);
        return;
      }
    }

    console.warn('No events with available streams found for auto-select');
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
      const srcName = String(stream._sourceName || stream.source || '').toLowerCase();
      const isPpv = srcName === 'ppv';
      const isCdnLive = srcName === 'cdnlive';
      dot.className = 'indicator' + (isPpv ? ' ppv' : '') + (isCdnLive ? ' cdnlive' : '') + (streamKey === activeStreamId ? ' active' : '');
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

    if (match._provider === 'cdnlive' && match._cdnlive) {
      return match._cdnlive.status === 'live';
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
    if (!match || !match.poster) {
      // For CDN Live TV events, use team images as poster fallback
      if (match && match._provider === 'cdnlive' && match.teams) {
        return match.teams.home?.img || match.teams.away?.img || null;
      }
      return null;
    }
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
    const hasBadge = match?.teams?.home?.badge || match?.teams?.away?.badge;
    const hasImg = match?.teams?.home?.img || match?.teams?.away?.img;
    if (!hasBadge && !hasImg) return null;

    const badgesContainer = document.createElement('div');
    badgesContainer.style.display = 'flex';
    badgesContainer.style.alignItems = 'center';
    badgesContainer.style.gap = '8px';
    badgesContainer.style.padding = '0 8px';

    const homeImgSrc = match.teams?.home?.badge
      ? `${this.apiBase}/images/badge/${match.teams.home.badge}.webp`
      : match.teams?.home?.img || null;

    if (homeImgSrc) {
      const homeBadge = document.createElement('img');
      homeBadge.src = homeImgSrc;
      homeBadge.alt = match.teams.home?.name || 'Home';
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

    const awayImgSrc = match.teams?.away?.badge
      ? `${this.apiBase}/images/badge/${match.teams.away.badge}.webp`
      : match.teams?.away?.img || null;

    if (awayImgSrc) {
      const awayBadge = document.createElement('img');
      awayBadge.src = awayImgSrc;
      awayBadge.alt = match.teams.away?.name || 'Away';
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
