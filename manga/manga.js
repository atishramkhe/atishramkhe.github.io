/* global localStorage, URLSearchParams */
(() => {
  const API_BASE = 'https://api.mangadex.org';
  const ANILIST_API_BASE = 'https://graphql.anilist.co';
  const PUBLIC_API_PROXY_BASE = 'https://api.codetabs.com/v1/proxy/?quest=';
  const VIDSRC_EMBED_BASE = 'https://vidsrc.icu/embed/manga';
  const READER_SOURCES = Object.freeze({
    VIDSRC: 'vidsrc',
    MANGADEX: 'mangadex',
  });
  const DISCOVERY_SECTION_LIMIT = 22;
  const RECENT_WINDOW_DAYS = 14;
  const COUNTRY_TO_LANG = Object.freeze({
    JP: 'ja',
    KR: 'ko',
    CN: 'zh',
    TW: 'zh',
    US: 'en',
    GB: 'en',
    FR: 'fr',
  });
  const LANG_TO_COUNTRY = Object.freeze({
    ja: 'JP',
    ko: 'KR',
    zh: 'CN',
    en: 'US',
    fr: 'FR',
  });

  const STORAGE = {
    SETTINGS: 'ateaish_manga_settings_v1',
    CONTINUE: 'ateaish_manga_continue_v1',
    READ_LATER: 'ateaish_manga_read_later_v1',
    FINISHED: 'ateaish_manga_finished_v1',
  };

  const DEFAULT_SETTINGS = {
    preferredTitleLangs: ['en', 'fr', 'ja-ro', 'ja', 'ko', 'zh-hk', 'zh'],
    preferredDescriptionLangs: ['en', 'fr'],
    preferredChapterLangs: ['en', 'fr'],
    contentRatings: ['safe', 'suggestive'],
    quality: 'data-saver', // data | data-saver
    includedTagsMode: 'AND',
    excludedTagsMode: 'OR',
    readerSource: READER_SOURCES.VIDSRC,
    readerFitMode: 'vertical', // vertical | page | horizontal
    readerPanelCollapsed: false,
  };

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    proxyAvailable: false,
    tags: [],
    tagByName: new Map(),
    tagById: new Map(),
    mediaById: new Map(),
    mangadexByAniListId: new Map(),
    searchPageInfoCache: new Map(),
    includeTags: new Set(),
    excludeTags: new Set(),
    current: {
      mangaId: null,
      mangaTitle: null,
      coverUrl: null,
      anilistId: null,
      mangadexId: null,
      chapters: [],
      chapterIndexById: new Map(),
      chapterLangs: [],
      currentChapterId: null,
      currentSource: READER_SOURCES.VIDSRC,
      latestChapterId: null,
    },
    detailChaptersCache: [],
    chapterLoading: false,
  };

  const ANILIST_PAGE_MEDIA_FIELDS = `
    id
    title { romaji english native userPreferred }
    description(asHtml: false)
    status
    startDate { year month day }
    endDate { year month day }
    updatedAt
    coverImage { large extraLarge color }
    bannerImage
    countryOfOrigin
    genres
    tags { name rank isAdult }
    averageScore
    meanScore
    popularity
    favourites
    chapters
    volumes
    isAdult
  `;

  const ANILIST_DETAIL_MEDIA_FIELDS = `
    ${ANILIST_PAGE_MEDIA_FIELDS}
    staff(perPage: 12) {
      edges {
        role
        node {
          name { full native }
        }
      }
    }
  `;

  const ANILIST_PAGE_QUERY = `
    query MangaPage(
      $page: Int,
      $perPage: Int,
      $search: String,
      $sort: [MediaSort],
      $status: MediaStatus,
      $countryOfOrigin: CountryCode,
      $startDateLike: String,
      $chaptersGreater: Int,
      $genreIn: [String],
      $genreNotIn: [String],
      $tagIn: [String],
      $tagNotIn: [String],
      $isAdult: Boolean
    ) {
      Page(page: $page, perPage: $perPage) {
        pageInfo {
          total
          currentPage
          lastPage
          hasNextPage
        }
        media(
          type: MANGA,
          search: $search,
          sort: $sort,
          status: $status,
          countryOfOrigin: $countryOfOrigin,
          startDate_like: $startDateLike,
          chapters_greater: $chaptersGreater,
          genre_in: $genreIn,
          genre_not_in: $genreNotIn,
          tag_in: $tagIn,
          tag_not_in: $tagNotIn,
          isAdult: $isAdult
        ) {
          ${ANILIST_PAGE_MEDIA_FIELDS}
        }
      }
    }
  `;

  const ANILIST_DETAIL_QUERY = `
    query MangaById($id: Int) {
      Media(id: $id, type: MANGA) {
        ${ANILIST_DETAIL_MEDIA_FIELDS}
      }
    }
  `;

  const ANILIST_GENRES_QUERY = `
    query MangaGenres {
      GenreCollection
    }
  `;

  const el = {};

  function $(id) {
    return document.getElementById(id);
  }

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function loadSettings() {
    const saved = safeJsonParse(localStorage.getItem(STORAGE.SETTINGS), null);
    if (saved && typeof saved === 'object') {
      state.settings = {
        ...DEFAULT_SETTINGS,
        ...saved,
        preferredTitleLangs: Array.isArray(saved.preferredTitleLangs) ? saved.preferredTitleLangs : DEFAULT_SETTINGS.preferredTitleLangs,
        preferredDescriptionLangs: Array.isArray(saved.preferredDescriptionLangs)
          ? saved.preferredDescriptionLangs
          : DEFAULT_SETTINGS.preferredDescriptionLangs,
        preferredChapterLangs: Array.isArray(saved.preferredChapterLangs)
          ? saved.preferredChapterLangs
          : DEFAULT_SETTINGS.preferredChapterLangs,
        contentRatings: Array.isArray(saved.contentRatings) ? saved.contentRatings : DEFAULT_SETTINGS.contentRatings,
        readerSource: normalizeReaderSource(saved.readerSource),
        readerFitMode: typeof saved.readerFitMode === 'string' ? saved.readerFitMode : DEFAULT_SETTINGS.readerFitMode,
        readerPanelCollapsed: typeof saved.readerPanelCollapsed === 'boolean'
          ? saved.readerPanelCollapsed
          : DEFAULT_SETTINGS.readerPanelCollapsed,
      };

      // Migration: older default was EN only; new default is EN+FR.
      if (Array.isArray(state.settings.preferredChapterLangs)) {
        const langs = state.settings.preferredChapterLangs.map((s) => String(s || '').toLowerCase()).filter(Boolean);
        if (langs.length === 1 && (langs[0] === 'en' || langs[0] === 'fr')) {
          state.settings.preferredChapterLangs = langs[0] === 'fr' ? ['fr', 'en'] : ['en', 'fr'];
        }
      }
    }

    // Best-effort: seed preferredChapterLangs from browser language
    if (!saved) {
      const navLang = (navigator.language || '').toLowerCase();
      const iso = navLang.split('-')[0];
      const base = ['en', 'fr'];
      if (iso && iso.length === 2 && !base.includes(iso)) {
        base.unshift(iso);
      }
      state.settings.preferredChapterLangs = base;
    }
  }

  function saveSettings() {
    localStorage.setItem(STORAGE.SETTINGS, JSON.stringify(state.settings));
  }

  function normalizeReaderSource(source) {
    return source === READER_SOURCES.MANGADEX ? READER_SOURCES.MANGADEX : READER_SOURCES.VIDSRC;
  }

  function applyReaderFitMode(mode) {
    const m = (mode || 'vertical').toLowerCase();
    const normalized = (m === 'page' || m === 'horizontal' || m === 'vertical') ? m : 'vertical';
    state.settings.readerFitMode = normalized;
    saveSettings();
    if (el.readerOverlay) {
      el.readerOverlay.dataset.fit = normalized;
    }
    if (el.readerFitModeSelect) {
      el.readerFitModeSelect.value = normalized;
    }
  }

  function applyReaderPanelState() {
    const collapsed = Boolean(state.settings.readerPanelCollapsed);
    if (el.readerOverlay) {
      el.readerOverlay.classList.toggle('panel-collapsed', collapsed);
    }
    if (el.readerPanelToggleBtn) {
      el.readerPanelToggleBtn.textContent = collapsed ? 'left_panel_open' : 'left_panel_close';
      el.readerPanelToggleBtn.title = collapsed ? 'Show reader panel' : 'Focus mode';
      el.readerPanelToggleBtn.setAttribute('aria-label', collapsed ? 'Show reader panel' : 'Hide reader panel');
    }
    if (el.readerFloatingPanelBtn) {
      el.readerFloatingPanelBtn.textContent = collapsed ? 'dock_to_left' : 'dock_to_right';
      el.readerFloatingPanelBtn.title = collapsed ? 'Show reader panel' : 'Hide reader panel';
      el.readerFloatingPanelBtn.setAttribute('aria-label', collapsed ? 'Show reader panel' : 'Hide reader panel');
    }
  }

  function toggleReaderPanel(forceState) {
    state.settings.readerPanelCollapsed = typeof forceState === 'boolean'
      ? forceState
      : !state.settings.readerPanelCollapsed;
    saveSettings();
    applyReaderPanelState();
  }

  async function toggleReaderFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await el.readerOverlay.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      console.warn('Fullscreen failed', e);
    }
  }

  function loadMap(key) {
    const parsed = safeJsonParse(localStorage.getItem(key) || '{}', {});
    return parsed && typeof parsed === 'object' ? parsed : {};
  }

  function saveMap(key, obj) {
    localStorage.setItem(key, JSON.stringify(obj));
  }

  function buildQuery(params) {
    const qs = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') return;
      if (Array.isArray(v)) {
        v.forEach((item) => {
          if (item === undefined || item === null || item === '') return;
          qs.append(k, String(item));
        });
      } else {
        qs.set(k, String(v));
      }
    });
    return qs;
  }

  function isLikelyCorsOrNetworkFailure(err) {
    if (!err) return false;
    // Browser CORS failures typically surface as TypeError: Failed to fetch
    if (err instanceof TypeError) return true;
    const msg = String(err?.message || err);
    return /failed to fetch|networkerror|load failed|fetch/i.test(msg);
  }

  async function fetchJson(urlStr, { signal } = {}) {
    const res = await fetch(urlStr, {
      headers: { 'Accept': 'application/json' },
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw Object.assign(new Error(`API ${res.status} ${res.statusText}: ${text.slice(0, 250)}`), {
        status: res.status,
        retryable: res.status === 429 || res.status >= 500,
      });
    }
    return res.json();
  }

  async function postJson(urlStr, payload, { signal } = {}) {
    const res = await fetch(urlStr, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw Object.assign(new Error(`API ${res.status} ${res.statusText}: ${text.slice(0, 250)}`), {
        status: res.status,
        retryable: res.status === 429 || res.status >= 500,
      });
    }

    return res.json();
  }

  function cleanObject(value) {
    if (Array.isArray(value)) {
      const next = value
        .map((item) => cleanObject(item))
        .filter((item) => item !== undefined && item !== null && item !== '');
      return next.length ? next : undefined;
    }

    if (value && typeof value === 'object') {
      const next = Object.fromEntries(
        Object.entries(value)
          .map(([key, inner]) => [key, cleanObject(inner)])
          .filter(([, inner]) => inner !== undefined && inner !== null && inner !== '')
      );
      return Object.keys(next).length ? next : undefined;
    }

    return value;
  }

  async function apiGet(path, params) {
    const url = new URL(API_BASE + path);
    const qs = buildQuery(params);
    if ([...qs.keys()].length) url.search = qs.toString();

    const maxAttempts = 3;
    let attempt = 0;
    let lastErr = null;

    while (attempt < maxAttempts) {
      attempt++;
      const controller = new AbortController();
      const timeoutMs = 12000;
      const t = setTimeout(() => controller.abort(), timeoutMs);

      try {
        // MangaDex recently tightened CORS (often allows localhost only).
        // Try direct first, then local /proxy if present, then a public JSON proxy.
        const directUrl = url.toString();

        const modes = [
          { name: 'direct', fn: () => fetchJson(directUrl, { signal: controller.signal }) },
          ...(state.proxyAvailable
            ? [{ name: 'localProxy', fn: () => fetchJson(`/proxy?url=${encodeURIComponent(directUrl)}`, { signal: controller.signal }) }]
            : []),
          { name: 'publicProxy', fn: () => fetchJson(`${PUBLIC_API_PROXY_BASE}${encodeURIComponent(directUrl)}`, { signal: controller.signal }) },
        ];

        let lastModeErr = null;
        for (const m of modes) {
          try {
            return await m.fn();
          } catch (e) {
            lastModeErr = e;

            const status = Number(e?.status || 0);
            const retryableStatus = status === 429 || status >= 500;
            if (retryableStatus && attempt < maxAttempts) {
              const backoff = 350 * attempt + Math.floor(Math.random() * 250);
              await new Promise((r) => setTimeout(r, backoff));
              // retry whole loop
              throw Object.assign(new Error('retry'), { _retry: true });
            }

            // If this looks like a pure CORS/network failure, try the next mode.
            // If it's a non-retryable HTTP error (4xx), don't keep trying proxies.
            if (!isLikelyCorsOrNetworkFailure(e) && status >= 400 && status < 500) {
              throw e;
            }
          }
        }

        throw lastModeErr || new Error('API request failed');
      } catch (e) {
        if (e && e._retry) {
          continue;
        }
        lastErr = e;
        const retryable = String(e && e.name) === 'AbortError';
        if (retryable && attempt < maxAttempts) {
          const backoff = 350 * attempt + Math.floor(Math.random() * 250);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        throw e;
      } finally {
        clearTimeout(t);
      }
    }

    throw lastErr || new Error('API request failed');
  }

  async function checkProxyAvailability() {
    try {
      const testUrl = API_BASE + '/ping';
      const res = await fetch(`/proxy?url=${encodeURIComponent(testUrl)}`, { cache: 'no-store' });
      state.proxyAvailable = res.ok;
    } catch {
      state.proxyAvailable = false;
    }
  }

  function proxify(url) {
    if (!state.proxyAvailable) return url;
    return `/proxy?url=${encodeURIComponent(url)}`;
  }

  async function anilistQuery(query, variables = {}) {
    const maxAttempts = 3;
    let attempt = 0;
    let lastErr = null;

    while (attempt < maxAttempts) {
      attempt++;
      const controller = new AbortController();
      const timeoutMs = 12000;
      const t = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const payload = { query, variables: cleanObject(variables) || {} };
        const json = await postJson(ANILIST_API_BASE, payload, { signal: controller.signal });
        if (Array.isArray(json?.errors) && json.errors.length) {
          throw new Error(json.errors.map((item) => item?.message || 'AniList query failed').join(' | '));
        }
        return json?.data || null;
      } catch (e) {
        lastErr = e;
        const status = Number(e?.status || 0);
        const retryable = String(e?.name) === 'AbortError' || status === 429 || status >= 500;
        if (retryable && attempt < maxAttempts) {
          const backoff = 350 * attempt + Math.floor(Math.random() * 250);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }
        throw e;
      } finally {
        clearTimeout(t);
      }
    }

    throw lastErr || new Error('AniList request failed');
  }

  function bestLocalizedString(localized, preferredLangs) {
    if (!localized || typeof localized !== 'object') return '';
    for (const lang of preferredLangs) {
      if (localized[lang]) return localized[lang];
    }
    const first = Object.values(localized)[0];
    return typeof first === 'string' ? first : '';
  }

  function stripHtmlText(html) {
    return String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  function fuzzyDateToIso(dateObj) {
    const year = Number(dateObj?.year || 0);
    if (!year) return '';
    const month = Number(dateObj?.month || 1);
    const day = Number(dateObj?.day || 1);
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function formatAniListStatus(status) {
    const map = {
      FINISHED: 'Completed',
      RELEASING: 'Ongoing',
      HIATUS: 'Hiatus',
      CANCELLED: 'Cancelled',
      NOT_YET_RELEASED: 'Not Yet Released',
    };
    return map[String(status || '').toUpperCase()] || '';
  }

  function statusToAniList(status) {
    const map = {
      ongoing: 'RELEASING',
      completed: 'FINISHED',
      hiatus: 'HIATUS',
      cancelled: 'CANCELLED',
    };
    return map[String(status || '').toLowerCase()] || null;
  }

  function originalLangToCountry(lang) {
    return LANG_TO_COUNTRY[String(lang || '').toLowerCase()] || null;
  }

  function countryToOriginalLang(country) {
    return COUNTRY_TO_LANG[String(country || '').toUpperCase()] || String(country || '').toLowerCase();
  }

  function mapSortToAniList(sortValue, hasSearch) {
    const map = {
      relevance: hasSearch ? ['POPULARITY_DESC'] : ['TRENDING_DESC'],
      latestUploadedChapter: ['UPDATED_AT_DESC'],
      followedCount: ['POPULARITY_DESC'],
      rating: ['SCORE_DESC'],
      createdAt: ['START_DATE_DESC'],
      updatedAt: ['UPDATED_AT_DESC'],
      title: ['TITLE_ROMAJI'],
      year: ['START_DATE_DESC'],
    };
    return map[sortValue] || (hasSearch ? ['POPULARITY_DESC'] : ['TRENDING_DESC']);
  }

  function inferDemographicFromTags(tags) {
    const names = (tags || []).map((tag) => String(tag?.name || '').toLowerCase());
    if (names.includes('shounen')) return 'shounen';
    if (names.includes('shoujo')) return 'shoujo';
    if (names.includes('seinen')) return 'seinen';
    if (names.includes('josei')) return 'josei';
    return '';
  }

  function buildNormalizedRelationship(type, data) {
    return { type, attributes: { ...data } };
  }

  function normalizeAniListMedia(media) {
    if (!media?.id) return null;

    const title = media.title || {};
    const genres = Array.isArray(media.genres) ? media.genres.filter(Boolean) : [];
    const tags = Array.isArray(media.tags) ? media.tags.filter((tag) => tag?.name) : [];
    const tagNames = [...new Set([...genres, ...tags.map((tag) => tag.name)])];
    const relationships = [];

    relationships.push(buildNormalizedRelationship('cover_art', {
      coverUrl: media.coverImage?.extraLarge || media.coverImage?.large || '../movies/assets/no_poster.png',
    }));

    tagNames.forEach((name) => {
      relationships.push(buildNormalizedRelationship('tag', { name: { en: name } }));
    });

    (media.staff?.edges || []).forEach((edge) => {
      const fullName = edge?.node?.name?.full || edge?.node?.name?.native;
      if (!fullName) return;
      const role = String(edge?.role || '').toLowerCase();
      if (role.includes('art')) {
        relationships.push(buildNormalizedRelationship('artist', { name: fullName }));
      }
      if (role.includes('story') || !role.includes('art')) {
        relationships.push(buildNormalizedRelationship('author', { name: fullName }));
      }
    });

    const normalized = {
      id: String(media.id),
      provider: 'anilist',
      sourceIds: {
        anilist: String(media.id),
        mangadex: null,
      },
      attributes: {
        title: {
          en: title.english || title.romaji || title.native || title.userPreferred || 'Untitled',
          'ja-ro': title.romaji || title.english || title.userPreferred || '',
          ja: title.native || '',
        },
        description: {
          en: stripHtmlText(media.description || ''),
        },
        year: media.startDate?.year || null,
        status: formatAniListStatus(media.status),
        originalLanguage: countryToOriginalLang(media.countryOfOrigin),
        publicationDemographic: inferDemographicFromTags(tags),
        links: {
          al: String(media.id),
        },
        tags: tagNames.map((name) => ({ attributes: { name: { en: name } } })),
        startDateIso: fuzzyDateToIso(media.startDate),
        endDateIso: fuzzyDateToIso(media.endDate),
        updatedAtIso: media.updatedAt ? new Date(media.updatedAt * 1000).toISOString() : '',
      },
      relationships,
      anilist: {
        id: media.id,
        title,
        countryOfOrigin: media.countryOfOrigin || '',
        averageScore: media.averageScore,
        meanScore: media.meanScore,
        popularity: media.popularity,
        favourites: media.favourites,
        chapters: media.chapters,
        volumes: media.volumes,
        bannerImage: media.bannerImage,
        coverImage: media.coverImage,
        genres,
        tags,
        updatedAt: media.updatedAt,
        startDate: media.startDate,
        endDate: media.endDate,
      },
    };

    state.mediaById.set(normalized.id, normalized);
    return normalized;
  }

  function mangaTitle(manga) {
    const attrs = manga?.attributes;
    return (
      bestLocalizedString(attrs?.title, state.settings.preferredTitleLangs) ||
      bestLocalizedString(attrs?.title, ['en']) ||
      'Untitled'
    );
  }

  function mangaDescription(manga) {
    const attrs = manga?.attributes;
    return bestLocalizedString(attrs?.description, state.settings.preferredDescriptionLangs) || '';
  }

  function mangaAniListId(manga) {
    if (manga?.sourceIds?.anilist) return String(manga.sourceIds.anilist);
    const raw = manga?.attributes?.links?.al;
    if (raw === undefined || raw === null || raw === '') return null;

    const match = String(raw).match(/\d+/);
    return match ? match[0] : null;
  }

  function chapterNumberForReader(chapter) {
    const raw = String(chapter?.attributes?.chapter || '').trim();
    if (!raw) return null;
    return /^\d+(?:\.\d+)?$/.test(raw) ? raw : null;
  }

  function buildVidsrcEmbedUrl(anilistId, chapterNumber) {
    return `${VIDSRC_EMBED_BASE}/${encodeURIComponent(anilistId)}/${encodeURIComponent(chapterNumber)}`;
  }

  function resolveReaderSource(chapter, preferredSource = state.settings.readerSource) {
    const anilistId = state.current.anilistId;
    const chapterNumber = chapterNumberForReader(chapter);
    const requested = normalizeReaderSource(preferredSource);
    const hasMangaDexPages = Boolean(state.current.mangadexId && chapter?.id && !String(chapter.id).startsWith('al:'));

    if (requested === READER_SOURCES.MANGADEX) {
      if (!hasMangaDexPages && anilistId && chapterNumber) {
        return {
          requested,
          source: READER_SOURCES.VIDSRC,
          anilistId,
          chapterNumber,
          fallbackReason: 'MangaDex chapter pages are unavailable for this title.',
        };
      }

      return {
        requested,
        source: READER_SOURCES.MANGADEX,
        anilistId,
        chapterNumber,
        fallbackReason: '',
      };
    }

    if (!anilistId) {
      return {
        requested,
        source: READER_SOURCES.MANGADEX,
        anilistId: null,
        chapterNumber,
        fallbackReason: 'Missing AniList ID on MangaDex metadata.',
      };
    }

    if (!chapterNumber) {
      return {
        requested,
        source: READER_SOURCES.MANGADEX,
        anilistId,
        chapterNumber: null,
        fallbackReason: 'This chapter does not have a numeric chapter number.',
      };
    }

    return {
      requested,
      source: READER_SOURCES.VIDSRC,
      anilistId,
      chapterNumber,
      fallbackReason: '',
    };
  }

  function setReaderNotice(text) {
    el.readerProxyHint.style.display = text ? 'block' : 'none';
    el.readerProxyHint.textContent = text || '';
  }

  function syncReaderSourceUI(info) {
    if (!el.readerSourceSelect) return;
    const mangadexAvailable = Boolean(state.current.mangadexId && state.current.currentChapterId && !String(state.current.currentChapterId).startsWith('al:'));

    const vidsrcOption = [...el.readerSourceSelect.options].find((option) => option.value === READER_SOURCES.VIDSRC);
    if (vidsrcOption) {
      const available = Boolean(info?.anilistId && info?.chapterNumber);
      vidsrcOption.disabled = !available;
      vidsrcOption.textContent = available ? 'Vidsrc (Primary)' : 'Vidsrc (Unavailable)';
    }

    const mangadexOption = [...el.readerSourceSelect.options].find((option) => option.value === READER_SOURCES.MANGADEX);
    if (mangadexOption) {
      mangadexOption.disabled = !mangadexAvailable;
      mangadexOption.textContent = mangadexAvailable ? 'MangaDex (Fallback)' : 'MangaDex (Unavailable)';
    }

    el.readerSourceSelect.value = info?.source || normalizeReaderSource(state.settings.readerSource);

    if (el.readerQualitySelect) {
      el.readerQualitySelect.disabled = info?.source !== READER_SOURCES.MANGADEX;
    }

    if (el.readerFitModeSelect) {
      el.readerFitModeSelect.disabled = info?.source !== READER_SOURCES.MANGADEX;
    }
  }

  function relationshipByType(entity, type) {
    const rels = entity?.relationships;
    if (!Array.isArray(rels)) return null;
    return rels.find((r) => r?.type === type) || null;
  }

  function relationshipManyByType(entity, type) {
    const rels = entity?.relationships;
    if (!Array.isArray(rels)) return [];
    return rels.filter((r) => r?.type === type);
  }

  function coverUrlFromManga(manga, size = 256) {
    const coverRel = relationshipByType(manga, 'cover_art');
    const directCover = coverRel?.attributes?.coverUrl;
    if (directCover) return directCover;
    const fileName = coverRel?.attributes?.fileName;
    if (!fileName) return '../movies/assets/no_poster.png';
    const safeSize = Number(size) === 512 ? 512 : 256;
    // Covers do not require CORS proxying and are much faster direct.
    return `https://uploads.mangadex.org/covers/${manga.id}/${fileName}.${safeSize}.jpg`;
  }

  function coverFileNameFromManga(manga) {
    const coverRel = relationshipByType(manga, 'cover_art');
    return coverRel?.attributes?.fileName || null;
  }

  function mangaReleaseDate(manga) {
    return manga?.attributes?.startDateIso || '';
  }

  function mangaNativeTitle(manga) {
    return bestLocalizedString(manga?.attributes?.title, ['ja', 'ja-ro', 'en']);
  }

  function normalizeSearchText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function mangaSearchTitles(manga) {
    const title = manga?.anilist?.title || {};
    const attrs = manga?.attributes?.title || {};
    return [...new Set([
      title.english,
      title.romaji,
      title.native,
      title.userPreferred,
      attrs.en,
      attrs['ja-ro'],
      attrs.ja,
    ].map((value) => String(value || '').trim()).filter(Boolean))];
  }

  function mangaSearchScore(manga, query) {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return 0;

    const titles = mangaSearchTitles(manga).map(normalizeSearchText).filter(Boolean);
    const popularity = Number(manga?.anilist?.popularity || 0);
    let score = 0;

    for (const title of titles) {
      if (title === normalizedQuery) score = Math.max(score, 1000);
      else if (title.startsWith(`${normalizedQuery} `) || title.startsWith(normalizedQuery)) score = Math.max(score, 800);
      else if (title.includes(` ${normalizedQuery} `) || title.includes(normalizedQuery)) score = Math.max(score, 600);

      const words = normalizedQuery.split(' ').filter(Boolean);
      if (words.length && words.every((word) => title.includes(word))) {
        score = Math.max(score, 500);
      }
    }

    return score + Math.min(popularity / 1000, 199);
  }

  function sortSearchResults(items, query, sortValue) {
    if (!query || sortValue !== 'relevance') return items;

    return items.slice().sort((left, right) => {
      const scoreDiff = mangaSearchScore(right, query) - mangaSearchScore(left, query);
      if (scoreDiff !== 0) return scoreDiff;

      const popularityDiff = Number(right?.anilist?.popularity || 0) - Number(left?.anilist?.popularity || 0);
      if (popularityDiff !== 0) return popularityDiff;

      return mangaTitle(left).localeCompare(mangaTitle(right));
    });
  }

  function buildAniListSearchVariables({ title, page, perPage, sortValue }) {
    const includeLabels = [...state.includeTags]
      .map((id) => state.tagById.get(id)?.label)
      .filter(Boolean);
    const excludeLabels = [...state.excludeTags]
      .map((id) => state.tagById.get(id)?.label)
      .filter(Boolean);

    const demoLabel = el.filterDemo.value
      ? el.filterDemo.value.charAt(0).toUpperCase() + el.filterDemo.value.slice(1)
      : '';

    const ratings = selectedContentRatings();
    let isAdult = null;
    const allowsAdult = ratings.includes('erotica') || ratings.includes('pornographic');
    const allowsSafe = ratings.includes('safe') || ratings.includes('suggestive');
    if (allowsAdult && !allowsSafe) isAdult = true;
    if (!allowsAdult && allowsSafe) isAdult = false;

    return {
      page,
      perPage,
      search: title || undefined,
      sort: mapSortToAniList(sortValue, Boolean(title)),
      status: statusToAniList(el.filterStatus.value),
      countryOfOrigin: originalLangToCountry(el.filterOriginalLang.value),
      startDateLike: el.filterYear.value ? `${String(el.filterYear.value).trim()}%` : null,
      chaptersGreater: el.filterHasChapters.checked ? 0 : null,
      genreIn: includeLabels.length ? includeLabels : null,
      genreNotIn: excludeLabels.length ? excludeLabels : null,
      tagIn: demoLabel ? [demoLabel] : null,
      tagNotIn: null,
      isAdult,
    };
  }

  async function searchAniListManga(variables) {
    const data = await anilistQuery(ANILIST_PAGE_QUERY, variables);
    const page = data?.Page || {};
    const items = Array.isArray(page.media) ? page.media.map(normalizeAniListMedia).filter(Boolean) : [];
    return {
      items,
      total: Number(page?.pageInfo?.total || 0),
      currentPage: Number(page?.pageInfo?.currentPage || variables.page || 1),
      lastPage: Number(page?.pageInfo?.lastPage || 1),
      hasNextPage: Boolean(page?.pageInfo?.hasNextPage),
    };
  }

  function buildSearchPageCacheKey(variables) {
    const cloned = { ...variables };
    delete cloned.page;
    delete cloned.perPage;
    return JSON.stringify(cloned);
  }

  async function resolveSearchLastPage(result, variables) {
    const cacheKey = buildSearchPageCacheKey(variables);
    const cached = state.searchPageInfoCache.get(cacheKey);

    if (cached && cached.lastPage >= result.currentPage) {
      return cached.lastPage;
    }

    let resolved = result.lastPage || result.currentPage || 1;
    const hasSearchTerm = Boolean(variables?.search);
    const suspiciousFirstPage = hasSearchTerm && result.currentPage === 1 && resolved > 10;

    if (suspiciousFirstPage) {
      const maxProbePages = 8;
      resolved = 1;

      for (let probePage = 2; probePage <= maxProbePages; probePage++) {
        const probe = await searchAniListManga({ ...variables, page: probePage });

        if (!probe.items.length) {
          resolved = probePage - 1;
          break;
        }

        resolved = probePage;

        if (probe.lastPage && probe.lastPage <= probePage) {
          resolved = probe.lastPage;
          break;
        }

        if (!probe.hasNextPage || probe.items.length < Number(variables?.perPage || 24)) {
          resolved = probePage;
          break;
        }
      }
    }

    const safeLastPage = Math.max(result.currentPage || 1, resolved || 1);
    state.searchPageInfoCache.set(cacheKey, { lastPage: safeLastPage, updatedAt: Date.now() });
    return safeLastPage;
  }

  async function getAniListMedia(mangaId) {
    const key = String(mangaId || '');
    if (state.mediaById.has(key)) return state.mediaById.get(key);

    const data = await anilistQuery(ANILIST_DETAIL_QUERY, { id: Number(mangaId) });
    const normalized = normalizeAniListMedia(data?.Media || null);
    if (!normalized) throw new Error('No AniList manga data');
    return normalized;
  }

  function isAniListNumericId(value) {
    return /^\d+$/.test(String(value || '').trim());
  }

  async function resolveAniListMediaFromAnyId(mangaId) {
    const key = String(mangaId || '').trim();
    if (!key) throw new Error('Missing manga id');

    if (isAniListNumericId(key)) {
      return getAniListMedia(key);
    }

    const md = await apiGet(`/manga/${key}`, {
      'includes[]': ['cover_art', 'author', 'artist'],
    });
    const mangaDexData = md?.data;
    if (!mangaDexData) throw new Error('No MangaDex data for legacy entry');

    const linkedAniListId = mangaAniListId(mangaDexData);
    if (linkedAniListId) {
      const media = await getAniListMedia(linkedAniListId);
      media.sourceIds.mangadex = mangaDexData.id;
      state.mangadexByAniListId.set(String(linkedAniListId), mangaDexData);
      return media;
    }

    const fallbackTitle = mangaTitle(mangaDexData);
    const result = await searchAniListManga({
      page: 1,
      perPage: 5,
      search: fallbackTitle,
      sort: ['SEARCH_MATCH'],
    });
    const media = result.items[0] || null;
    if (!media) throw new Error('No AniList match for legacy MangaDex entry');

    media.sourceIds.mangadex = mangaDexData.id;
    state.mangadexByAniListId.set(String(media.id), mangaDexData);
    return media;
  }

  function titleCandidatesForMatch(manga) {
    const attrs = manga?.attributes?.title || {};
    return [...new Set([attrs.en, attrs['ja-ro'], attrs.ja].map((value) => String(value || '').trim()).filter(Boolean))];
  }

  async function resolveMangaDexMangaForMedia(manga) {
    const anilistId = mangaAniListId(manga);
    if (!anilistId) return null;
    if (state.mangadexByAniListId.has(anilistId)) return state.mangadexByAniListId.get(anilistId);

    const titles = titleCandidatesForMatch(manga);
    for (const title of titles) {
      try {
        const json = await apiGet('/manga', {
          limit: 10,
          offset: 0,
          title,
          'includes[]': ['cover_art', 'author', 'artist'],
          'contentRating[]': ['safe', 'suggestive', 'erotica', 'pornographic'],
        });
        const items = Array.isArray(json?.data) ? json.data : [];
        const exact = items.find((item) => mangaAniListId(item) === anilistId);
        if (exact) {
          state.mangadexByAniListId.set(anilistId, exact);
          manga.sourceIds.mangadex = exact.id;
          return exact;
        }
      } catch {
        // ignore and try next title
      }
    }

    state.mangadexByAniListId.set(anilistId, null);
    return null;
  }

  function buildSyntheticChapters(manga, totalChapters) {
    const maxChapters = Math.max(0, Number(totalChapters || 0));
    const items = [];
    for (let chapterNumber = maxChapters; chapterNumber >= 1; chapterNumber--) {
      items.push({
        id: `al:${manga.id}:${chapterNumber}`,
        attributes: {
          chapter: String(chapterNumber),
          title: '',
          translatedLanguage: '',
          readableAt: mangaReleaseDate(manga) || null,
        },
        relationships: [],
      });
    }
    return items;
  }

  function formatCompactDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
    } catch {
      return '';
    }
  }

  function formatTimestamp(ts) {
    if (!ts) return '';
    try {
      return formatCompactDate(new Date(ts).toISOString());
    } catch {
      return '';
    }
  }

  function parseNumericChapter(value) {
    const parsed = Number.parseFloat(String(value || '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  function isRecentDateValue(value) {
    if (!value) return false;
    const timestamp = typeof value === 'number' ? value : new Date(value).getTime();
    if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
    return (Date.now() - timestamp) <= RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function buildProgressMarkup(rows) {
    const validRows = Array.isArray(rows) ? rows.filter((row) => row && row.ratio !== null && row.ratio !== undefined) : [];
    if (!validRows.length) return '';

    return `
      <div class="card-progress">
        ${validRows.map((row) => {
          const bounded = Math.max(0, Math.min(Number(row.ratio) || 0, 1));
          return `
            <div class="progress-block">
              <div class="progress-meta">
                <span>${escapeHtml(row.label || 'Progress')}</span>
                <span>${Math.round(bounded * 100)}%</span>
              </div>
              <div class="progress-track"><div class="progress-fill" style="width:${bounded * 100}%"></div></div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function appendPosterBadges(cover, badges) {
    const valid = Array.isArray(badges) ? badges.filter((badge) => badge && badge.label) : [];
    if (!valid.length) return;

    const row = document.createElement('div');
    row.className = 'poster-badge-row';

    valid.forEach((badge) => {
      const chip = document.createElement('span');
      chip.className = `poster-badge${badge.tone ? ` ${badge.tone}` : ''}`;
      chip.textContent = badge.label;
      row.appendChild(chip);
    });

    cover.appendChild(row);
  }

  function setStatus(text) {
    if (!el.statusText) return;
    el.statusText.textContent = text || '';
    el.statusBar.style.display = text ? 'block' : 'none';
  }

  function flashStatus(text, ms = 1800) {
    setStatus(text);
    if (!text) return;
    setTimeout(() => {
      // only clear if unchanged
      if (el.statusText && el.statusText.textContent === text) setStatus('');
    }, ms);
  }

  function spinRandomIcon() {
    const icon = $('jump-random-icon');
    if (!icon) return;
    icon.classList.remove('is-spinning');
    void icon.offsetWidth;
    icon.classList.add('is-spinning');
    window.setTimeout(() => icon.classList.remove('is-spinning'), 560);
  }

  function randomLoadedManga() {
    const pool = [...state.mediaById.values()].filter((item) => item?.id);
    if (!pool.length) return null;
    const index = Math.floor(Math.random() * pool.length);
    return pool[index] || null;
  }

  function renderPosterGrid(container, items, opts = {}) {
    const { context = 'generic', showNewBadge = false, newBadgeMap = {} } = opts;
    container.innerHTML = '';

    const frag = document.createDocumentFragment();
    items.forEach((manga) => {
      const title = mangaTitle(manga);
      const desc = mangaDescription(manga);
      const cover = coverUrlFromManga(manga, 256);
      const coverFile = coverFileNameFromManga(manga);

      const poster = document.createElement('article');
      poster.className = 'poster';
      poster.dataset.mangaId = manga.id;
      poster.dataset.context = context;
      poster.tabIndex = 0;
      poster.setAttribute('role', 'button');

      const coverShell = document.createElement('span');
      coverShell.className = 'poster-cover';

      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = title;
      img.src = cover;

      img.onerror = () => {
        // Some manga do not have a generated 256 cover; fallback to 512.
        if (coverFile && !img.dataset.tried512) {
          img.dataset.tried512 = '1';
          img.src = `https://uploads.mangadex.org/covers/${manga.id}/${coverFile}.512.jpg`;
          return;
        }
        img.src = '../movies/assets/no_poster.png';
      };

      const titleDiv = document.createElement('div');
      titleDiv.className = 'poster-title';
      titleDiv.textContent = title;
      const year = manga?.attributes?.year ? String(manga.attributes.year) : '';
      const status = manga?.attributes?.status ? String(manga.attributes.status) : '';

      const subtitleDiv = document.createElement('div');
      subtitleDiv.className = 'poster-subtitle';
      subtitleDiv.textContent = [year, status].filter(Boolean).join(' • ') || desc || 'Open details';

      const badges = [];
      const totalChapters = Number(manga?.anilist?.chapters || 0);
      if (totalChapters > 0) badges.push({ label: `Ch. ${totalChapters}`, tone: 'soft' });
      if (showNewBadge && newBadgeMap[manga.id]) {
        badges.push({ label: 'New', tone: 'alert' });
      } else if (context === 'new' || isRecentDateValue(manga?.attributes?.updatedAtIso || manga?.attributes?.startDateIso)) {
        badges.push({ label: 'Recent', tone: 'cool' });
      }

      coverShell.appendChild(img);
      appendPosterBadges(coverShell, badges);

      poster.appendChild(coverShell);
      poster.appendChild(titleDiv);
      poster.appendChild(subtitleDiv);

      const activate = () => openMangaDetail(manga.id);
      poster.addEventListener('click', activate);
      poster.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate();
      });

      frag.appendChild(poster);
    });

    container.appendChild(frag);
  }

  async function loadTags() {
    const data = await anilistQuery(ANILIST_GENRES_QUERY, {});
    const genres = Array.isArray(data?.GenreCollection) ? data.GenreCollection.filter(Boolean) : [];
    state.tags = genres.map((name) => ({ id: name, label: name }));

    state.tagByName.clear();
    state.tagById.clear();

    state.tags.forEach((t) => {
      const name = t?.label;
      if (name) state.tagByName.set(name.toLowerCase(), t);
      if (t?.id) state.tagById.set(t.id, t);
    });

    // Fill datalist
    el.tagDatalist.innerHTML = '';
    state.tags
      .map((t) => t?.label)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        el.tagDatalist.appendChild(opt);
      });
  }

  function renderTagChips() {
    el.includeTagChips.innerHTML = '';
    el.excludeTagChips.innerHTML = '';

    const makeChip = (tagId, kind) => {
      const tag = state.tagById.get(tagId);
      const label = tag?.label || 'Tag';

      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-chip';
      chip.textContent = label;
      chip.title = 'Click to remove';
      chip.addEventListener('click', () => {
        if (kind === 'include') state.includeTags.delete(tagId);
        else state.excludeTags.delete(tagId);
        renderTagChips();
      });
      return chip;
    };

    [...state.includeTags]
      .map((id) => makeChip(id, 'include'))
      .forEach((chip) => el.includeTagChips.appendChild(chip));

    [...state.excludeTags]
      .map((id) => makeChip(id, 'exclude'))
      .forEach((chip) => el.excludeTagChips.appendChild(chip));

    el.includeTagChips.style.display = state.includeTags.size ? 'flex' : 'none';
    el.excludeTagChips.style.display = state.excludeTags.size ? 'flex' : 'none';
  }

  function selectedContentRatings() {
    const ratings = [];
    for (const cb of el.contentRatingChecks.querySelectorAll('input[type="checkbox"]')) {
      if (cb.checked) ratings.push(cb.value);
    }
    return ratings;
  }

  function showResults(open) {
    el.searchResultsWrapper.classList.toggle('active', !!open);
    el.closeSearchBtn.classList.toggle('visible', !!open);
  }

  let searchDebounce = null;

  async function performSearch(page = 1) {
    const q = (el.searchInput.value || '').trim();

    if (!q && !state.includeTags.size && !state.excludeTags.size && !el.filterStatus.value && !el.filterDemo.value && !el.filterOriginalLang.value && !el.filterYear.value) {
      el.results.innerHTML = '';
      el.searchPagination.innerHTML = '';
      showResults(false);
      return;
    }

    showResults(true);

    const limit = 24;
    const sortVal = el.filterSort.value || 'relevance';

    setStatus('Searching…');

    try {
      const searchVariables = buildAniListSearchVariables({
        title: q || undefined,
        page,
        perPage: limit,
        sortValue: sortVal,
      });
      const result = await searchAniListManga(searchVariables);
      const items = sortSearchResults(result.items, q, sortVal);
      const safeLastPage = await resolveSearchLastPage(result, searchVariables);

      renderPosterGrid(el.results, items, { context: 'search' });

      renderSearchPagination(page, safeLastPage || Math.ceil(result.total / limit));

      setStatus('');
    } catch (e) {
      console.error(e);
      setStatus('Search failed.');
    }
  }

  function renderSearchPagination(current, totalPages) {
    el.searchPagination.innerHTML = '';
    if (!totalPages || totalPages <= 1) return;

    const wrap = document.createElement('div');
    wrap.className = 'pagination';

    const makeBtn = (label, page, disabled, active) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pagination-btn' + (active ? ' active' : '');
      b.textContent = label;
      b.disabled = !!disabled;
      b.addEventListener('click', () => performSearch(page));
      return b;
    };

    wrap.appendChild(makeBtn('Prev', Math.max(1, current - 1), current === 1, false));

    const windowSize = 5;
    let start = Math.max(1, current - Math.floor(windowSize / 2));
    let end = Math.min(totalPages, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);

    for (let p = start; p <= end; p++) {
      wrap.appendChild(makeBtn(String(p), p, false, p === current));
    }

    wrap.appendChild(makeBtn('Next', Math.min(totalPages, current + 1), current === totalPages, false));

    const info = document.createElement('div');
    info.className = 'pagination-info';
    info.textContent = `Page ${current} / ${totalPages}`;

    el.searchPagination.appendChild(wrap);
    el.searchPagination.appendChild(info);
  }

  async function fetchDiscoveryList(orderKey, orderDir = 'desc', limit = DISCOVERY_SECTION_LIMIT) {
    const sortValue = orderKey === 'latestUploadedChapter'
      ? 'updatedAt'
      : orderKey === 'followedCount'
        ? 'followedCount'
        : orderKey === 'rating'
          ? 'rating'
          : orderKey === 'createdAt'
            ? 'createdAt'
            : 'relevance';

    return searchAniListManga(buildAniListSearchVariables({
      page: 1,
      perPage: limit,
      sortValue,
    }));
  }

  async function loadDiscovery() {
    setStatus('Loading discovery…');

    try {
      const trending = await searchAniListManga(buildAniListSearchVariables({ page: 1, perPage: DISCOVERY_SECTION_LIMIT, sortValue: 'relevance' }));
      const trendingItems = trending.items;
      renderPosterGrid(el.trendingGrid, trendingItems, { context: 'trending' });
      if (!el.showcaseSection?.hidden && trendingItems[0]) await renderShowcase(trendingItems[0]);

      setStatus('Loading more…');

      const popular = await searchAniListManga(buildAniListSearchVariables({ page: 1, perPage: DISCOVERY_SECTION_LIMIT, sortValue: 'followedCount' }));
      const topRated = await searchAniListManga(buildAniListSearchVariables({ page: 1, perPage: DISCOVERY_SECTION_LIMIT, sortValue: 'rating' }));
      const newTitles = await searchAniListManga(buildAniListSearchVariables({ page: 1, perPage: DISCOVERY_SECTION_LIMIT, sortValue: 'updatedAt' }));

      const popularItems = popular.items;
      const ratedItems = topRated.items;
      const newItems = newTitles.items;

      renderPosterGrid(el.popularGrid, popularItems, { context: 'popular' });
      renderPosterGrid(el.topRatedGrid, ratedItems, { context: 'top-rated' });
      renderPosterGrid(el.newGrid, newItems, { context: 'new' });

      // Showcase fallback if trending was empty
      if (!el.showcaseSection?.hidden && !trendingItems[0]) {
        const featured = popularItems[0] || ratedItems[0] || newItems[0];
        if (featured) await renderShowcase(featured);
      }

      setStatus('');
    } catch (e) {
      console.error(e);
      setStatus('Failed to load discovery.');
    }
  }

  async function renderShowcase(manga) {
    const title = mangaTitle(manga);
    const cover = coverUrlFromManga(manga, 512);

    el.showcasePoster.src = cover;
    el.showcaseTitle.textContent = title;

    const releaseDate = formatCompactDate(mangaReleaseDate(manga));
    const status = manga?.attributes?.status ? String(manga.attributes.status) : '';
    const ogLang = manga?.attributes?.originalLanguage ? String(manga.attributes.originalLanguage).toUpperCase() : '';

    el.showcaseMeta.textContent = [releaseDate || manga?.attributes?.year || '', status, ogLang].filter(Boolean).join(' • ');

    const overview = mangaDescription(manga);
    el.showcaseOverview.textContent = overview || 'Discover live-updated manga on AniList.';

    el.showcaseActions.style.display = 'flex';
    el.showcaseReadBtn.onclick = () => openMangaDetail(manga.id, { autoRead: true });
    el.showcaseLaterBtn.onclick = () => toggleReadLater(manga);

    const bgUrl = coverUrlFromManga(manga, 512);
    el.showcaseBg.style.backgroundImage = `url('${bgUrl}')`;
  }

  function upsertEntry(mapKey, manga) {
    const obj = loadMap(mapKey);
    const title = mangaTitle(manga);
    const cover = coverUrlFromManga(manga, 256);

    obj[manga.id] = {
      mangaId: manga.id,
      anilistId: mangaAniListId(manga),
      mangadexId: manga?.sourceIds?.mangadex || null,
      title,
      nativeTitle: mangaNativeTitle(manga),
      coverUrl: cover,
      updatedAt: Date.now(),
      year: manga?.attributes?.year || null,
      totalChapters: manga?.anilist?.chapters || null,
      releaseDate: mangaReleaseDate(manga) || null,
      status: manga?.attributes?.status || null,
      originalLanguage: manga?.attributes?.originalLanguage || null,
    };

    saveMap(mapKey, obj);
    return obj;
  }

  function removeEntry(mapKey, mangaId) {
    const obj = loadMap(mapKey);
    delete obj[mangaId];
    saveMap(mapKey, obj);
    return obj;
  }

  function toggleReadLater(manga) {
    const rl = loadMap(STORAGE.READ_LATER);
    if (rl[manga.id]) {
      removeEntry(STORAGE.READ_LATER, manga.id);
    } else {
      upsertEntry(STORAGE.READ_LATER, manga);
      // If it was marked finished, unmark it
      removeEntry(STORAGE.FINISHED, manga.id);
    }
    renderLibrarySections();
  }

  function markFinished(manga) {
    upsertEntry(STORAGE.FINISHED, manga);
    removeEntry(STORAGE.READ_LATER, manga.id);
    renderLibrarySections();
  }

  function ensureContinue(manga, patch) {
    const cont = loadMap(STORAGE.CONTINUE);
    const base = cont[manga.id] || {
      mangaId: manga.id,
      anilistId: mangaAniListId(manga),
      mangadexId: manga?.sourceIds?.mangadex || null,
      title: mangaTitle(manga),
      coverUrl: coverUrlFromManga(manga, 256),
      updatedAt: Date.now(),
      totalChapters: manga?.anilist?.chapters || null,
    };
    cont[manga.id] = {
      ...base,
      ...patch,
      updatedAt: Date.now(),
    };
    saveMap(STORAGE.CONTINUE, cont);
  }

  function renderLibraryGrid(container, entries, opts = {}) {
    container.innerHTML = '';
    const frag = document.createDocumentFragment();

    entries.forEach((entry) => {
      const poster = document.createElement('article');
      poster.className = 'poster';
      poster.dataset.mangaId = entry.mangaId;
      poster.tabIndex = 0;
      poster.setAttribute('role', 'button');

      const coverShell = document.createElement('span');
      coverShell.className = 'poster-cover';

      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = entry.title;
      img.src = entry.coverUrl || '../movies/assets/no_poster.png';

      img.onerror = () => {
        if (!img.dataset.tried512 && img.src.includes('.256.jpg')) {
          img.dataset.tried512 = '1';
          img.src = img.src.replace('.256.jpg', '.512.jpg');
          return;
        }
        img.src = '../movies/assets/no_poster.png';
      };

      const titleDiv = document.createElement('div');
      titleDiv.className = 'poster-title';
      titleDiv.textContent = entry.title || 'Untitled';

      const subtitleDiv = document.createElement('div');
      subtitleDiv.className = 'poster-subtitle';
      if (opts.mode === 'continue') {
        subtitleDiv.textContent = [
          entry.lastChapter ? `Resume chapter ${entry.lastChapter}` : 'Resume reading',
          formatTimestamp(entry.lastReadAt),
        ].filter(Boolean).join(' • ');
      } else if (opts.mode === 'later') {
        subtitleDiv.textContent = entry.updatedAt ? `Saved ${formatTimestamp(entry.updatedAt)}` : 'Saved for later';
      } else if (opts.mode === 'finished') {
        subtitleDiv.textContent = entry.updatedAt ? `Finished ${formatTimestamp(entry.updatedAt)}` : 'Completed';
      } else {
        subtitleDiv.textContent = opts.hint || '';
      }

      const badges = [];
      if (opts.mode === 'continue') badges.push({ label: 'Continue', tone: 'cool' });
      if (opts.mode === 'later') badges.push({ label: 'Later', tone: 'soft' });
      if (opts.mode === 'finished') badges.push({ label: 'Finished', tone: 'soft' });
      if (entry.lastChapter) badges.push({ label: `Ch. ${entry.lastChapter}`, tone: 'soft' });
      if (entry.newChapters) badges.push({ label: 'New', tone: 'alert' });

      let progressMarkup = '';
      if (opts.mode === 'continue') {
        const lastChapter = parseNumericChapter(entry.lastChapter);
        const totalChapters = parseNumericChapter(entry.totalChapters);
        if (lastChapter !== null && totalChapters !== null && totalChapters > 0) {
          progressMarkup = buildProgressMarkup([{ label: 'Series', ratio: lastChapter / totalChapters }]);
        }
      }

      coverShell.appendChild(img);
      appendPosterBadges(coverShell, badges);

      poster.appendChild(coverShell);
      poster.appendChild(titleDiv);
      poster.appendChild(subtitleDiv);
      if (progressMarkup) {
        const progressWrap = document.createElement('div');
        progressWrap.innerHTML = progressMarkup;
        if (progressWrap.firstElementChild) {
          poster.appendChild(progressWrap.firstElementChild);
        }
      }

      const activate = () => {
        const targetId = entry.anilistId || entry.mangaId;
        if (opts.resume && entry.lastChapterId) {
          openMangaDetail(targetId, { autoRead: true, chapterId: entry.lastChapterId });
        } else {
          openMangaDetail(targetId);
        }
      };

      poster.addEventListener('click', activate);
      poster.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate();
      });

      frag.appendChild(poster);
    });

    container.appendChild(frag);
  }

  function renderLibrarySections() {
    const cont = Object.values(loadMap(STORAGE.CONTINUE)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const rl = Object.values(loadMap(STORAGE.READ_LATER)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const fin = Object.values(loadMap(STORAGE.FINISHED)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const finishedIds = new Set(fin.map((entry) => entry.mangaId));
    const continueEntries = cont.filter((entry) => !finishedIds.has(entry.mangaId));
    const laterEntries = rl.filter((entry) => !finishedIds.has(entry.mangaId));

    el.continueSection.style.display = continueEntries.length ? 'block' : 'none';
    el.readLaterSection.style.display = laterEntries.length ? 'block' : 'none';
    el.finishedSection.style.display = fin.length ? 'block' : 'none';

    renderLibraryGrid(el.continueGrid, continueEntries, { resume: true, hint: 'Resume reading.', mode: 'continue' });
    renderLibraryGrid(el.readLaterGrid, laterEntries, { resume: false, hint: 'Saved for later.', mode: 'later' });
    renderLibraryGrid(el.finishedGrid, fin, { resume: false, hint: 'Completed.', mode: 'finished' });
  }

  async function checkNewChaptersBadges() {
    const cont = loadMap(STORAGE.CONTINUE);
    const entries = Object.values(cont);
    if (!entries.length) {
      renderLibrarySections();
      return;
    }

    const max = 14; // keep requests bounded
    const slice = entries.slice(0, max);

    await Promise.all(
      slice.map(async (entry) => {
        try {
          if (!entry.mangadexId) {
            cont[entry.mangaId] = { ...entry, newChapters: false, latestCheckedAt: Date.now() };
            return;
          }

          const langs = Array.isArray(entry.chapterLangs) && entry.chapterLangs.length ? entry.chapterLangs : state.settings.preferredChapterLangs;
          const feed = await apiGet(`/manga/${entry.mangadexId}/feed`, {
            limit: 1,
            offset: 0,
            'translatedLanguage[]': langs,
            'order[readableAt]': 'desc',
          });

          const latest = feed?.data?.[0];
          const latestId = latest?.id || null;
          const isNew = !!(latestId && entry.lastChapterId && latestId !== entry.lastChapterId);

          cont[entry.mangaId] = { ...entry, newChapters: isNew, latestChapterId: latestId, latestCheckedAt: Date.now() };
        } catch {
          cont[entry.mangaId] = { ...entry, latestCheckedAt: Date.now() };
        }
      })
    );

    saveMap(STORAGE.CONTINUE, cont);
    renderLibrarySections();
  }

  async function openMangaDetail(mangaId, opts = {}) {
    el.detailOverlay.classList.add('open');
    el.detailPanel.innerHTML = '<div style="padding:20px; opacity:0.75;">Loading…</div>';

    try {
      const mangaData = await resolveAniListMediaFromAnyId(mangaId);
      if (!mangaData) throw new Error('No manga data');

      const mangadexManga = await resolveMangaDexMangaForMedia(mangaData).catch(() => null);
      const resolvedMangadexId = mangadexManga?.id || null;
      if (resolvedMangadexId) {
        mangaData.sourceIds.mangadex = resolvedMangadexId;
      }

      const title = mangaTitle(mangaData);
      const cover = coverUrlFromManga(mangaData, 512);
      const desc = mangaDescription(mangaData);
      const nativeTitle = mangaData?.anilist?.title?.native || '';
      const englishTitle = mangaData?.anilist?.title?.english || '';
      const rating = mangaData?.anilist?.averageScore || mangaData?.anilist?.meanScore || null;
      const follows = mangaData?.anilist?.popularity || mangaData?.anilist?.favourites || null;

      const attrs = mangaData.attributes || {};
      const year = attrs.year || '';
      const releaseDate = formatCompactDate(attrs.startDateIso);
      const status = attrs.status || '';
      const demo = attrs.publicationDemographic || '';
      const og = attrs.originalLanguage ? String(attrs.originalLanguage).toUpperCase() : '';

      const tags = Array.isArray(attrs.tags) ? attrs.tags : relationshipManyByType(mangaData, 'tag');
      const tagList = (tags || [])
        .map((t) => (t?.attributes?.name?.en ? t.attributes.name.en : null))
        .filter(Boolean)
        .slice(0, 24);

      const authors = relationshipManyByType(mangaData, 'author')
        .map((a) => a?.attributes?.name)
        .filter(Boolean);
      const artists = relationshipManyByType(mangaData, 'artist')
        .map((a) => a?.attributes?.name)
        .filter(Boolean);

      const cont = loadMap(STORAGE.CONTINUE);
      const isLater = !!loadMap(STORAGE.READ_LATER)[mangaId];
      const isFinished = !!loadMap(STORAGE.FINISHED)[mangaId];
      const contEntry = cont[mangaId] || null;

      const hasNew = !!contEntry?.newChapters;

      el.detailPanel.innerHTML = `
        <div class="detail-header">
          <img class="detail-poster" src="${escapeHtml(cover)}" alt="${escapeHtml(title)}" />
          <div class="detail-info">
            <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
              <h1 class="detail-title">${escapeHtml(title)}</h1>
              ${hasNew ? '<span class="pill-badge">New chapters</span>' : ''}
            </div>
            <div class="detail-meta">${escapeHtml([releaseDate || year, status, demo, og].filter(Boolean).join(' • '))}</div>
            ${rating ? `<div class="detail-score">★ ${Number(rating).toFixed(2)}${follows ? `  ·  ${Number(follows).toLocaleString()} readers` : ''}</div>` : (follows ? `<div class="detail-score">${Number(follows).toLocaleString()} readers</div>` : '')}

            <div class="detail-genres">
              ${tagList.map((t) => `<span class="detail-genre-tag">${escapeHtml(t)}</span>`).join('')}
            </div>

            <div class="detail-studios">${escapeHtml([
              englishTitle && englishTitle !== title ? `English: ${englishTitle}` : '',
              nativeTitle && nativeTitle !== title ? `Native: ${nativeTitle}` : '',
              authors.length ? `Author: ${authors.slice(0, 2).join(', ')}` : '',
              artists.length ? `Artist: ${artists.slice(0, 2).join(', ')}` : '',
            ].filter(Boolean).join(' · '))}</div>

            <div class="detail-synopsis">${escapeHtml(desc || 'No description.')}</div>

            <div class="detail-actions">
              <button class="detail-btn" id="detail-read-btn" type="button">
                <span class="material-symbols-outlined">menu_book</span>
                ${contEntry?.lastChapterId ? 'Resume' : 'Read'}
              </button>
              <button class="detail-btn secondary" id="detail-later-btn" type="button">
                <span class="material-symbols-outlined">bookmark</span>
                ${isLater ? 'Saved' : 'Read Later'}
              </button>
              <button class="detail-btn secondary" id="detail-finished-btn" type="button">
                <span class="material-symbols-outlined">check_circle</span>
                ${isFinished ? 'Finished' : 'Mark Finished'}
              </button>
            </div>

            <div class="chapter-list-wrap" style="margin-top: 18px;">
              <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                <div style="opacity:0.85;">Chapters</div>
                <select id="chapter-lang-select" class="search-filter-select" title="Chapter language">
                  ${buildLangOptions(state.settings.preferredChapterLangs)}
                </select>
                <button id="load-chapters-btn" class="small-btn" type="button">
                  <span class="material-symbols-outlined">refresh</span>
                  Load
                </button>
                <div id="chapters-hint" style="opacity:0.6; font-size:0.85em;"></div>
              </div>
              <div id="chapter-list" class="chapter-list"></div>
              <div style="display:flex; justify-content:center; margin-top: 10px;">
                <button id="chapters-more-btn" class="small-btn" type="button" style="display:none;">
                  Load more
                </button>
              </div>
            </div>
          </div>
        </div>

        <div style="opacity:0.55; font-size: 0.8em; margin-top: 20px;">
          Metadata by AniList · Chapters by MangaDex when a source match exists.
        </div>
      `;

      const readBtn = $('detail-read-btn');
      const laterBtn = $('detail-later-btn');
      const finBtn = $('detail-finished-btn');

      laterBtn.addEventListener('click', () => {
        toggleReadLater(mangaData);
        laterBtn.innerHTML = `<span class="material-symbols-outlined">bookmark</span> ${loadMap(STORAGE.READ_LATER)[mangaId] ? 'Saved' : 'Read Later'}`;
      });

      finBtn.addEventListener('click', () => {
        markFinished(mangaData);
        finBtn.innerHTML = `<span class="material-symbols-outlined">check_circle</span> Finished`;
      });

      const chapterLangSelect = $('chapter-lang-select');
      const loadChaptersBtn = $('load-chapters-btn');
      const chapterList = $('chapter-list');
      const moreBtn = $('chapters-more-btn');
      const hint = $('chapters-hint');

      let chapterOffset = 0;
      const chapterLimit = 100;
      let chaptersCache = [];
      state.detailChaptersCache = chaptersCache;
      chapterLangSelect.disabled = !resolvedMangadexId;

      // Default selection: EN + FR (or saved preferred).
      try {
        const preferred = Array.isArray(state.settings.preferredChapterLangs) ? state.settings.preferredChapterLangs : [];
        const prefVal = preferred.length ? preferred.join(',') : '';
        if (prefVal && Array.from(chapterLangSelect.options || []).some((o) => o.value === prefVal)) {
          chapterLangSelect.value = prefVal;
        } else if (prefVal) {
          // If the exact combo isn't present, fall back to Auto.
          chapterLangSelect.value = '';
        }
      } catch {
        // ignore
      }

      const currentLangs = () => {
        const v = chapterLangSelect.value;
        if (v === 'all') return [];
        if (!v) return state.settings.preferredChapterLangs;
        return v.split(',').map((s) => s.trim()).filter(Boolean);
      };

      async function loadChapters(reset = true) {
        hint.textContent = 'Loading…';
        moreBtn.style.display = 'none';

        if (reset) {
          chapterOffset = 0;
          chaptersCache = [];
          chapterList.innerHTML = '';
        }

        if (resolvedMangadexId) {
          const langs = currentLangs();

          const feed = await apiGet(`/manga/${resolvedMangadexId}/feed`, {
            limit: chapterLimit,
            offset: chapterOffset,
            'translatedLanguage[]': langs,
            'order[chapter]': 'desc',
            'includes[]': ['scanlation_group'],
          });

          const items = Array.isArray(feed?.data) ? feed.data : [];
          const total = Number(feed?.total || 0);
          chaptersCache = chaptersCache.concat(items);
          state.detailChaptersCache = chaptersCache;
          chapterOffset += chapterLimit;

          renderChapterList(chapterList, mangaData, items, { append: true, allChapters: () => state.detailChaptersCache });

          if (reset && total === 0) {
            hint.textContent = 'No chapters available for this manga on MangaDex right now.';
            return;
          }

          if (reset && chaptersCache.length === 0) {
            hint.textContent = 'No chapters found for selected language(s). Try changing the language dropdown or choosing All languages.';
            return;
          }

          const shown = chaptersCache.length;
          hint.textContent = `${shown} / ${total || '?'} loaded from MangaDex`;

          if (total && shown < total) {
            moreBtn.style.display = 'inline-flex';
          }

          if (langs.length) {
            state.settings.preferredChapterLangs = langs;
            saveSettings();
          }

          if (opts.autoRead && reset) {
            const target = opts.chapterId || contEntry?.lastChapterId || chaptersCache[chaptersCache.length - 1]?.id;
            if (target) {
              await openReader({ manga: mangaData, chapters: chaptersCache, chapterId: target, chapterLangs: langs });
            }
          }
          return;
        }

        const totalChapters = Number(mangaData?.anilist?.chapters || 0);
        if (!totalChapters) {
          hint.textContent = 'AniList metadata loaded, but no chapter feed or chapter count is available for this title yet.';
          return;
        }

        chaptersCache = buildSyntheticChapters(mangaData, totalChapters);
        state.detailChaptersCache = chaptersCache;
        renderChapterList(chapterList, mangaData, chaptersCache, { append: true, allChapters: () => state.detailChaptersCache });
        hint.textContent = `Using AniList chapter count (${totalChapters}). MangaDex chapter feed not matched for this title.`;

        if (opts.autoRead && reset) {
          const target = opts.chapterId || contEntry?.lastChapterId || chaptersCache[chaptersCache.length - 1]?.id;
          if (target) {
            await openReader({ manga: mangaData, chapters: chaptersCache, chapterId: target, chapterLangs: currentLangs() });
          }
        }
      }

      loadChaptersBtn.addEventListener('click', () => loadChapters(true));
      moreBtn.addEventListener('click', () => loadChapters(false));

      readBtn.addEventListener('click', async () => {
        // Ensure we have at least one page of chapters to select from
        if (!chaptersCache.length) {
          try {
            await loadChapters(true);
          } catch (e) {
            console.error(e);
            hint.textContent = 'Failed to load chapters.';
            return;
          }
        }

        if (!chaptersCache.length) {
          hint.textContent = resolvedMangadexId
            ? 'No chapters found for selected language(s). Try changing the language dropdown.'
            : 'No chapter list available for this title yet.';
          return;
        }

        const target = contEntry?.lastChapterId || chaptersCache[chaptersCache.length - 1]?.id || chaptersCache[0]?.id;
        if (target) {
          await openReader({ manga: mangaData, chapters: chaptersCache, chapterId: target, chapterLangs: currentLangs() });
        }
      });

      // auto-load chapters list quickly (light, one page)
      loadChapters(true).catch((e) => {
        console.error(e);
        hint.textContent = 'Failed to load chapters.';
      });

    } catch (e) {
      console.error(e);
      el.detailPanel.innerHTML = '<div style="padding:20px; opacity:0.75;">Failed to load manga.</div>';
    }
  }

  function buildLangOptions(preferred) {
    // Compact preset list: choose combinations for common usage
    const presets = [
      { label: 'All languages', value: 'all' },
      { label: 'Auto', value: '' },
      { label: 'EN', value: 'en' },
      { label: 'FR', value: 'fr' },
      { label: 'EN + FR', value: 'en,fr' },
      { label: 'ES', value: 'es' },
      { label: 'PT-BR', value: 'pt-br' },
      { label: 'ID', value: 'id' },
      { label: 'RU', value: 'ru' },
      { label: 'DE', value: 'de' },
      { label: 'IT', value: 'it' },
      { label: 'JA', value: 'ja' },
      { label: 'KO', value: 'ko' },
      { label: 'ZH', value: 'zh' },
    ];

    // Add preferred as a preset if not already covered
    const prefVal = Array.isArray(preferred) ? preferred.join(',') : '';
    if (prefVal && !presets.some((p) => p.value === prefVal)) {
      presets.splice(1, 0, { label: `Preferred (${prefVal})`, value: prefVal });
    }

    return presets.map((p) => `<option value="${escapeHtml(p.value)}">${escapeHtml(p.label)}</option>`).join('');
  }

  function renderChapterList(container, manga, chapters, { append = false, allChapters } = {}) {
    if (!append) container.innerHTML = '';

    const cont = loadMap(STORAGE.CONTINUE);
    const lastReadId = cont[manga.id]?.lastChapterId || null;

    const frag = document.createDocumentFragment();
    chapters.forEach((ch) => {
      const attrs = ch?.attributes || {};
      const chNum = attrs.chapter || '?';
      const vol = attrs.volume || '';
      const title = attrs.title || '';
      const lang = attrs.translatedLanguage ? attrs.translatedLanguage.toUpperCase() : '';
      const date = formatCompactDate(attrs.readableAt || attrs.publishAt || attrs.createdAt);

      const groups = relationshipManyByType(ch, 'scanlation_group')
        .map((g) => g?.attributes?.name)
        .filter(Boolean);

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'chapter-row' + (ch.id === lastReadId ? ' active' : '');
      row.innerHTML = `
        <div class="chapter-main">
          <div class="chapter-left">
            <div class="chapter-num">${escapeHtml(vol ? `Vol. ${vol} · Ch. ${chNum}` : `Ch. ${chNum}`)}</div>
            <div class="chapter-title">${escapeHtml(title || 'Untitled chapter')}</div>
            <div class="chapter-sub">${escapeHtml([lang, date].filter(Boolean).join(' • '))}</div>
          </div>
          <div class="chapter-right">${escapeHtml(groups.slice(0, 2).join(', ') || '')}</div>
        </div>
      `;

      row.addEventListener('click', async () => {
        // Use the full accumulated chapter list when available
        const fullList = (typeof allChapters === 'function' ? allChapters() : null) || chapters;
        await openReader({ manga, chapters: fullList, chapterId: ch.id, chapterLangs: state.settings.preferredChapterLangs });
      });

      frag.appendChild(row);
    });

    container.appendChild(frag);
  }

  function openReaderUI() {
    // Hide detail overlay so it doesn't intercept events behind the reader
    el.detailOverlay.classList.remove('open');
    el.readerOverlay.style.display = 'block';
    el.readerOverlay.classList.add('is-open');
    document.body.classList.add('reader-open');

    // Apply persisted fit mode
    el.readerOverlay.dataset.fit = state.settings.readerFitMode || 'vertical';
    applyReaderPanelState();
  }

  function closeReaderUI() {
    el.readerOverlay.style.display = 'none';
    el.readerOverlay.classList.remove('is-open');
    document.body.classList.remove('reader-open');
    el.readerPages.innerHTML = '';
    el.readerPages.classList.remove('embed-mode');
    el.readerTitle.textContent = '';
    el.readerChapterSelect.innerHTML = '';
    el.readerBadge.style.display = 'none';
    setReaderNotice('');
    // Do not clear fit mode; keep persisted setting

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }

  async function openReader({ manga, chapters, chapterId, chapterLangs }) {
    state.current.mangaId = manga.id;
    state.current.mangaTitle = mangaTitle(manga);
    state.current.coverUrl = coverUrlFromManga(manga, 256);
    state.current.anilistId = mangaAniListId(manga);
    state.current.mangadexId = manga?.sourceIds?.mangadex || null;
    state.current.chapterLangs = chapterLangs || state.settings.preferredChapterLangs;

    // Normalize chapter list: distinct + sorted by chapter number where possible
    const uniq = new Map();
    (chapters || []).forEach((c) => {
      if (c?.id && !uniq.has(c.id)) uniq.set(c.id, c);
    });
    const list = [...uniq.values()];

    // Prefer ascending reading order by chapter number (fallback to readableAt)
    list.sort((a, b) => {
      const ca = parseFloat(a?.attributes?.chapter);
      const cb = parseFloat(b?.attributes?.chapter);
      if (!Number.isNaN(ca) && !Number.isNaN(cb) && ca !== cb) return ca - cb;
      const da = new Date(a?.attributes?.readableAt || a?.attributes?.publishAt || a?.attributes?.createdAt || 0).getTime();
      const db = new Date(b?.attributes?.readableAt || b?.attributes?.publishAt || b?.attributes?.createdAt || 0).getTime();
      return da - db;
    });

    state.current.chapters = list;
    state.current.chapterIndexById = new Map(list.map((c, i) => [c.id, i]));

    // Pick chapter
    const idx = state.current.chapterIndexById.get(chapterId);
    const resolvedId = idx !== undefined ? chapterId : list[list.length - 1]?.id;

    openReaderUI();

    el.readerTitle.textContent = state.current.mangaTitle;

    // Render chapter select
    el.readerChapterSelect.innerHTML = '';
    list.slice().reverse().forEach((ch) => {
      const attrs = ch?.attributes || {};
      const num = attrs.chapter || '?';
      const title = attrs.title || '';
      const label = `Ch. ${num}${title ? ` — ${title}` : ''}`;
      const opt = document.createElement('option');
      opt.value = ch.id;
      opt.textContent = label;
      el.readerChapterSelect.appendChild(opt);
    });

    el.readerQualitySelect.value = state.settings.quality;

    if (el.readerSourceSelect) {
      el.readerSourceSelect.value = normalizeReaderSource(state.settings.readerSource);
      el.readerSourceSelect.onchange = async () => {
        state.settings.readerSource = normalizeReaderSource(el.readerSourceSelect.value);
        saveSettings();
        if (state.current.currentChapterId) {
          await loadChapter(state.current.currentChapterId);
        }
      };
    }

    el.readerChapterSelect.onchange = async () => {
      await loadChapter(el.readerChapterSelect.value);
    };

    el.readerQualitySelect.onchange = async () => {
      state.settings.quality = el.readerQualitySelect.value;
      saveSettings();
      if (state.current.currentChapterId) {
        await loadChapter(state.current.currentChapterId);
      }
    };

    el.readerPrevBtn.onclick = async () => {
      const cur = state.current.currentChapterId;
      const i = state.current.chapterIndexById.get(cur);
      if (i === undefined) return;
      const prev = state.current.chapters[i - 1];
      if (prev?.id) await loadChapter(prev.id);
    };

    el.readerNextBtn.onclick = async () => {
      const cur = state.current.currentChapterId;
      const i = state.current.chapterIndexById.get(cur);
      if (i === undefined) return;
      const next = state.current.chapters[i + 1];
      if (next?.id) await loadChapter(next.id);
    };

    // New chapter badge check (async)
    checkLatestChapterForCurrent().catch(() => {});

    await loadChapter(resolvedId);
  }

  async function checkLatestChapterForCurrent() {
    const mangaId = state.current.mangaId;
    const mangadexId = state.current.mangadexId;
    if (!mangaId || !mangadexId) {
      el.readerBadge.style.display = 'none';
      el.readerBadge.textContent = '';
      return;
    }

    try {
      const feed = await apiGet(`/manga/${mangadexId}/feed`, {
        limit: 1,
        offset: 0,
        'translatedLanguage[]': state.current.chapterLangs,
        'order[readableAt]': 'desc',
      });
      const latest = feed?.data?.[0];
      const latestId = latest?.id || null;
      state.current.latestChapterId = latestId;

      const cont = loadMap(STORAGE.CONTINUE);
      const entry = cont[mangaId];
      const last = entry?.lastChapterId || state.current.currentChapterId;

      const show = !!(latestId && last && latestId !== last);
      el.readerBadge.style.display = show ? 'inline-flex' : 'none';
      el.readerBadge.textContent = show ? 'New chapters available' : '';
    } catch {
      // ignore
    }
  }

  // Fetch /at-home/server with caching: reuse a recent response unless forceRefresh
  const _atHomeCache = new Map(); // chapterId -> { ts, data }
  async function getAtHome(chapterId, forceRefresh = false) {
    const ttl = 4 * 60 * 1000; // 4 min
    const cached = _atHomeCache.get(chapterId);
    if (!forceRefresh && cached && Date.now() - cached.ts < ttl) return cached.data;

    const data = await apiGet(`/at-home/server/${chapterId}`, {});
    _atHomeCache.set(chapterId, { ts: Date.now(), data });
    return data;
  }

  function buildPageUrls(atHome, quality) {
    const baseUrl = atHome?.baseUrl;
    const hash = atHome?.chapter?.hash;
    const files = quality === 'data' ? atHome?.chapter?.data : atHome?.chapter?.dataSaver;
    if (!baseUrl || !hash || !Array.isArray(files) || !files.length) return null;
    return { urls: files.map((fn) => `${baseUrl}/${quality}/${hash}/${fn}`), hash, files };
  }

  function persistReaderProgress(chapterId) {
    const chapter = state.current.chapters.find((item) => item.id === chapterId) || null;
    const chapterNumber = chapter?.attributes?.chapter || null;

    const activeManga = state.mediaById.get(String(state.current.mangaId)) || {
      id: state.current.mangaId,
      sourceIds: {
        anilist: state.current.anilistId,
        mangadex: state.current.mangadexId,
      },
      attributes: {
        title: { en: state.current.mangaTitle },
      },
      relationships: [{ type: 'cover_art', attributes: { coverUrl: state.current.coverUrl } }],
      anilist: {
        chapters: state.current.chapters.length || null,
      },
    };

    ensureContinue(
      activeManga,
      {
        title: state.current.mangaTitle,
        coverUrl: state.current.coverUrl,
        anilistId: state.current.anilistId,
        mangadexId: state.current.mangadexId,
        lastChapterId: chapterId,
        lastChapter: chapterNumber,
        lastReadAt: Date.now(),
        chapterLangs: state.current.chapterLangs,
        totalChapters: activeManga?.anilist?.chapters || state.current.chapters.length || null,
      }
    );

    removeEntry(STORAGE.FINISHED, state.current.mangaId);
    checkLatestChapterForCurrent().catch(() => {});
    checkNewChaptersBadges().catch(() => {});
  }

  async function renderVidsrcChapter(chapterId, readerInfo) {
    const url = buildVidsrcEmbedUrl(readerInfo.anilistId, readerInfo.chapterNumber);

    el.readerPages.classList.add('embed-mode');
    el.readerPages.innerHTML = '';

    const shell = document.createElement('div');
    shell.className = 'reader-embed-shell';

    const frame = document.createElement('iframe');
    frame.id = 'reader-embed-frame';
    frame.src = url;
    frame.title = `${state.current.mangaTitle} chapter ${readerInfo.chapterNumber}`;
    frame.loading = 'eager';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';

    shell.appendChild(frame);
    el.readerPages.appendChild(shell);

    state.current.currentSource = READER_SOURCES.VIDSRC;
    persistReaderProgress(chapterId);
    el.readerScroll.scrollTop = 0;

    setReaderNotice('Using Vidsrc as the primary source. If this embed does not load the chapter properly, switch Source to MangaDex.');
  }

  async function renderMangadexChapter(chapterId) {
    el.readerPages.classList.remove('embed-mode');

    const quality = state.settings.quality === 'data' ? 'data' : 'data-saver';
    let atHome = await getAtHome(chapterId);
    let pageInfo = buildPageUrls(atHome, quality);

    if (!pageInfo) {
      atHome = await getAtHome(chapterId, true);
      pageInfo = buildPageUrls(atHome, quality);
    }
    if (!pageInfo) throw new Error('Missing at-home data');

    let { urls } = pageInfo;

    el.readerPages.innerHTML = '';
    const frag = document.createDocumentFragment();

    let failedCount = 0;
    const totalPages = urls.length;

    const loadImage = (img, pageIndex, wrap) => {
      let retryStage = 0;
      const directUrl = urls[pageIndex];

      const tryLoad = (src) => {
        const next = new Image();
        next.className = 'reader-page';
        next.loading = pageIndex < 3 ? 'eager' : 'lazy';
        next.decoding = 'async';
        next.alt = `Page ${pageIndex + 1}`;

        next.onload = () => {
          wrap.innerHTML = '';
          wrap.appendChild(next);
        };

        next.onerror = () => handleError();
        next.src = src;
      };

      const showPlaceholder = () => {
        failedCount++;
        wrap.innerHTML = '';
        const ph = document.createElement('div');
        ph.style.cssText = 'padding:22px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.10);background:rgba(255,255,255,0.03);color:#ddd;opacity:0.9;text-align:center;';
        ph.style.fontFamily = "'OumaTrialLight', sans-serif";
        ph.textContent = `Failed to load page ${pageIndex + 1}.`;
        wrap.appendChild(ph);

        if (failedCount >= Math.ceil(totalPages * 0.4)) {
          setReaderNotice('Many MangaDex pages failed. The CDN node may be down. Try Reload, or switch quality.');
        }
      };

      const handleError = () => {
        retryStage++;
        if (retryStage === 1 && state.proxyAvailable) {
          tryLoad(`/proxy?url=${encodeURIComponent(directUrl)}`);
        } else if (retryStage <= 2) {
          getAtHome(chapterId, true)
            .then((freshAtHome) => {
              const freshInfo = buildPageUrls(freshAtHome, quality);
              if (freshInfo && freshInfo.urls[pageIndex]) {
                urls[pageIndex] = freshInfo.urls[pageIndex];
                freshInfo.urls.forEach((u, j) => {
                  urls[j] = u;
                });
                tryLoad(freshInfo.urls[pageIndex]);
              } else {
                showPlaceholder();
              }
            })
            .catch(() => showPlaceholder());
        } else if (retryStage === 3 && state.proxyAvailable) {
          tryLoad(`/proxy?url=${encodeURIComponent(urls[pageIndex])}`);
        } else {
          showPlaceholder();
        }
      };

      img.onload = () => {};
      img.onerror = () => handleError();
      img.src = directUrl;
    };

    urls.forEach((u, i) => {
      const wrap = document.createElement('div');
      wrap.style.position = 'relative';

      const img = document.createElement('img');
      img.className = 'reader-page';
      img.loading = i < 3 ? 'eager' : 'lazy';
      img.decoding = 'async';
      img.alt = `Page ${i + 1}`;

      wrap.appendChild(img);
      frag.appendChild(wrap);

      loadImage(img, i, wrap);
    });

    el.readerPages.appendChild(frag);

    state.current.currentSource = READER_SOURCES.MANGADEX;
    persistReaderProgress(chapterId);
    el.readerScroll.scrollTop = 0;
  }

  async function loadChapter(chapterId) {
    if (!chapterId) return;
    if (state.chapterLoading) return; // prevent concurrent loads
    state.chapterLoading = true;

    state.current.currentChapterId = chapterId;

    // Ensure chapter select reflects current
    el.readerChapterSelect.value = chapterId;

    const idx = state.current.chapterIndexById.get(chapterId);
    el.readerPrevBtn.disabled = idx === undefined ? true : idx <= 0;
    el.readerNextBtn.disabled = idx === undefined ? true : idx >= state.current.chapters.length - 1;

    el.readerPages.innerHTML = '<div style="padding:18px; opacity:0.75; text-align:center;">Loading pages…</div>';
    el.readerPages.classList.remove('embed-mode');
    setReaderNotice('');

    try {
      const chapter = state.current.chapters.find((c) => c.id === chapterId) || null;
      const readerInfo = resolveReaderSource(chapter);
      state.current.currentSource = readerInfo.source;
      syncReaderSourceUI(readerInfo);

      if (readerInfo.source === READER_SOURCES.VIDSRC) {
        await renderVidsrcChapter(chapterId, readerInfo);
      } else {
        await renderMangadexChapter(chapterId);
        if (readerInfo.requested === READER_SOURCES.VIDSRC && readerInfo.fallbackReason) {
          setReaderNotice(`Using MangaDex fallback. ${readerInfo.fallbackReason}`);
        } else {
          setReaderNotice('Using MangaDex as the fallback source.');
        }
      }

    } catch (e) {
      console.error(e);
      el.readerPages.innerHTML = '<div style="padding:18px; opacity:0.75; text-align:center;">Failed to load chapter pages. Hit Reload to try again.</div>';
      setReaderNotice('Could not load the current reader source. Try Reload or switch Source.');
    } finally {
      state.chapterLoading = false;
    }
  }

  function wireDropdownMenu() {
    const dropdown = document.querySelector('.dropdown');
    const toggle = $('dropdownToggle');

    toggle.addEventListener('click', (e) => {
      dropdown.classList.toggle('open');
      toggle.setAttribute('aria-expanded', dropdown.classList.contains('open'));
      e.stopPropagation();
    });

    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });

    toggle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        dropdown.classList.toggle('open');
        toggle.setAttribute('aria-expanded', dropdown.classList.contains('open'));
        e.preventDefault();
      }
    });
  }

  function wireOverlays() {
    el.detailClose.addEventListener('click', () => {
      el.detailOverlay.classList.remove('open');
    });

    el.detailOverlay.addEventListener('click', (e) => {
      if (e.target === el.detailOverlay) {
        el.detailOverlay.classList.remove('open');
      }
    });

    el.readerClose.addEventListener('click', closeReaderUI);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (el.readerOverlay.style.display === 'block') closeReaderUI();
        else if (el.detailOverlay.classList.contains('open')) el.detailOverlay.classList.remove('open');
      }
    });
  }

  function wireSearchUI() {
    const openSearchPanel = () => {
      if (el.searchPanel) el.searchPanel.hidden = false;
    };

    const closeSearchPanel = () => {
      if (el.searchPanel) el.searchPanel.hidden = true;
    };

    const resetSearchFilters = () => {
      el.filterSort.value = 'relevance';
      el.filterStatus.value = '';
      el.filterDemo.value = '';
      el.filterOriginalLang.value = '';
      el.filterYear.value = '';
      el.filterHasChapters.checked = true;
      state.includeTags.clear();
      state.excludeTags.clear();
      state.settings.contentRatings = [...DEFAULT_SETTINGS.contentRatings];
      state.settings.includedTagsMode = DEFAULT_SETTINGS.includedTagsMode;
      state.settings.excludedTagsMode = DEFAULT_SETTINGS.excludedTagsMode;
      el.tagsModeInclude.value = state.settings.includedTagsMode;
      el.tagsModeExclude.value = state.settings.excludedTagsMode;
      saveSettings();
      initContentRatingUI();
      renderTagChips();
      performSearch(1);
    };

    el.searchInput.addEventListener('focus', openSearchPanel);
    if (el.searchWrap) {
      el.searchWrap.addEventListener('click', (event) => {
        if (event.target instanceof HTMLElement && event.target.closest('#search-panel-close')) return;
        openSearchPanel();
      });
    }

    el.searchInput.addEventListener('input', () => {
      el.clearBtn.style.display = el.searchInput.value ? 'block' : 'none';

      if (searchDebounce) clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => performSearch(1), 320);
    });

    el.clearBtn.addEventListener('click', () => {
      el.searchInput.value = '';
      el.clearBtn.style.display = 'none';
      performSearch(1);
      el.searchInput.focus();
    });

    if (el.searchResetBtn) {
      el.searchResetBtn.addEventListener('click', resetSearchFilters);
    }

    if (el.searchPanelCloseBtn) {
      el.searchPanelCloseBtn.addEventListener('click', () => {
        closeSearchPanel();
      });
    }

    el.closeSearchBtn.addEventListener('click', () => {
      el.searchInput.value = '';
      el.clearBtn.style.display = 'none';
      el.results.innerHTML = '';
      el.searchPagination.innerHTML = '';
      showResults(false);
      closeSearchPanel();
    });

    document.addEventListener('click', (event) => {
      if (!el.searchWrap?.contains(event.target)) {
        closeSearchPanel();
      }
    });

    // Filter changes trigger a new search
    const triggers = [
      el.filterSort,
      el.filterStatus,
      el.filterDemo,
      el.filterOriginalLang,
      el.filterHasChapters,
    ];
    triggers.forEach((t) => t.addEventListener('change', () => performSearch(1)));

    // Year is an input; search as user types (not only on blur)
    el.filterYear.addEventListener('input', () => {
      if (searchDebounce) clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => performSearch(1), 320);
    });

    // Content rating toggles
    el.contentRatingChecks.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        state.settings.contentRatings = selectedContentRatings();
        saveSettings();
        performSearch(1);
      });
    });

    // Tag adders
    el.includeTagAdd.addEventListener('click', () => addTagFromInput('include'));
    el.excludeTagAdd.addEventListener('click', () => addTagFromInput('exclude'));

    el.includeTagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTagFromInput('include');
      }
    });

    el.excludeTagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTagFromInput('exclude');
      }
    });

    el.tagsModeInclude.addEventListener('change', () => {
      state.settings.includedTagsMode = el.tagsModeInclude.value;
      saveSettings();
      performSearch(1);
    });

    el.tagsModeExclude.addEventListener('change', () => {
      state.settings.excludedTagsMode = el.tagsModeExclude.value;
      saveSettings();
      performSearch(1);
    });
  }

  function addTagFromInput(kind) {
    const input = kind === 'include' ? el.includeTagInput : el.excludeTagInput;
    const name = (input.value || '').trim().toLowerCase();
    if (!name) return;

    const tag = state.tagByName.get(name);
    if (!tag?.id) return;

    if (kind === 'include') {
      state.includeTags.add(tag.id);
      state.excludeTags.delete(tag.id);
    } else {
      state.excludeTags.add(tag.id);
      state.includeTags.delete(tag.id);
    }

    input.value = '';
    renderTagChips();
    performSearch(1);
  }

  function wireReaderTools() {
    el.readerReload.addEventListener('click', () => {
      // Clear at-home cache so we get a fresh CDN node
      if (state.current.currentChapterId) {
        _atHomeCache.delete(state.current.currentChapterId);
        loadChapter(state.current.currentChapterId);
      }
    });

    if (el.readerFitModeSelect) {
      el.readerFitModeSelect.addEventListener('change', () => {
        applyReaderFitMode(el.readerFitModeSelect.value);
      });
    }

    if (el.readerPanelToggleBtn) {
      el.readerPanelToggleBtn.addEventListener('click', () => toggleReaderPanel());
    }

    if (el.readerFloatingPanelBtn) {
      el.readerFloatingPanelBtn.addEventListener('click', () => toggleReaderPanel());
    }

    if (el.readerFullscreenBtn) {
      el.readerFullscreenBtn.addEventListener('click', () => {
        toggleReaderFullscreen();
      });

      const syncIcon = () => {
        const icon = el.readerFullscreenBtn.querySelector('.material-symbols-outlined');
        if (!icon) return;
        icon.textContent = document.fullscreenElement ? 'fullscreen_exit' : 'fullscreen';
      };
      document.addEventListener('fullscreenchange', syncIcon);
      syncIcon();
    }
  }

  function initContentRatingUI() {
    // seed from settings
    const selected = new Set(state.settings.contentRatings || DEFAULT_SETTINGS.contentRatings);
    for (const cb of el.contentRatingChecks.querySelectorAll('input[type="checkbox"]')) {
      cb.checked = selected.has(cb.value);
    }
  }

  function migrateStoredEntries() {
    [STORAGE.CONTINUE, STORAGE.READ_LATER, STORAGE.FINISHED].forEach((key) => {
      const map = loadMap(key);
      let changed = false;

      Object.values(map).forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;

        if (!entry.anilistId && isAniListNumericId(entry.mangaId)) {
          entry.anilistId = String(entry.mangaId);
          changed = true;
        }

        if (!entry.mangadexId && !isAniListNumericId(entry.mangaId)) {
          entry.mangadexId = String(entry.mangaId);
          changed = true;
        }
      });

      if (changed) {
        saveMap(key, map);
      }
    });
  }

  async function init() {
    // elements
    el.searchInput = $('search-input');
    el.searchWrap = $('search-wrap');
    el.searchPanel = $('search-panel');
    el.searchResetBtn = $('search-reset');
    el.searchPanelCloseBtn = $('search-panel-close');
    el.clearBtn = $('clear-search-btn');
    el.results = $('results');
    el.searchPagination = $('search-pagination');
    el.searchResultsWrapper = $('search-results-wrapper');
    el.closeSearchBtn = $('close-search-results');

    el.jumpRandomBtn = $('jump-random');
    el.jumpContinueBtn = $('jump-continue');
    el.jumpReadLaterBtn = $('jump-readlater');
    el.jumpFinishedBtn = $('jump-finished');

    el.filterSort = $('filter-sort');
    el.filterStatus = $('filter-status');
    el.filterDemo = $('filter-demo');
    el.filterOriginalLang = $('filter-original-lang');
    el.filterYear = $('filter-year');
    el.filterHasChapters = $('filter-has-chapters');

    el.contentRatingChecks = $('content-rating-checks');

    el.includeTagInput = $('include-tag-input');
    el.excludeTagInput = $('exclude-tag-input');
    el.includeTagAdd = $('include-tag-add');
    el.excludeTagAdd = $('exclude-tag-add');
    el.includeTagChips = $('include-tag-chips');
    el.excludeTagChips = $('exclude-tag-chips');
    el.tagsModeInclude = $('tags-mode-include');
    el.tagsModeExclude = $('tags-mode-exclude');
    el.tagDatalist = $('tag-datalist');

    el.trendingGrid = $('trendingGrid');
    el.popularGrid = $('popularGrid');
    el.topRatedGrid = $('topRatedGrid');
    el.newGrid = $('newGrid');

    el.showcaseBg = $('showcase-bg');
    el.showcaseSection = $('showcase');
    el.showcasePoster = $('showcase-poster');
    el.showcaseTitle = $('showcase-title');
    el.showcaseMeta = $('showcase-meta');
    el.showcaseOverview = $('showcase-overview');
    el.showcaseActions = $('showcase-actions');
    el.showcaseReadBtn = $('showcase-read');
    el.showcaseLaterBtn = $('showcase-readlater');

    el.continueSection = $('continueSection');
    el.readLaterSection = $('readLaterSection');
    el.finishedSection = $('finishedSection');
    el.continueGrid = $('continueGrid');
    el.readLaterGrid = $('readLaterGrid');
    el.finishedGrid = $('finishedGrid');

    el.detailOverlay = $('manga-detail-overlay');
    el.detailClose = $('detail-close');
    el.detailPanel = $('manga-detail-panel');

    el.readerOverlay = $('manga-reader-overlay');
    el.readerClose = $('reader-close');
    el.readerPanelToggleBtn = $('reader-panel-toggle');
    el.readerFloatingPanelBtn = $('reader-floating-panel');
    el.readerTitle = $('reader-title');
    el.readerBadge = $('reader-badge');
    el.readerProxyHint = $('reader-proxy-hint');
    el.readerSourceSelect = $('reader-source-select');
    el.readerChapterSelect = $('reader-chapter-select');
    el.readerQualitySelect = $('reader-quality');
    el.readerPrevBtn = $('reader-prev');
    el.readerNextBtn = $('reader-next');
    el.readerPages = $('reader-pages');
    el.readerScroll = $('reader-scroll');
    el.readerReload = $('reader-reload');
    el.readerFitModeSelect = $('reader-fit-mode');
    el.readerFullscreenBtn = $('reader-fullscreen');

    el.statusBar = $('status-bar');
    el.statusText = $('status-text');

    loadSettings();
    migrateStoredEntries();
    await checkProxyAvailability();

    // Apply fit mode to UI
    applyReaderFitMode(state.settings.readerFitMode);
    applyReaderPanelState();

    initContentRatingUI();

    wireDropdownMenu();
    wireOverlays();
    wireSearchUI();
    wireReaderTools();

    // Library quick jumps
    const scrollTo = (sectionEl) => {
      if (!sectionEl || sectionEl.style.display === 'none') return false;
      sectionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return true;
    };

    if (el.jumpRandomBtn) {
      el.jumpRandomBtn.addEventListener('click', () => {
        spinRandomIcon();
        const target = randomLoadedManga();
        if (!target) {
          flashStatus('No manga loaded yet.');
          return;
        }
        openMangaDetail(target.id);
      });
    }

    if (el.jumpContinueBtn) {
      el.jumpContinueBtn.addEventListener('click', () => {
        if (!scrollTo(el.continueSection)) flashStatus('No Continue Reading yet.');
      });
    }
    if (el.jumpReadLaterBtn) {
      el.jumpReadLaterBtn.addEventListener('click', () => {
        if (!scrollTo(el.readLaterSection)) flashStatus('No Read Later yet.');
      });
    }
    if (el.jumpFinishedBtn) {
      el.jumpFinishedBtn.addEventListener('click', () => {
        if (!scrollTo(el.finishedSection)) flashStatus('No Finished list yet.');
      });
    }

    // Tags
    try {
      await loadTags();
    } catch (e) {
      console.warn('Failed to load tags', e);
    }

    renderTagChips();

    // Apply settings to UI bits
    el.tagsModeInclude.value = state.settings.includedTagsMode;
    el.tagsModeExclude.value = state.settings.excludedTagsMode;

    // Discovery + library
    renderLibrarySections();
    await loadDiscovery();

    // badge check
    checkNewChaptersBadges().catch(() => {});

    // periodic check (light)
    setInterval(() => {
      checkNewChaptersBadges().catch(() => {});
    }, 1000 * 60 * 8);
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((e) => {
      console.error(e);
      setStatus('Failed to start.');
    });
  });
})();
