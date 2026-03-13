const canvas = document.getElementById('canvas');
const seriesCover = document.getElementById('series-cover');
const seriesTitle = document.getElementById('series-title');
const seriesCopy = document.getElementById('series-copy');
const seriesMeta = document.getElementById('series-meta');
const issueSelect = document.getElementById('issue-select');
const prevIssue = document.getElementById('prev-issue');
const nextIssue = document.getElementById('next-issue');
const widthSelect = document.getElementById('width-select');
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
const SAVE_SCROLL_DEBOUNCE_MS = 120;

const state = {
  manifest: null,
  currentIssueIndex: -1,
  currentPageIndex: Number.isNaN(initialPageParam) ? 0 : Math.max(0, initialPageParam - 1),
  saveTimer: null,
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

function getLatestIssue(manifest) {
  return manifest?.issues?.[0] || null;
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
    cover_url: manifest?.cover_url || existing.cover_url || '../assets/logo_noborder.png',
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
  toggleLater.textContent = entry.read_later ? 'Saved for later' : 'Read later';
  toggleFinished.textContent = entry.finished ? 'Finished' : 'Mark finished';
  toggleLater.classList.toggle('primary', Boolean(entry.read_later));
  toggleFinished.classList.toggle('primary', Boolean(entry.finished));
}

function findActivePageIndex() {
  const cards = [...canvas.querySelectorAll('.page-card')];
  if (!cards.length) return 0;

  const viewportAnchor = Math.max(120, window.innerHeight * 0.24);
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

function persistReadingState() {
  const issue = getCurrentIssue();
  if (!state.manifest || !issue) return;

  const pageIndex = findActivePageIndex();
  state.currentPageIndex = pageIndex;

  updateLibraryEntry((entry) => ({
    ...entry,
    last_page_index: pageIndex,
    last_page_number: pageIndex + 1,
    last_page_count: issue.pages.length,
    last_read_at: Date.now(),
    read_later: false,
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

function restoreSavedPosition(issue) {
  const entry = getStoredEntry();
  const savedPageIndex = issue.issue_slug === entry?.last_issue_slug && Number.isInteger(entry?.last_page_index)
    ? entry.last_page_index
    : state.currentPageIndex;
  const cards = canvas.querySelectorAll('.page-card');
  if (!cards.length) return;

  const boundedIndex = Math.max(0, Math.min(savedPageIndex || 0, cards.length - 1));
  state.currentPageIndex = boundedIndex;

  window.requestAnimationFrame(() => {
    // Scroll to the saved page, then wait for images/layout to settle before
    // persisting. Immediate persistence can be overwritten by layout shifts
    // caused by lazy-loading images, which results in the saved page snapping
    // back to the top.
    const target = cards[boundedIndex];
    if (!target) return;
    target.scrollIntoView({ block: 'start', behavior: 'auto' });

    const img = target.querySelector('img');
    const finalize = () => {
      // Give a small buffer after image load/paint to allow layout to stabilise
      window.setTimeout(() => {
        persistReadingState();
      }, 160);
    };

    if (img && !img.complete) {
      img.addEventListener('load', finalize, { once: true });
      // fallback if load event doesn't fire for any reason
      window.setTimeout(finalize, 1000);
    } else {
      // image already loaded or missing — persist after a short delay
      window.setTimeout(finalize, 120);
    }
  });
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
  const pageCards = issue.pages
    .map((pageUrl, index) => `
      <figure class="page-card" id="page-${index + 1}" data-page-index="${index}">
        <img src="${pageUrl}" alt="${issue.title} page ${index + 1}" loading="lazy" referrerpolicy="no-referrer">
        <figcaption class="page-caption">Page ${index + 1} of ${issue.pages.length}</figcaption>
      </figure>
    `)
    .join('');

  canvas.innerHTML = `
    <div class="canvas-head">
      <div>
        <h2 class="canvas-title">${issue.title}</h2>
        <p class="status-copy">${formatNumber(issue.pages.length)} extracted pages loaded from the local reader manifest.</p>
      </div>
    </div>
    <div class="page-stack">${pageCards}</div>
  `;

  issueLink.href = issue.issue_url;
  updateLocation(issue);
  restoreSavedPosition(issue);
}

function syncIssueControls() {
  const issues = state.manifest?.issues || [];
  const issue = issues[state.currentIssueIndex];
  if (!issue) return;

  issueSelect.innerHTML = issues
    .map((entry, index) => `<option value="${index}"${index === state.currentIssueIndex ? ' selected' : ''}>${entry.title}</option>`)
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
    state.manifest = await response.json();
  } catch {
    setEmpty(
      'Reader manifest missing',
      'This series has not been extracted into a local reader manifest yet. Run the reader manifest generator in the comics folder, then reload this page.',
      `https://readcomiconline.li/Comic/${seriesSlug}`
    );
    seriesTitle.textContent = seriesSlug.replace(/-/g, ' ');
    seriesCopy.textContent = 'Local issue data is not available for this series yet.';
    seriesLink.href = `https://readcomiconline.li/Comic/${seriesSlug}`;
    issueLink.href = `https://readcomiconline.li/Comic/${seriesSlug}`;
    return;
  }

  const manifest = state.manifest;
  seriesTitle.textContent = manifest.title;
  seriesCopy.textContent = manifest.description || 'Extracted locally from the source site for in-page reading.';
  seriesMeta.textContent = `${formatNumber(manifest.issue_count)} issues • ${formatNumber(manifest.page_count_total)} extracted pages`;
  seriesCover.src = manifest.cover_url || '../assets/logo_noborder.png';
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
    if (entry && entry.last_issue_slug) {
      const found = manifest.issues.findIndex((iss) => iss.issue_slug === entry.last_issue_slug);
      if (found !== -1) {
        initialIssueIndex = found;
        state.currentPageIndex = Number.isInteger(entry.last_page_index) ? entry.last_page_index : 0;
      }
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
    finished: !current.finished,
    finished_at: !current.finished ? Date.now() : null,
    read_later: false,
    read_later_at: null,
  }));
  if (entry?.finished) {
    persistReadingState();
  }
  updateActionButtons();
});

widthSelect.addEventListener('change', () => {
  canvas.dataset.width = widthSelect.value;
});

window.addEventListener('scroll', queuePersistReadingState, { passive: true });
window.addEventListener('beforeunload', persistReadingState);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistReadingState();
});

// Close button in the topbar — persist current reading state then return to index

function handleExitReader() {
  persistReadingState();
  window.location.href = './index.html';
}

const closeReader = document.getElementById('close-reader');
if (closeReader) {
  closeReader.addEventListener('click', handleExitReader);
}

const floatingExit = document.getElementById('floating-exit');
if (floatingExit) {
  floatingExit.addEventListener('click', handleExitReader);
}

loadManifest();
