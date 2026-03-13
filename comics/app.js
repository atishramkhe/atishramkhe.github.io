const DISCOVERY_URL = './data/discovery.json';
const CATALOG_URL = './data/catalog.json';
const SERIES_MANIFEST_BASE_URL = './data/series/';
const COMICS_LIBRARY_KEY = 'ateaish-comics-library-v1';
const CARD_LIMIT = 120;
const SEARCH_DEBOUNCE_MS = 140;

const librarySections = document.getElementById('library-sections');
const sectionList = document.getElementById('section-list');
const quickStrip = document.getElementById('quick-strip');
const statGrid = document.getElementById('stat-grid');
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
  searchTerm: '',
  activeDetailItem: null,
};

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
  const next = updater(current) || current;
  library[seriesSlug] = next;
  writeLibraryMap(library);
  return next;
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
  const issueSlug = progressEntry?.last_issue_slug || getIssueSlug(item?.issue_url);
  const issueId = progressEntry?.last_issue_id || getIssueId(item?.issue_url);
  const pageNumber = Number.isInteger(progressEntry?.last_page_index) ? progressEntry.last_page_index + 1 : null;
  if (issueSlug) params.set('issue', issueSlug);
  if (issueId) params.set('id', issueId);
  if (pageNumber) params.set('page', String(pageNumber));
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

function buildCard(item, options = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'comic-card';
  const badges = (options.badges || [{ label: options.badge || item.latest_label || 'Series' }])
    .filter((entry) => entry && entry.label)
    .map((entry) => `<span class="comic-badge${entry.tone ? ` ${entry.tone}` : ''}">${escapeHtml(entry.label)}</span>`)
    .join('');
  button.innerHTML = `
    <span class="comic-cover">
      <img src="${escapeHtml(item.cover_url || '../assets/logo_noborder.png')}" alt="${escapeHtml(item.title)}" loading="lazy">
      <span class="comic-meta">
        <span class="comic-badges">${badges}</span>
      </span>
    </span>
    <span class="comic-title">${escapeHtml(item.title)}</span>
    <span class="comic-subtitle">${escapeHtml(options.subtitle || item.context || item.latest_label || 'Open source page')}</span>
  `;
  button.addEventListener('click', () => {
    if (typeof options.onClick === 'function') {
      options.onClick(item);
      return;
    }
    openDetail(item, options.sectionTitle || 'Comic detail');
  });
  return button;
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
  const manifest = await loadSeriesManifest(entry.series_slug);
  const latestIssue = manifest?.issues?.[0] || null;
  const hasNewChapter = Boolean(latestIssue && entry.last_issue_slug && latestIssue.issue_slug !== entry.last_issue_slug);
  const merged = {
    ...entry,
    title: manifest?.title || entry.title || entry.series_slug.replace(/-/g, ' '),
    cover_url: manifest?.cover_url || entry.cover_url || '../assets/logo_noborder.png',
    series_url: manifest?.series_url || entry.series_url || `https://readcomiconline.li/Comic/${entry.series_slug}`,
    latest_issue_slug: latestIssue?.issue_slug || entry.latest_issue_slug || '',
    latest_issue_title: latestIssue?.title || entry.latest_issue_title || '',
    latest_issue_id: latestIssue?.issue_id || entry.latest_issue_id || '',
    latest_issue_url: latestIssue?.issue_url || entry.latest_issue_url || '',
    has_new_chapter: hasNewChapter,
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
  let onClick = () => openDetail(entry, sectionTitle);
  if (mode === 'continue') {
    const pagePart = entry.last_page_count ? `Page ${entry.last_page_number || 1}/${entry.last_page_count}` : 'Resume from last page';
    subtitle = `${entry.last_issue_title || 'Last opened issue'} · ${pagePart}`;
    onClick = () => openReader(getReaderUrl(entry, entry, true));
  } else if (mode === 'later') {
    subtitle = entry.read_later_at ? `Saved ${formatRelativeDate(entry.read_later_at)}` : 'Queued to pick up later';
  } else if (mode === 'finished') {
    subtitle = entry.finished_at ? `Finished ${formatRelativeDate(entry.finished_at)}` : 'Marked finished';
  }

  return buildCard(entry, {
    badges,
    subtitle,
    sectionTitle,
    onClick,
  });
}

async function renderLibrarySections() {
  const entries = getLibraryEntries();
  const continueEntries = entries.filter((entry) => entry.last_read_at && !entry.finished);
  const laterEntries = entries.filter((entry) => entry.read_later && !entry.finished && !entry.last_read_at);
  const finishedEntries = entries.filter((entry) => entry.finished);

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
    if (!config.entries.length) {
      librarySections.appendChild(buildLibraryPlaceholder(config.title, config.description, config.empty, config.id));
      continue;
    }

    const shell = document.createElement('section');
    shell.className = 'section-shell';
    shell.id = config.id;
    const rail = document.createElement('div');
    rail.className = 'rail';
    const items = await Promise.all(config.entries.map((entry) => enrichLibraryEntry(entry)));
    items.forEach((entry) => rail.appendChild(buildLibraryCard(entry, config.title, config.mode)));

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
}

function renderStats(meta) {
  if (!meta) return;
  statGrid.innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${formatNumber(meta.catalog_total || 0)}</div>
      <div class="stat-label">Indexed comic series ready for lazy search</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${meta.section_count || 0}</div>
      <div class="stat-label">Live discovery rails on the front page</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${meta.catalog_pages || '?'}</div>
      <div class="stat-label">Catalog pages scraped from the source site</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${formatTimestamp(meta.generated_at)}</div>
      <div class="stat-label">Latest local snapshot build date</div>
    </div>
  `;
}

function renderQuickStrip(sections) {
  const buttons = [
    { label: 'Continue reading', action: () => document.getElementById('continue-reading-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    { label: 'Read later', action: () => document.getElementById('read-later-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    { label: 'Finished', action: () => document.getElementById('finished-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    { label: 'Home rails', action: resetHomeView },
    ...sections.map((section) => ({
      label: section.nav_label || section.title,
      action: () => document.getElementById(`section-${section.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    })),
    { label: 'A-Z catalog', action: showAlphabeticalCatalog, accent: true },
    { label: 'Surprise me', action: surpriseMe, accent: true },
  ];

  quickStrip.innerHTML = '';
  buttons.forEach((entry) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `chip${entry.accent ? ' chip-accent' : ''}`;
    button.textContent = entry.label;
    button.addEventListener('click', entry.action);
    quickStrip.appendChild(button);
  });
}

function renderDiscovery() {
  if (!state.discovery) return;

  const sections = state.discovery.sections || [];
  sectionList.innerHTML = '';

  sections.forEach((section, index) => {
    const shell = document.createElement('section');
    shell.className = 'section-shell';
    shell.id = `section-${section.id}`;
    shell.style.animationDelay = `${index * 80}ms`;

    const items = document.createElement('div');
    items.className = 'rail';

    (section.items || []).forEach((item) => {
      items.appendChild(buildCard(item, {
        badge: item.latest_label || section.badge,
        subtitle: item.context || section.description,
        sectionTitle: section.title,
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
    sectionList.appendChild(shell);
  });

  renderQuickStrip(sections);
}

async function loadCatalog() {
  if (state.catalog) return state.catalog;
  if (!state.catalogPromise) {
    state.catalogPromise = fetch(CATALOG_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        const items = (payload.items || []).map((item) => ({
          ...item,
          _search: normalize(`${item.title} ${item.latest_label || ''}`),
        }));
        state.catalog = { ...payload, items };
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

  items.forEach((item) => {
    resultsGrid.appendChild(buildCard(item, {
      badge: item.latest_label || 'Series',
      subtitle: item.context || 'Series page',
      sectionTitle: title,
    }));
  });

  resultsStatus.textContent = countLabel;
}

async function runSearch(term) {
  const query = normalize(term);
  if (!query || query.length < 2) {
    hideSearchResults();
    return;
  }

  showSearchResults('Searching catalog', 'Loading the full static index for the first time.');
  resultsGrid.innerHTML = '<div class="loading-state">Loading catalog and scoring matches...</div>';
  resultsStatus.textContent = '';

  try {
    const catalog = await loadCatalog();
    const results = [];
    for (const item of catalog.items) {
      const index = item._search.indexOf(query);
      if (index === -1) continue;
      results.push({ item, score: index + item.title.length * 0.01 });
    }
    results.sort((left, right) => left.score - right.score || left.item.title.localeCompare(right.item.title));
    const sliced = results.slice(0, CARD_LIMIT).map((entry) => entry.item);
    renderResults(
      sliced,
      `Results for “${term}”`,
      `Showing the best ${Math.min(results.length, CARD_LIMIT)} matches from ${formatNumber(catalog.total || catalog.items.length)} indexed series.`,
      `${formatNumber(results.length)} matches`
    );
  } catch (error) {
    resultsGrid.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    resultsStatus.textContent = 'Catalog unavailable';
  }
}

async function showAlphabeticalCatalog() {
  try {
    state.searchTerm = '';
    searchInput.value = '';
    clearSearch.style.display = 'none';
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
    const catalog = await loadCatalog();
    if (!catalog.items.length) return;
    const item = catalog.items[Math.floor(Math.random() * catalog.items.length)];
    openDetail(item, 'Surprise pick');
  } catch {
      // Keep the UI stable if the catalog is unavailable.
  }
}

function openDetail(item, label) {
  state.activeDetailItem = item;
  detailKicker.textContent = label;
  detailTitle.textContent = item.title || 'Comic';
  detailImage.src = item.cover_url || '../assets/logo_noborder.png';
  detailImage.alt = item.title || 'Comic cover';

  const metaLines = [];
  if (item.latest_label) metaLines.push(`Latest: ${item.latest_label}`);
  if (item.context) metaLines.push(item.context);
  if (item.source_section) metaLines.push(`Source rail: ${item.source_section}`);
  detailMeta.textContent = metaLines.join(' • ');
  const seriesSlug = getSeriesSlug(item);
  const entry = getLibraryEntry(seriesSlug) || {};
  detailCopy.textContent = 'Open the local reader when a manifest exists for this series, save it for later, or mark it as finished when you are caught up.';
  detailReader.href = getReaderUrl(item, entry.last_read_at ? entry : null);
  detailReader.textContent = entry.last_read_at && !entry.finished ? 'Continue here' : 'Read here';
  detailSeries.href = withAbsoluteUrl(item.series_url || item.issue_url || '/');
  detailLatest.href = withAbsoluteUrl(item.issue_url || item.series_url || '/');
  detailLatest.textContent = item.issue_url ? 'Latest issue' : 'Open source';
  detailLater.textContent = entry.read_later ? 'Saved for later' : 'Read later';
  detailFinished.textContent = entry.finished ? 'Finished' : 'Mark finished';
  detailLater.classList.toggle('primary', Boolean(entry.read_later));
  detailFinished.classList.toggle('primary', Boolean(entry.finished));

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
  searchInput.value = '';
  clearSearch.style.display = 'none';
  hideSearchResults();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

let searchTimer = null;

searchInput.addEventListener('input', () => {
  state.searchTerm = searchInput.value.trim();
  clearSearch.style.display = state.searchTerm ? 'block' : 'none';

  if (searchTimer) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    runSearch(state.searchTerm);
  }, SEARCH_DEBOUNCE_MS);
});

searchInput.addEventListener('focus', () => {
  if (!state.catalogPromise && !state.catalog) {
    loadCatalog().catch(() => {
      // The explicit search flow surfaces the error.
    });
  }
});

clearSearch.addEventListener('click', resetHomeView);
detailClose.addEventListener('click', closeDetail);
detailLater.addEventListener('click', () => {
  const item = state.activeDetailItem;
  if (!item) return;
  const seriesSlug = getSeriesSlug(item);
  const latestIssue = getLatestIssueFromItem(item);
  updateLibraryEntry(seriesSlug, (current) => ({
    ...current,
    series_slug: seriesSlug,
    title: item.title || current.title || seriesSlug.replace(/-/g, ' '),
    cover_url: item.cover_url || current.cover_url || '../assets/logo_noborder.png',
    series_url: withAbsoluteUrl(item.series_url || current.series_url || ''),
    read_later: !current.read_later,
    read_later_at: !current.read_later ? Date.now() : null,
    finished: false,
    finished_at: null,
    updated_at: Date.now(),
    last_issue_slug: current.last_issue_slug || latestIssue?.issue_slug || '',
    last_issue_id: current.last_issue_id || latestIssue?.issue_id || '',
    last_issue_title: current.last_issue_title || latestIssue?.issue_title || '',
    last_issue_url: current.last_issue_url || latestIssue?.issue_url || '',
  }));
  openDetail(item, detailKicker.textContent || 'Comic detail');
  void renderLibrarySections();
});
detailFinished.addEventListener('click', () => {
  const item = state.activeDetailItem;
  if (!item) return;
  const seriesSlug = getSeriesSlug(item);
  const latestIssue = getLatestIssueFromItem(item);
  updateLibraryEntry(seriesSlug, (current) => ({
    ...current,
    series_slug: seriesSlug,
    title: item.title || current.title || seriesSlug.replace(/-/g, ' '),
    cover_url: item.cover_url || current.cover_url || '../assets/logo_noborder.png',
    series_url: withAbsoluteUrl(item.series_url || current.series_url || ''),
    finished: !current.finished,
    finished_at: !current.finished ? Date.now() : null,
    read_later: false,
    read_later_at: null,
    updated_at: Date.now(),
    last_issue_slug: current.last_issue_slug || latestIssue?.issue_slug || '',
    last_issue_id: current.last_issue_id || latestIssue?.issue_id || '',
    last_issue_title: current.last_issue_title || latestIssue?.issue_title || '',
    last_issue_url: current.last_issue_url || latestIssue?.issue_url || '',
  }));
  openDetail(item, detailKicker.textContent || 'Comic detail');
  void renderLibrarySections();
});
detailBackdrop.addEventListener('click', (event) => {
  if (event.target === detailBackdrop) closeDetail();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDetail();
});

fetch(DISCOVERY_URL)
  .then((response) => {
    if (!response.ok) throw new Error(`Discovery request failed: ${response.status}`);
    return response.json();
  })
  .then((payload) => {
    state.discovery = payload;
    renderStats(payload.meta);
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
