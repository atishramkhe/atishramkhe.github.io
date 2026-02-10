(async function () {
  const header = document.getElementById("siteHeader");
  const hero = document.getElementById("hero");
  const heroTitle = document.getElementById("heroTitle");
  const projectsEl = document.getElementById("projects");
  const tpl = document.getElementById("projectCardTpl");

  if (!projectsEl || !tpl) return;

  let projects = [];
  try {
    projects = await window.PortfolioData.loadProjects();
  } catch (e) {
    projectsEl.textContent = "Impossible de charger les projets.";
    return;
  }

  projects.sort(window.PortfolioData.byNumberAsc);

  if (heroTitle) {
    heroTitle.textContent = "FANILO BINI";
  }

  if (header) {
    const onScroll = () => {
      if (window.scrollY > 24) header.classList.add("site-header--solid");
      else header.classList.remove("site-header--solid");
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // Home page top banner slideshow: rotate through each project's banner.png
  const banners = projects
    .map((p) => p.banner)
    .filter(Boolean)
    .map((src) => window.PortfolioData.resolveAssetPath(src));

  if (hero && banners.length > 0) {
    let i = 0;
    hero.style.backgroundImage = `url("${banners[i]}")`;
    hero.style.backgroundPosition = "center";

    // Preload next images (best-effort)
    for (const b of banners) {
      const img = new Image();
      img.src = b;
    }

    if (banners.length > 1) {
      setInterval(() => {
        i = (i + 1) % banners.length;
        hero.style.backgroundImage = `url("${banners[i]}")`;
      }, 4500);
    }
  }

  const frag = document.createDocumentFragment();

  for (const p of projects) {
    const node = tpl.content.cloneNode(true);
    const a = node.querySelector(".project-card");
    const img = node.querySelector(".project-card__img");
    const title = node.querySelector(".project-card__title");
    const subtitle = node.querySelector(".project-card__subtitle");

    if (a) a.href = `./project/?p=${encodeURIComponent(p.slug)}`;
    if (img) {
      img.src = window.PortfolioData.resolveAssetPath(p.home ?? "");
      img.alt = p.title ?? "Projet";
    }
    if (title) title.textContent = p.title ?? p.name ?? "";
    if (subtitle) subtitle.textContent = p.year ? String(p.year) : "";

    frag.appendChild(node);
  }

  projectsEl.innerHTML = "";
  projectsEl.appendChild(frag);
})();
