import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE_URL = 'https://readcomiconline.li';
const USER_AGENT = 'Mozilla/5.0';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const SERIES_DIR = path.join(DATA_DIR, 'series');
const DISCOVERY_JSON = path.join(DATA_DIR, 'discovery.json');
const CATALOG_JSON = path.join(DATA_DIR, 'catalog.json');
const READER_INDEX_JSON = path.join(DATA_DIR, 'reader_index.json');
const READER_STATE_JSON = path.join(DATA_DIR, 'reader_build_state.json');
const DEFAULT_CONCURRENCY = 4;

function cleanText(value) {
  return String(value ?? '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function absolute(url) {
  return new URL(url, BASE_URL).toString();
}

function parseInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseOptions(argv) {
  const options = {
    source: 'tracked',
    start: 0,
    startSpecified: false,
    count: null,
    concurrency: DEFAULT_CONCURRENCY,
    skipExisting: false,
    resume: false,
    rebuildIndexOnly: false,
    seriesArgs: [],
  };

  for (const arg of argv) {
    if (arg.startsWith('--source=')) {
      options.source = arg.split('=')[1] || options.source;
      continue;
    }
    if (arg.startsWith('--start=')) {
      options.start = Math.max(0, parseInteger(arg.split('=')[1], 0));
      options.startSpecified = true;
      continue;
    }
    if (arg.startsWith('--count=')) {
      options.count = Math.max(0, parseInteger(arg.split('=')[1], 0));
      continue;
    }
    if (arg.startsWith('--concurrency=')) {
      options.concurrency = Math.max(1, parseInteger(arg.split('=')[1], DEFAULT_CONCURRENCY));
      continue;
    }
    if (arg === '--skip-existing') {
      options.skipExisting = true;
      continue;
    }
    if (arg === '--resume') {
      options.resume = true;
      continue;
    }
    if (arg === '--rebuild-index-only') {
      options.rebuildIndexOnly = true;
      continue;
    }
    options.seriesArgs.push(arg);
  }

  if (!['catalog', 'discovery', 'tracked', 'urls'].includes(options.source)) {
    throw new Error(`Unsupported source: ${options.source}`);
  }

  if (options.seriesArgs.length) {
    options.source = 'urls';
  }

  return options;
}

function seriesSlugFromUrl(seriesUrl) {
  const parts = new URL(seriesUrl).pathname.split('/').filter(Boolean);
  if (parts[0] === 'Comic' && parts[1]) return parts[1];
  throw new Error(`Unsupported series URL: ${seriesUrl}`);
}

function issueSlugFromUrl(issueUrl) {
  const parts = new URL(issueUrl).pathname.split('/').filter(Boolean);
  return parts[2] || '';
}

function issueIdFromUrl(issueUrl) {
  return new URL(issueUrl).searchParams.get('id') || '';
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }
  return response.text();
}

function step1(value) {
  return value.substring(0xf, 0xf + 0x12) + value.substring(0xf + 0x12 + 0x11);
}

function step2(value) {
  return value.substring(0, value.length - (0x9 + 0x2)) + value[value.length - 2] + value[value.length - 1];
}

function decodeReaderImage(rawValue) {
  let value = rawValue
    .replace(/kv__WYemU7_/g, 'e')
    .replace(/b/g, 'pw_.g28x')
    .replace(/h/g, 'd2pr.x_27');

  value = value.replace(/pw_.g28x/g, 'b').replace(/d2pr.x_27/g, 'h');
  if (value.indexOf('https') === 0) return value;

  const query = value.substring(value.indexOf('?'));
  let encoded;
  let suffix;

  if (value.indexOf('=s0?') > 0) {
    encoded = value.substring(0, value.indexOf('=s0?'));
    suffix = '=s0';
  } else {
    encoded = value.substring(0, value.indexOf('=s1600?'));
    suffix = '=s1600';
  }

  let decoded = atob(step2(step1(encoded)));
  decoded = decodeURIComponent(escape(decoded));
  decoded = decoded.substring(0, 13) + decoded.substring(17);
  decoded = decoded.substring(0, decoded.length - 2) + suffix;
  return `https://2.bp.blogspot.com/${decoded}${query}`;
}

function parseMetaContent(html, key, attribute = 'property') {
  const regex = new RegExp(`<meta[^>]+${attribute}=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i');
  return html.match(regex)?.[1] || '';
}

function parseSeriesTitle(html, seriesSlug) {
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    const title = cleanText(titleMatch[1]).replace(/\s*-\s*Read.*$/i, '');
    if (title) return title;
  }
  return seriesSlug.replace(/-/g, ' ');
}

function parseSeriesIssues(html, seriesSlug) {
  const escapedSlug = seriesSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const issuePattern = new RegExp(`href=["'](/Comic/${escapedSlug}/[^"'#?]+\\?id=\\d+)["']`, 'gi');
  const issues = [];
  const seen = new Set();
  for (const match of html.matchAll(issuePattern)) {
    const issueUrl = absolute(match[1]);
    if (seen.has(issueUrl)) continue;
    seen.add(issueUrl);
    issues.push({
      issue_url: issueUrl,
      issue_slug: issueSlugFromUrl(issueUrl),
      issue_id: issueIdFromUrl(issueUrl),
      title: issueSlugFromUrl(issueUrl).replace(/-/g, ' '),
    });
  }
  return issues;
}

function parseIssuePages(html) {
  const pathCandidates = [...html.matchAll(/pth = '([^']+)';/g)]
    .map((match) => match[1])
    .filter(
      (entry) =>
        entry.startsWith('http') ||
        entry.includes('?rhlupa=') ||
        entry.includes('=s0?') ||
        entry.includes('=s1600?') ||
        entry.includes('/s0') ||
        entry.includes('/s1600') ||
        /\.(jpg|jpeg|png|webp)(\?|$)/i.test(entry)
    );
  const directImages = [...html.matchAll(/<img[^>]+src="([^"]+)"/gi)]
    .map((match) => match[1])
    .filter((entry) => entry.startsWith('http'));
  const decodedPaths = [];
  const seen = new Set();

  for (const entry of pathCandidates) {
    try {
      const decoded = decodeReaderImage(entry);
      if (!decoded || seen.has(decoded)) continue;
      seen.add(decoded);
      decodedPaths.push(decoded);
    } catch {
      continue;
    }
  }

  if (decodedPaths.length) {
    return decodedPaths;
  }

  if (directImages.length) {
    return directImages;
  }

  throw new Error('Could not locate issue image paths');
}

function parseIssueTitle(html, fallback) {
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!titleMatch) return fallback;
  const title = cleanText(titleMatch[1])
    .replace(/\s*-\s*Read.*$/i, '')
    .replace(/\s+comic online in high quality$/i, '');
  return title || fallback;
}

async function loadCatalogMap() {
  if (!existsSync(CATALOG_JSON)) return new Map();
  const payload = JSON.parse(await readFile(CATALOG_JSON, 'utf8'));
  return new Map((payload.items || []).map((item) => [item.series_url, item]));
}

async function collectTargetSeries(options) {
  if (options.source === 'urls') {
    return options.seriesArgs.map((entry) => absolute(entry));
  }

  if (options.source === 'catalog') {
    if (!existsSync(CATALOG_JSON)) {
      throw new Error('Missing catalog.json. Run update_catalog.py first.');
    }
    const catalog = JSON.parse(await readFile(CATALOG_JSON, 'utf8'));
    return (catalog.items || []).map((item) => item.series_url).filter(Boolean);
  }

  if (!existsSync(DISCOVERY_JSON)) {
    throw new Error('Missing discovery.json. Run update_catalog.py first or pass series URLs explicitly.');
  }

  const discovery = JSON.parse(await readFile(DISCOVERY_JSON, 'utf8'));

  if (options.source === 'tracked') {
    const trackedUrls = discovery.meta?.tracked_series_urls;
    if (Array.isArray(trackedUrls) && trackedUrls.length) {
      return trackedUrls.filter(Boolean);
    }

    const fallbackSections = new Set(['newest', 'ongoing']);
    const fallbackUrls = [];
    const seenFallback = new Set();
    for (const section of discovery.sections || []) {
      if (!fallbackSections.has(section.id)) continue;
      for (const item of section.items || []) {
        if (!item.series_url || seenFallback.has(item.series_url)) continue;
        seenFallback.add(item.series_url);
        fallbackUrls.push(item.series_url);
      }
    }
    return fallbackUrls;
  }

  const seen = new Set();
  const urls = [];
  for (const section of discovery.sections || []) {
    for (const item of section.items || []) {
      if (!item.series_url || seen.has(item.series_url)) continue;
      seen.add(item.series_url);
      urls.push(item.series_url);
    }
  }
  return urls;
}

function uniqueSeries(urls) {
  const seen = new Set();
  return urls.filter((url) => {
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function sliceTargets(targetSeries, options) {
  const start = Math.min(options.start, targetSeries.length);
  const end = options.count === null ? targetSeries.length : Math.min(start + options.count, targetSeries.length);
  return {
    selected: targetSeries.slice(start, end),
    start,
    end,
    total: targetSeries.length,
  };
}

function manifestPathForSeriesSlug(seriesSlug) {
  return path.join(SERIES_DIR, `${seriesSlug}.json`);
}

async function loadManifestSummary(filePath) {
  const manifest = JSON.parse(await readFile(filePath, 'utf8'));
  return {
    series_slug: manifest.series_slug,
    title: manifest.title,
    issue_count: manifest.issue_count,
    skipped_issue_count: manifest.skipped_issue_count || 0,
    page_count_total: manifest.page_count_total,
    cover_url: manifest.cover_url,
    series_url: manifest.series_url,
    manifest_url: `./data/series/${manifest.series_slug}.json`,
  };
}

async function shouldSkipExistingManifest(filePath) {
  if (!existsSync(filePath)) return false;

  try {
    const manifest = JSON.parse(await readFile(filePath, 'utf8'));
    return (manifest.skipped_issue_count || 0) === 0 && (manifest.issue_count || 0) > 0;
  } catch {
    return false;
  }
}

async function rebuildReaderIndex() {
  await mkdir(SERIES_DIR, { recursive: true });
  const entries = await readdir(SERIES_DIR, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = path.join(SERIES_DIR, entry.name);
    items.push(await loadManifestSummary(filePath));
  }

  items.sort((left, right) => left.title.localeCompare(right.title));
  await writeFile(
    READER_INDEX_JSON,
    JSON.stringify({
      generated_at: new Date().toISOString(),
      total_series: items.length,
      items,
    }),
    'utf8'
  );
  return items;
}

async function writeRunState(payload) {
  await writeFile(READER_STATE_JSON, JSON.stringify(payload), 'utf8');
}

async function loadPreviousRunState() {
  if (!existsSync(READER_STATE_JSON)) return null;

  try {
    return JSON.parse(await readFile(READER_STATE_JSON, 'utf8'));
  } catch {
    return null;
  }
}

async function buildSeriesManifest(seriesUrl, catalogMap) {
  const seriesSlug = seriesSlugFromUrl(seriesUrl);
  const seriesHtml = await fetchHtml(seriesUrl);
  const catalogItem = catalogMap.get(seriesUrl);
  const title = catalogItem?.title || parseSeriesTitle(seriesHtml, seriesSlug);
  const description = catalogItem?.context || cleanText(parseMetaContent(seriesHtml, 'og:description'));
  const coverUrl = catalogItem?.cover_url || parseMetaContent(seriesHtml, 'og:image');
  const issues = parseSeriesIssues(seriesHtml, seriesSlug);

  const issuePayloads = [];
  const skippedIssues = [];
  for (const issue of issues) {
    try {
      const issueHtml = await fetchHtml(issue.issue_url);
      const pages = parseIssuePages(issueHtml);
      issuePayloads.push({
        ...issue,
        title: parseIssueTitle(issueHtml, issue.title),
        page_count: pages.length,
        pages,
      });
    } catch (error) {
      skippedIssues.push({
        issue_url: issue.issue_url,
        issue_slug: issue.issue_slug,
        issue_id: issue.issue_id,
        title: issue.title,
        reason: error.message,
      });
      console.warn(`Skipped issue ${issue.issue_slug} for ${seriesSlug}: ${error.message}`);
    }
  }

  if (!issuePayloads.length) {
    throw new Error('No readable issues extracted for this series');
  }

  return {
    generated_at: new Date().toISOString(),
    series_slug: seriesSlug,
    title,
    description,
    series_url: seriesUrl,
    cover_url: coverUrl,
    issue_count: issuePayloads.length,
    skipped_issue_count: skippedIssues.length,
    page_count_total: issuePayloads.reduce((total, issue) => total + issue.page_count, 0),
    issues: issuePayloads,
    skipped_issues: skippedIssues,
  };
}

async function promisePool(items, limit, worker) {
  const results = [];
  const queue = [...items];
  const running = new Set();

  async function launch(item) {
    const result = await worker(item);
    results.push(result);
  }

  while (queue.length || running.size) {
    while (queue.length && running.size < limit) {
      const item = queue.shift();
      const task = launch(item).finally(() => running.delete(task));
      running.add(task);
    }
    if (running.size) {
      await Promise.race(running);
    }
  }

  return results;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  await mkdir(SERIES_DIR, { recursive: true });

  if (options.rebuildIndexOnly) {
    const indexItems = await rebuildReaderIndex();
    await writeRunState({
      generated_at: new Date().toISOString(),
      mode: 'rebuild-index-only',
      indexed_series: indexItems.length,
    });
    console.log(`Wrote ${READER_INDEX_JSON}`);
    console.log(`Wrote ${READER_STATE_JSON}`);
    return;
  }

  if (options.resume && !options.startSpecified && options.source !== 'urls') {
    const previousRunState = await loadPreviousRunState();
    if (previousRunState?.source === options.source && Number.isInteger(previousRunState.next_start)) {
      options.start = previousRunState.next_start;
      console.log(`Resuming ${options.source} batch from start=${options.start}`);
    }
  }

  const catalogMap = await loadCatalogMap();
  const targetSeries = uniqueSeries(await collectTargetSeries(options));
  const batch = sliceTargets(targetSeries, options);

  console.log(`Building reader manifests for ${batch.selected.length} series (${batch.start}-${Math.max(batch.end - 1, batch.start)} of ${batch.total})...`);
  let builtCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  await promisePool(batch.selected, options.concurrency, async (seriesUrl) => {
    const seriesSlug = seriesSlugFromUrl(seriesUrl);
    const filePath = manifestPathForSeriesSlug(seriesSlug);
    if (options.skipExisting) {
      const shouldSkip = await shouldSkipExistingManifest(filePath);
      if (shouldSkip) {
        skippedCount += 1;
        console.log(`Skipped ${seriesSlug}.json`);
        return;
      }
    }

    try {
      const manifest = await buildSeriesManifest(seriesUrl, catalogMap);
      await writeFile(filePath, JSON.stringify(manifest), 'utf8');
      builtCount += 1;
      console.log(`Wrote ${manifest.series_slug}.json (${manifest.issue_count} issues)`);
    } catch (error) {
      failedCount += 1;
      console.error(`Failed ${seriesSlug}: ${error.message}`);
    }
  });

  const indexItems = await rebuildReaderIndex();
  await writeRunState({
    generated_at: new Date().toISOString(),
    source: options.source,
    requested_start: options.start,
    requested_count: options.count,
    actual_start: batch.start,
    actual_end: batch.end,
    total_available: batch.total,
    processed_in_run: batch.selected.length,
    built_in_run: builtCount,
    skipped_in_run: skippedCount,
    failed_in_run: failedCount,
    indexed_series_total: indexItems.length,
    next_start: batch.end >= batch.total ? 0 : batch.end,
  });

  console.log(`Wrote ${READER_INDEX_JSON}`);
  console.log(`Wrote ${READER_STATE_JSON}`);
  console.log(`Next start: ${batch.end >= batch.total ? 0 : batch.end}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
