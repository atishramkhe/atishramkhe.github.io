let _basePrefix = "./";

function _projectsJsonCandidates() {
  const p = window.location.pathname;
  // For nested pages like /project/, /infos/, /shop/ prefer ../ first.
  if (/\/(project|infos|shop)\//.test(p)) {
    return ["../travaux/projects.json", "./travaux/projects.json", "../../travaux/projects.json"]; 
  }
  return ["./travaux/projects.json", "../travaux/projects.json", "../../travaux/projects.json"]; 
}

async function _fetchJsonWithCandidates(candidates) {
  let lastErr;
  for (const candidate of candidates) {
    try {
      const res = await fetch(`${candidate}?ts=${Date.now()}`);
      if (!res.ok) {
        lastErr = new Error(`Failed to load ${candidate} (${res.status})`);
        continue;
      }
      const data = await res.json();
      _basePrefix = candidate.split("travaux/projects.json")[0] || "./";
      return data;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("Failed to load projects.json");
}

async function loadProjects() {
  const data = await _fetchJsonWithCandidates(_projectsJsonCandidates());
  return Array.isArray(data.projects) ? data.projects : [];
}

function resolveAssetPath(src) {
  if (!src) return "";
  if (src.startsWith("http://") || src.startsWith("https://")) return src;
  if (src.startsWith("/")) return src;
  // Encode spaces and other URL-unsafe chars, but keep path structure.
  return encodeURI(`${_basePrefix}${src}`);
}

function byNumberAsc(a, b) {
  return (a.number ?? 0) - (b.number ?? 0);
}

function findProject(projects, slug) {
  return projects.find((p) => p.slug === slug || p.dir === slug || String(p.number) === String(slug));
}

window.PortfolioData = {
  loadProjects,
  byNumberAsc,
  findProject,
  resolveAssetPath,
};
