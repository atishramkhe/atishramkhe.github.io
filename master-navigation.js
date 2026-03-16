(function () {
  const scriptUrl = new URL(document.currentScript && document.currentScript.src ? document.currentScript.src : 'master-navigation.js', window.location.href);
  const rootUrl = new URL('./', scriptUrl);

  const NAV_ITEMS = [
    {
      id: 'home',
      label: 'Home',
      href: '',
      icon: 'assets/Logo_V2_Ateaish_bleu_blanc_RVB_2000px.png',
      alt: 'Ateaish home'
    },
    {
      id: 'anime',
      label: 'Anime',
      href: 'anime/',
      icon: 'anime/assets/ateaish_anime default.png',
      alt: 'Ateaish anime'
    },
    {
      id: 'drama',
      label: 'Drama',
      href: 'drama/',
      icon: 'drama/assets/ateaish dramas default.png',
      alt: 'Ateaish drama'
    },
    {
      id: 'manga',
      label: 'Manga',
      href: 'manga/',
      icon: 'manga/assets/ateaish_m.png',
      alt: 'Ateaish manga'
    },
    {
      id: 'comics',
      label: 'Comics',
      href: 'comics/',
      icon: 'comics/assets/ateaish_comics_default.webp',
      alt: 'Ateaish comics'
    },
    {
      id: 'movies',
      label: 'Movies',
      href: 'movies/',
      icon: 'movies/assets/ateaish_movie_default_150ppi.png',
      alt: 'Ateaish movies'
    },
    {
      id: 'radio',
      label: 'Radio',
      href: 'radio/',
      icon: 'radio/assets/ateaish_radio_blanc_150ppi.png',
      alt: 'Ateaish radio'
    },
    {
      id: 'sport',
      label: 'Sport',
      href: 'sport/',
      icon: 'sport/assets/ateaish_sport_blanc_150ppi.png',
      alt: 'Ateaish sport'
    },
    {
      id: 'tv',
      label: 'TV',
      href: 'tv/',
      icon: 'tv/assets/ateaish_tv_blanc_150ppi_noborder.png',
      alt: 'Ateaish TV'
    }
  ];

  function normalizePath(pathname) {
    if (!pathname) {
      return '/';
    }
    return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  }

  function detectCurrentSection(pathname) {
    const path = normalizePath(pathname);

    if (path === '/' || path === '/index.html') {
      return 'home';
    }
    if (path.startsWith('/anime')) {
      return 'anime';
    }
    if (path.startsWith('/drama')) {
      return 'drama';
    }
    if (path.startsWith('/manga')) {
      return 'manga';
    }
    if (path.startsWith('/comics')) {
      return 'comics';
    }
    if (path.startsWith('/movies')) {
      return 'movies';
    }
    if (path.startsWith('/radio')) {
      return 'radio';
    }
    if (path.startsWith('/sport')) {
      return 'sport';
    }
    if (path.startsWith('/tv')) {
      return 'tv';
    }

    return 'home';
  }

  function detectCurrentSectionFromUrl() {
    const currentHref = window.location.href;
    const rootHref = rootUrl.href;

    if (currentHref.startsWith(rootHref)) {
      const relativePath = currentHref.slice(rootHref.length).split('#')[0].split('?')[0];
      const firstSegment = relativePath.replace(/^\/+/, '').split('/')[0];

      if (!firstSegment || firstSegment === 'index.html') {
        return 'home';
      }

      if (['anime', 'drama', 'manga', 'comics', 'movies', 'radio', 'sport', 'tv'].includes(firstSegment)) {
        return firstSegment;
      }
    }

    return detectCurrentSection(window.location.pathname);
  }

  function resolveFromRoot(path) {
    return new URL(path, rootUrl).href;
  }

  function ensureStyles() {
    if (document.getElementById('ateaish-master-nav-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'ateaish-master-nav-styles';
    style.textContent = [
      '.ateaish-master-nav{--master-nav-accent:var(--ateaish-master-nav-accent,#75fe4e);--master-nav-accent-rgb:var(--ateaish-master-nav-accent-rgb,117,254,78);--master-nav-text:var(--ateaish-master-nav-text,#fff);--master-nav-muted:var(--ateaish-master-nav-muted,rgba(255,255,255,.62));--master-nav-expanded-width-desktop:610px;--master-nav-expanded-width-mobile:min(480px,calc(100vw - 8px));position:fixed;top:50%;right:22px;transform:translateY(-50%);z-index:95;display:flex;align-items:center;justify-content:flex-end;pointer-events:none;width:66px;height:66px;transition:width 280ms ease;font-family:inherit;}',
      '.ateaish-master-nav,.ateaish-master-nav *{box-sizing:border-box;}',
      '.ateaish-master-nav.is-open{pointer-events:auto;}',
      '.ateaish-master-nav:hover,.ateaish-master-nav:focus-within,.ateaish-master-nav.is-open{width:var(--master-nav-expanded-width-desktop);}',
      '.ateaish-master-nav__toggle,.ateaish-master-nav__panel{pointer-events:auto;}',
      '.ateaish-master-nav__toggle{display:inline-flex;align-items:center;justify-content:center;width:66px;height:66px;padding:0;border:0;border-radius:999px;background:#000;box-shadow:16px 16px 28px rgba(0,0,0,.34);color:var(--master-nav-text);cursor:pointer;font:inherit;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);transition:transform 160ms ease,box-shadow 160ms ease,background 160ms ease;position:relative;overflow:hidden;flex:0 0 66px;z-index:2;}',
      '.ateaish-master-nav__toggle::before{content:"";position:absolute;inset:0;border:1px solid rgba(var(--master-nav-accent-rgb),.22);background:none;pointer-events:none;border-radius:inherit;}',
      '.ateaish-master-nav__toggle:hover,.ateaish-master-nav__toggle:focus-visible{transform:scale(1.12);box-shadow:20px 20px 34px rgba(0,0,0,.4);outline:none;}',
      '.ateaish-master-nav__toggle img{width:42px;height:42px;object-fit:contain;position:relative;z-index:1;transition:transform 180ms ease;}',
      '.ateaish-master-nav:hover .ateaish-master-nav__toggle img,.ateaish-master-nav:focus-within .ateaish-master-nav__toggle img,.ateaish-master-nav.is-open .ateaish-master-nav__toggle img{transform:scale(1.16);}',
      '.ateaish-master-nav__toggle:hover img,.ateaish-master-nav__toggle:focus-visible img{transform:scale(2.25);}',
      '.ateaish-master-nav__panel{position:absolute;right:0;top:0;transform:translateX(0);width:100%;height:66px;padding:0 72px 0 14px;display:flex;align-items:center;background:#000;border:0;box-shadow:22px 22px 40px rgba(0,0,0,.34);border-radius:999px;opacity:0;visibility:hidden;pointer-events:none;transition:opacity 220ms ease,visibility 220ms ease;overflow:hidden;}',
      '.ateaish-master-nav__panel::before,.ateaish-master-nav__panel::after{content:"";position:absolute;background:rgba(var(--master-nav-accent-rgb),.38);pointer-events:none;}',
      '.ateaish-master-nav__panel::before{top:0;left:0;width:100%;height:1px;border-radius:999px 999px 0 0;}',
      '.ateaish-master-nav__panel::after{top:0;right:0;width:1px;height:100%;border-radius:0 999px 999px 0;}',
      '.ateaish-master-nav:hover .ateaish-master-nav__panel,.ateaish-master-nav:focus-within .ateaish-master-nav__panel,.ateaish-master-nav.is-open .ateaish-master-nav__panel{opacity:1;visibility:visible;pointer-events:auto;transform:translateX(0);}',
      '.ateaish-master-nav__links{display:flex;align-items:center;justify-content:flex-start;flex-wrap:nowrap;gap:9px;height:100%;width:100%;padding-left:14px;}',
      '.ateaish-master-nav__link{display:flex;align-items:center;justify-content:center;gap:0;width:54px;height:66px;min-height:66px;padding:0;text-decoration:none;color:var(--master-nav-text);background:transparent;border:0;border-radius:999px;transition:transform 160ms ease,background 160ms ease,filter 160ms ease,opacity 220ms ease;position:relative;overflow:hidden;opacity:0;transform:translateY(26px);animation:none;}',
      '.ateaish-master-nav__link::before{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;background:transparent;transition:background 140ms ease;}',
      '.ateaish-master-nav:hover .ateaish-master-nav__link,.ateaish-master-nav:focus-within .ateaish-master-nav__link,.ateaish-master-nav.is-open .ateaish-master-nav__link{opacity:1;transform:translateY(0);}',
      '.ateaish-master-nav:hover .ateaish-master-nav__link:nth-child(1),.ateaish-master-nav:focus-within .ateaish-master-nav__link:nth-child(1),.ateaish-master-nav.is-open .ateaish-master-nav__link:nth-child(1){transition-delay:40ms;}',
      '.ateaish-master-nav:hover .ateaish-master-nav__link:nth-child(2),.ateaish-master-nav:focus-within .ateaish-master-nav__link:nth-child(2),.ateaish-master-nav.is-open .ateaish-master-nav__link:nth-child(2){transition-delay:80ms;}',
      '.ateaish-master-nav:hover .ateaish-master-nav__link:nth-child(3),.ateaish-master-nav:focus-within .ateaish-master-nav__link:nth-child(3),.ateaish-master-nav.is-open .ateaish-master-nav__link:nth-child(3){transition-delay:120ms;}',
      '.ateaish-master-nav:hover .ateaish-master-nav__link:nth-child(4),.ateaish-master-nav:focus-within .ateaish-master-nav__link:nth-child(4),.ateaish-master-nav.is-open .ateaish-master-nav__link:nth-child(4){transition-delay:160ms;}',
      '.ateaish-master-nav:hover .ateaish-master-nav__link:nth-child(5),.ateaish-master-nav:focus-within .ateaish-master-nav__link:nth-child(5),.ateaish-master-nav.is-open .ateaish-master-nav__link:nth-child(5){transition-delay:200ms;}',
      '.ateaish-master-nav:hover .ateaish-master-nav__link:nth-child(6),.ateaish-master-nav:focus-within .ateaish-master-nav__link:nth-child(6),.ateaish-master-nav.is-open .ateaish-master-nav__link:nth-child(6){transition-delay:240ms;}',
      '.ateaish-master-nav:hover .ateaish-master-nav__link:nth-child(7),.ateaish-master-nav:focus-within .ateaish-master-nav__link:nth-child(7),.ateaish-master-nav.is-open .ateaish-master-nav__link:nth-child(7){transition-delay:280ms;}',
      '.ateaish-master-nav:hover .ateaish-master-nav__link:nth-child(8),.ateaish-master-nav:focus-within .ateaish-master-nav__link:nth-child(8),.ateaish-master-nav.is-open .ateaish-master-nav__link:nth-child(8){transition-delay:320ms;}',
      '.ateaish-master-nav:hover .ateaish-master-nav__link:nth-child(9),.ateaish-master-nav:focus-within .ateaish-master-nav__link:nth-child(9),.ateaish-master-nav.is-open .ateaish-master-nav__link:nth-child(9){transition-delay:360ms;}',
      '.ateaish-master-nav__link:hover,.ateaish-master-nav__link:focus-visible,.ateaish-master-nav__link.is-active{background:rgba(var(--master-nav-accent-rgb),.1);transform:scale(1.24);filter:brightness(1.08);outline:none;}',
      '.ateaish-master-nav__link:hover::before,.ateaish-master-nav__link:focus-visible::before,.ateaish-master-nav__link.is-active::before{background:var(--master-nav-accent);}',
      '.ateaish-master-nav__link img{width:40px;height:40px;object-fit:contain;justify-self:center;filter:drop-shadow(0 5px 10px rgba(0,0,0,.18));transition:transform 180ms ease;}',
      '.ateaish-master-nav:hover .ateaish-master-nav__link img,.ateaish-master-nav:focus-within .ateaish-master-nav__link img,.ateaish-master-nav.is-open .ateaish-master-nav__link img{transform:scale(1.28);}',
      '.ateaish-master-nav__link:hover img,.ateaish-master-nav__link:focus-visible img,.ateaish-master-nav__link.is-active img{transform:scale(2.1);}',
      '.ateaish-master-nav__label{display:none;}',
      '.ateaish-master-nav--inline{position:relative;top:auto;right:auto;transform:none;width:100%;height:52px;justify-content:flex-end;pointer-events:auto;overflow:visible;z-index:19;}',
      '.ateaish-master-nav--inline:hover,.ateaish-master-nav--inline:focus-within,.ateaish-master-nav--inline.is-open{width:100%;}',
      '.ateaish-master-nav--inline .ateaish-master-nav__toggle{width:52px;height:52px;flex:0 0 52px;border-radius:16px;box-shadow:0 10px 26px rgba(0,0,0,.34);}',
      '.ateaish-master-nav--inline .ateaish-master-nav__toggle img{width:34px;height:34px;}',
      '.ateaish-master-nav--inline .ateaish-master-nav__panel{right:0;top:0;bottom:auto;width:min(520px,calc(100vw - 28px));height:52px;padding:0 60px 0 12px;border-radius:16px;box-shadow:0 18px 38px rgba(0,0,0,.46);}',
      '.ateaish-master-nav--inline .ateaish-master-nav__links{gap:8px;padding-left:0;justify-content:flex-start;}',
      '.ateaish-master-nav--inline .ateaish-master-nav__link{width:42px;height:52px;min-height:52px;}',
      '.ateaish-master-nav--inline .ateaish-master-nav__link img{width:34px;height:34px;}',
      '@media (max-width:720px){.ateaish-master-nav{top:auto;bottom:144px;right:0;transform:none;width:58px;height:58px;}.ateaish-master-nav:hover,.ateaish-master-nav:focus-within,.ateaish-master-nav.is-open{width:var(--master-nav-expanded-width-mobile);}.ateaish-master-nav__toggle{width:58px;height:58px;flex:0 0 58px;}.ateaish-master-nav__toggle img{width:38px;height:38px;}.ateaish-master-nav__panel{right:0;top:auto;bottom:0;transform:translateX(0);width:100%;height:58px;padding:0 64px 0 10px;border-radius:999px;}.ateaish-master-nav__links{gap:6px;padding-left:10px;}.ateaish-master-nav__link{width:44px;height:58px;min-height:58px;}.ateaish-master-nav__link img{width:32px;height:32px;}}'
    ].join('');
    document.head.appendChild(style);
  }

  function getMountTarget() {
    return document.querySelector('[data-ateaish-master-nav-slot]') || document.body;
  }

  function attachNavigationListeners(nav) {
    if (nav.dataset.listenersBound === 'true') {
      return;
    }

    function setOpen(nextOpen) {
      nav.dataset.open = nextOpen ? 'true' : 'false';
      nav.classList.toggle('is-open', nextOpen);
      const activeToggle = nav.querySelector('.ateaish-master-nav__toggle');
      if (activeToggle) {
        activeToggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
      }
    }

    nav.addEventListener('click', function (event) {
      const clickedToggle = event.target.closest('.ateaish-master-nav__toggle');
      if (!clickedToggle || !nav.contains(clickedToggle)) {
        return;
      }
      setOpen(nav.dataset.open !== 'true');
    });

    nav.addEventListener('mouseenter', function () {
      if (window.matchMedia('(hover: hover)').matches) {
        setOpen(true);
      }
    });

    nav.addEventListener('mouseleave', function () {
      if (window.matchMedia('(hover: hover)').matches) {
        setOpen(false);
      }
    });

    document.addEventListener('click', function (event) {
      if (!nav.contains(event.target)) {
        setOpen(false);
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    });

    nav.dataset.listenersBound = 'true';
  }

  function buildNavigation() {
    if (!document.body) {
      return;
    }

    const currentSection = detectCurrentSectionFromUrl();
    const activeItem = NAV_ITEMS.find((item) => item.id === currentSection) || NAV_ITEMS[0];
    const mountTarget = getMountTarget();
    const inline = mountTarget !== document.body;

    const nav = document.querySelector('[data-ateaish-master-nav]') || document.createElement('div');
    nav.className = 'ateaish-master-nav' + (inline ? ' ateaish-master-nav--inline' : '');
    nav.dataset.ateaishMasterNav = 'true';
    nav.dataset.open = nav.dataset.open || 'false';
    nav.classList.toggle('is-open', nav.dataset.open === 'true');
    nav.setAttribute('aria-label', 'Website navigation');

    const expandedWidth = Math.max(548, 66 + (NAV_ITEMS.length * 60));
    nav.style.setProperty('--master-nav-expanded-width-desktop', expandedWidth + 'px');

    const linksMarkup = NAV_ITEMS.map((item) => {
      const isActive = item.id === currentSection;
      return [
        '<a class="ateaish-master-nav__link',
        isActive ? ' is-active' : '',
        '" href="',
        resolveFromRoot(item.href),
        '" role="menuitem"',
        isActive ? ' aria-current="page"' : '',
        ' aria-label="',
        item.label,
        '" title="',
        item.label,
        '">',
        '<img src="',
        resolveFromRoot(item.icon),
        '" alt="',
        item.alt,
        '">',
        '</a>'
      ].join('');
    }).join('');

    nav.innerHTML = [
      '<button class="ateaish-master-nav__toggle" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Open website navigation" title="Open website navigation">',
      '<img src="',
      resolveFromRoot(activeItem.icon),
      '" alt="',
      activeItem.alt,
      '">',
      '</button>',
      '<div class="ateaish-master-nav__panel" role="menu">',
      '<div class="ateaish-master-nav__links">',
      linksMarkup,
      '</div>',
      '</div>'
    ].join('');

    if (mountTarget === document.body) {
      if (nav.parentNode !== document.body || nav !== document.body.firstChild) {
        document.body.insertBefore(nav, document.body.firstChild);
      }
    } else if (nav.parentNode !== mountTarget) {
      mountTarget.appendChild(nav);
    }

    const toggle = nav.querySelector('.ateaish-master-nav__toggle');
    toggle.setAttribute('aria-expanded', nav.dataset.open === 'true' ? 'true' : 'false');
    attachNavigationListeners(nav);
  }

  function init() {
    ensureStyles();
    buildNavigation();
    window.addEventListener('ateaish-master-nav-refresh', buildNavigation);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();