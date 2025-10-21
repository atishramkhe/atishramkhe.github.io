let loadedFMHYData = {}; // New global variable to store raw FMHY data

// Base path to the logos folder (relative path - adjust if your build serves logos elsewhere)
const LOGO_BASE_PATH = './logos';

// Loaded manifest mapping (e.g. { "example-site": "example-site.png", ... })
let localLogoManifest = {};

/**
 * Load a manifest.json from the logos folder that maps site keys/names to filenames.
 * manifest.json example:
 * {
 *   "anime-sama.fr": "anime-sama.png",
 *   "default": "default.png"
 * }
 */
async function loadLocalLogoManifest() {
    // Try multiple likely locations for the manifest (relative only)
    const candidates = [
        `logo_manifest.json`, 
        `${LOGO_BASE_PATH}/logo_manifest.json`,   // try this name first (new)
        `${LOGO_BASE_PATH}/manifest.json`,
        `websites_logos/manifest.json`
    ];
    for (const url of candidates) {
        try {
            const resp = await fetch(url, { cache: 'no-cache' });
            if (!resp.ok) throw new Error(`Not found ${resp.status}`);
            const json = await resp.json();
            if (json && typeof json === 'object') {
                // Normalize keys: store original keys and slugified/hostname variants for easier lookup
                localLogoManifest = {};
                for (const rawKey of Object.keys(json)) {
                    const entry = json[rawKey];
                    localLogoManifest[rawKey] = entry;
                    try {
                        const s = slugify(rawKey);
                        if (s) localLogoManifest[s] = entry;
                    } catch (e) {}
                    // if the manifest key looks like a URL, also register its hostname
                    try {
                        const u = new URL(rawKey, window.location.origin);
                        if (u && u.hostname) {
                            localLogoManifest[u.hostname] = entry;
                            localLogoManifest[slugify(u.hostname)] = entry;
                        }
                    } catch (e) {
                        // not a URL; ignore
                    }
                }
                console.info('Loaded logo manifest from', url);
                return;
            }
        } catch (err) {
            // continue to next candidate
        }
    }
    // no manifest found, use empty manifest (we'll fallback to conventions / favicons)
    localLogoManifest = {};
}

/**
 * Make a safe slug from a string (used to form fallback filenames).
 */
function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/https?:\/\//, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

// Minimal clock function to avoid ReferenceError if UI expects a clock
function updateClock() {
    try {
        const el = document.getElementById('clock');
        if (el) el.textContent = new Date().toLocaleTimeString();
    } catch (e) {
        // noop
    }
}

/**
 * Resolve the logo URL for a site object.
 * - If site.logo or site.icon is provided, return that (absolute or relative).
 * - If manifest contains an entry for site.url or site.name, use it.
 * - Otherwise fallback to a conventional path: /logos/<slug>.png
 * - Final fallback: /logos/default.png
 *
 * site may be { name, url, logo, icon }
 */
function getLogoUrlForSite(site) {
    // 1) explicit logo field provided by data
    if (site.logo) {
        return site.logo.startsWith('http') ? site.logo : `${LOGO_BASE_PATH}/${site.logo}`;
    }
    if (site.icon) {
        return site.icon.startsWith('http') ? site.icon : `${LOGO_BASE_PATH}/${site.icon}`;
    }

    // 2) manifest lookup by exact url, hostname or name
    const candidates = [];
    if (site.url) {
        try {
            const u = new URL(site.url, window.location.origin);
            candidates.push(u.hostname);
            candidates.push(u.hostname + u.pathname.replace(/\//g, '-'));
            candidates.push(site.url);
        } catch (e) {
            // ignore
        }
    }
    if (site.name) candidates.push(site.name);
    // normalize and check manifest keys
    for (const raw of candidates) {
        const key = slugify(raw);
        if (localLogoManifest[key]) {
            const entry = localLogoManifest[key];
            // manifest can be either string filename or object { filename, logo_type, dominant_color }
            if (typeof entry === 'string') {
                return `${LOGO_BASE_PATH}/${entry}`;
            } else if (entry && entry.filename) {
                return entry.filename.startsWith('http') ? entry.filename : `${LOGO_BASE_PATH}/${entry.filename}`;
            }
        }
    }

    // 3) convention fallback using slugified name or url
    const fallbackSlug = slugify(site.name || site.url || 'unknown');
    const tryExts = ['png', 'svg', 'jpg', 'webp'];
    for (const ext of tryExts) {
        // optimistic path - file may not exist but browser will show broken image,
        // we handle onerror when creating <img>
        return `${LOGO_BASE_PATH}/${fallbackSlug}.${ext}`;
    }

    // 4) default image
    return `${LOGO_BASE_PATH}/default.png`;
}

/**
 * Example helper to create a site card element that uses the logo loader.
 * Use this in your rendering loop where you create site list items.
 */
function createSiteCard(site) {
    const a = document.createElement('a');
    a.href = site.url || '#';
    a.className = 'site-card';

    const img = document.createElement('img');
    img.alt = site.name || site.url || 'site';
    img.className = 'site-logo';
    img.src = getLogoUrlForSite(site);
    // fallback to default if image fails to load
    img.onerror = () => {
        if (img.src && !img.src.endsWith('/default.png')) {
            img.src = `${LOGO_BASE_PATH}/default.png`;
        }
    };

    const title = document.createElement('div');
    title.className = 'site-title';
    title.textContent = site.name || site.url || 'Unknown';

    // Add favorite star button (hidden by default, shown on hover)
    const starBtn = document.createElement('button');
    starBtn.className = 'favorite-star';
    starBtn.type = 'button';
    starBtn.title = 'Add to Favorites';
    starBtn.textContent = isFavorite(site.url) ? '★' : '☆';
    starBtn.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleFavorite(site);
      // Update star immediately
      starBtn.textContent = isFavorite(site.url) ? '★' : '☆';
    };
    a.appendChild(starBtn);

    a.appendChild(img);
    a.appendChild(title);
    return a;
}

// Example usage: ensure manifest is loaded before rendering
async function initHomepage() {
    await loadLocalLogoManifest();
    // ...existing initialization: loadLocalFMHYData(), renderSectionsInOrder(), etc.
    // then when rendering each site use createSiteCard(site)
}

// If you already have a DOMContentLoaded initializer, call initHomepage() inside it.
// Otherwise you may add:
document.addEventListener('DOMContentLoaded', async () => {
    // const loadingIndicator = document.getElementById('loading-indicator');

    // Show loading overlay
    // showLoadingScreen();
    // if (loadingIndicator) loadingIndicator.style.display = 'flex';

    // Also make sure settings modal starts hidden
    const sm = document.getElementById('settings-modal');
    if (sm) sm.style.display = 'none';

    // Inject runtime style overrides (header transparent, aligned rows, snap)
    injectRuntimeOverrides();

    // Make background glow move on scroll
    updateGlowOnScroll();
    window.addEventListener('scroll', updateGlowOnScroll, { passive: true });

    // Initialize small utilities
    updateClock();
    setInterval(updateClock, 1000);

    // Initialize section data
    sectionData['favorites'] = favorites;
    sectionData['my-links'] = myCustomLinks;
    sectionData['traditional-websites'] = TRADITIONAL_WEBSITES;

    // Load manifest and local FMHY data (best-effort)
    await loadLocalLogoManifest();
    await loadLocalFMHYData();

    // Inject homepage styles and render the TV-style app grid hero
    injectHomepageStyles();
    try { renderAppGrid(); } catch (e) { console.warn('renderAppGrid failed', e); }

    // Render the rest of the sections as before
    renderSectionsInOrder();

    // Collect all sites for search functionality (unchanged logic)
    allSites = [];
    for (const sectionId in loadedFMHYData) {
         if (loadedFMHYData.hasOwnProperty(sectionId) && Array.isArray(loadedFMHYData[sectionId])) {
             loadedFMHYData[sectionId].forEach(site => {
                 if (site && site.name && site.url && !allSites.some(s => s.url === site.url)) {
                     allSites.push({ name: site.name, url: site.url });
                 }
             });
         } else if (
             loadedFMHYData.hasOwnProperty(sectionId) &&
             typeof loadedFMHYData[sectionId] === 'object' &&
             loadedFMHYData[sectionId] !== null
         ) {
             for (const subSectionName in loadedFMHYData[sectionId]) {
                 if (
                     loadedFMHYData[sectionId].hasOwnProperty(subSectionName) &&
                     Array.isArray(loadedFMHYData[sectionId][subSectionName])
                 ) {
                     loadedFMHYData[sectionId][subSectionName].forEach(site => {
                         if (site && site.name && site.url && !allSites.some(s => s.url === site.url)) {
                             allSites.push({ name: site.name, url: site.url });
                         }
                     });
                 }
             }
         }
     }

    // Finalize UI
    setupEventListeners();

    // if (loadingIndicator) loadingIndicator.style.display = 'none';
    // hideLoadingScreen();
    document.body.classList.add('loaded');
});

// Remove the second DOMContentLoaded for settings modal (already handled in setupEventListeners)

// If you already have a DOMContentLoaded initializer, call initHomepage() inside it.
// Otherwise you may add:
// document.addEventListener('DOMContentLoaded', () => {
//     // start init but do not block page if other init exists
//     initHomepage().catch(e => console.error('Init failed', e));
// });

async function loadLocalFMHYData() {
  console.log('Attempting to load data from local links.v5.json...'); // Updated to v5
  try {
    const response = await fetch('links.v5.json'); // Use relative path
    console.log('Fetch response received. Status:', response.status, response.statusText);
    if (!response.ok) {
      throw new Error(`Failed to fetch local JSON: ${response.statusText} (${response.status})`);
    }
    const data = await response.json();
    console.log('JSON data parsed. Data keys:', Object.keys(data));

    // Store the raw loaded data globally
    loadedFMHYData = data;
    console.log('Local FMHY data loaded successfully into loadedFMHYData. Keys:', Object.keys(loadedFMHYData));
  } catch (error) {
    console.error('Error loading local FMHY data:', error);
  }
}

// Limit visible tiles per section (except search results)
const VISIBLE_LIMIT = 4;
// Track expanded/collapsed state per section grid id
const expandedSections = {}; // { '<section-id>-grid': boolean }

// Default section order (no longer user-customizable)
const DEFAULT_SECTION_ORDER = [
  'favorites',
  'movies-tv-shows',
  'francais',
  'live-sports',
  'live-tv',
  'anime-streaming',
  'drama-streaming',
  'manga',
  'traditional-websites',
  'my-links'
];
let sectionOrder = DEFAULT_SECTION_ORDER.slice();

// Define the sections to be displayed on the homepage
let allSites = []; // Global array to store all sites for searching
let sectionData = {}; // Global object to store data for each section (will be populated by renderSectionsInOrder)

const SECTIONS = [
  { id: 'anime-streaming', label: 'Anime', type: 'h2', defaultVisible: true, order: 1, sourceSectionId: 'video', sourceSubSectionNames: ['Anime Streaming'], sitesToRemove: [
    'Wotaku', 'Wotaku The Index', 'Wotaku Wiki', 'Wotaku EverythingMoe', 'Wotaku 2',
    'AnimeKai Status', 'Official Mirrors', 'Official Mirrors Enhancements', 
    'Official Mirrors Auto-Focus', 'animepahe Enhancements', 'Anime Streaming CSE',
    'Anime Streaming CSE Kuroiru', 'Rive', 'Aninow', 'Rive 2', 'Rive Status', 
    'Crunchyroll', 'Crunchyroll US Proxy', 'Miu', 'Miu AnimeThemes', 'Layendimator', 
    'Layendimator AnymeX', 'Layendimator Extension Guide', 'Layendimator Seanime', 
    'Layendimator Miru'
  ] },
  { id: 'drama-streaming', label: 'Drama', type: 'h2', defaultVisible: true, order: 2, sourceSectionId: 'video', sourceSubSectionNames: ['Drama Streaming'], sitesToRemove: [
    'EverythingMoe', 'EverythingMoe 2', 'dramacool', 'OnDemandChina', 'AsianCrush', 'Dramacool 2',
    'KissAsian'
  ] },
  { id: 'live-sports', label: 'Sports', type: 'h2', defaultVisible: true, order: 3, sourceSectionId: 'video', sourceSubSectionNames: ['Live Sports'], sitesToRemove: [
    '/sport calendars/', '/sport calendars/ 2', 'r/rugbystreams', 'Live Snooker Guide', 
    'WatchSports', 'DaddyLive Self-Hosted Proxy',
    'VIP Box Sports', 'VIP Box Sports Mirrors', 'TimStreams Status', 'TotalSportek.to', 
    'TotalSportek.to 2', 'CricHD.to', 'SportOnTv 2', 'Sports Plus', 'CrackStreams', '720pStream', 
    '⁠GoalieTrend', 'BuffStream', 'Boxing-100', 'Soccerdoge', 'OnHockey', 'MLB24ALL', 'MLB24ALL NHL24ALL', 
    'OvertakeFans', 'Aceztrims', 'DD12', 'NontonGP', 'F1 Dash' 
  ] },
  { id: 'live-tv', label: 'TV', type: 'h2', defaultVisible: true, order: 4, sourceSectionId: 'video', sourceSubSectionNames: ['Live TV'], sitesToRemove: [
    'TitanTV', 'SHOWROOM',  'EXP TV', 'Channel 99', 'Baked', 'psp-tv', 'cytube', 'Puffer', 'SquidTV', 'FreeInterTV', 
    'lmao.love', 'IPTV Play', 'USTVGo', 'Xumo Play', 'DaddyLive TV Self-Hosted Proxy', 'EAsyWebTV IPTV Web', 
    'StreamHub'
  ] },
  { id: 'movies-tv-shows', label: 'Films & TV', type: 'h2', defaultVisible: true, order: 5, sourceSectionId: 'video', sourceSubSectionNames: ['Streaming Sites', 'API Frontends', 'Single Server'], sitesToRemove: [
    'Rive Status', '1Shows Guide', '1Shows RgShows', 'Cinegram', 'Smashystream', 'Smashystream 2','PrimeWire', 'PrimeWire 2',
    'Downloads-Anymovies', 'Streaming CSE', 'Streaming CSE 2', 'Streaming CSE 3', 'Streaming CSE 4', 'BEECH', 'BEECH Mocine', 
    'Willow', 'Willow 2', 'Willow 4K Guide', 'Primeshows', 'VLOP', 'HydraHD', 'HydraHD Status', 'Mapple.tv', 'Nunflix Docs', 
    'Hopfly', 'Purplix', 'Purplix 2', 'Purplix 3', 'M-Zone', 'Movie Pluto', 'Cinema Deck', 'Cinema Deck 2', 'Cinema Deck Status', 
    'Altair', 'Altair Nova', 'Autoembed', 'Ask4Movies', 'Novafork', 'EE3', 'EE3 RIPS', 'Poorflix', 'Movies7', 'LookMovie', 'LookMovie Clones', 
    'Soaker', 'Soaker Soaper', 'Soaker Mirrors', 'Vidsrc.cx', 'OnionPlay', 'Mp4Hydra', 'Mp4Hydra 2', 'ShowBox', 'Levidia', 'Levidia 2',
    'Levidia 3', 'Movies4F', 'FshareTV', 'Zoechip', 'Player4U', 'Gir Society', 'PlayIMDb'
  ] },
  { id: 'manga', label: 'Manga', type: 'h2', defaultVisible: true, order: 6, sourceSectionId: 'reading', sourceSubSectionNames: ['Manga'], sitesToRemove: [
    'Wotaku', 'Wotaku The Index', 'Wotaku Wiki', 'Wotaku EverythingMoe', 'Wotaku 2', 'Rawmangaz', 'MangaDex Downloader', 'NyaaManga / LNs',
    'The Manga Library', 'Great Discord Links', 'Great Discord Links MangaDex Groups', 'Madokami', 'Madokami Archive', 'Manga CSE', 
    'Manga CSE CSE 2', 'Seanime', 'Kaizoku', 'Webcomic Reader', 'BallonsTranslator', 'BallonsTranslator Cotrans', 
    'BallonsTranslator Scanlate', 'Manga-Manager', 'Scan Updates', 'MangaHasu'
  ] },
  { id: 'traditional-websites', label: 'Web', type: 'h2', defaultVisible: true, order: 7, sitesToRemove: [] },
  { id: 'favorites', label: 'Favorites', type: 'h2', defaultVisible: true, order: 8, sitesToRemove: [] },
  { id: 'francais', label: 'Français', type: 'h2', defaultVisible: true, order: 9, sourceSectionId: 'non-english', sourceSubSectionNames: ['French'], sitesToRemove: [
    'RgShows API', 'xalaflix Status', 'Paradise lost.666', 'Movie to Review', 'Ciné-Bis-Art', 'TF1',
    'Cinémathèque de Bretagne', 'ICI Tou.tv', 'Télé-Québec', 'TV5Unis', 'TFO', 'molotov.tv',
    'Grafikart', 'fluxradios', 'programmes-radio', 'RgShows Guide', 'RgShows', 'kiboanime'
  ] },
  { id: 'my-links', label: 'My Links', type: 'h2', defaultVisible: true, order: 10, sitesToRemove: [] },
];

// Predefined list of traditional websites
const TRADITIONAL_WEBSITES = [
  { name: 'ateaish movies', url: 'https://atishramkhe.github.io/movies' },
  { name: 'ateaish Radio', url: 'https://atishramkhe.github.io/radio' },
  { name: 'YouTube', url: 'https://www.youtube.com' },
  { name: 'YouTube Music', url: 'https://music.youtube.com' },
  { name: 'Netflix', url: 'https://www.netflix.com' },
  { name: 'Amazon Prime', url: 'https://www.primevideo.com' },
  { name: 'Disney+', url: 'https://www.disneyplus.com' },
  { name: 'France.tv', url: 'https://www.france.tv' },
  { name: 'TF1', url: 'https://www.tf1.fr' },
  { name: 'M6', url: 'https://www.6play.fr' },
  { name: 'BFMTV', url: 'https://www.bfmtv.com' },
  { name: 'Arte', url: 'https://www.arte.fr', logo: 'https://upload.wikimedia.org/wikipedia/fr/8/8c/Logo_ARTE.TV_2020.svg' }
];

// Helper function to safely parse JSON from localStorage
function safeJsonParse(key, defaultValue) {
  try {
    const storedValue = localStorage.getItem(key);
    if (storedValue === null || storedValue === undefined) {
      return defaultValue;
    }
    return JSON.parse(storedValue);
  } catch (error) {
    console.error(`Error parsing JSON from localStorage for key "${key}". Using default value.`, error);
    return defaultValue;
  }
}

// Load data from localStorage safely
const FAVORITES_KEY = 'fmhy_favorites';
const MY_LINKS_KEY = 'my_custom_links';

let favorites = safeJsonParse(FAVORITES_KEY, []);
let myCustomLinks = safeJsonParse(MY_LINKS_KEY, []);
let sectionVisibility = safeJsonParse('sectionVisibility', {});
// Remove sectionOrder from here

// Initialize section visibility for new sections
SECTIONS.forEach(section => {
  if (sectionVisibility[section.id] === undefined) {
    sectionVisibility[section.id] = section.defaultVisible;
  }
});
localStorage.setItem('sectionVisibility', JSON.stringify(sectionVisibility));

// Check if a URL is in the favorites list
function isFavorite(url) {
    if (!url) return false;
    const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    return favorites.some(fav => {
        if (!fav || !fav.url) return false;
        const normalizedFavUrl = fav.url.endsWith('/') ? fav.url.slice(0, -1) : fav.url;
        return normalizedFavUrl === normalizedUrl;
    });
}

// Add or remove a site from the favorites list
function toggleFavorite(site) {
    if (!site || !site.url) return;
    const normalizedUrl = site.url.endsWith('/') ? site.url.slice(0, -1) : site.url;
    const index = favorites.findIndex(fav => {
        if (!fav || !fav.url) return false;
        const normalizedFavUrl = fav.url.endsWith('/') ? fav.url.slice(0, -1) : fav.url;
        return normalizedFavUrl === normalizedUrl;
    });

    if (index === -1) {
        favorites.push(site);
    } else {
        favorites.splice(index, 1);
    }
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    
    // Re-render the favorites section and update stars everywhere
    renderSection('favorites-grid', favorites, 'Favorites');
    updateFavoriteStars(); // This will update all stars on the page
}

// Update the favorite stars in all sections
function updateFavoriteStars() {
  const allSections = document.querySelectorAll('.site');
  allSections.forEach(siteElement => {
    const link = siteElement.querySelector('a');
    const favButton = siteElement.querySelector('.favorite-star');
    if (!link) return;
    const fav = isFavorite(link.href);
    // keep old behavior if a star still exists
    if (favButton) favButton.textContent = fav ? '★' : '☆';
    // NEW: reflect favorite state via class
    siteElement.classList.toggle('favorite', fav);
  });
}

// Replace the old getWebsiteLogo(siteName, siteUrl) with a robust version that accepts the whole site object
function getWebsiteLogo(site) {
  if (!site) {
    return { src: `${LOGO_BASE_PATH}/default.png`, logoType: 'default', dominantColor: null };
  }

  // 1) explicit logo/icon fields on the site object
  if (site.logo) {
    const src = site.logo.startsWith('http') ? site.logo : `${LOGO_BASE_PATH}/${site.logo}`;
    return { src, logoType: 'explicit', dominantColor: site.dominant_color || site.dominantColor || null };
  }
  if (site.icon) {
    const src = site.icon.startsWith('http') ? site.icon : `${LOGO_BASE_PATH}/${site.icon}`;
    return { src, logoType: 'explicit', dominantColor: site.dominant_color || site.dominantColor || null };
  }

  // 2) try manifest lookup using several candidate keys (name, slug(name), hostname, slug(hostname), url, slug(url))
  const candidates = [];
  if (site.name) {
    candidates.push(site.name, slugify(site.name));
  }
  if (site.url) {
    try {
      const u = new URL(site.url, window.location.origin);
      candidates.push(u.hostname, slugify(u.hostname), site.url, slugify(site.url));
    } catch (e) {
      candidates.push(site.url, slugify(site.url));
    }
  }

  for (const raw of candidates) {
    if (!raw) continue;
    const key = String(raw);
    const entry = localLogoManifest[key];
    if (entry) {
      if (typeof entry === 'string') {
        return { src: entry.startsWith('http') ? entry : `${LOGO_BASE_PATH}/${entry}`, logoType: 'local_manifest', dominantColor: null };
      } else if (entry && entry.filename) {
        return { src: entry.filename.startsWith('http') ? entry.filename : `${LOGO_BASE_PATH}/${entry.filename}`, logoType: 'local_manifest', dominantColor: entry.dominant_color || entry.dominantColor || null };
      }
    }
  }

  // 3) fallback to Google's favicon service if not found in local manifest
  try {
    const domain = site.url ? (new URL(site.url, window.location.origin).hostname) : slugify(site.name || '');
    if (domain) {
      return {
        src: `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
        logoType: 'google_favicon',
        dominantColor: null
      };
    }
  } catch (e) {
    // ignore and fall through
  }

  // 4) final fallback
  return { src: `${LOGO_BASE_PATH}/default.png`, logoType: 'default', dominantColor: null };
}

// Updated renderSection to handle empty favorites and new data structure
function renderSection(containerId, sites, sectionLabel) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`Container with ID "${containerId}" not found. Skipping rendering.`);
    return;
  }

  container.innerHTML = '';

  // Section title tile should be the first child inside the grid
  if (sectionLabel) {
    const titleTile = document.createElement('div');
    titleTile.className = 'site section-title-tile';
    titleTile.innerHTML = `<span class="section-title-text">${sectionLabel}</span>`;
    container.appendChild(titleTile);
  }

  if (!sites || sites.length === 0) {
    if (containerId === 'favorites-grid') {
        const placeholder = document.createElement('div');
        placeholder.className = 'placeholder';
        placeholder.textContent = '⭐ No favorites yet. Add some by clicking the star!';
        container.appendChild(placeholder);
    }
    return;
  }

  // Render all tiles, no limit, no show more button
  for (const site of sites) {
    // Ensure site has at least name and url
    if (!site || !site.name || !site.url) continue; 

    const div = document.createElement('div');
    div.className = 'site';

    const a = document.createElement('a');
    a.href = site.url;
    a.target = '_blank';
    a.title = site.name; // Add name to title attribute for tooltip

    const logoInfo = getWebsiteLogo(site);

    const img = document.createElement('img');
    img.alt = site.name; // Keep alt text for accessibility

    if (logoInfo.logoType === 'favicon_fallback' || logoInfo.logoType === 'google_favicon') {
      // For favicons, create a text placeholder instead of a tiny icon
      const textLogoContainer = document.createElement('div');
      textLogoContainer.className = 'text-logo-container';
      const textLogoName = document.createElement('span');
      textLogoName.className = 'text-logo-name';
      textLogoName.textContent = site.name;
      textLogoName.style.fontFamily = 'Ubuntu, sans-serif';
      textLogoContainer.appendChild(textLogoName);
      a.appendChild(textLogoContainer);
    } else {
      img.src = logoInfo.src;
      img.onerror = () => {
        // If image fails, show a text placeholder with the name
        img.remove();
        const placeholder = document.createElement('div');
        placeholder.className = 'placeholder-icon';
        placeholder.textContent = site.name; // Show name in placeholder
        a.insertBefore(placeholder, a.firstChild);
      };
      a.appendChild(img);
    }

    if (logoInfo.dominantColor) {
      div.style.backgroundColor = logoInfo.dominantColor;
      div.classList.add('has-dominant-bg');
    }

    // Add crown for featured sites directly to the link
    if (site.featured) {
      const crownIcon = document.createElement('span');
      crownIcon.textContent = '';
      crownIcon.className = 'featured-crown';
      crownIcon.title = 'Featured Site';
      a.appendChild(crownIcon);
    }

    // Add FMHY suggested star if applicable
    if (site.fmhy_suggested) {
      const fmhyStar = document.createElement('span');
      fmhyStar.textContent = '';
      fmhyStar.className = 'fmhy-suggested-star';
      fmhyStar.title = 'FMHY Suggested';
      a.appendChild(fmhyStar);
    }

    // Add favorite star button (hidden by default, shown on hover)
    const starBtn = document.createElement('button');
    starBtn.className = 'favorite-star';
    starBtn.type = 'button';
    starBtn.title = 'Add to Favorites';
    starBtn.textContent = isFavorite(site.url) ? '★' : '☆';
    starBtn.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleFavorite(site);
      // Update star immediately
      starBtn.textContent = isFavorite(site.url) ? '★' : '☆';
    };
    div.appendChild(starBtn);

    div.appendChild(a);
    container.appendChild(div);
  }

  // Add placeholder tiles if less than 10 sites (for favorites and my-links only)
  if ((containerId === 'favorites-grid' || containerId === 'my-links-grid') && sites && sites.length < 10) {
    const placeholdersNeeded = 10 - sites.length;
    for (let i = 0; i < placeholdersNeeded; i++) {
      const placeholderDiv = document.createElement('div');
      placeholderDiv.className = 'site placeholder-tile';
      container.appendChild(placeholderDiv);
    }
  }

  // Update total count (all sites, not just visible subset)
  const countElement = document.getElementById(`${containerId}-count`);
  if (countElement) {
    countElement.textContent = `${sites.length} sites`;
  }
}

function sortSectionsAlphabetically() {
  console.log('Sorting sections alphabetically...');
  for (const sectionId in sectionData) {
    if (sectionData.hasOwnProperty(sectionId) && Array.isArray(sectionData[sectionId])) {
      sectionData[sectionId].sort((a, b) => a.name.localeCompare(b.name));
    }
  }
  renderSectionsInOrder(); // Re-render sections after sorting
}

function renderSectionsInOrder() {
  console.log('Rendering sections in order. Current sectionData keys:', Object.keys(sectionData));
  const contentGrid = document.querySelector('.content-grid');
  if (!contentGrid) {
    console.error('Content grid container not found.');
    return;
  }
  
  // Remove all existing sections except search results
  Array.from(contentGrid.children).forEach(child => {
      if (child.id !== 'search-results') {
          contentGrid.removeChild(child);
      }
  });

  sectionOrder.forEach(sectionId => {
    const section = SECTIONS.find(s => s.id === sectionId);
    if (section) {
      let dataToRender = [];
      if (section.sourceSectionId) {
        let rawSourceData = loadedFMHYData[section.sourceSectionId] || {};
        let collectedLinks = [];

        if (section.sourceSectionId === 'non-english') {
          if (section.sourceSubSectionNames && section.sourceSubSectionNames.length > 0) {
            section.sourceSubSectionNames.forEach(languageName => {
              const languageData = rawSourceData[languageName] || {};
              if (section.id === 'francais') {
                  const streamingLinks = languageData['Streaming'] || [];
                  collectedLinks.push(...streamingLinks);
              } else {
                  for (const categoryName in languageData) {
                      if (languageData.hasOwnProperty(categoryName) && Array.isArray(languageData[categoryName])) {
                          collectedLinks.push(...languageData[categoryName]);
                      }
                  }
              }
            });
          }
        } else {
          if (section.sourceSubSectionNames && section.sourceSubSectionNames.length > 0) {
            section.sourceSubSectionNames.forEach(subSectionName => {
              const subSectionLinks = rawSourceData[subSectionName] || [];
              collectedLinks.push(...subSectionLinks);
            });
          } else {
            for (const subSectionName in rawSourceData) {
                if (rawSourceData.hasOwnProperty(subSectionName) && Array.isArray(rawSourceData[subSectionName])) {
                    collectedLinks.push(...rawSourceData[subSectionName]);
                }
            }
          }
        }

          // Apply custom modifications based on section.id
          if (section.id === 'anime-streaming') {
            const featuredAnimeNames = ['AnimeKai', 'HiAnime', 'Gojo', 'otakuu 2', 'KickAssAnime'];
            const newAnimeSites = [];
            
            featuredAnimeNames.forEach(featuredName => {
                const foundSite = collectedLinks.find(site => site.name === featuredName);
                if (foundSite) {
                    newAnimeSites.push({ ...foundSite, featured: true });
                } else {
                    let url = '';
                    if (featuredName === 'AnimeKai') url = 'https://animekai.com/';
                    else if (featuredName === 'HiAnime') url = 'https://hianime.to/';
                    else if (featuredName === 'KickAssAnime') url = 'https://www2.kickassanime.ro/';
                    newAnimeSites.push({ name: featuredName, url: url, featured: true });
                }
            });

            collectedLinks.forEach(site => {
                if (!featuredAnimeNames.includes(site.name)) {
                    newAnimeSites.push(site);
                }
            });
            dataToRender = newAnimeSites;

          } else if (section.id === 'movies-tv-shows') {
            const featuredMovieNames = ['Cineby', 'XPrime', 'Rive CorsFlix'];
            const newMoviesSites = [];
            
            featuredMovieNames.forEach(featuredName => {
                const foundSite = collectedLinks.find(site => site.name === featuredName);
                if (foundSite) {
                    newMoviesSites.push({ ...foundSite, featured: true });
                }
            });

            collectedLinks.forEach(site => {
                if (!newMoviesSites.some(s => s.url === site.url)) {
                    newMoviesSites.push(site);
                }
            });
            dataToRender = newMoviesSites;

          } else if (section.id === 'drama-streaming') {
            const featuredDramaNames = ['kisskh', 'GoPlay'];
            const newDramaSites = [];

            const kissAsianSite = collectedLinks.find(site => site.url.includes('kissasian.vip'));
            if (kissAsianSite) {
                newDramaSites.push({ ...kissAsianSite, featured: true });
            }
            
            featuredDramaNames.forEach(featuredName => {
                const foundSite = collectedLinks.find(site => site.name === featuredName);
                if (foundSite && !newDramaSites.some(s => s.url === foundSite.url)) {
                    newDramaSites.push({ ...foundSite, featured: true });
                }
            });

            collectedLinks.forEach(site => {
                if (!newDramaSites.some(s => s.url === site.url)) {
                    newDramaSites.push(site);
                }
            });
            dataToRender = newDramaSites;

          } else if (section.id === 'cartoon') {
            const featuredCartoonNames = ['HiCartoons', 'KissCartoon', 'Watch Cartoon Online'];
            const newCartoonSites = [];
            
            featuredCartoonNames.forEach(featuredName => {
                const foundSite = collectedLinks.find(site => site.name === featuredName);
                if (foundSite) {
                    newCartoonSites.push({ ...foundSite, featured: true });
                }
            });

            collectedLinks.forEach(site => {
                if (!newCartoonSites.some(s => s.url === site.url)) {
                    newCartoonSites.push(site);
                }
            });
            dataToRender = newCartoonSites;

          } else if (section.id === 'live-sports') {
            const featuredSportsNames = ['Streamed 2', 'PPV.TO', 'MrGamingStreams', 'DaddyLive Dad','TimStreams'];
            const newSportsSites = [];
            
            featuredSportsNames.forEach(featuredName => {
                const foundSite = collectedLinks.find(site => site.name === featuredName);
                if (foundSite) {
                    newSportsSites.push({ ...foundSite, featured: true });
                }
            });

            collectedLinks.forEach(site => {
                if (!newSportsSites.some(s => s.url === site.url)) {
                    newSportsSites.push(site);
                }
            });
            dataToRender = newSportsSites;

          } else if (section.id === 'francais') {
            const featuredFrenchNames = ['Movix Status','cinepulse', 'xalaflix', 'cinestream', 'anime-sama', 'oohquelbut', 'Sadisflix', ];
            const newFrenchSites = [];

            // Add featured sites in the specified order
            featuredFrenchNames.forEach(featuredName => {
                const foundSite = collectedLinks.find(site => site.name === featuredName);
                if (foundSite) {
                    newFrenchSites.push({ ...foundSite, featured: true });
                } else if (featuredName === 'Sadisflix') {
                    // If Sadisflix is missing, add it with the correct URL
                    newFrenchSites.push({ name: 'Sadisflix', url: 'https://sadisflix.online/', featured: true });
                }
            });

            // Add the rest of the sites (non-featured)
            collectedLinks.forEach(site => {
                if (!newFrenchSites.some(s => s.url === site.url)) {
                    newFrenchSites.push(site);
                }
            });
            dataToRender = newFrenchSites;

          } else if (section.id === 'live-tv') {
            const featuredLiveTVNames = ['ateaish TV', 'AlienFlix TV', 'NTV', 'DaddyLive TV Dad', 'WiTV','DistroTV'];
            const sitesToRemoveNames = ['KCNA', 'Titan TV'];
            const newLiveTVSites = [];

            let filteredLinks = collectedLinks.filter(site => !sitesToRemoveNames.includes(site.name));

            // Ensure WiTV is present in the list
            if (!filteredLinks.some(site => site.name === 'WiTV')) {
              filteredLinks.push({ name: 'WiTV', url: 'https://witv.soccer/' }, { name: 'ateaish TV', url: 'https://atishramkhe.github.io/tv' });
            }

            featuredLiveTVNames.forEach(featuredName => {
                const foundSite = filteredLinks.find(site => site.name === featuredName);
                if (foundSite) {
                    newLiveTVSites.push({ ...foundSite, featured: true });
                }
            });

            filteredLinks.forEach(site => {
                if (!featuredLiveTVNames.includes(site.name)) {
                    newLiveTVSites.push(site);
                }
            });
            dataToRender = newLiveTVSites;
          } else {
            dataToRender = collectedLinks;
          }
      } else {
        dataToRender = sectionData[section.id] || [];
      }

      if (section.sitesToRemove && section.sitesToRemove.length > 0) {
        dataToRender = dataToRender.filter(site => !section.sitesToRemove.includes(site.name));
      }
      sectionData[section.id] = dataToRender;

      const sectionElement = document.createElement('div');
      sectionElement.id = section.id;
      sectionElement.className = 'category';

      // Remove header, add title as tile in grid
      // const header = document.createElement('h2');
      // header.textContent = section.label;
      // sectionElement.appendChild(header);

      const countSpan = document.createElement('span');
      countSpan.id = `${section.id}-count`;
      countSpan.className = 'site-count';
      // header.appendChild(countSpan);

      const carouselWrapper = document.createElement('div');
      carouselWrapper.className = 'carousel-wrapper';

      const prevButton = document.createElement('button');
      prevButton.className = 'carousel-btn prev';
      prevButton.innerHTML = '&lsaquo;';

      const gridDiv = document.createElement('div');
      gridDiv.id = `${section.id}-grid`;
      gridDiv.className = 'grid';

      const nextButton = document.createElement('button');
      nextButton.className = 'carousel-btn next';
      nextButton.innerHTML = '&rsaquo;';

      carouselWrapper.appendChild(prevButton);
      carouselWrapper.appendChild(gridDiv);
      carouselWrapper.appendChild(nextButton);
      sectionElement.appendChild(carouselWrapper);

      contentGrid.appendChild(sectionElement);

      renderSection(`${section.id}-grid`, sectionData[section.id] || [], section.label);

      // Add section title as a tile at the beginning (inside the grid)
      if (typeof sectionLabel !== 'undefined' && sectionLabel) {
        const titleTile = document.createElement('div');
        titleTile.className = 'site section-title-tile';
        titleTile.innerHTML = `<span class="section-title-text">${sectionLabel}</span>`;
        container.appendChild(titleTile);
      }

      // After rendering, setup the carousel functionality
      setupCarousel(gridDiv, prevButton, nextButton);
    }
  });
  applySectionVisibility();
  updateFavoriteStars();
}

// Minimal placeholder for setupCarousel to prevent ReferenceError
function setupCarousel(gridDiv, prevButton, nextButton) {
  if (!gridDiv || !prevButton || !nextButton) return;
  // Amount to scroll: width of 2 tiles or 80% of grid
  function getScrollAmount() {
    const tile = gridDiv.querySelector('.site:not(.section-title-tile)');
    if (tile) return tile.offsetWidth * 2;
    return Math.floor(gridDiv.offsetWidth * 0.8);
  }
  prevButton.onclick = function(e) {
    e.preventDefault();
    gridDiv.scrollBy({ left: -getScrollAmount(), behavior: 'smooth' });
  };
  nextButton.onclick = function(e) {
    e.preventDefault();
    gridDiv.scrollBy({ left: getScrollAmount(), behavior: 'smooth' });
  };
  // Show/hide buttons based on scroll position
  function updateButtons() {
    prevButton.disabled = gridDiv.scrollLeft <= 10;
    nextButton.disabled = gridDiv.scrollLeft + gridDiv.offsetWidth >= gridDiv.scrollWidth - 10;
  }
  gridDiv.addEventListener('scroll', updateButtons);
  window.addEventListener('resize', updateButtons);
  setTimeout(updateButtons, 100); // Initial state
}

function setupEventListeners() {
  console.log('Setting up event listeners...');

  const settingsModal = document.getElementById('settings-modal');
  const settingsButton = document.getElementById('settings-button');
  const closeSettingsButton = document.getElementById('close-settings');
  const searchBar = document.getElementById('search-bar');
  const themeSelect = document.getElementById('theme-select');
  const sortAlphabeticallyButton = document.getElementById('sort-alphabetically');
  const addCustomLinkButton = document.getElementById('add-custom-link');
  const customLinksList = document.getElementById('custom-links-list');
  const editCustomLinkForm = document.getElementById('edit-custom-link-form');
  const saveEditLinkButton = document.getElementById('save-edit-link');
  const cancelEditLinkButton = document.getElementById('cancel-edit-link');
  const sectionVisibilityOptions = document.getElementById('section-visibility-options');

  // Ensure settings modal is hidden by default even if missing the .modal class
  if (settingsModal) {
    settingsModal.style.display = 'none';
  }

  // Turn the settings button into a hamburger menu and open a windowed flyout
  if (settingsButton) {
    settingsButton.textContent = '☰';
    settingsButton.title = 'Menu';
    settingsButton.setAttribute('aria-label', 'Open menu');

    settingsButton.addEventListener('click', () => {
      // open as flyout
      showSettingsWindow(settingsModal, settingsButton);
      populateSettings();
    });
  }

  if (closeSettingsButton) {
    // keep close button support (closes flyout)
    closeSettingsButton.addEventListener('click', () => {
      hideSettingsWindow(settingsModal);
    });
  }

  window.addEventListener('click', (event) => {
    // do not auto-close on overlay click anymore (handled by flyout logic)
    if (event.target === settingsModal) {
      // no-op: overlay is transparent/pointer-events none
    }
  });

  // Theme Selector
  if (themeSelect) {
    themeSelect.addEventListener('change', (e) => {
      document.body.className = e.target.value + '-theme';
      localStorage.setItem('theme', e.target.value);
    });
    // Apply saved theme
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.body.className = savedTheme + '-theme';
    themeSelect.value = savedTheme;
  }

  // Search functionality
  if (searchBar) {
    searchBar.addEventListener('input', (e) => {
      const searchTerm = e.target.value.toLowerCase();
      const contentGrid = document.querySelector('.content-grid');
      const searchResultsGrid = document.getElementById('search-results-grid');
      const searchResultsSection = document.getElementById('search-results');

      if (searchTerm.length > 0) {
        // Hide all sections
        contentGrid.querySelectorAll('.category').forEach(section => {
            if(section.id !== 'search-results') {
                section.style.display = 'none'
            }
        });
        searchResultsSection.style.display = 'flex';

        const filteredSites = allSites.filter(site => site.name.toLowerCase().includes(searchTerm));
        renderSection('search-results-grid', filteredSites, 'Search Results');
      } else {
        searchResultsSection.style.display = 'none';
        applySectionVisibility();
      }
    });
  }

  // Sort Alphabetically
  if (sortAlphabeticallyButton) {
    sortAlphabeticallyButton.addEventListener('click', () => {
      sortSectionsAlphabetically();
      alert('All sections have been sorted alphabetically.');
    });
  }

  // Custom Links
  if (addCustomLinkButton) {
    addCustomLinkButton.addEventListener('click', () => {
      const nameInput = document.getElementById('custom-link-name');
      const urlInput = document.getElementById('custom-link-url');
      addCustomLink(nameInput.value, urlInput.value);
      nameInput.value = '';
      urlInput.value = '';
    });
  }

  if (customLinksList) {
    customLinksList.addEventListener('click', (e) => {
      const target = e.target;
      if (target.classList.contains('delete-custom-link')) {
        const index = target.dataset.index;
        if (confirm('Are you sure you want to delete this link?')) {
          deleteCustomLink(index);
        }
      }
      if (target.classList.contains('edit-custom-link')) {
        const index = target.dataset.index;
        const link = myCustomLinks[index];
        document.getElementById('edit-link-index').value = index;
        document.getElementById('edit-link-name').value = link.name;
        document.getElementById('edit-link-url').value = link.url;
        editCustomLinkForm.style.display = 'block';
      }
    });
  }

  if (saveEditLinkButton) {
    saveEditLinkButton.addEventListener('click', () => {
      const index = document.getElementById('edit-link-index').value;
      const newName = document.getElementById('edit-link-name').value;
      const newUrl = document.getElementById('edit-link-url').value;
      editCustomLink(index, newName, newUrl);
      editCustomLinkForm.style.display = 'none';
    });
  }

  if (cancelEditLinkButton) {
    cancelEditLinkButton.addEventListener('click', () => {
      editCustomLinkForm.style.display = 'none';
    });
  }

  // Section Visibility
  if (sectionVisibilityOptions) {
    sectionVisibilityOptions.addEventListener('change', (e) => {
      if (e.target.type === 'checkbox') {
        const sectionId = e.target.dataset.sectionId;
        sectionVisibility[sectionId] = e.target.checked;
        localStorage.setItem('sectionVisibility', JSON.stringify(sectionVisibility));
        applySectionVisibility();
      }
    });
  }
}

// Inject small runtime CSS tweaks (header transparent, align rows, snap)
function injectRuntimeOverrides() {
  if (document.getElementById('runtime-overrides')) return;
  const css = `
    header { background: transparent !important; box-shadow: none !important; }
    .content-grid { padding-left: 24px !important; }
    .category { margin-top: 8px !important; }
    .category > .grid, .category > .slider {
      padding-left: 24px !important;
      scroll-snap-type: x proximity !important;
    }
    .category > .grid .site, .category > .slider .site {
      scroll-snap-align: start !important;
    }
    .category > .grid .site:not(.section-title-tile), .category > .slider .site:not(.section-title-tile) {
      min-width: 220px;
    }
    /* --- Search bar style and positioning overrides --- */
    #search-bar {
      background: none !important;
      border: none !important;
      box-shadow: none !important;
      outline: none !important;
      padding: 6px 12px !important;
      font-size: 1rem;
      color: #fff;
      border-radius: 6px;
      margin: 0 0 0 12px !important;
      min-width: 180px;
      width: 220px;
      transition: background 0.2s;
    }
    #search-bar:focus {
      background: rgba(255,255,255,0.08) !important;
    }
    /* Move search bar to the right, next to settings button */
    header {
      display: flex;
      align-items: center;
      justify-content: flex-end;
    }
    #settings-button {
      margin-left: 16px;
    }
    /* Ensure search bar and settings button are on the same row */
    #search-bar, #settings-button {
      vertical-align: middle;
      display: inline-block;
    }

    .grid {
      display: flex;
      flex-wrap: nowrap;
      overflow: hidden;
      gap: 28px;
      justify-content: flex-start;
      align-items: stretch;
      padding-bottom: 8px;
      padding-left: 0 !important;
      margin-left: 0 !important;
    }
    @media (max-width: 1200px) {
      .grid {
        gap: 20px;
      }
    }
    @media (max-width: 720px) {
      .grid {
        gap: 12px;
      }
    }

    .category > .grid .site:not(.section-title-tile) {
      /* Website tile styles (keep as before) */
      scroll-snap-align: start !important;
      /* Add any other tile-specific styles here if needed */
    }

    .section-title-tile {
      width: 120px;
      min-width: 120px;
      max-width: 120px;
      height: 64px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255,255,255,0.04);
      border-radius: 8px;
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
      color: #fff;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      align-self: stretch;
      justify-self: start;
      padding: 12px;
      flex-shrink: 0;
    }
    @media (max-width: 1200px) {
      .section-title-tile {
        width: 120px;
        height: 64px;
        border-radius: 8px;
        font-size: 1rem;
        padding: 10px;
      }
    }
    @media (max-width: 720px) {
      .section-title-tile {
        width: 120px;
        height: 64px;
        border-radius: 8px;
        font-size: 0.95rem;
        padding: 8px;
      }
    }

    .grid::-webkit-scrollbar, .slider::-webkit-scrollbar {
      height: 10px;
      background: transparent;
    }
    .grid::-webkit-scrollbar-thumb, .slider::-webkit-scrollbar-thumb {
      background: rgba(120,92,230,0.22);
      border-radius: 8px;
    }
    .grid::-webkit-scrollbar-track, .slider::-webkit-scrollbar-track {
      background: transparent;
    }
    .grid::-webkit-scrollbar-button, .slider::-webkit-scrollbar-button {
      display: none;
    }
    /* For Firefox */
    .grid, .slider {
      scrollbar-color: rgba(120,92,230,0.22) transparent;
      scrollbar-width: thin;
    }
  `;
  const style = document.createElement('style');
  style.id = 'runtime-overrides';
  style.appendChild(document.createTextNode(css));
  document.head.appendChild(style);
}

// Parallax-like movement for the background glow while scrolling
function updateGlowOnScroll() {
  const y = window.scrollY || document.documentElement.scrollTop || 0;
  const belowTilesY = 420 + y * 0.25; // glow under tiles
  const topGlowY = 8 + y * 0.12;      // top glow
  document.body.style.backgroundPosition =
    `50% ${belowTilesY}px, 50% ${topGlowY}px, 85% 20%, 0 0`;
}

function populateSettings() {
  // Populate Section Visibility
  const sectionVisibilityOptions = document.getElementById('section-visibility-options');
  sectionVisibilityOptions.innerHTML = '';
  SECTIONS.forEach(section => {
    const label = document.createElement('label');
    label.style.display = 'block';
    label.innerHTML = `
      <input type="checkbox" data-section-id="${section.id}" ${sectionVisibility[section.id] ? 'checked' : ''}>
      ${section.label}
    `;
    sectionVisibilityOptions.appendChild(label);
  });

  // Remove section order population
}

// Cache Notice Logic
document.addEventListener('DOMContentLoaded', () => {
  const cacheNotice = document.getElementById('cache-notice');
  const closeButton = document.getElementById('close-cache-notice');
  const langEnButton = document.getElementById('lang-en');
  const langFrButton = document.getElementById('lang-fr');
  const enInstructions = document.querySelector('.en-instructions');
  const frInstructions = document.querySelector('.fr-instructions');

  const noticeDismissed = localStorage.getItem('cacheNoticeDismissed');
  const oneWeek = 7 * 24 * 60 * 60 * 1000;

  // Do NOT auto-show the notice; keep it hidden unless explicitly opened
  if (cacheNotice) {
    cacheNotice.style.display = 'none';
  }

  // Optional trigger to open the notice if you add a button with this id in your UI
  const openCacheNoticeBtn = document.getElementById('open-cache-notice');
  if (openCacheNoticeBtn && cacheNotice) {
    openCacheNoticeBtn.addEventListener('click', () => {
      cacheNotice.style.display = 'block';
    });
  }

  if (closeButton && cacheNotice) {
    closeButton.addEventListener('click', () => {
      cacheNotice.style.display = 'none';
      localStorage.setItem('cacheNoticeDismissed', Date.now());
    });
  }

  if (langEnButton && langFrButton && enInstructions && frInstructions) {
    langEnButton.addEventListener('click', () => {
      enInstructions.style.display = 'block';
      frInstructions.style.display = 'none';
      langEnButton.classList.add('active');
      langFrButton.classList.remove('active');
    });

    langFrButton.addEventListener('click', () => {
      enInstructions.style.display = 'none';
      frInstructions.style.display = 'block';
      langFrButton.classList.add('active');
      langEnButton.classList.remove('active');
    });
  }
});



function findPageLogoSrc() {
  // Try common selectors for the existing top-left logo used by the page.
  const selectors = [
    '#logo img',
    '.brand img',
    '.site-logo',               // matches other uses on page
    'header img[alt*="logo" i]',
    'img[alt*="logo" i]',
    'img[src*="/assets/"]',
    'img[src*="logo"]'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.tagName === 'IMG' && el.src) {
      // return absolute src
      return el.src;
    }
  }
  return null;
}

function createLoadingScreen() {
  if (_fmhyLoadingOverlay) return;
  injectLoadingStyles();

  const overlay = document.createElement('div');
  overlay.className = 'fmhy-loading-overlay';
  overlay.id = 'fmhy-loading-overlay';
  overlay.style.display = 'none';

  const inner = document.createElement('div');
  inner.className = 'fmhy-loading-inner';

  const logoImg = document.createElement('img');

  // Build candidates: prefer the actual page logo if present
  const pageLogo = findPageLogoSrc();
  const candidateLogos = [];
  if (pageLogo) {
    candidateLogos.push(pageLogo);
    console.info('Using page logo for loader:', pageLogo);
  }
  candidateLogos.push('/assets/Logo_V2_Ateaish_bleu_blanc_RVB_2000px.png', `${LOGO_BASE_PATH}/loader-logo.png`, `${LOGO_BASE_PATH}/default.png`);

  let _logoIndex = 0;
  logoImg.className = 'fmhy-loading-logo';
  logoImg.alt = 'Loading';
  logoImg.src = candidateLogos[_logoIndex];

  // Text fallback element (hidden by default)
  const textFallback = document.createElement('div');
  textFallback.className = 'fmhy-loading-text';
  textFallback.textContent = 'FMHY';

  // On successful load, ensure text fallback is hidden
  logoImg.onload = () => {
    console.info('Loader image loaded from', logoImg.src);
    textFallback.style.display = 'none';
  };

  // On error, try next candidate; if exhausted, show text fallback
  logoImg.onerror = () => {
    console.warn('Loader image failed to load:', candidateLogos[_logoIndex]);
    _logoIndex++;
    if (_logoIndex < candidateLogos.length) {
      setTimeout(() => { logoImg.src = candidateLogos[_logoIndex]; }, 60);
    } else {
      logoImg.style.display = 'none';
      textFallback.style.display = 'block';
      console.warn('All loader image candidates failed, showing text fallback.');
    }
  };

  // NOTE: loader/progress element removed — do not create or append a .loader element
  inner.appendChild(logoImg);
  inner.appendChild(textFallback);
  overlay.appendChild(inner);
  document.body.appendChild(overlay);
  _fmhyLoadingOverlay = overlay;
}

function showLoadingScreen() {
  try {
    createLoadingScreen();
    if (_fmhyLoadingOverlay) {
      _fmhyLoadingOverlay.style.display = 'flex';
      // ensure fully visible (remove fade-out if set)
      _fmhyLoadingOverlay.classList.remove('fade-out');
    }
    _fmhyLoadingShownAt = Date.now();
    // prevent body scroll/interaction while loading
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  } catch (e) {
    // noop
  }
}

function hideLoadingScreen() {
  try {
    const hide = () => {
      if (!_fmhyLoadingOverlay) return;

      // Pause/cleanup any videos inside the overlay so they stop playing and free resources
      try {
        const vids = _fmhyLoadingOverlay.querySelectorAll('video');
        vids.forEach(v => {
          try {
            v.pause();
            v.currentTime = 0;
            // remove src and reload to fully stop network activity
            v.removeAttribute('src');
            v.load();
          } catch (e) { /* ignore per-video errors */ }
        });
      } catch (e) {
        // ignore
      }

      // fade and remove after transition
      _fmhyLoadingOverlay.classList.add('fade-out');
      setTimeout(() => {
        try {
          if (_fmhyLoadingOverlay && _fmhyLoadingOverlay.parentNode) {
            _fmhyLoadingOverlay.parentNode.removeChild(_fmhyLoadingOverlay);
          }
        } catch (e) {}
        _fmhyLoadingOverlay = null;
      }, 500); // match CSS transition ~450ms
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };

    const elapsed = Date.now() - (_fmhyLoadingShownAt || 0);
    if (typeof FMHY_MIN_LOADING_MS === 'number' && elapsed < FMHY_MIN_LOADING_MS) {
      setTimeout(hide, FMHY_MIN_LOADING_MS - elapsed);
    } else {
      hide();
    }
  } catch (e) {
    // noop
  }
}

// ---- NEW: homepage TV-style styles + renderer ----
function injectHomepageStyles() {
  if (document.getElementById('fmhy-homepage-styles')) return;
  const css = `
    /* TV-like centered screen + ambient room glow */
    .homepage-tv {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 28px 18px;
      background: radial-gradient(1200px 400px at 50% 10%, rgba(120,92,230,0.12), transparent 25%),
                  radial-gradient(800px 300px at 85% 20%, rgba(90,160,255,0.06), transparent 20%),
                  linear-gradient(180deg,#08080a 0%, #050506 100%);
      min-height: 360px;
    }

    .tv-frame {
      width: 94%;
      max-width: 1500px;
      background: transparent;
      border-radius: 12px;
      padding: 14px;
      position: relative;
      box-shadow: 0 40px 120px rgba(0,0,0,0.75);
    }

    .tv-screen {
      background: linear-gradient(180deg,#0b1013, #061017);
      border-radius: 12px;
      padding: 20px;
      overflow: hidden;
      position: relative;
      min-height: 380px;
      box-shadow: inset 0 0 80px rgba(0,0,0,0.5);
      border: 1px solid rgba(255,255,255,0.02);
    }
    .tv-screen::after {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      box-shadow: inset 0 0 260px rgba(147,112,219,0.06);
      border-radius: 12px;
    }

    /* Rectangular TV app tiles: wider min width -> app-like layout */
    .app-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); /* wider tiles */
      gap: 28px; /* more spacing like TV rows */
      align-items: center;
      z-index: 2;
      position: relative;
    }

    .app-tile {
      height: 180px;                /* rectangular, TV-app feel */
      border-radius: 16px;
      background: rgba(255,255,255,0.03); /* subtle card */
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform .22s cubic-bezier(.2,.9,.3,1), box-shadow .22s ease;
      cursor: pointer;
      position: relative;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.03);
      padding: 18px;
      backdrop-filter: blur(4px);   /* slightly glassy */
    }
    .app-tile:hover {
      transform: translateY(-14px) scale(1.03);
      box-shadow: 0 40px 90px rgba(0,0,0,0.75), 0 0 40px rgba(147,112,219,0.08);
    }

    .app-logo {
      width: 68%;
      height: 72%;
      background-repeat: no-repeat;
      background-position: center;
      background-size: contain;
      filter: drop-shadow(0 18px 30px rgba(0,0,0,0.65));
    }

    .app-label {
      position: absolute;
      bottom: 10px;
      left: 10px;
      right: 10px;
      text-align: center;
      font-size: 13px;
      color: #ffffff;
      opacity: 0.95;
      text-shadow: 0 2px 10px rgba(0,0,0,0.7);
      pointer-events: none;
    }

    .ambient-backdrop {
      position: absolute;
      width: 66%;
      height: 220px;
      right: -8%;
      bottom: -80px;
      background: radial-gradient(circle at center, rgba(147,112,219,0.16), transparent 42%);
      filter: blur(72px);
      pointer-events: none;
      z-index: 1;
    }

    /* responsive - keep rectangular but scale down */
    @media (max-width: 1200px) {
      .app-grid { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; }
      .app-tile { height: 150px; padding: 14px; border-radius: 12px; }
      .app-logo { width: 72%; height: 68%; filter: drop-shadow(0 12px 20px rgba(0,0,0,0.6)); }
       }
    @media (max-width: 720px) {
      .app-grid { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
      .app-tile { height: 92px; padding: 8px; border-radius: 10px; }
      .app-logo { width: 78%; height: 60%; filter: drop-shadow(0 6px 12px rgba(0,0,0,0.45)); }
      .tv-screen { min-height: 220px; padding: 12px; }
    }

    .section-title-tile {
      width: 120px;
      min-width: 120px;
      max-width: 120px;
      height: 64px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255,255,255,0.04);
      border-radius: 8px;
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
      color: #fff;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      align-self: stretch;
      justify-self: start;
      padding: 12px;
      flex-shrink: 0;
    }
    @media (max-width: 1200px) {
      .section-title-tile {
        width: 120px;
        height: 64px;
        border-radius: 8px;
        font-size: 1rem;
        padding: 10px;
      }
    }
    @media (max-width: 720px) {
      .section-title-tile {
        width: 120px;
        height: 64px;
        border-radius: 8px;
        font-size: 0.95rem;
        padding: 8px;
      }
    }

    .grid::-webkit-scrollbar, .slider::-webkit-scrollbar {
      height: 10px;
      background: transparent;
    }
    .grid::-webkit-scrollbar-thumb, .slider::-webkit-scrollbar-thumb {
      background: rgba(120,92,230,0.22);
      border-radius: 8px;
    }
    .grid::-webkit-scrollbar-track, .slider::-webkit-scrollbar-track {
      background: transparent;
    }
    .grid::-webkit-scrollbar-button, .slider::-webkit-scrollbar-button {
      display: none;
    }
    /* For Firefox */
    .grid, .slider {
      scrollbar-color: rgba(120,92,230,0.22) transparent;
      scrollbar-width: thin;
    }
  `;
  const style = document.createElement('style');
  style.id = 'fmhy-homepage-styles';
  style.appendChild(document.createTextNode(css));
  document.head.appendChild(style);
}

function renderAppGrid() {
  const contentGrid = document.querySelector('.content-grid') || document.body;
  // remove existing homepage-tv if present
  const existing = document.getElementById('homepage-tv');
  if (existing) existing.remove();

  const homepage = document.createElement('div');
  homepage.id = 'homepage-tv';
  homepage.className = 'homepage-tv';

  const frame = document.createElement('div');
  frame.className = 'tv-frame';

  const screen = document.createElement('div');
  screen.className = 'tv-screen';

  const ambient = document.createElement('div');
  ambient.className = 'ambient-backdrop';

  const grid = document.createElement('div');
  grid.className = 'app-grid';

  // Pick a compact curated list (you can adjust order/content)
  const curatedNames = [
    'Netflix','Prime Video','Spotify','Vevo','BBC iPlayer',
    'ITV Hub','My5','YouTube','Disney+','Amazon Prime'
  ];

  curatedNames.forEach(name => {
    // try to find a matching entry in your TRADITIONAL_WEBSITES or loaded data
    let siteObj = TRADITIONAL_WEBSITES.find(s => s.name && s.name.toLowerCase() === name.toLowerCase());
    if (!siteObj) {
      // try to search loaded data for same name
      for (const sectionId in loadedFMHYData) {
        if (!loadedFMHYData.hasOwnProperty(sectionId)) continue;
        const arr = loadedFMHYData[sectionId];
        if (Array.isArray(arr)) {
          const found = arr.find(i => i.name && i.name.toLowerCase() === name.toLowerCase());
          if (found) { siteObj = found; break; }
        } else if (typeof arr === 'object' && arr !== null) {
          for (const sub in arr) {
            if (!arr.hasOwnProperty(sub)) continue;
            const subarr = arr[sub];
            if (Array.isArray(subarr)) {
              const found = subarr.find(i => i.name && i.name.toLowerCase() === name.toLowerCase());
              if (found) { siteObj = found; break; }
            }
          }
          if (siteObj) break;
        }
      }
    }
    // fallback minimal object
    if (!siteObj) siteObj = { name: name, url: '#' };

    const tile = document.createElement('div');
    tile.className = 'app-tile';
    tile.title = siteObj.name || '';

    const logoDiv = document.createElement('div');
    logoDiv.className = 'app-logo';

    // Resolve logo using existing helper (falls back gracefully)
    const logoInfo = (typeof getWebsiteLogo === 'function') ? getWebsiteLogo(siteObj) : { src: getLogoUrlForSite(siteObj) };
    const logoSrc = (logoInfo && logoInfo.src) ? logoInfo.src : getLogoUrlForSite(siteObj);

    // set background image

    logoDiv.style.backgroundImage = `url("${logoSrc}")`;

    const label = document.createElement('div');
    label.className = 'app-label';
    label.textContent = siteObj.name;

    // click behavior
    tile.addEventListener('click', (e) => {
      e.preventDefault();
      if (siteObj && siteObj.url && siteObj.url !== '#') {
        window.open(siteObj.url, '_blank');
      }
    });

    tile.appendChild(logoDiv);
    tile.appendChild(label);
    grid.appendChild(tile);
  });

  screen.appendChild(grid);
  screen.appendChild(ambient);
  frame.appendChild(screen);
  homepage.appendChild(frame);

  // Insert at top of content grid so it appears like hero area
  if (contentGrid && contentGrid.firstChild) {
    contentGrid.insertBefore(homepage, contentGrid.firstChild);
  } else {
    (document.body || document.documentElement).appendChild(homepage);
  }
}

// ---- END NEW additions ----

// Ensure manifest is loaded before the main initialization run in the DOMContentLoaded handler
document.addEventListener('DOMContentLoaded', async () => {
    const loadingIndicator = document.getElementById('loading-indicator');

    // Show loading overlay
    // showLoadingScreen();
    // if (loadingIndicator) loadingIndicator.style.display = 'flex';

    // Also make sure settings modal starts hidden
    const sm = document.getElementById('settings-modal');
    if (sm) sm.style.display = 'none';

    // Inject runtime style overrides (header transparent, aligned rows, snap)
    injectRuntimeOverrides();

    // Make background glow move on scroll
    updateGlowOnScroll();
    window.addEventListener('scroll', updateGlowOnScroll, { passive: true });

    // Initialize small utilities
    updateClock();
    setInterval(updateClock, 1000);

    // Initialize section data
    sectionData['favorites'] = favorites;
    sectionData['my-links'] = myCustomLinks;
    sectionData['traditional-websites'] = TRADITIONAL_WEBSITES;

    // Load manifest and local FMHY data (best-effort)
    await loadLocalLogoManifest();
    await loadLocalFMHYData();

    // Inject homepage styles and render the TV-style app grid hero
    injectHomepageStyles();
    try { renderAppGrid(); } catch (e) { console.warn('renderAppGrid failed', e); }

    // Render the rest of the sections as before
    renderSectionsInOrder();

    // Collect all sites for search functionality (unchanged logic)
    allSites = [];
    for (const sectionId in loadedFMHYData) {
         if (loadedFMHYData.hasOwnProperty(sectionId) && Array.isArray(loadedFMHYData[sectionId])) {
             loadedFMHYData[sectionId].forEach(site => {
                 if (site && site.name && site.url && !allSites.some(s => s.url === site.url)) {
                     allSites.push({ name: site.name, url: site.url });
                 }
             });
         } else if (
             loadedFMHYData.hasOwnProperty(sectionId) &&
             typeof loadedFMHYData[sectionId] === 'object' &&
             loadedFMHYData[sectionId] !== null
         ) {
             for (const subSectionName in loadedFMHYData[sectionId]) {
                 if (
                     loadedFMHYData[sectionId].hasOwnProperty(subSectionName) &&
                     Array.isArray(loadedFMHYData[sectionId][subSectionName])
                 ) {
                     loadedFMHYData[sectionId][subSectionName].forEach(site => {
                         if (site && site.name && site.url && !allSites.some(s => s.url === site.url)) {
                             allSites.push({ name: site.name, url: site.url });
                         }
                     });
                 }
             }
         }
     }

    // Finalize UI
    setupEventListeners();

    // if (loadingIndicator) loadingIndicator.style.display = 'none';
    // hideLoadingScreen();
    document.body.classList.add('loaded');
});

// Loading-screen logic: remove the loading video after it plays once
  (function() {
    const loadingVideo = document.getElementById('loading-video');
    if (!loadingVideo) return;

    // Ensure playsInline & muted for autoplay policies
    loadingVideo.muted = true;
    loadingVideo.playsInline = true;

    // Try to play (some environments require explicit play())
    loadingVideo.play().catch(() => { /* ignore autoplay rejection */ });

    function removeLoadingVideo() {
      if (!loadingVideo.parentNode) return;
      loadingVideo.style.opacity = '0';
      setTimeout(() => {
        if (loadingVideo.parentNode) loadingVideo.parentNode.removeChild(loadingVideo);
      }, 600);
    }

    loadingVideo.addEventListener('ended', removeLoadingVideo, { once: true });

    // Fallback: remove after a maximum duration in case 'ended' doesn't fire
    const MAX_FALLBACK_MS = 30000;
    setTimeout(() => {
      if (document.getElementById('loading-video')) removeLoadingVideo();
    }, MAX_FALLBACK_MS);

    // Optional: allow click to skip the loading video (unobtrusive)
    loadingVideo.addEventListener('click', removeLoadingVideo);
  })();

(function() {
  function showAccessOverlay() {
    const overlay = document.getElementById('access-overlay');
    if (!overlay) return;
    overlay.classList.add('visible');
  }

  document.addEventListener('DOMContentLoaded', function() {
    // const loading = document.getElementById('loading-indicator');
    // If body already marked loaded, show overlay immediately
    if (document.body.classList.contains('loaded')) {
      showAccessOverlay();
      return;
    }

    
  });
})();

// Minimal modal open/close for settings
function showSettingsWindow(modal, button) {
  if (!modal) return;
  modal.style.display = 'flex';
  modal.classList.add('open');
  // Optionally focus the modal for accessibility
  modal.setAttribute('tabindex', '-1');
  modal.focus();
}
function hideSettingsWindow(modal) {
  if (!modal) return;
  modal.style.display = 'none';
  modal.classList.remove('open');
}

// Apply section visibility based on user settings
function applySectionVisibility() {
  if (typeof sectionVisibility !== 'object') return;
  (sectionOrder || []).forEach(sectionId => {
    const sectionElement = document.getElementById(sectionId);
    if (sectionElement) {
      if (sectionVisibility[sectionId] !== false) {
        sectionElement.style.display = 'block';
      } else {
        sectionElement.style.display = 'none';
      }
    }
  });
}

const unlockBtn = document.getElementById('access-overlay-unlock-btn');
const passwordInput = document.getElementById('access-overlay-password');
const errorMsg = document.getElementById('access-overlay-error');
const overlay = document.getElementById('access-overlay');

// SHA256 using Web Crypto API
async function sha256(str) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error('SHA256 not supported: crypto.subtle is unavailable (use HTTPS or localhost)');
  }
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, '0')).join('');
}

// Show password input when button is clicked
unlockBtn.addEventListener('click', async () => {
  passwordInput.classList.add('active');
  passwordInput.style.display = 'inline-block';
  passwordInput.focus();

  // If password input is already visible and has a value, check it
  if (passwordInput.value) {
    errorMsg.style.display = 'none';
    const hash = await sha256(passwordInput.value);
    if (hash === '564c6c20f643a4e38e665382ce043b6927b4ed55548e9d411296b963668bc56f') {
      overlay.classList.remove('visible');
      overlay.style.opacity = 0;
      overlay.style.pointerEvents = 'none';
      overlay.style.visibility = 'hidden';
    } else {
      errorMsg.style.display = 'inline-block';
    }
  }
});