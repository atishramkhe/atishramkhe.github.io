const canvas = document.getElementById('canvas');
const seriesCover = document.getElementById('series-cover');
const issueSelect = document.getElementById('issue-select');
const prevIssue = document.getElementById('prev-issue');
const nextIssue = document.getElementById('next-issue');
const widthSelect = document.getElementById('width-select');
const pageFitSelect = document.getElementById('page-fit-select');
const pageGapSelect = document.getElementById('page-gap-select');
const zoomSelect = document.getElementById('zoom-select');
const alignSelect = document.getElementById('align-select');
const themeSelect = document.getElementById('theme-select');
const toggleCaptions = document.getElementById('toggle-captions');
const togglePanel = document.getElementById('toggle-panel');
const zoomOut = document.getElementById('zoom-out');
const zoomIn = document.getElementById('zoom-in');
const floatingFullscreen = document.getElementById('floating-fullscreen');
const floatingPanel = document.getElementById('floating-panel');
const panel = document.querySelector('.panel');
const seriesLink = document.getElementById('series-link');
const issueLink = document.getElementById('issue-link');
const toggleLater = document.getElementById('toggle-later');
const toggleFinished = document.getElementById('toggle-finished');

const params = new URLSearchParams(window.location.search);
const seriesSlug = params.get('series') || '';
const issueSlug = params.get('issue') || '';
const issueId = params.get('id') || '';
const continueMode = params.get('continue') === '1';
const initialPageParam = Number.parseInt(params.get('page') || '1', 10);
const COMICS_LIBRARY_KEY = 'ateaish-comics-library-v1';
const READER_SETTINGS_KEY = 'ateaish-comics-reader-settings-v1';
const SAVE_SCROLL_DEBOUNCE_MS = 120;
const RESTORE_BUFFER_MS = 280;
const PANEL_IDLE_MS = 1800;

const DEFAULT_READER_SETTINGS = {
  width: 'standard',
  fit: 'horizontal',
  gap: 'comfortable',
  zoom: '100',
  align: 'center',
  theme: 'midnight',
  captions: false,
  panelCollapsed: false,
};

const state = {
  manifest: null,
  currentIssueIndex: -1,
  currentPageIndex: Number.isNaN(initialPageParam) ? 0 : Math.max(0, initialPageParam - 1),
  saveTimer: null,
  restoreToken: 0,
  panelIdleTimer: null,
  readerSettings: { ...DEFAULT_READER_SETTINGS },
};

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function readLibrary() {
  try {
    const raw = localStorage.getItem(COMICS_LIBRARY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLibrary(library) {
  localStorage.setItem(COMICS_LIBRARY_KEY, JSON.stringify(library));
}

function readReaderSettings() {
  try {
    const raw = localStorage.getItem(READER_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_READER_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_READER_SETTINGS,
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
    };
  } catch {
    return { ...DEFAULT_READER_SETTINGS };
  }
}

function writeReaderSettings(settings) {
  localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(settings));
}

function applyReaderSettings() {
  const settings = state.readerSettings;
  canvas.dataset.width = settings.width;
  canvas.dataset.fit = settings.fit;
  canvas.dataset.gap = settings.gap;
  canvas.dataset.zoom = settings.zoom;
  canvas.dataset.align = settings.align;
  canvas.dataset.captions = settings.captions ? 'visible' : 'hidden';
  document.body.dataset.theme = settings.theme;
  document.body.classList.toggle('panel-collapsed', Boolean(settings.panelCollapsed));

  widthSelect.value = settings.width;
  pageFitSelect.value = settings.fit;
  pageGapSelect.value = settings.gap;
  zoomSelect.value = settings.zoom;
  alignSelect.value = settings.align;
  themeSelect.value = settings.theme;
  toggleCaptions.textContent = settings.captions ? 'Hide captions' : 'Show captions';
  toggleCaptions.classList.toggle('primary', !settings.captions);
  if (togglePanel) {
    togglePanel.textContent = settings.panelCollapsed ? 'Show panel' : 'Focus mode';
    togglePanel.classList.toggle('primary', Boolean(settings.panelCollapsed));
  }
  if (floatingPanel) {
    floatingPanel.textContent = settings.panelCollapsed ? '▣' : '☰';
    floatingPanel.setAttribute('aria-label', settings.panelCollapsed ? 'Show reader panel' : 'Hide reader panel');
    floatingPanel.title = settings.panelCollapsed ? 'Show reader panel' : 'Hide reader panel';
  }
  updateZoomButtons();
}

function updateReaderSettings(partial) {
  state.readerSettings = {
    ...state.readerSettings,
    ...partial,
  };
  writeReaderSettings(state.readerSettings);
  applyReaderSettings();
}

function resetPanelIdleTimer() {
  if (!panel) return;
  if (state.readerSettings.panelCollapsed) {
    panel.classList.remove('is-idle');
    return;
  }
  panel.classList.remove('is-idle');
  if (state.panelIdleTimer) window.clearTimeout(state.panelIdleTimer);
  state.panelIdleTimer = window.setTimeout(() => {
    panel.classList.add('is-idle');
  }, PANEL_IDLE_MS);
}

function getZoomOptions() {
  return ['70', '85', '100', '115', '130', '150'];
}

function updateZoomButtons() {
  const options = getZoomOptions();
  const index = options.indexOf(state.readerSettings.zoom);
  if (zoomOut) zoomOut.disabled = index <= 0;
  if (zoomIn) zoomIn.disabled = index === -1 || index >= options.length - 1;
}

function stepZoom(direction) {
  const options = getZoomOptions();
  const index = options.indexOf(state.readerSettings.zoom);
  const nextIndex = Math.max(0, Math.min((index === -1 ? 2 : index) + direction, options.length - 1));
  const activePageIndex = findActivePageIndex();
  updateReaderSettings({ zoom: options[nextIndex] });
  scrollToPage(activePageIndex, 'auto');
}

function toggleReaderPanel() {
  updateReaderSettings({ panelCollapsed: !state.readerSettings.panelCollapsed });
}

function formatIssueOption(issue, fallbackIndex) {
  const sequence = extractIssueSequence(issue);
  if (sequence !== null) {
    return Number.isInteger(sequence) ? String(sequence) : sequence.toFixed(1).replace(/\.0$/, '');
  }
  const slugMatch = String(issue.issue_slug || '').match(/(\d+(?:\.\d+)?)/);
  if (slugMatch) return slugMatch[1];
  return String(fallbackIndex + 1);
}

function getLatestIssue(manifest) {
  if (!Array.isArray(manifest?.issues) || !manifest.issues.length) return null;
  return manifest.issues[manifest.issues.length - 1];
}

function getCurrentIssue() {
  return state.manifest?.issues?.[state.currentIssueIndex] || null;
}

function getStoredEntry() {
  return readLibrary()[seriesSlug] || null;
}

function updateLibraryEntry(updater) {
  if (!seriesSlug) return null;

  const library = readLibrary();
  const existing = library[seriesSlug] || { series_slug: seriesSlug };
  const manifest = state.manifest;
  const currentIssue = getCurrentIssue();
  const latestIssue = getLatestIssue(manifest);
  const baseEntry = {
    ...existing,
    series_slug: seriesSlug,
    title: manifest?.title || existing.title || seriesSlug.replace(/-/g, ' '),
    cover_url: manifest?.cover_url || existing.cover_url || './assets/ateaish_comics_default.webp',
    series_url: manifest?.series_url || existing.series_url || `https://readcomiconline.li/Comic/${seriesSlug}`,
    manifest_issue_count: manifest?.issue_count || existing.manifest_issue_count || 0,
    latest_issue_slug: latestIssue?.issue_slug || existing.latest_issue_slug || '',
    latest_issue_title: latestIssue?.title || existing.latest_issue_title || '',
    latest_issue_id: latestIssue?.issue_id || existing.latest_issue_id || '',
    latest_issue_url: latestIssue?.issue_url || existing.latest_issue_url || '',
    last_issue_slug: currentIssue?.issue_slug || existing.last_issue_slug || '',
    last_issue_title: currentIssue?.title || existing.last_issue_title || '',
    last_issue_id: currentIssue?.issue_id || existing.last_issue_id || '',
    last_issue_url: currentIssue?.issue_url || existing.last_issue_url || '',
    updated_at: Date.now(),
  };

  const nextEntry = updater(baseEntry) || baseEntry;
  library[seriesSlug] = nextEntry;
  writeLibrary(library);
  return nextEntry;
}

function updateActionButtons() {
  const entry = getStoredEntry() || {};
  const isOngoingSeries = entry.series_status === 'ongoing';
  const isVisibleFinished = Boolean(entry.finished || (entry.completed_series && !entry.finished_dismissed && !isOngoingSeries));
  toggleLater.textContent = entry.read_later ? 'Saved for later' : 'Read later';
  toggleFinished.textContent = isVisibleFinished ? 'Finished' : 'Mark finished';
  toggleLater.classList.toggle('primary', Boolean(entry.read_later));
  toggleFinished.classList.toggle('primary', isVisibleFinished);
}

function findActivePageIndex() {
  const cards = [...canvas.querySelectorAll('.page-card')];
  if (!cards.length) return 0;

  const canvasRect = canvas.getBoundingClientRect();
  const viewportAnchor = canvasRect.top + Math.max(72, canvas.clientHeight * 0.24);
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  cards.forEach((card, index) => {
    const rect = card.getBoundingClientRect();
    if (rect.bottom < 0) return;
    const distance = Math.abs(rect.top - viewportAnchor);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function getPageCards() {
  return [...canvas.querySelectorAll('.page-card')];
}

function getCanvasScrollTarget(card) {
  const offset = 8;
  return Math.max(0, card.offsetTop - offset);
}

function getPageViewportState(index = findActivePageIndex()) {
  const cards = getPageCards();
  const boundedIndex = Math.max(0, Math.min(index, cards.length - 1));
  const card = cards[boundedIndex];
  if (!card) {
    return {
      index: 0,
      card: null,
      isFirst: true,
      isLast: true,
      fullyVisible: false,
      atTop: true,
      atBottom: true,
    };
  }

  const canvasRect = canvas.getBoundingClientRect();
  const rect = card.getBoundingClientRect();
  const tolerance = 6;

  return {
    index: boundedIndex,
    card,
    isFirst: boundedIndex === 0,
    isLast: boundedIndex === cards.length - 1,
    fullyVisible: rect.top >= canvasRect.top - tolerance && rect.bottom <= canvasRect.bottom + tolerance,
    atTop: rect.top >= canvasRect.top - tolerance,
    atBottom: rect.bottom <= canvasRect.bottom + tolerance,
  };
}

function scrollReaderViewport(direction) {
  const amount = Math.max(120, Math.round(canvas.clientHeight * 0.82));
  canvas.scrollBy({ top: amount * direction, behavior: 'smooth' });
}

function isStoredIssueComplete(entry) {
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

function resolveContinueTarget(issues, entry) {
  if (!Array.isArray(issues) || !issues.length) {
    return { issueIndex: 0, pageIndex: 0 };
  }

  const fallbackPageIndex = Number.isInteger(entry?.last_page_index) ? Math.max(0, entry.last_page_index) : 0;
  if (!entry?.last_issue_slug) {
    return { issueIndex: 0, pageIndex: fallbackPageIndex };
  }

  const storedIndex = issues.findIndex((issue) => issue.issue_slug === entry.last_issue_slug);
  if (storedIndex === -1) {
    return { issueIndex: 0, pageIndex: fallbackPageIndex };
  }

  if (isStoredIssueComplete(entry) && storedIndex < issues.length - 1) {
    return { issueIndex: storedIndex + 1, pageIndex: 0 };
  }

  return { issueIndex: storedIndex, pageIndex: fallbackPageIndex };
}

function showAdjacentIssue(delta, pageIndex = 0) {
  const issues = state.manifest?.issues || [];
  const targetIndex = state.currentIssueIndex + delta;
  if (targetIndex < 0 || targetIndex >= issues.length) return false;
  state.currentPageIndex = Math.max(0, pageIndex);
  showIssue(targetIndex);
  return true;
}

function isIssueCompleteInViewport() {
  const viewportState = getPageViewportState();
  return Boolean(viewportState.card && viewportState.isLast && viewportState.atBottom);
}

function isSeriesCompleteAt(pageIndex) {
  const issue = getCurrentIssue();
  const issues = state.manifest?.issues || [];
  if (!issue || !issues.length) return false;
  return state.currentIssueIndex === issues.length - 1 && pageIndex >= issue.pages.length - 1;
}

function scrollToPage(index, behavior = 'smooth') {
  const cards = getPageCards();
  if (!cards.length) return;
  const boundedIndex = Math.max(0, Math.min(index, cards.length - 1));
  const target = cards[boundedIndex];
  if (!target) return;
  state.currentPageIndex = boundedIndex;
  canvas.scrollTo({ top: getCanvasScrollTarget(target), behavior });
}

function navigatePage(delta) {
  const cards = getPageCards();
  if (!cards.length) return;

  const activeIndex = findActivePageIndex();
  const targetIndex = activeIndex + delta;
  if (targetIndex >= 0 && targetIndex < cards.length) {
    scrollToPage(targetIndex, 'smooth');
    return;
  }

  if (delta > 0 && isIssueCompleteInViewport()) {
    showAdjacentIssue(1, 0);
  }
}

function persistReadingState() {
  const issue = getCurrentIssue();
  if (!state.manifest || !issue) return;

  const pageIndex = findActivePageIndex();
  const completedSeries = isSeriesCompleteAt(pageIndex);
  state.currentPageIndex = pageIndex;

  updateLibraryEntry((entry) => ({
    ...entry,
    last_page_index: pageIndex,
    last_page_number: pageIndex + 1,
    last_page_count: issue.pages.length,
    last_read_at: Date.now(),
    read_later: false,
    completed_series: completedSeries,
    finished: completedSeries
      ? (entry.series_status === 'ongoing' ? false : !entry.finished_dismissed)
      : entry.finished,
    finished_at: completedSeries
      ? ((entry.finished_dismissed || entry.series_status === 'ongoing') ? null : (entry.finished_at || Date.now()))
      : entry.finished_at,
    finished_dismissed: completedSeries ? Boolean(entry.finished_dismissed) : false,
  }));

  updateActionButtons();
  updateLocation(issue);
}

function queuePersistReadingState() {
  if (state.saveTimer) window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(() => {
    persistReadingState();
  }, SAVE_SCROLL_DEBOUNCE_MS);
}

function setRestoreState(active, copy = 'Loading saved page...') {
  canvas.classList.toggle('restore-pending', active);
  document.body.classList.toggle('reader-restoring', active);

  const restoreCopy = canvas.querySelector('[data-restore-copy]');
  if (restoreCopy) restoreCopy.textContent = copy;
}

function getSavedPageIndex(issue) {
  const entry = getStoredEntry();
  return issue.issue_slug === entry?.last_issue_slug && Number.isInteger(entry?.last_page_index)
    ? entry.last_page_index
    : state.currentPageIndex;
}

function waitForImageLoad(img) {
  if (!img || (img.complete && img.naturalWidth > 0)) return Promise.resolve();

  return new Promise((resolve) => {
    const done = () => resolve();
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
    window.setTimeout(done, 1500);
  });
}

async function restoreSavedPosition(issue, restoreToken) {
  const savedPageIndex = getSavedPageIndex(issue);
  const cards = canvas.querySelectorAll('.page-card');
  if (!cards.length) {
    setRestoreState(false);
    return;
  }

  const boundedIndex = Math.max(0, Math.min(savedPageIndex || 0, cards.length - 1));
  state.currentPageIndex = boundedIndex;
  const preloadCards = [...cards].slice(0, boundedIndex + 1);

  preloadCards.forEach((card, index) => {
    const img = card.querySelector('img');
    if (!img) return;
    img.loading = 'eager';
    if (index === boundedIndex) img.fetchPriority = 'high';
  });

  const loadingCopy = boundedIndex > 0
    ? `Loading pages 1-${boundedIndex + 1} so the reader can resume where you left off.`
    : 'Loading page 1.';
  setRestoreState(true, loadingCopy);

  await Promise.all(preloadCards.map((card) => waitForImageLoad(card.querySelector('img'))));
  await new Promise((resolve) => window.setTimeout(resolve, RESTORE_BUFFER_MS));

  if (restoreToken !== state.restoreToken) return;

  await new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(resolve);
    });
  });

  if (restoreToken !== state.restoreToken) return;

  const target = cards[boundedIndex];
  if (!target) {
    setRestoreState(false);
    return;
  }

  canvas.scrollTo({ top: 0, behavior: 'auto' });
  canvas.scrollTo({ top: getCanvasScrollTarget(target), behavior: 'auto' });

  await new Promise((resolve) => window.setTimeout(resolve, 180));

  if (restoreToken !== state.restoreToken) return;

  setRestoreState(false);
  persistReadingState();
}

function setEmpty(title, copy, seriesUrl) {
  const action = seriesUrl
    ? `<p style="margin-top:16px;"><a class="link-button primary" href="${seriesUrl}" target="_blank" rel="noreferrer">Open source series</a></p>`
    : '';
  canvas.innerHTML = `
    <div class="empty-shell">
      <div>
        <h2 class="empty-title">${title}</h2>
        <p class="empty-copy">${copy}</p>
        ${action}
      </div>
    </div>
  `;
}

function updateLocation(issue) {
  const next = new URLSearchParams(window.location.search);
  next.set('series', seriesSlug);
  next.set('issue', issue.issue_slug);
  if (issue.issue_id) next.set('id', issue.issue_id);
  next.set('page', String((state.currentPageIndex || 0) + 1));
  window.history.replaceState({}, '', `${window.location.pathname}?${next.toString()}`);
}

function renderIssue(issue) {
  const restoreTargetIndex = Math.max(0, Math.min(getSavedPageIndex(issue) || 0, issue.pages.length - 1));
  const pageCards = issue.pages
    .map((pageUrl, index) => `
      <figure class="page-card" id="page-${index + 1}" data-page-index="${index}">
        <img src="${pageUrl}" alt="${issue.title} page ${index + 1}" loading="${index <= restoreTargetIndex ? 'eager' : 'lazy'}" referrerpolicy="no-referrer">
        <figcaption class="page-caption">Page ${index + 1} of ${issue.pages.length}</figcaption>
      </figure>
    `)
    .join('');

  canvas.innerHTML = `
    <div class="restore-shell" aria-live="polite">
      <div>
        <h2 class="status-title">Opening your saved page</h2>
        <p class="status-copy" data-restore-copy>Loading saved page...</p>
      </div>
    </div>
    <div class="page-stack">${pageCards}</div>
  `;

  issueLink.href = issue.issue_url;
  updateLocation(issue);
  canvas.scrollTop = 0;
  state.restoreToken += 1;
  void restoreSavedPosition(issue, state.restoreToken);
}

function extractIssueSequence(issue) {
  const candidates = [issue.issue_slug, issue.title, issue.issue_url];
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

function updateFullscreenButtons() {
  const isFullscreen = Boolean(document.fullscreenElement);
  if (floatingFullscreen) {
    floatingFullscreen.textContent = isFullscreen ? '🡼' : '⛶';
    floatingFullscreen.setAttribute('aria-label', isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
    floatingFullscreen.title = isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen';
  }
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await document.documentElement.requestFullscreen();
  } catch {
    // Keep the reader usable when fullscreen is unavailable.
  }
}

function handleReaderKeydown(event) {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target;
  if (target instanceof HTMLElement) {
    const tagName = target.tagName;
    if (tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA' || target.isContentEditable) return;
  }

  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === ' ') {
    const direction = (event.key === 'ArrowLeft' || event.key === 'ArrowUp') ? -1 : 1;
    const viewportState = getPageViewportState();
    event.preventDefault();

    if (!viewportState.card) return;

    if (viewportState.fullyVisible) {
      navigatePage(direction);
      return;
    }

    if (direction > 0 && viewportState.isLast && viewportState.atBottom) {
      navigatePage(direction);
      return;
    }

    scrollReaderViewport(direction);
    return;
  }
  if (event.key === 'Home') {
    event.preventDefault();
    scrollToPage(0, 'smooth');
    return;
  }
  if (event.key === 'End') {
    event.preventDefault();
    scrollToPage(getPageCards().length - 1, 'smooth');
    return;
  }
  if (event.key === 'Escape' && document.fullscreenElement) {
    event.preventDefault();
    void document.exitFullscreen();
    return;
  }
  if (event.key.toLowerCase() === 'f') {
    event.preventDefault();
    void toggleFullscreen();
    return;
  }
  if (event.key.toLowerCase() === 'p') {
    event.preventDefault();
    toggleReaderPanel();
    return;
  }
  if (event.key === '+' || event.key === '=') {
    event.preventDefault();
    stepZoom(1);
    return;
  }
  if (event.key === '-') {
    event.preventDefault();
    stepZoom(-1);
  }
}

function syncIssueControls() {
  const issues = state.manifest?.issues || [];
  const issue = issues[state.currentIssueIndex];
  if (!issue) return;

  issueSelect.innerHTML = issues
    .map((entry, index) => `<option value="${index}"${index === state.currentIssueIndex ? ' selected' : ''}>${formatIssueOption(entry, index)}</option>`)
    .join('');

  prevIssue.disabled = state.currentIssueIndex <= 0;
  nextIssue.disabled = state.currentIssueIndex >= issues.length - 1;
}

function showIssue(index) {
  const issues = state.manifest?.issues || [];
  if (index < 0 || index >= issues.length) return;
  state.currentIssueIndex = index;
  syncIssueControls();
  renderIssue(issues[index]);
  updateActionButtons();
}

function findInitialIssueIndex(issues) {
  if (!issues.length) return -1;
  if (issueId) {
    const match = issues.findIndex((issue) => issue.issue_id === issueId);
    if (match >= 0) return match;
  }
  if (issueSlug) {
    const match = issues.findIndex((issue) => issue.issue_slug === issueSlug);
    if (match >= 0) return match;
  }
  const storedEntry = getStoredEntry();
  if (storedEntry?.last_issue_slug) {
    const match = issues.findIndex((issue) => issue.issue_slug === storedEntry.last_issue_slug);
    if (match >= 0) {
      state.currentPageIndex = Number.isInteger(storedEntry.last_page_index) ? storedEntry.last_page_index : 0;
      return match;
    }
  }
  return 0;
}

async function loadManifest() {
  if (!seriesSlug) {
    setEmpty('No series selected', 'Open the comics page, choose a title, and use the local reader action from the detail drawer.');
    return;
  }

  try {
    const response = await fetch(`./data/series/${encodeURIComponent(seriesSlug)}.json`);
    if (!response.ok) throw new Error(`Reader manifest request failed: ${response.status}`);
    state.manifest = sortManifestIssues(await response.json());
  } catch {
    setEmpty(
      'Reader manifest missing',
      'This series has not been extracted into a local reader manifest yet. Run the reader manifest generator in the comics folder, then reload this page.',
      `https://readcomiconline.li/Comic/${seriesSlug}`
    );
    document.title = `${seriesSlug.replace(/-/g, ' ')} | ateaish comics reader`;
    seriesCover.alt = seriesSlug.replace(/-/g, ' ');
    seriesLink.href = `https://readcomiconline.li/Comic/${seriesSlug}`;
    issueLink.href = `https://readcomiconline.li/Comic/${seriesSlug}`;
    return;
  }

  const manifest = state.manifest;
  document.title = `${manifest.title} | ateaish comics reader`;
  seriesCover.src = manifest.cover_url || './assets/ateaish_comics_default.webp';
  seriesCover.alt = `${manifest.title} cover`;
  seriesLink.href = manifest.series_url;
  updateLibraryEntry((entry) => entry);
  updateActionButtons();

  if (!manifest.issues.length) {
    setEmpty('No extracted issues', 'The manifest exists, but it does not contain any issue pages yet.', manifest.series_url);
    return;
  }

  let initialIssueIndex = findInitialIssueIndex(manifest.issues);
  if (continueMode) {
    const entry = getStoredEntry();
    if (entry) {
      const target = resolveContinueTarget(manifest.issues, entry);
      initialIssueIndex = target.issueIndex;
      state.currentPageIndex = target.pageIndex;
    }
  }
  showIssue(initialIssueIndex);
}

issueSelect.addEventListener('change', () => {
  state.currentPageIndex = 0;
  showIssue(Number(issueSelect.value));
});

prevIssue.addEventListener('click', () => {
  state.currentPageIndex = 0;
  showIssue(state.currentIssueIndex - 1);
});

nextIssue.addEventListener('click', () => {
  state.currentPageIndex = 0;
  showIssue(state.currentIssueIndex + 1);
});

toggleLater.addEventListener('click', () => {
  const entry = updateLibraryEntry((current) => ({
    ...current,
    read_later: !current.read_later,
    read_later_at: !current.read_later ? Date.now() : null,
  }));
  if (entry?.read_later) {
    updateLibraryEntry((current) => ({ ...current, finished: false, finished_at: null }));
  }
  updateActionButtons();
});

toggleFinished.addEventListener('click', () => {
  const entry = updateLibraryEntry((current) => ({
    ...current,
    finished: !(current.finished || (current.completed_series && !current.finished_dismissed)),
    finished_at: !(current.finished || (current.completed_series && !current.finished_dismissed)) ? Date.now() : null,
    finished_dismissed: current.completed_series
      ? (current.finished || (current.completed_series && !current.finished_dismissed))
      : false,
    read_later: false,
    read_later_at: null,
  }));
  if (entry?.finished) {
    persistReadingState();
  }
  updateActionButtons();
});

widthSelect.addEventListener('change', () => {
  updateReaderSettings({ width: widthSelect.value });
});

pageFitSelect.addEventListener('change', () => {
  updateReaderSettings({ fit: pageFitSelect.value });
  scrollToPage(findActivePageIndex(), 'auto');
});

pageGapSelect.addEventListener('change', () => {
  updateReaderSettings({ gap: pageGapSelect.value });
});

zoomSelect.addEventListener('change', () => {
  const activePageIndex = findActivePageIndex();
  updateReaderSettings({ zoom: zoomSelect.value });
  scrollToPage(activePageIndex, 'auto');
});

alignSelect.addEventListener('change', () => {
  updateReaderSettings({ align: alignSelect.value });
});

themeSelect.addEventListener('change', () => {
  updateReaderSettings({ theme: themeSelect.value });
});

toggleCaptions.addEventListener('click', () => {
  updateReaderSettings({ captions: !state.readerSettings.captions });
});

if (togglePanel) {
  togglePanel.addEventListener('click', toggleReaderPanel);
}

if (zoomOut) {
  zoomOut.addEventListener('click', () => stepZoom(-1));
}

if (zoomIn) {
  zoomIn.addEventListener('click', () => stepZoom(1));
}

canvas.addEventListener('scroll', queuePersistReadingState, { passive: true });
window.addEventListener('beforeunload', persistReadingState);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistReadingState();
});
document.addEventListener('keydown', handleReaderKeydown);
document.addEventListener('fullscreenchange', updateFullscreenButtons);

// Close button in the topbar — persist current reading state then return to index

function handleExitReader() {
  persistReadingState();
  window.location.href = './index.html';
}

const floatingExit = document.getElementById('floating-exit');
if (floatingExit) {
  floatingExit.addEventListener('click', handleExitReader);
}

if (floatingFullscreen) {
  floatingFullscreen.addEventListener('click', () => {
    void toggleFullscreen();
  });
}

if (floatingPanel) {
  floatingPanel.addEventListener('click', toggleReaderPanel);
}

if (panel) {
  panel.addEventListener('mouseenter', resetPanelIdleTimer);
  panel.addEventListener('mousemove', resetPanelIdleTimer);
  panel.addEventListener('mouseleave', () => {
    if (state.readerSettings.panelCollapsed) return;
    panel.classList.add('is-idle');
  });
}

state.readerSettings = readReaderSettings();
applyReaderSettings();
updateFullscreenButtons();
resetPanelIdleTimer();
loadManifest();
