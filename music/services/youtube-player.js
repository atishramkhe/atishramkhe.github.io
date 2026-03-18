let apiReadyPromise = null;

function getEmbedUrl(videoId, autoplay = false) {
  const url = new URL(`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`);
  url.searchParams.set('playsinline', '1');
  url.searchParams.set('rel', '0');
  url.searchParams.set('modestbranding', '1');
  if (autoplay) url.searchParams.set('autoplay', '1');
  return url.toString();
}

function loadYouTubeIframeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiReadyPromise) return apiReadyPromise;

  apiReadyPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
  });

  return apiReadyPromise;
}

export class YouTubePlayerController {
  constructor(containerId, { onStateChange, onEnded } = {}) {
    this.containerId = containerId;
    this.onStateChange = onStateChange;
    this.onEnded = onEnded;
    this.player = null;
    this.playerReadyPromise = null;
    this.fallbackVideoId = null;
  }

  getContainer() {
    const container = document.getElementById(this.containerId);
    if (!container) {
      throw new Error(`Missing player container: ${this.containerId}`);
    }
    return container;
  }

  renderFallback(videoId, autoplay = true) {
    const container = this.getContainer();
    this.fallbackVideoId = videoId;
    this.player = null;
    this.playerReadyPromise = null;
    container.innerHTML = `<iframe src="${getEmbedUrl(videoId, autoplay)}" title="YouTube player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
  }

  async ensurePlayer() {
    if (this.player && this.playerReadyPromise) {
      await this.playerReadyPromise;
      return this.player;
    }

    this.getContainer().innerHTML = '';
    const YT = await loadYouTubeIframeApi();
    this.playerReadyPromise = new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        reject(new Error('YouTube player timed out while initializing.'));
      }, 8000);

      this.player = new YT.Player(this.containerId, {
        playerVars: {
          rel: 0,
          modestbranding: 1,
          playsinline: 1
        },
        events: {
          onReady: () => {
            window.clearTimeout(timeoutId);
            resolve(this.player);
          },
          onError: (event) => {
            window.clearTimeout(timeoutId);
            reject(new Error(`YouTube player error: ${event.data}`));
          },
          onStateChange: (event) => {
            if (this.onStateChange) this.onStateChange(event.data);
            if (event.data === window.YT.PlayerState.ENDED && this.onEnded) {
              this.onEnded();
            }
          }
        }
      });
    });

    await this.playerReadyPromise;
    return this.player;
  }

  async load(videoId) {
    try {
      const player = await this.ensurePlayer();
      this.fallbackVideoId = null;
      player.loadVideoById(videoId);
    } catch {
      this.renderFallback(videoId, true);
    }
  }

  async play() {
    if (this.fallbackVideoId) {
      this.renderFallback(this.fallbackVideoId, true);
      return;
    }
    const player = await this.ensurePlayer();
    player.playVideo();
  }

  async pause() {
    if (this.fallbackVideoId) return;
    const player = await this.ensurePlayer();
    player.pauseVideo();
  }
}