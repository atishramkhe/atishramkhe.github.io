const DISCOVERY_URL = './data/discovery.json';
const CATALOG_URL = './data/catalog.json';
const SERIES_MANIFEST_BASE_URL = './data/series/';
const COMICS_LIBRARY_KEY = 'ateaish-comics-library-v1';
const CARD_LIMIT = 72;
const SEARCH_DEBOUNCE_MS = 220;
const GENRE_OPTIONS = [
  'Action', 'Adventure', 'Anthology', 'Anthropomorphic', 'Biography', 'Children', 'Comedy', 'Crime', 'Drama', 'Family',
  'Fantasy', 'Fighting', 'Graphic Novels', 'Historical', 'Horror', 'Leading Ladies', 'LGBTQ', 'Literature', 'Manga',
  'Martial Arts', 'Mature', 'Military', 'Mini-Series', 'Movies & TV', 'Music', 'Mystery', 'Mythology', 'Personal',
  'Political', 'Post-Apocalyptic', 'Psychological', 'Pulp', 'Religious', 'Robots', 'Romance', 'Satire', 'School Life',
  'Sci-Fi', 'Slice of Life', 'Sport', 'Spy', 'Superhero', 'Supernatural', 'Suspense', 'Teen', 'Thriller', 'Vampires',
  'Video Games', 'War', 'Western', 'Zombies'
];

const searchWrap = document.getElementById('search-wrap');
const searchPanel = document.getElementById('search-panel');
const searchReset = document.getElementById('search-reset');
const searchScope = document.getElementById('search-scope');
const searchSection = document.getElementById('search-section');
const searchGenre = document.getElementById('search-genre');
const searchStatus = document.getElementById('search-status');
const searchSort = document.getElementById('search-sort');
const searchBrowseChips = document.getElementById('search-browse-chips');
const searchMeta = document.getElementById('search-meta');
const featuredSections = document.getElementById('featured-sections');
const librarySections = document.getElementById('library-sections');
const sectionList = document.getElementById('section-list');
const quickStrip = document.getElementById('quick-strip');
const searchInput = document.getElementById('search-input');
const clearSearch = document.getElementById('clear-search');
const searchResults = document.getElementById('search-results');
const resultsGrid = document.getElementById('results-grid');
const resultsTitle = document.getElementById('results-title');
const resultsCopy = document.getElementById('results-copy');
const resultsStatus = document.getElementById('results-status');

const detailBackdrop = document.getElementById('detail-backdrop');
const detailClose = document.getElementById('detail-close');
const detailTitle = document.getElementById('detail-title');
const detailKicker = document.getElementById('detail-kicker');
const detailImage = document.getElementById('detail-image');
const detailMeta = document.getElementById('detail-meta');
const detailCopy = document.getElementById('detail-copy');
const detailReader = document.getElementById('detail-reader');
const detailLater = document.getElementById('detail-later');
const detailFinished = document.getElementById('detail-finished');
const detailSeries = document.getElementById('detail-series');
const detailLatest = document.getElementById('detail-latest');

const state = {
  discovery: null,
  catalog: null,
  catalogPromise: null,
  manifestPromises: new Map(),
  discoveryItems: [],
  discoverySections: [],
  searchTerm: '',
  searchFilters: {
    scope: 'catalog',
    section: 'all',
    genre: 'all',
    status: 'all',
    sort: 'relevance',
  },
  activeDetailItem: null,
  libraryState: {
    hasContinue: false,
    hasLater: false,
    hasFinished: false,
  },
  searchRequestId: 0,
};

function getFreshDropsSections(sections = []) {
  return sections.filter((section) => /fresh\s*drops|fresh\s*drop|newest/i.test(section.title || ''));
}

function getNonFeaturedSections(sections = []) {
  return sections.filter((section) => !/fresh\s*drops|fresh\s*drop|newest/i.test(section.title || ''));
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatTimestamp(value) {
  if (!value) return 'Unknown update';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function inferGenres(item) {
  const haystack = normalize(`${item.title || ''} ${item.context || ''} ${item.latest_label || ''} ${item.source_section || ''}`);
  return GENRE_OPTIONS
    .map((genre) => ({ label: genre, key: normalize(genre) }))
    .filter((genre) => haystack.includes(genre.key))
    .map((genre) => genre.key);
}

function extractStatus(context) {
  const match = String(context || '').match(/Status:\s*([^|]+)/i);
  return normalize(match ? match[1] : '');
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getSeriesSlug(item) || item.series_url || item.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getDiscoveryItems(sections = []) {
  return dedupeItems(
    sections.flatMap((section) =>
      (section.items || []).map((item) => ({
        ...item,
        source_section: item.source_section || section.title || '',
        _status: extractStatus(item.context),
        _section: normalize(item.source_section || section.title || ''),
        _search: normalize(`${item.title} ${item.latest_label || ''} ${item.context || ''} ${item.source_section || section.title || ''}`),
      }))
    )
  );
}

function updateClearSearchVisibility() {
  const hasFilters = state.searchFilters.scope !== 'catalog'
    || state.searchFilters.section !== 'all'
    || state.searchFilters.genre !== 'all'
    || state.searchFilters.status !== 'all'
    || state.searchFilters.sort !== 'relevance';
  clearSearch.style.display = state.searchTerm || hasFilters ? 'block' : 'none';
}

function setSearchPanelOpen(open) {
  searchPanel.hidden = !open;
  searchWrap.classList.toggle('active', open);
}

function syncSearchControls() {
  searchScope.value = state.searchFilters.scope;
  searchSection.value = state.searchFilters.section;
  searchGenre.value = state.searchFilters.genre;
  searchStatus.value = state.searchFilters.status;
  searchSort.value = state.searchFilters.sort;
  updateClearSearchVisibility();
}

function buildSearchMeta(meta) {
  if (!searchMeta) return;
  searchMeta.innerHTML = `
    <div class="search-meta-card">
      <span class="search-meta-value">${formatNumber(meta.catalog_total || 0)}</span>
      <span class="search-meta-label">Indexed series in the full local catalog</span>
    </div>
    <div class="search-meta-card">
      <span class="search-meta-value">${meta.section_count || 0}</span>
      <span class="search-meta-label">Discovery rails available for quick browsing</span>
    </div>
    <div class="search-meta-card">
      <span class="search-meta-value">${meta.catalog_pages || '?'}</span>
      <span class="search-meta-label">Source pages scraped into the catalog snapshot</span>
    </div>
    <div class="search-meta-card">
      <span class="search-meta-value">${formatTimestamp(meta.generated_at)}</span>
      <span class="search-meta-label">Most recent local snapshot build date</span>
    </div>
  `;
}

function renderSearchBrowseChips() {
  if (!searchBrowseChips) return;
  const quickOptions = [
    { label: 'Full catalog', type: 'scope', value: 'catalog', active: state.searchFilters.scope === 'catalog' && state.searchFilters.section === 'all' },
    { label: 'Discovery rails', type: 'scope', value: 'discovery', active: state.searchFilters.scope === 'discovery' && state.searchFilters.section === 'all' },
    { label: 'Superhero', type: 'genre', value: normalize('Superhero'), active: state.searchFilters.genre === normalize('Superhero') },
    { label: 'Sci-Fi', type: 'genre', value: normalize('Sci-Fi'), active: state.searchFilters.genre === normalize('Sci-Fi') },
    { label: 'Horror', type: 'genre', value: normalize('Horror'), active: state.searchFilters.genre === normalize('Horror') },
    { label: 'Manga', type: 'genre', value: normalize('Manga'), active: state.searchFilters.genre === normalize('Manga') },
    { label: 'Ongoing', type: 'status', value: 'ongoing', active: state.searchFilters.status === 'ongoing' },
    { label: 'Completed', type: 'status', value: 'completed', active: state.searchFilters.status === 'completed' },
    ...state.discoverySections.slice(0, 6).map((section) => ({
      label: section.title,
      type: 'section',
      value: normalize(section.title),
      active: state.searchFilters.section === normalize(section.title),
    })),
  ];

  searchBrowseChips.innerHTML = '';
  quickOptions.forEach((entry) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `chip${entry.active ? ' is-active' : ''}`;
    button.textContent = entry.label;
    button.addEventListener('click', () => {
      if (entry.type === 'scope') {
        state.searchFilters.scope = entry.value;
        if (entry.value === 'catalog') state.searchFilters.section = 'all';
      }
      if (entry.type === 'section') {
        state.searchFilters.scope = 'discovery';
        state.searchFilters.section = entry.value;
      }
      if (entry.type === 'genre') {
        state.searchFilters.genre = state.searchFilters.genre === entry.value ? 'all' : entry.value;
      }
      if (entry.type === 'status') {
        state.searchFilters.status = state.searchFilters.status === entry.value ? 'all' : entry.value;
      }
      syncSearchControls();
      renderSearchBrowseChips();
      void updateSearchResults();
    });
    searchBrowseChips.appendChild(button);
  });
}

function renderQuickStrip() {
  const buttons = [
    {
      label: 'Random comic',
      icon: '⚄',
      accent: true,
      action: (button) => {
        const icon = button.querySelector('.chip-icon');
        if (icon) {
          icon.classList.remove('is-spinning');
          void icon.offsetWidth;
          icon.classList.add('is-spinning');
          window.setTimeout(() => icon.classList.remove('is-spinning'), 560);
        }
        void surpriseMe();
      },
    },
  ];

  if (state.libraryState.hasContinue) {
    buttons.push({ label: 'Continue reading', action: () => document.getElementById('continue-reading-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) });
  }
  if (state.libraryState.hasLater) {
    buttons.push({ label: 'Read later', action: () => document.getElementById('read-later-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) });
  }

  quickStrip.innerHTML = '';
  buttons.forEach((entry) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `chip${entry.accent ? ' chip-accent' : ''}`;
    button.innerHTML = entry.icon
      ? `<span class="chip-icon" aria-hidden="true">${escapeHtml(entry.icon)}</span><span>${escapeHtml(entry.label)}</span>`
      : `<span>${escapeHtml(entry.label)}</span>`;
    button.addEventListener('click', () => entry.action(button));
    quickStrip.appendChild(button);
  });
}

function renderSearchGenreOptions() {
  const options = ['<option value="all">All genres</option>']
    .concat(GENRE_OPTIONS.map((genre) => `<option value="${escapeHtml(normalize(genre))}">${escapeHtml(genre)}</option>`));
  searchGenre.innerHTML = options.join('');
  syncSearchControls();
}

function renderSearchSectionOptions() {
  const options = ['<option value="all">All categories</option>']
    .concat(
      state.discoverySections.map((section) => {
        const value = normalize(section.title);
        return `<option value="${escapeHtml(value)}">${escapeHtml(section.title)}</option>`;
      })
    );
  searchSection.innerHTML = options.join('');
  syncSearchControls();
}

function getSearchContext() {
  const term = state.searchTerm.trim();
  const query = normalize(term);
  const usingDiscovery = state.searchFilters.scope === 'discovery' || state.searchFilters.section !== 'all';
  return {
    term,
    query,
    usingDiscovery,
    hasQuery: query.length >= 2,
    hasBrowseFilter: usingDiscovery || state.searchFilters.genre !== 'all' || state.searchFilters.status !== 'all',
  };
}

function sortSearchResults(items, query) {
  const sorted = [...items];
  if (state.searchFilters.sort === 'title-asc') {
    sorted.sort((left, right) => left.title.localeCompare(right.title));
    return sorted;
  }
  if (state.searchFilters.sort === 'title-desc') {
    sorted.sort((left, right) => right.title.localeCompare(left.title));
    return sorted;
  }

  sorted.sort((left, right) => {
    const leftIndex = query ? left._search.indexOf(query) : 0;
    const rightIndex = query ? right._search.indexOf(query) : 0;
    return leftIndex - rightIndex || left.title.localeCompare(right.title);
  });
  return sorted;
}

function getSearchHeading(total, context) {
  const activeSection = state.discoverySections.find((section) => normalize(section.title) === state.searchFilters.section);
  if (context.term && context.hasBrowseFilter) {
    return {
      title: `Filtered results for “${context.term}”`,
      copy: `Showing ${Math.min(total, CARD_LIMIT)} matches after applying the active browse filters.`,
    };
  }
  if (context.term) {
    return {
      title: `Results for “${context.term}”`,
      copy: `Showing the best ${Math.min(total, CARD_LIMIT)} matches from the local catalog snapshot.`,
    };
  }
  if (activeSection) {
    return {
      title: activeSection.title,
      copy: 'Browsing the current discovery rail without needing a text query.',
    };
  }
  if (state.searchFilters.status !== 'all') {
    return {
      title: `${state.searchFilters.status[0].toUpperCase()}${state.searchFilters.status.slice(1)} series`,
      copy: 'Browsing catalog matches by status only.',
    };
  }
  if (state.searchFilters.genre !== 'all') {
    const activeGenre = GENRE_OPTIONS.find((genre) => normalize(genre) === state.searchFilters.genre) || state.searchFilters.genre;
    return {
      title: `${activeGenre} comics`,
      copy: 'Browsing the indexed catalog by genre keyword.',
    };
  }
  return {
    title: state.searchFilters.scope === 'discovery' ? 'Discovery rails' : 'Browse catalog',
    copy: 'Using the active search scope without a typed query.',
  };
}

function readLibraryMap() {
  try {
    const raw = localStorage.getItem(COMICS_LIBRARY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLibraryMap(map) {
  localStorage.setItem(COMICS_LIBRARY_KEY, JSON.stringify(map));
}

function getLibraryEntry(seriesSlug) {
  return readLibraryMap()[seriesSlug] || null;
}

function updateLibraryEntry(seriesSlug, updater) {
  if (!seriesSlug) return null;
  const library = readLibraryMap();
  const current = library[seriesSlug] || { series_slug: seriesSlug };
  const updated = updater(current);
  const next = updated === undefined ? current : updated;
  const hasProgress = Boolean(next?.last_read_at || Number.isInteger(next?.last_page_index) || next?.last_issue_slug);
  const hasPinnedState = Boolean(next?.read_later || next?.finished || next?.completed_series || next?.finished_dismissed);
  if (!next || (!hasProgress && !hasPinnedState)) {
    delete library[seriesSlug];
    writeLibraryMap(library);
    return null;
  }
  library[seriesSlug] = next;
  writeLibraryMap(library);
  return next;
}

function buildLibrarySeed(item, current, seriesSlug) {
  const latestIssue = getLatestIssueFromItem(item);
  return {
    ...current,
    series_slug: seriesSlug,
    title: item.title || current.title || seriesSlug.replace(/-/g, ' '),
    cover_url: item.cover_url || current.cover_url || './assets/ateaish_comics_default.webp',
    series_url: withAbsoluteUrl(item.series_url || current.series_url || ''),
    updated_at: Date.now(),
    last_issue_slug: current.last_issue_slug || latestIssue?.issue_slug || '',
    last_issue_id: current.last_issue_id || latestIssue?.issue_id || '',
    last_issue_title: current.last_issue_title || latestIssue?.issue_title || '',
    last_issue_url: current.last_issue_url || latestIssue?.issue_url || '',
  };
}

function rerenderLibrarySurfaces() {
  void renderLibrarySections();
  if (state.discovery) renderDiscovery();
  if (searchResults.classList.contains('active')) {
    void updateSearchResults();
  }
}

function toggleReadLaterForItem(item) {
  const seriesSlug = getSeriesSlug(item);
  if (!seriesSlug) return null;
  const nextEntry = updateLibraryEntry(seriesSlug, (current) => {
    const seeded = buildLibrarySeed(item, current, seriesSlug);
    const nextReadLater = !current.read_later;
    return {
      ...seeded,
      read_later: nextReadLater,
      read_later_at: nextReadLater ? Date.now() : null,
      finished: false,
      finished_at: null,
    };
  });
  rerenderLibrarySurfaces();
  return nextEntry;
}

function clearLibrarySectionEntry(entry, mode) {
  if (!entry?.series_slug) return;
  updateLibraryEntry(entry.series_slug, (current) => {
    if (mode === 'continue') {
      return {
        ...current,
        last_read_at: null,
        last_page_index: null,
        last_page_number: null,
        last_page_count: null,
        last_issue_slug: '',
        last_issue_id: '',
        last_issue_title: '',
        last_issue_url: '',
        updated_at: Date.now(),
      };
    }
    if (mode === 'later') {
      return {
        ...current,
        read_later: false,
        read_later_at: null,
        updated_at: Date.now(),
      };
    }
    if (mode === 'finished') {
      return {
        ...current,
        finished: false,
        finished_at: null,
        finished_dismissed: Boolean(current.completed_series || entry.completed_series),
        updated_at: Date.now(),
      };
    }
    return current;
  });
  rerenderLibrarySurfaces();
}

function getLibraryEntries() {
  return Object.values(readLibraryMap()).sort((left, right) => {
    const leftScore = left.updated_at || left.last_read_at || left.read_later_at || left.finished_at || 0;
    const rightScore = right.updated_at || right.last_read_at || right.read_later_at || right.finished_at || 0;
    return rightScore - leftScore;
  });
}

function withAbsoluteUrl(url) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://readcomiconline.li${url}`;
}

function getSeriesSlug(item) {
  const url = withAbsoluteUrl(item?.series_url || item?.issue_url || '');
  const match = url.match(/\/Comic\/([^/?#]+)/i);
  return match ? match[1] : '';
}

function getIssueSlug(issueUrl) {
  const url = withAbsoluteUrl(issueUrl || '');
  const match = url.match(/\/Comic\/[^/]+\/([^/?#]+)/i);
  return match ? match[1] : '';
}

function getIssueId(issueUrl) {
  const url = withAbsoluteUrl(issueUrl || '');
  const match = url.match(/[?&]id=(\d+)/i);
  return match ? match[1] : '';
}

function getReaderUrl(item, progressEntry = null, forceContinue = false) {
  const seriesSlug = progressEntry?.series_slug || getSeriesSlug(item);
  if (!seriesSlug) return './reader.html';
  const params = new URLSearchParams({ series: seriesSlug });
  const issueSlug = progressEntry?.last_issue_slug || '';
  const issueId = progressEntry?.last_issue_id || '';
  const pageNumber = Number.isInteger(progressEntry?.last_page_number)
    ? progressEntry.last_page_number
    : Number.isInteger(progressEntry?.last_page_index)
      ? progressEntry.last_page_index + 1
      : null;
  if (issueSlug) params.set('issue', issueSlug);
  if (issueId) params.set('id', issueId);
  if (pageNumber !== null) params.set('page', String(Math.max(1, pageNumber)));
  if (forceContinue) params.set('continue', '1');
  return `./reader.html?${params.toString()}`;
}

function getLatestIssueFromItem(item) {
  const issueUrl = withAbsoluteUrl(item?.issue_url || '');
  if (!issueUrl) return null;
  return {
    issue_slug: getIssueSlug(issueUrl),
    issue_id: getIssueId(issueUrl),
    issue_title: item.latest_label || '',
    issue_url: issueUrl,
  };
}

function openReader(url) {
  window.location.href = url;
}

function isIssueProgressComplete(entry) {
  if (!entry) return false;
  const lastPageCount = Number.isInteger(entry.last_page_count) ? entry.last_page_count : 0;
  if (lastPageCount <= 0) return false;
  const lastPageNumber = Number.isInteger(entry.last_page_number)
    ? entry.last_page_number
    : Number.isInteger(entry.last_page_index)
      ? entry.last_page_index + 1
      : 0;
  return lastPageNumber >= lastPageCount;
}

function getResumeEntry(entry) {
  if (!entry) return null;
  if (!entry.resume_on_next_issue || !entry.next_issue_slug) return entry;
  return {
    ...entry,
    last_issue_slug: entry.next_issue_slug,
    last_issue_id: entry.next_issue_id || '',
    last_issue_title: entry.next_issue_title || '',
    last_issue_url: entry.next_issue_url || '',
    last_page_index: 0,
    last_page_number: 1,
    last_page_count: Number.isInteger(entry.next_issue_page_count) ? entry.next_issue_page_count : null,
  };
}

function formatRelativeDate(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

async function loadSeriesManifest(seriesSlug) {
  if (!seriesSlug) return null;
  if (!state.manifestPromises.has(seriesSlug)) {
    state.manifestPromises.set(
      seriesSlug,
      fetch(`${SERIES_MANIFEST_BASE_URL}${encodeURIComponent(seriesSlug)}.json`)
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null)
    );
  }
  return state.manifestPromises.get(seriesSlug);
}

function extractIssueSequence(issue) {
  const candidates = [issue?.issue_slug, issue?.title, issue?.issue_url];
  for (const candidate of candidates) {
    const match = String(candidate || '').match(/issue[-\s#]*(\d+(?:\.\d+)?)/i);
    if (match) return Number.parseFloat(match[1]);
  }
  return null;
}

function sortManifestIssues(manifest) {
  if (!Array.isArray(manifest?.issues)) return manifest;
  const issues = manifest.issues
    .map((issue, index) => ({
      ...issue,
      _originalIndex: index,
      _sequence: extractIssueSequence(issue),
    }))
    .sort((left, right) => {
      if (left._sequence !== null && right._sequence !== null) {
        return left._sequence - right._sequence || left._originalIndex - right._originalIndex;
      }
      if (left._sequence !== null) return -1;
      if (right._sequence !== null) return 1;
      return left._originalIndex - right._originalIndex;
    })
    .map(({ _originalIndex, _sequence, ...issue }) => issue);
  return { ...manifest, issues };
}

async function filterItemsWithManifest(items) {
  const availability = await Promise.all(items.map(async (item) => {
    const seriesSlug = getSeriesSlug(item);
    if (!seriesSlug) return null;
    const manifest = sortManifestIssues(await loadSeriesManifest(seriesSlug));
    if (!manifest?.issues?.length) return null;
    return {
      ...item,
      cover_url: manifest.cover_url || item.cover_url || './assets/ateaish_comics_default.webp',
      series_url: manifest.series_url || item.series_url,
      issue_url: item.issue_url || manifest.issues[manifest.issues.length - 1]?.issue_url || '',
    };
  }));
  return availability.filter(Boolean);
}

function buildRandomDiscoverySection(items) {
  const pool = [...items];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  return {
    id: 'random-picks',
    title: 'Random Comics',
    nav_label: 'Random',
    description: 'A rotating mix of extracted comics picked from the local library-ready pool.',
    source_url: 'https://readcomiconline.li/',
    items: pool.slice(0, 18).map((item) => ({
      ...item,
      source_section: 'Random Comics',
    })),
  };
}

async function prepareDiscoveryPayload(payload) {
  const filteredSections = [];
  for (const section of payload.sections || []) {
    const filteredItems = await filterItemsWithManifest(section.items || []);
    if (!filteredItems.length) continue;
    filteredSections.push({
      ...section,
      items: filteredItems,
    });
  }
  const freshSections = filteredSections.filter((section) => /fresh\s*drops|fresh\s*drop|newest/i.test(section.title || ''));
  const standardSections = filteredSections.filter((section) => !/fresh\s*drops|fresh\s*drop|newest/i.test(section.title || ''));
  const orderedSections = [...freshSections, ...standardSections];
  const discoveryItems = getDiscoveryItems(filteredSections);
  if (discoveryItems.length) {
    orderedSections.push(buildRandomDiscoverySection(discoveryItems));
  }
  return {
    ...payload,
    sections: orderedSections,
    meta: {
      ...payload.meta,
      section_count: orderedSections.length,
    },
  };
}

function buildProgressMarkup(progress) {
  if (!progress) return '';
  const rows = [];
  if (progress.issueRatio !== null) {
    rows.push(`
      <div class="progress-block">
        <div class="progress-meta">
          <span>Issue</span>
          <span>${Math.round(progress.issueRatio * 100)}%</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${Math.max(0, Math.min(progress.issueRatio, 1)) * 100}%"></div></div>
      </div>
    `);
  }
  if (progress.seriesRatio !== null) {
    rows.push(`
      <div class="progress-block">
        <div class="progress-meta">
          <span>Series</span>
          <span>${Math.round(progress.seriesRatio * 100)}%</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${Math.max(0, Math.min(progress.seriesRatio, 1)) * 100}%"></div></div>
      </div>
    `);
  }
  return rows.length ? `<div class="card-progress">${rows.join('')}</div>` : '';
}

function buildCard(item, options = {}) {
  const card = document.createElement('article');
  card.className = 'comic-card';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  const badges = (options.badges || [{ label: options.badge || item.latest_label || 'Series' }])
    .filter((entry) => entry && entry.label)
    .map((entry) => `<span class="comic-badge${entry.tone ? ` ${entry.tone}` : ''}">${escapeHtml(entry.label)}</span>`)
    .join('');
  const overlayActions = (options.overlayActions || [])
    .map((action, index) => `
      <button
        type="button"
        class="cover-action${action.active ? ' is-active' : ''}${action.variant ? ` ${escapeHtml(action.variant)}` : ''}"
        data-cover-action="${index}"
        aria-label="${escapeHtml(action.label)}"
        title="${escapeHtml(action.label)}"
      >${escapeHtml(action.icon)}</button>
    `)
    .join('');
  card.innerHTML = `
    <span class="comic-cover">
      <span class="cover-actions">${overlayActions}</span>
      <img src="${escapeHtml(item.cover_url || './assets/ateaish_comics_default.webp')}" alt="${escapeHtml(item.title)}" loading="lazy">
      <span class="comic-meta">
        <span class="comic-badges">${badges}</span>
      </span>
    </span>
    <span class="comic-title">${escapeHtml(item.title)}</span>
    <span class="comic-subtitle">${escapeHtml(options.subtitle || item.context || item.latest_label || 'Open source page')}</span>
    ${buildProgressMarkup(options.progress)}
  `;
  const activate = () => {
    if (typeof options.onClick === 'function') {
      options.onClick(item);
      return;
    }
    openReader(getReaderUrl(item, null));
  };
  card.addEventListener('click', (event) => {
    if (event.target instanceof HTMLElement && event.target.closest('[data-cover-action]')) return;
    activate();
  });
  card.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target instanceof HTMLElement && event.target.closest('[data-cover-action]')) return;
    event.preventDefault();
    activate();
  });
  card.querySelectorAll('[data-cover-action]').forEach((actionButton) => {
    actionButton.addEventListener('click', (event) => {
      event.stopPropagation();
      const action = options.overlayActions?.[Number(actionButton.getAttribute('data-cover-action'))];
      if (action?.onClick) action.onClick(item);
    });
  });
  return card;
}

function buildLibraryPlaceholder(title, description, emptyCopy, id) {
  const shell = document.createElement('section');
  shell.className = 'section-shell';
  shell.id = id;
  shell.innerHTML = `
    <div class="section-head">
      <div>
        <h2 class="section-title">${escapeHtml(title)}</h2>
        <p class="section-copy">${escapeHtml(description)}</p>
      </div>
    </div>
    <div class="empty-rail">${escapeHtml(emptyCopy)}</div>
  `;
  return shell;
}

async function enrichLibraryEntry(entry) {
  const manifest = sortManifestIssues(await loadSeriesManifest(entry.series_slug));
  const latestIssue = manifest?.issues?.[manifest.issues.length - 1] || null;
  const hasNewChapter = Boolean(latestIssue && entry.last_issue_slug && latestIssue.issue_slug !== entry.last_issue_slug);
  const sortedIssues = manifest?.issues || [];
  const issueCount = sortedIssues.length;
  const currentIssueIndex = entry.last_issue_slug
    ? sortedIssues.findIndex((issue) => issue.issue_slug === entry.last_issue_slug)
    : -1;
  const nextIssue = currentIssueIndex >= 0 ? sortedIssues[currentIssueIndex + 1] || null : null;
  const issueRatio = Number.isInteger(entry.last_page_count) && entry.last_page_count > 0
    ? Math.max(0, Math.min((entry.last_page_number || 1) / entry.last_page_count, 1))
    : null;
  const completedSeries = Boolean(
    !hasNewChapter
    && issueCount > 0
    && currentIssueIndex === issueCount - 1
    && issueRatio !== null
    && issueRatio >= 1
  );
  const finishedDismissed = Boolean(entry.finished_dismissed && completedSeries);
  const visibleFinished = Boolean(entry.finished || (completedSeries && !finishedDismissed));
  const seriesRatio = issueCount > 0 && currentIssueIndex >= 0
    ? Math.max(0, Math.min((currentIssueIndex + (issueRatio ?? 0)) / issueCount, 1))
    : visibleFinished
      ? 1
      : null;
  const merged = {
    ...entry,
    title: manifest?.title || entry.title || entry.series_slug.replace(/-/g, ' '),
    cover_url: manifest?.cover_url || entry.cover_url || './assets/ateaish_comics_default.webp',
    series_url: manifest?.series_url || entry.series_url || `https://readcomiconline.li/Comic/${entry.series_slug}`,
    latest_issue_slug: latestIssue?.issue_slug || entry.latest_issue_slug || '',
    latest_issue_title: latestIssue?.title || entry.latest_issue_title || '',
    latest_issue_id: latestIssue?.issue_id || entry.latest_issue_id || '',
    latest_issue_url: latestIssue?.issue_url || entry.latest_issue_url || '',
    has_new_chapter: hasNewChapter,
    progress_issue_ratio: issueRatio,
    progress_series_ratio: seriesRatio,
    manifest_issue_count: issueCount,
    next_issue_slug: nextIssue?.issue_slug || '',
    next_issue_id: nextIssue?.issue_id || '',
    next_issue_title: nextIssue?.title || '',
    next_issue_url: nextIssue?.issue_url || '',
    next_issue_page_count: Array.isArray(nextIssue?.pages) ? nextIssue.pages.length : null,
    resume_on_next_issue: Boolean(nextIssue && isIssueProgressComplete(entry)),
    completed_series: completedSeries,
    finished_dismissed: finishedDismissed,
    visible_finished: visibleFinished,
  };
  return merged;
}

function buildLibraryCard(entry, sectionTitle, mode) {
  const badges = [];
  if (mode === 'continue') badges.push({ label: 'Continue', tone: 'cool' });
  if (mode === 'later') badges.push({ label: 'Later', tone: 'soft' });
  if (mode === 'finished') badges.push({ label: 'Finished', tone: 'soft' });
  if (entry.has_new_chapter) badges.push({ label: 'New chapter', tone: 'alert' });

  let subtitle = entry.latest_issue_title || 'Series saved locally';
  let onClick = () => openReader(getReaderUrl(entry, entry.last_read_at ? entry : null));
  if (mode === 'continue') {
    const resumeEntry = getResumeEntry(entry);
    const pagePart = entry.last_page_count ? `Page ${entry.last_page_number || 1}/${entry.last_page_count}` : 'Resume from last page';
    subtitle = entry.resume_on_next_issue && entry.next_issue_title
      ? `${entry.next_issue_title} · Start at page 1`
      : `${entry.last_issue_title || 'Last opened issue'} · ${pagePart}`;
    onClick = () => openReader(getReaderUrl(entry, resumeEntry, true));
  } else if (mode === 'later') {
    subtitle = entry.read_later_at ? `Saved ${formatRelativeDate(entry.read_later_at)}` : 'Queued to pick up later';
  } else if (mode === 'finished') {
    subtitle = entry.finished_at ? `Finished ${formatRelativeDate(entry.finished_at)}` : 'Completed locally';
  }

  return buildCard(entry, {
    badges,
    subtitle,
    sectionTitle,
    onClick,
    progress: mode === 'continue'
      ? {
          issueRatio: entry.progress_issue_ratio,
          seriesRatio: entry.progress_series_ratio,
        }
      : null,
    overlayActions: [
      {
        label: `Remove from ${sectionTitle}`,
        icon: '✕',
        variant: 'remove',
        onClick: () => clearLibrarySectionEntry(entry, mode),
      },
    ],
  });
}

async function renderLibrarySections() {
  const entries = await Promise.all(getLibraryEntries().map((entry) => enrichLibraryEntry(entry)));
  const continueEntries = entries.filter((entry) => entry.last_read_at && !entry.visible_finished && !entry.completed_series && !entry.read_later);
  const laterEntries = entries.filter((entry) => entry.read_later && !entry.visible_finished);
  const finishedEntries = entries.filter((entry) => entry.visible_finished);

  librarySections.innerHTML = '';

  const sectionConfigs = [
    {
      id: 'continue-reading-section',
      title: 'Continue Reading',
      description: 'Jump straight back into the exact issue and page you last left open.',
      empty: 'Start reading any extracted comic and it will appear here with its last page saved.',
      entries: continueEntries,
      mode: 'continue',
    },
    {
      id: 'read-later-section',
      title: 'Read Later',
      description: 'Park series here when you want them easy to find without starting them yet.',
      empty: 'Use the Read Later action from a comic card or the reader to build this list.',
      entries: laterEntries,
      mode: 'later',
    },
    {
      id: 'finished-section',
      title: 'Finished',
      description: 'Completed series stay here, and they get a badge when a newer issue shows up.',
      empty: 'Mark a series as finished to keep a clean archive of what you have already read.',
      entries: finishedEntries,
      mode: 'finished',
    },
  ];

  for (const config of sectionConfigs) {
    if (!config.entries.length) continue;

    const shell = document.createElement('section');
    shell.className = 'section-shell';
    shell.id = config.id;
    const rail = document.createElement('div');
    rail.className = 'section-grid';
    config.entries.forEach((entry) => rail.appendChild(buildLibraryCard(entry, config.title, config.mode)));

    shell.innerHTML = `
      <div class="section-head">
        <div>
          <h2 class="section-title">${escapeHtml(config.title)}</h2>
          <p class="section-copy">${escapeHtml(config.description)}</p>
        </div>
      </div>
    `;
    shell.appendChild(rail);
    librarySections.appendChild(shell);
  }

  state.libraryState = {
    hasContinue: continueEntries.length > 0,
    hasLater: laterEntries.length > 0,
    hasFinished: finishedEntries.length > 0,
  };
  renderQuickStrip();
}

function renderStats(meta) {
  if (!meta) return;
  buildSearchMeta(meta);
}

function buildDiscoverySection(section, index) {
    const shell = document.createElement('section');
    shell.className = 'section-shell';
    shell.id = `section-${section.id}`;
    shell.style.animationDelay = `${index * 80}ms`;

    const items = document.createElement('div');
    items.className = 'section-grid';

    (section.items || []).forEach((item) => {
      const readLaterEntry = getLibraryEntry(getSeriesSlug(item)) || {};
      items.appendChild(buildCard(item, {
        badge: item.latest_label || section.badge,
        subtitle: item.context || section.description,
        sectionTitle: section.title,
        overlayActions: [
          {
            label: readLaterEntry.read_later ? 'Remove from read later' : 'Add to read later',
            icon: '◷',
            active: Boolean(readLaterEntry.read_later),
            onClick: () => toggleReadLaterForItem(item),
          },
        ],
      }));
    });

    shell.innerHTML = `
      <div class="section-head">
        <div>
          <h2 class="section-title">${escapeHtml(section.title)}</h2>
          <p class="section-copy">${escapeHtml(section.description || '')}</p>
        </div>
        <a class="section-link" href="${escapeHtml(section.source_url || 'https://readcomiconline.li/')}" target="_blank" rel="noreferrer">Open source page</a>
      </div>
    `;
    shell.appendChild(items);
    return shell;
}

function renderDiscovery() {
  if (!state.discovery) return;

  const sections = state.discovery.sections || [];
  const freshSections = getFreshDropsSections(sections);
  const remainingSections = getNonFeaturedSections(sections);
  featuredSections.innerHTML = '';
  sectionList.innerHTML = '';

  freshSections.forEach((section, index) => {
    featuredSections.appendChild(buildDiscoverySection(section, index));
  });

  remainingSections.forEach((section, index) => {
    sectionList.appendChild(buildDiscoverySection(section, index + freshSections.length));
  });

  renderQuickStrip();
}

async function loadCatalog() {
  if (state.catalog) return state.catalog;
  if (!state.catalogPromise) {
    state.catalogPromise = fetch(CATALOG_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);
        return response.json();
      })
      .then(async (payload) => {
        const availableItems = await filterItemsWithManifest(payload.items || []);
        const items = availableItems.map((item) => ({
          ...item,
          _search: normalize(`${item.title} ${item.latest_label || ''} ${item.context || ''} ${item.source_section || ''}`),
          _status: extractStatus(item.context),
          _section: normalize(item.source_section || ''),
          _genres: inferGenres(item),
        }));
        state.catalog = { ...payload, items, total: items.length };
        return state.catalog;
      })
      .catch((error) => {
        state.catalogPromise = null;
        throw error;
      });
  }
  return state.catalogPromise;
}

function showSearchResults(title, copy) {
  searchResults.classList.add('active');
  resultsTitle.textContent = title;
  resultsCopy.textContent = copy;
}

function hideSearchResults() {
  searchResults.classList.remove('active');
  resultsGrid.innerHTML = '';
  resultsStatus.textContent = '';
}

function renderResults(items, title, copy, countLabel) {
  showSearchResults(title, copy);
  resultsGrid.innerHTML = '';

  if (!items.length) {
    resultsGrid.innerHTML = '<div class="empty-state">No comics matched that view.</div>';
    resultsStatus.textContent = '0 matches';
    return;
  }

  const libraryMap = readLibraryMap();
  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    const readLaterEntry = libraryMap[getSeriesSlug(item)] || {};
    fragment.appendChild(buildCard(item, {
      badge: item.latest_label || 'Series',
      subtitle: item.context || 'Series page',
      sectionTitle: title,
      overlayActions: [
        {
          label: readLaterEntry.read_later ? 'Remove from read later' : 'Add to read later',
          icon: '◷',
          active: Boolean(readLaterEntry.read_later),
          onClick: () => toggleReadLaterForItem(item),
        },
      ],
    }));
  });
  resultsGrid.appendChild(fragment);

  resultsStatus.textContent = countLabel;
}

async function runSearch(term) {
  state.searchTerm = term.trim();
  updateClearSearchVisibility();
  return updateSearchResults();
}

async function updateSearchResults() {
  const requestId = ++state.searchRequestId;
  const context = getSearchContext();
  if (!context.hasQuery && !context.hasBrowseFilter) {
    hideSearchResults();
    return;
  }

  const needsCatalogLoad = !context.usingDiscovery && !state.catalog && !state.catalogPromise;
  if (needsCatalogLoad) {
    const loadingLabel = 'Loading the full catalog snapshot...';
    showSearchResults('Searching catalog', 'Loading matching comics from the local snapshot.');
    resultsGrid.innerHTML = `<div class="loading-state">${loadingLabel}</div>`;
    resultsStatus.textContent = '';
  }

  try {
    const pool = context.usingDiscovery
      ? state.discoveryItems
      : (await loadCatalog()).items;

    if (requestId !== state.searchRequestId) return;

    const filtered = pool.filter((item) => {
      if (context.hasQuery && item._search.indexOf(context.query) === -1) return false;
      if (state.searchFilters.genre !== 'all' && !(item._genres || []).includes(state.searchFilters.genre)) return false;
      if (state.searchFilters.status !== 'all' && item._status !== state.searchFilters.status) return false;
      if (state.searchFilters.section !== 'all') {
        const itemSection = item._section || normalize(item.source_section || '');
        if (itemSection !== state.searchFilters.section) return false;
      }
      return true;
    });

    const sorted = sortSearchResults(filtered, context.query);
    const sliced = sorted.slice(0, CARD_LIMIT);
    const heading = getSearchHeading(filtered.length, context);
    renderResults(
      sliced,
      heading.title,
      heading.copy,
      `${formatNumber(filtered.length)} matches`
    );
  } catch (error) {
    if (requestId !== state.searchRequestId) return;
    resultsGrid.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    resultsStatus.textContent = 'Catalog unavailable';
  }
}

async function showAlphabeticalCatalog() {
  try {
    state.searchTerm = '';
    state.searchFilters = { scope: 'catalog', section: 'all', genre: 'all', status: 'all', sort: 'title-asc' };
    searchInput.value = '';
    syncSearchControls();
    renderSearchBrowseChips();
    showSearchResults('A-Z catalog', 'Loading the static catalog snapshot and showing the first alphabetical slice.');
    resultsGrid.innerHTML = '<div class="loading-state">Loading the full catalog snapshot...</div>';
    const catalog = await loadCatalog();
    const sorted = [...catalog.items].sort((left, right) => left.title.localeCompare(right.title));
    renderResults(
      sorted.slice(0, CARD_LIMIT),
      'A-Z catalog',
      `Showing the first ${CARD_LIMIT} series alphabetically. Use search for anything specific.`,
      `${formatNumber(catalog.total || catalog.items.length)} indexed series`
    );
    searchResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    resultsGrid.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    resultsStatus.textContent = 'Catalog unavailable';
  }
}

async function surpriseMe() {
  try {
    const pool = state.discoveryItems.length ? state.discoveryItems : (await loadCatalog()).items;
    if (!pool.length) return;
    const item = pool[Math.floor(Math.random() * pool.length)];
    openReader(getReaderUrl(item, null));
  } catch {
      // Keep the UI stable if the catalog is unavailable.
  }
}

function openDetail(item, label) {
  state.activeDetailItem = item;
  detailKicker.textContent = label;
  detailTitle.textContent = item.title || 'Comic';
  detailImage.src = item.cover_url || './assets/ateaish_comics_default.webp';
  detailImage.alt = item.title || 'Comic cover';

  const metaLines = [];
  if (item.latest_label) metaLines.push(`Latest: ${item.latest_label}`);
  if (item.context) metaLines.push(item.context);
  if (item.source_section) metaLines.push(`Source rail: ${item.source_section}`);
  detailMeta.textContent = metaLines.join(' • ');
  const seriesSlug = getSeriesSlug(item);
  const entry = getLibraryEntry(seriesSlug) || {};
  detailCopy.textContent = 'Open the local reader when a manifest exists for this series, save it for later, or mark it as finished when you are caught up.';
  detailReader.href = getReaderUrl(item, entry.last_read_at ? getResumeEntry(entry) : null, Boolean(entry.last_read_at));
  detailReader.textContent = entry.last_read_at && !entry.finished && !entry.completed_series ? 'Continue here' : 'Read here';
  detailSeries.href = withAbsoluteUrl(item.series_url || item.issue_url || '/');
  detailLatest.href = withAbsoluteUrl(item.issue_url || item.series_url || '/');
  detailLatest.textContent = item.issue_url ? 'Latest issue' : 'Open source';
  detailLater.textContent = entry.read_later ? 'Saved for later' : 'Read later';
  detailFinished.textContent = (entry.finished || (entry.completed_series && !entry.finished_dismissed)) ? 'Finished' : 'Mark finished';
  detailLater.classList.toggle('primary', Boolean(entry.read_later));
  detailFinished.classList.toggle('primary', Boolean(entry.finished || (entry.completed_series && !entry.finished_dismissed)));

  detailBackdrop.classList.add('open');
  detailBackdrop.setAttribute('aria-hidden', 'false');
}

function closeDetail() {
  state.activeDetailItem = null;
  detailBackdrop.classList.remove('open');
  detailBackdrop.setAttribute('aria-hidden', 'true');
}

function resetHomeView() {
  state.searchTerm = '';
  state.searchFilters = {
    scope: 'catalog',
    section: 'all',
    genre: 'all',
    status: 'all',
    sort: 'relevance',
  };
  searchInput.value = '';
  syncSearchControls();
  renderSearchBrowseChips();
  hideSearchResults();
  setSearchPanelOpen(false);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

let searchTimer = null;

searchInput.addEventListener('input', () => {
  state.searchTerm = searchInput.value.trim();
  updateClearSearchVisibility();

  if (searchTimer) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    runSearch(state.searchTerm);
  }, SEARCH_DEBOUNCE_MS);
});

searchInput.addEventListener('focus', () => {
  setSearchPanelOpen(true);
  if (!state.catalogPromise && !state.catalog) {
    loadCatalog().catch(() => {
      // The explicit search flow surfaces the error.
    });
  }
});

searchInput.addEventListener('click', () => {
  setSearchPanelOpen(true);
});

searchScope.addEventListener('change', () => {
  state.searchFilters.scope = searchScope.value;
  if (searchScope.value === 'catalog') state.searchFilters.section = 'all';
  syncSearchControls();
  renderSearchBrowseChips();
  void updateSearchResults();
});

searchSection.addEventListener('change', () => {
  state.searchFilters.section = searchSection.value;
  if (searchSection.value !== 'all') state.searchFilters.scope = 'discovery';
  syncSearchControls();
  renderSearchBrowseChips();
  void updateSearchResults();
});

searchGenre.addEventListener('change', () => {
  state.searchFilters.genre = searchGenre.value;
  syncSearchControls();
  renderSearchBrowseChips();
  void updateSearchResults();
});

searchStatus.addEventListener('change', () => {
  state.searchFilters.status = searchStatus.value;
  syncSearchControls();
  renderSearchBrowseChips();
  void updateSearchResults();
});

searchSort.addEventListener('change', () => {
  state.searchFilters.sort = searchSort.value;
  syncSearchControls();
  void updateSearchResults();
});

searchReset.addEventListener('click', () => {
  state.searchFilters = {
    scope: 'catalog',
    section: 'all',
    genre: 'all',
    status: 'all',
    sort: 'relevance',
  };
  syncSearchControls();
  renderSearchBrowseChips();
  void updateSearchResults();
});

clearSearch.addEventListener('click', resetHomeView);
detailClose.addEventListener('click', closeDetail);
detailLater.addEventListener('click', () => {
  const item = state.activeDetailItem;
  if (!item) return;
  const seriesSlug = getSeriesSlug(item);
  updateLibraryEntry(seriesSlug, (current) => ({
    ...buildLibrarySeed(item, current, seriesSlug),
    read_later: !current.read_later,
    read_later_at: !current.read_later ? Date.now() : null,
    finished: false,
    finished_at: null,
    finished_dismissed: false,
  }));
  openDetail(item, detailKicker.textContent || 'Comic detail');
  rerenderLibrarySurfaces();
});
detailFinished.addEventListener('click', () => {
  const item = state.activeDetailItem;
  if (!item) return;
  const seriesSlug = getSeriesSlug(item);
  updateLibraryEntry(seriesSlug, (current) => ({
    ...buildLibrarySeed(item, current, seriesSlug),
    finished: !(current.finished || (current.completed_series && !current.finished_dismissed)),
    finished_at: !(current.finished || (current.completed_series && !current.finished_dismissed)) ? Date.now() : null,
    finished_dismissed: current.completed_series
      ? (current.finished || (current.completed_series && !current.finished_dismissed))
      : false,
    read_later: false,
    read_later_at: null,
  }));
  openDetail(item, detailKicker.textContent || 'Comic detail');
  rerenderLibrarySurfaces();
});
detailBackdrop.addEventListener('click', (event) => {
  if (event.target === detailBackdrop) closeDetail();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDetail();
});

document.addEventListener('click', (event) => {
  if (!searchWrap.contains(event.target)) {
    setSearchPanelOpen(false);
  }
});

fetch(DISCOVERY_URL)
  .then((response) => {
    if (!response.ok) throw new Error(`Discovery request failed: ${response.status}`);
    return response.json();
  })
  .then((payload) => prepareDiscoveryPayload(payload))
  .then((payload) => {
    state.discovery = payload;
    state.discoverySections = payload.sections || [];
    state.discoveryItems = getDiscoveryItems(state.discoverySections);
    renderStats(payload.meta);
    renderSearchSectionOptions();
    renderSearchGenreOptions();
    renderSearchBrowseChips();
    void renderLibrarySections();
    renderDiscovery();
  })
  .catch((error) => {
    void renderLibrarySections();
    sectionList.innerHTML = `
      <div class="section-shell">
        <div class="section-head">
          <div>
            <h2 class="section-title">Discovery data missing</h2>
            <p class="section-copy">Run the local catalog generator in the comics folder to create the static JSON files.</p>
          </div>
        </div>
        <div class="empty-state">${escapeHtml(error.message)}</div>
      </div>
    `;
  });

window.addEventListener('storage', (event) => {
  if (event.key === COMICS_LIBRARY_KEY) {
    void renderLibrarySections();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void renderLibrarySections();
  }
});
