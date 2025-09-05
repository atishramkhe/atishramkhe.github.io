document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOMContentLoaded event fired. Script execution started.');
  const loadingIndicator = document.getElementById('loading-indicator');
  loadingIndicator.style.display = 'flex';

  try {
    // Initialize the clock
    updateClock();
    setInterval(updateClock, 1000);

    // Initialize section data from localStorage and constants
    sectionData['favorites'] = favorites; // Use safely loaded favorites
    sectionData['my-links'] = myCustomLinks; // Use safely loaded custom links
    sectionData['traditional-websites'] = TRADITIONAL_WEBSITES;
    sectionData['adult-websites'] = []; // Initialize as empty

    // Load all remote data in parallel
    await Promise.allSettled([
      loadAndParseFMHY(),
      loadFrenchSection(),
      loadAnimeStreamingSection(),
      loadLiveTVSection(),
      loadMangaReadingSection(),
    ]);

    // Render all sections in their final order
    renderSectionsInOrder();

    // Collect all sites for search functionality *after* final rendering
    allSites = [];
    document.querySelectorAll('.site').forEach(siteElement => {
      const name = siteElement.querySelector('span').textContent.trim();
      const url = siteElement.querySelector('a').href;
      const site = { name, url };
      if (!allSites.some(s => s.url === site.url)) { // Avoid duplicates
          allSites.push(site);
      }
    });

    // Update favorite stars and apply visibility
    updateFavoriteStars();
    applySectionVisibility();

    // Setup all event listeners now that the page is fully rendered
    setupEventListeners();

    console.log('Page initialization complete.');

  } catch (error) {
    console.error('An error occurred during page initialization:', error);
    // Optionally, display a user-friendly error message on the page
  } finally {
    // Hide loading indicator regardless of success or failure
    loadingIndicator.style.display = 'none';
    document.body.classList.add('loaded');
  }
});

function findNextUl(sectionHeader) {
  let element = sectionHeader.nextElementSibling;
  while (element) {
    if (element.tagName === 'UL') {
      return element;
    }
    if (element.tagName === 'H2' || element.tagName === 'H3') {
      // We've hit the next section, so stop.
      break;
    }
    element = element.nextElementSibling;
  }
  return null;
}

async function loadMangaReadingSection() {
  console.log('Attempting to load Manga Reading section...');
  try {
    const response = await fetch('https://fmhy.net/reading');
    if (!response.ok) throw new Error(`Failed to fetch reading guide: ${response.statusText}`);
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const mangaHeader = doc.querySelector('h3#manga');
    const links = [];

    if (mangaHeader) {
      const ul = findNextUl(mangaHeader);
      if (ul) {
        Array.from(ul.querySelectorAll('li')).forEach((li) => {
          const mainLink = li.querySelector('a');
          if (mainLink && mainLink.href.startsWith('http')) {
            links.push({ name: mainLink.textContent.trim(), url: mainLink.href });
          }
        });
      }
    }
    console.log('Manga Reading links extracted:', links.length);
    sectionData['manga'] = links; // Store data in sectionData
  } catch (error) {
    console.error('Error loading Manga Reading section:', error);
  }
}

async function loadAndParseFMHY() {
  console.log('Attempting to load and parse FMHY sections...');
  try {
    const response = await fetch('https://fmhy.net/video');
    if (!response.ok) throw new Error(`Failed to fetch video piracy guide: ${response.statusText}`);
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    for (const section of SECTIONS) {
      // Skip favorites and traditional websites as they are already in index.html
      if (section.id === 'favorites' || section.id === 'traditional-websites') continue;

      const sectionHeader = doc.querySelector(`${section.type}#${section.id}`);
      if (!sectionHeader) continue;

      const ul = findNextUl(sectionHeader);
      if (!ul) continue;

      const links = processLinks(ul);
      sectionData[section.id] = links; // Store data in sectionData
    }
  } catch (error) {
    console.error('Error loading main FMHY sections:', error);
  }
}

async function loadFrenchSection() {
  console.log('Attempting to load French section...');
  try {
    const response = await fetch('https://fmhy.net/non-english');
    if (!response.ok) throw new Error(`Failed to fetch non-english guide: ${response.statusText}`);
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const streamingHeader = doc.querySelector('h3#streaming');
    const links = [];

    if (streamingHeader) {
      const ul = findNextUl(streamingHeader);
      if (ul) {
        Array.from(ul.querySelectorAll('li')).forEach((li) => {
          const mainLink = li.querySelector('a');
          if (
            mainLink &&
            mainLink.href.startsWith('http') &&
            !['https://grafikart.fr/','https://www.youtube.com/@LesicsFR','https://doc4u.top/','https://www.tv5unis.ca/','https://www.tfo.org/','https://www.telequebec.tv/','https://ici.tou.tv/','https://www.tf1.fr/', 'https://www.awtwa.site/'].includes(mainLink.href)
          ) {
            links.push({ name: mainLink.textContent.trim(), url: mainLink.href });
          }
        });
      }
    }
    console.log('French section links extracted:', links.length);
    sectionData['french-francais'] = links; // Store data in sectionData
  } catch (error) {
    console.error('Error loading French section:', error);
  }
}

async function loadLiveTVSection() {
  console.log('Attempting to load Live TV section...');
  try {
    const response = await fetch('https://fmhy.net/video');
    if (!response.ok) throw new Error(`Failed to fetch video piracy guide for Live TV: ${response.statusText}`);
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const liveTVHeader = doc.querySelector('h3#live-tv');
    const links = [];

    if (liveTVHeader) {
      const ul = findNextUl(liveTVHeader);
      if (ul) {
        Array.from(ul.querySelectorAll('li')).forEach((li) => {
          const mainLink = li.querySelector('a');
          if (
            mainLink &&
            mainLink.href.startsWith('http') &&
            !['https://titantv.com/','https://kcnawatch.us/korea-central-tv-livestream','https://funcube.space/','https://greasyfork.org/en/scripts/506340-better-hianime','https://greasyfork.org/en/scripts/506891-hianime-auto-1080p','https://miru.js.org/en/','https://miguapp.pages.dev/','https://www.squidtv.net/','https://play.xumo.com/'].includes(mainLink.href)
          ) {
            links.push({ name: mainLink.textContent.trim(), url: mainLink.href });
          }
        });
      }
    }

    const vavooURL = 'https://vavoo.to/';
    const vavooLink = links.find(link => link.url === vavooURL);
    if (vavooLink) {
      links.splice(links.indexOf(vavooLink), 1);
    }
    links.unshift({ name: 'Vavoo', url: vavooURL });
    sectionData['live-tv'] = links; // Store data in sectionData
  } catch (error) {
    console.error('Error loading Live TV section:', error);
  }
}

async function loadAnimeStreamingSection() {
  console.log('Attempting to load Anime Streaming section...');
  try {
    const response = await fetch('https://fmhy.net/video');
    if (!response.ok) throw new Error(`Failed to fetch video piracy guide for Anime: ${response.statusText}`);
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const animeHeader = doc.querySelector('h3#anime-streaming');
    const links = [];

    if (animeHeader) {
      const ul = findNextUl(animeHeader);
      if (ul) {
        Array.from(ul.querySelectorAll('li')).forEach((li) => {
          const mainLink = li.querySelector('a');
          if (
            mainLink &&
            mainLink.href.startsWith('http') &&
            !['https://greasyfork.org/en/scripts/506340-better-hianime','https://greasyfork.org/en/scripts/506891-hianime-auto-1080p'].includes(mainLink.href)
          ) {
            links.push({ name: mainLink.textContent.trim(), url: mainLink.href });
          }
        });
      }
    }
    console.log('Anime Streaming links extracted:', links.length);
    sectionData['anime-streaming'] = links; // Store data in sectionData
  } catch (error) {
    console.error('Error loading Anime Streaming section:', error);
  }
}

function renderTraditionalWebsites() {
  console.log('Attempting to render Traditional Websites section...');
  try {
    sectionData['traditional-websites'] = TRADITIONAL_WEBSITES; // Store data in sectionData
  } catch (error) {
    console.error('Error rendering traditional websites:', error);
  }
}

function updateClock() {
  const clockElement = document.getElementById('clock');
  if (clockElement) {
    const now = new Date();
    clockElement.textContent = now.toLocaleTimeString();
  }
}

// Function to sort all sections alphabetically


// Define the sections to be displayed on the homepage
let allSites = []; // Global array to store all sites for searching
let sectionData = {}; // Global object to store data for each section

const SECTIONS = [
  { id: 'favorites', label: 'Favorites', type: 'h2', defaultVisible: true, order: 1 },
  { id: 'traditional-websites', label: 'Traditional Websites', type: 'h2', defaultVisible: true, order: 2 },
  { id: 'streaming-sites', label: 'Movies & TV Shows', type: 'h2', defaultVisible: true, order: 3 },
  { id: 'anime-streaming', label: 'Anime Streaming', type: 'h3', defaultVisible: true, order: 4 },
  { id: 'drama-streaming', label: 'Drama Streaming', type: 'h3', defaultVisible: true, order: 5 },
  { id: 'live-sports', label: 'Live Sports', type: 'h3', defaultVisible: true, order: 6 },
  { id: 'live-tv', label: 'Live TV', type: 'h3', defaultVisible: true, order: 7 },
  { id: 'french-francais', label: 'Français', type: 'h2', defaultVisible: true, order: 8 },
  { id: 'manga', label: 'Manga Reading', type: 'h2', defaultVisible: true, order: 9 },
  { id: 'my-links', label: 'My Links', type: 'h2', defaultVisible: true, order: 10 },
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
let sectionOrder = safeJsonParse('sectionOrder', []);

// Initialize section visibility for new sections
SECTIONS.forEach(section => {
  if (sectionVisibility[section.id] === undefined) {
    sectionVisibility[section.id] = section.defaultVisible;
  }
});
localStorage.setItem('sectionVisibility', JSON.stringify(sectionVisibility));

// Initialize section order for new sections
if (sectionOrder.length === 0) {
  sectionOrder = SECTIONS.map(section => section.id);
  localStorage.setItem('sectionOrder', JSON.stringify(sectionOrder));
} else {
  const currentSectionIds = new Set(sectionOrder);
  SECTIONS.forEach(section => {
    if (!currentSectionIds.has(section.id)) {
      sectionOrder.push(section.id);
    }
  });
  sectionOrder = sectionOrder.filter(id => SECTIONS.some(section => section.id === id));
  localStorage.setItem('sectionOrder', JSON.stringify(sectionOrder));
}

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
    renderSection('favorites-grid', favorites);
    updateFavoriteStars(); // This will update all stars on the page
}

// Update the favorite stars in all sections
function updateFavoriteStars() {
  const allSections = document.querySelectorAll('.site');
  allSections.forEach(siteElement => {
    const link = siteElement.querySelector('a');
    const favButton = siteElement.querySelector('.favorite-star');
    if (link && favButton) {
      const isFav = isFavorite(link.href);
      favButton.textContent = isFav ? '★' : '☆'; // Update the star icon
    }
  });
}

// Function to get a consistent logo for a website
function getWebsiteLogo(url) {
  const domain = new URL(url).hostname;
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`; // Use Google's favicon service
}

// Updated renderSection to handle empty favorites
function renderSection(containerId, sites) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`Container with ID "${containerId}" not found. Skipping rendering.`);
    return;
  }

  container.innerHTML = ''; // Clear the container before rendering

  if (!sites || sites.length === 0) {
    if (containerId === 'favorites-grid') {
        const placeholder = document.createElement('div');
        placeholder.className = 'placeholder';
        placeholder.textContent = '⭐ No favorites yet. Add some by clicking the star!';
        container.appendChild(placeholder);
    }
    return;
  }

  for (const site of sites) {
    if (!site || !site.name || !site.url) continue; // Prevent errors from malformed site data

    const div = document.createElement('div');
    div.className = 'site';

    const a = document.createElement('a');
    a.href = site.url;
    a.target = '_blank';

    const img = document.createElement('img');
    img.src = getWebsiteLogo(site.url);
    img.alt = `Logo for ${site.name}`;
    img.onerror = () => {
      img.remove(); // Remove the broken image
      const placeholder = document.createElement('div');
      placeholder.className = 'placeholder-icon';
      placeholder.textContent = '▶'; // Sleek play symbol
      a.insertBefore(placeholder, a.firstChild);
    };
    a.appendChild(img);

    const name = document.createElement('span');
    name.textContent = site.name;

    const nameAndStarContainer = document.createElement('div');
    nameAndStarContainer.className = 'site-name-and-star';
    nameAndStarContainer.appendChild(name);

    const favButton = document.createElement('button');
    favButton.textContent = isFavorite(site.url) ? '★' : '☆';
    favButton.className = 'favorite-star';
    favButton.setAttribute('aria-label', `Toggle favorite for ${site.name}`);
    favButton.onclick = (event) => {
      event.preventDefault();
      toggleFavorite({ name: site.name, url: site.url });
    };
    nameAndStarContainer.appendChild(favButton);

    a.appendChild(nameAndStarContainer);

    div.appendChild(a);
    container.appendChild(div);
  }

  const countElement = document.getElementById(`${containerId}-count`);
  if (countElement) {
    countElement.textContent = `${sites.length} sites`;
  }
}

// Helper function to process links and handle mirrors
function processLinks(ul) {
  const links = [];
  const mirrors = [];

  Array.from(ul.querySelectorAll('li')).forEach((li) => {
    const mainLink = li.querySelector('a');
    if (mainLink) {
      const mainName = mainLink.textContent.trim();
      const mainUrl = mainLink.href;

      // Exclude unwanted links
      if (/^(https?:\/\/)?(www\.)?(github\.com|discord\.gg|discord\.com|t\.me|telegram\.me|reddit\.com\/r\/|twitter\.com|github\.io|cse\.google\.com|rentry\.co|addons\.mozilla\.org|wotaku\.wiki\/websites|thewiki\.moe|everythingmoe\.com)/i.test(mainUrl)) {
        console.log(`Excluded URL: ${mainUrl}`); // Log excluded URLs
        return;
      }

      // Add the main link to the list
      links.push({ name: mainName, url: mainUrl });

      // Process mirrors (subsequent <a> tags in the same <li>)
      const mirrorLinks = Array.from(li.querySelectorAll('a')).slice(1); // Skip the first <a> (main link)
      mirrorLinks.forEach((mirror, index) => {
        const mirrorUrl = mirror.href;
        if (/^(https?:\/\/)?(www\.)?(github\.com|discord\.gg|discord\.com|t\.me|telegram\.me|reddit\.com\/r\/|twitter\.com|github\.io|cse\.google\.com|rentry\.co|addons\.mozilla\.org|wotaku\.wiki\/websites|thewiki\.moe|everythingmoe\.com)/i.test(mirrorUrl)) {
          console.log(`Excluded Mirror URL: ${mirrorUrl}`); // Log excluded mirror URLs
          return;
        }
        mirrors.push({
          name: `${mainName} ${index + 2}`, // Append "2", "3", etc., to the main name
          url: mirrorUrl,
        });
      });
    }
  });

  // Push mirrors to the bottom of the list
  return [...links, ...mirrors];
}



// Predefined list of traditional websites
const TRADITIONAL_WEBSITES = [
  { name: 'YouTube', url: 'https://www.youtube.com' },
  { name: 'YouTube Music', url: 'https://music.youtube.com' },
  { name: 'Netflix', url: 'https://www.netflix.com' },
  { name: 'Amazon Prime', url: 'https://www.primevideo.com' },
  { name: 'Disney+', url: 'https://www.disneyplus.com' },
  { name: 'France.tv', url: 'https://www.france.tv' },
  { name: 'TF1', url: 'https://www.tf1.fr' },
  { name: 'M6', url: 'https://www.6play.fr' },
  { name: 'BFMTV', url: 'https://www.bfmtv.com' },
  { name: 'Arte', url: 'https://www.arte.fr', logo: 'https://upload.wikimedia.org/wikipedia/fr/8/8c/Logo_ARTE.TV_2020.svg' } // Updated Arte logo
];



// Function to sort all sections alphabetically
function renderSectionsInOrder() {
  console.log('Rendering sections in order...');
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
      const sectionElement = document.createElement('div');
      sectionElement.id = section.id;
      sectionElement.className = 'category';

      const header = document.createElement(section.type);
      header.textContent = section.label;
      sectionElement.appendChild(header);

      const countSpan = document.createElement('span');
      countSpan.id = `${section.id}-count`;
      countSpan.className = 'site-count';
      header.appendChild(countSpan);

      const gridDiv = document.createElement('div');
      gridDiv.id = `${section.id}-grid`;
      gridDiv.className = 'grid';
      sectionElement.appendChild(gridDiv);

      contentGrid.appendChild(sectionElement);

      // Render the sites within the newly created section
      renderSection(`${section.id}-grid`, sectionData[section.id] || []);
    }
  });
  applySectionVisibility(); // Apply visibility after rendering
  updateFavoriteStars();
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
  const sectionOrderList = document.getElementById('section-order-list');

  // Settings Modal
  if (settingsButton) {
    settingsButton.addEventListener('click', () => {
      settingsModal.style.display = 'flex';
      populateSettings();
    });
  }

  if (closeSettingsButton) {
    closeSettingsButton.addEventListener('click', () => {
      settingsModal.style.display = 'none';
    });
  }

  window.addEventListener('click', (event) => {
    if (event.target === settingsModal) {
      settingsModal.style.display = 'none';
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
        renderSection('search-results-grid', filteredSites);
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
  
    // Drag and drop for section order
    let draggedItem = null;
    sectionOrderList.addEventListener('dragstart', (e) => {
        draggedItem = e.target;
        setTimeout(() => {
            e.target.classList.add('dragging');
        }, 0);
    });

    sectionOrderList.addEventListener('dragend', (e) => {
        setTimeout(() => {
            e.target.classList.remove('dragging');
            draggedItem = null;
        }, 0);
        
        const newOrder = [...sectionOrderList.querySelectorAll('li')].map(li => li.dataset.sectionId);
        sectionOrder = newOrder;
        localStorage.setItem('sectionOrder', JSON.stringify(sectionOrder));
        renderSectionsInOrder();
    });

    sectionOrderList.addEventListener('dragover', (e) => {
        e.preventDefault();
        const afterElement = getDragAfterElement(sectionOrderList, e.clientY);
        if (afterElement == null) {
            sectionOrderList.appendChild(draggedItem);
        } else {
            sectionOrderList.insertBefore(draggedItem, afterElement);
        }
    });
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

  // Populate Section Order
  const sectionOrderList = document.getElementById('section-order-list');
  sectionOrderList.innerHTML = '';
  sectionOrder.forEach(sectionId => {
    const section = SECTIONS.find(s => s.id === sectionId);
    if (section) {
      const li = document.createElement('li');
      li.dataset.sectionId = section.id;
      li.draggable = true;
      li.textContent = section.label;
      sectionOrderList.appendChild(li);
    }
  });
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('li:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function applySectionVisibility() {
  sectionOrder.forEach(sectionId => {
    const sectionElement = document.getElementById(sectionId);
    if (sectionElement) {
      if (sectionVisibility[sectionId]) {
        sectionElement.style.display = 'flex';
      } else {
        sectionElement.style.display = 'none';
      }
    }
  });
}

// Custom Links functionality

function renderCustomLinks() {
  const customLinksList = document.getElementById('custom-links-list');
  if (!customLinksList) return;

  customLinksList.innerHTML = '';

  myCustomLinks.forEach((link, index) => {
    const listItem = document.createElement('li');
    listItem.innerHTML = `
      <span>${link.name}</span>
      <div>
        <button class="edit-custom-link" data-index="${index}">Edit</button>
        <button class="delete-custom-link" data-index="${index}">Delete</button>
      </div>
    `;
    customLinksList.appendChild(listItem);
  });

  // Update sectionData and render the 'my-links' section
  sectionData['my-links'] = myCustomLinks;
  renderSection('my-links-grid', myCustomLinks);
}

function addCustomLink(name, url) {
  if (name && url) {
    myCustomLinks.push({ name, url });
    localStorage.setItem(MY_LINKS_KEY, JSON.stringify(myCustomLinks));
    renderCustomLinks(); // This will re-render the list in the modal and the section on the page
  }
}

function deleteCustomLink(index) {
  myCustomLinks.splice(index, 1);
  localStorage.setItem(MY_LINKS_KEY, JSON.stringify(myCustomLinks));
  renderCustomLinks();
}

function editCustomLink(index, newName, newUrl) {
  if (newName && newUrl) {
    myCustomLinks[index] = { name: newName, url: newUrl };
    localStorage.setItem(MY_LINKS_KEY, JSON.stringify(myCustomLinks));
    renderCustomLinks();
  }
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

  if (!noticeDismissed || (Date.now() - noticeDismissed > oneWeek)) {
    cacheNotice.style.display = 'block';
  }

  closeButton.addEventListener('click', () => {
    cacheNotice.style.display = 'none';
    localStorage.setItem('cacheNoticeDismissed', Date.now());
  });

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
});


