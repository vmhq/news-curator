import { SITE_URL, DEFAULT_COVER, formatDateEs, dateFromFileId } from "../lib/curations.ts";

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MONTHS_SHORT_ES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

function formatDateShort(fileId: string): string {
  const clean = dateFromFileId(fileId);
  const dt = new Date(clean + "T12:00:00");
  if (Number.isNaN(dt.getTime())) return fileId;
  return `${dt.getDate()} ${MONTHS_SHORT_ES[dt.getMonth()]} ${dt.getFullYear()}`;
}

/** "Viernes 17 de abril" — no year, used for hero date */
function formatDateEsNoYear(fileId: string): string {
  const clean = dateFromFileId(fileId);
  const dt = new Date(clean + "T12:00:00");
  if (Number.isNaN(dt.getTime())) return formatDateEs(fileId);
  const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const months = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  return `${days[dt.getDay()]} ${dt.getDate()} de ${months[dt.getMonth()]}`;
}

/** Pastel SVG fallback composition for the hero visual. */
function heroArtSvg(): string {
  return `<svg class="hero-art-svg" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="pastelSkyGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="var(--accent-soft)"/>
        <stop offset="100%" stop-color="var(--accent-warm)" stop-opacity="0.7"/>
      </linearGradient>
      <pattern id="pastelDots" width="20" height="20" patternUnits="userSpaceOnUse">
        <circle cx="10" cy="10" r="0.8" fill="var(--ink-5)" opacity="0.5"/>
      </pattern>
    </defs>
    <rect width="400" height="500" fill="url(#pastelSkyGrad)"/>
    <rect width="400" height="500" fill="url(#pastelDots)"/>
    <circle cx="200" cy="250" r="120" fill="none" stroke="var(--accent)" stroke-width="1" opacity="0.25"/>
    <circle cx="200" cy="250" r="80" fill="none" stroke="var(--accent)" stroke-width="1" opacity="0.4"/>
    <circle cx="200" cy="250" r="42" fill="var(--paper)" opacity="0.9"/>
    <circle cx="120" cy="140" r="18" fill="var(--accent-warm)"/>
    <circle cx="310" cy="380" r="12" fill="var(--accent)"/>
    <rect x="60" y="380" width="24" height="24" rx="6" fill="var(--accent)" opacity="0.7" transform="rotate(15 72 392)"/>
    <circle cx="330" cy="130" r="8" fill="var(--accent)" opacity="0.6"/>
    <path d="M 280 90 Q 300 80 320 90 T 360 90" fill="none" stroke="var(--accent)" stroke-width="1.5" opacity="0.6"/>
    <g transform="translate(200, 250)">
      <circle r="4" fill="var(--accent)"/>
      <circle r="14" fill="none" stroke="var(--accent)" stroke-width="1"/>
    </g>
    <text x="24" y="476" font-family="Instrument Serif, serif" font-size="13" fill="var(--ink-4)" font-style="italic">
      Fig. I — La edición de hoy, en un glifo.
    </text>
  </svg>`;
}

/** Extract story items from rendered HTML body for the feed view */
function buildFeedItems(body: string): Array<{ section: string; headline: string; excerpt: string; href: string }> {
  const items: Array<{ section: string; headline: string; excerpt: string; href: string }> = [];
  let currentSection = "";
  const chunks = body.split(/(?=<h[23][\s>])/i);
  for (const chunk of chunks) {
    const h2Match = chunk.match(/^<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const h3Match = chunk.match(/^<h3[^>]*>([\s\S]*?)<\/h3>/i);
    if (h2Match) {
      currentSection = h2Match[1].replace(/<[^>]+>/g, "").trim();
    } else if (h3Match && currentSection) {
      const headlineHtml = h3Match[1];
      const headline = headlineHtml.replace(/<[^>]+>/g, "").trim();
      const hrefMatch = headlineHtml.match(/href="([^"]+)"/);
      const href = hrefMatch ? hrefMatch[1] : "#article-body";
      const pMatch = chunk.match(/<\/h3>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
      const excerpt = pMatch ? pMatch[1].replace(/<[^>]+>/g, "").trim() : "";
      if (headline) items.push({ section: currentSection, headline, excerpt, href });
    }
  }
  return items;
}

export function buildPage(
  title: string,
  body: string,
  meta: {
    date?: string;
    isToday?: boolean;
    generatedAt?: string;
    recentCurations?: Array<{ date: string; summary: string }>;
    prevDate?: string | null;
    nextDate?: string | null;
    featured?: { category: string; headline: string; body: string; firstUrl?: string | null } | null;
    heroImage?: string | null;
    canonicalPath?: string;
    sidebarHasMore?: boolean;
    sidebarHasPrev?: boolean;
    sidebarPage?: number;
    hideSidebar?: boolean;
    readingTime?: number;
  } = {}
): string {
  const {
    date, isToday, generatedAt, recentCurations = [],
    prevDate, nextDate, featured, heroImage,
    canonicalPath = "/",
    sidebarHasMore = false, sidebarHasPrev = false, sidebarPage = 1,
    hideSidebar = false, readingTime,
  } = meta;

  const canonicalUrl = `${SITE_URL}${canonicalPath}`;
  const ogDescription =
    featured?.body ?? "Noticias de tecnología e inteligencia artificial curadas diariamente por IA.";
  const ogImage = heroImage ?? DEFAULT_COVER;

  const isArchive = canonicalPath === "/ediciones";
  const isHomeOrEdition = !isArchive;

  // Active nav / seg-tabs
  const inicioActive = isHomeOrEdition ? " active" : "";
  const archivoActive = isArchive ? " active" : "";

  // Command palette payload
  const recentForPalette = recentCurations.slice(0, 6).map(c => ({
    date: c.date,
    summary: c.summary,
    url: `/curacion/${c.date}`,
    dateFormatted: formatDateEs(c.date),
  }));
  const recentJson = escapeHtml(JSON.stringify(recentForPalette));

  const recentLinks = recentCurations
    .map(
      (c) =>
        `<a href="/curacion/${escapeHtml(c.date)}" class="recent-item${c.date === date ? " active" : ""}">
      <span class="recent-date" data-iso="${escapeHtml(c.date)}">${escapeHtml(formatDateShort(c.date))}</span>
      <span class="recent-headline">${escapeHtml(c.summary)}</span>
    </a>`
    )
    .join("\n");

  const sidebarPaginationHtml =
    sidebarHasPrev || sidebarHasMore
      ? `
    <div class="sidebar-pagination">
      ${sidebarHasPrev ? `<a href="/?p=${sidebarPage - 1}" class="sidebar-page-btn">← Recientes</a>` : "<span></span>"}
      ${sidebarHasMore ? `<a href="/?p=${sidebarPage + 1}" class="sidebar-page-btn">Antiguas →</a>` : "<span></span>"}
    </div>`
      : "";

  const navHtml =
    prevDate || nextDate
      ? `
    <div class="pagination">
      ${prevDate ? `<a href="/curacion/${escapeHtml(prevDate)}" class="page-btn">← Anterior</a>` : '<span class="page-btn disabled">← Anterior</span>'}
      ${nextDate ? `<a href="/curacion/${escapeHtml(nextDate)}" class="page-btn">Siguiente →</a>` : '<span class="page-btn disabled">Siguiente →</span>'}
    </div>`
      : "";

  // Hero visual — image if present, else pastel SVG fallback
  const heroVisualInner = heroImage
    ? `<div class="hero-image loading" id="heroImageWrap"><img src="${escapeHtml(heroImage)}" alt="${escapeHtml(featured?.headline || "")}" loading="eager" id="heroImg"></div>`
    : `<div class="hero-image">${heroArtSvg()}</div>`;

  const figDate = date ? formatDateShort(date) : "";
  const figTag = featured
    ? `<div class="hero-visual-tag"><span>FIG · 01</span><span>${escapeHtml(figDate)}</span></div>`
    : "";

  const heroVisualHtml = featured ? `<div class="hero-visual">${heroVisualInner}${figTag}</div>` : "";

  const readingTimeMeta = readingTime
    ? `<span class="hero-dot"></span><span>${readingTime} min de lectura</span>`
    : "";

  const ctaHref = featured?.firstUrl ? escapeHtml(featured.firstUrl) : "#article-body";
  const ctaAttrs = featured?.firstUrl ? ` target="_blank" rel="noopener noreferrer"` : "";

  const heroDateText = date ? formatDateEsNoYear(date) : "";

  const heroHtml = featured
    ? `
    <section class="hero">
      <div class="hero-copy">
        <span class="hero-eyebrow">${escapeHtml(featured.category || "Noticia principal")}</span>
        ${heroDateText ? `<div class="hero-date">${escapeHtml(heroDateText)}</div>` : ""}
        <h1 class="hero-headline">${escapeHtml(featured.headline)}</h1>
        <p class="hero-excerpt">${escapeHtml(featured.body)}</p>
        <div class="hero-meta">
          ${date ? `<span>${escapeHtml(formatDateShort(date))}</span>` : ""}
          ${generatedAt ? `<span class="hero-dot"></span><span>${escapeHtml(generatedAt)}</span>` : ""}
          ${readingTimeMeta}
        </div>
        <a class="hero-cta" href="${ctaHref}"${ctaAttrs}>
          <span>Leer la historia</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
        </a>
      </div>
      ${heroVisualHtml}
    </section>`
    : "";

  // Stats row — derived from body + meta
  const storyCount = (body.match(/<h3[\s>]/g) || []).length;
  const sectionCount = (body.match(/<h2[\s>]/g) || []).length;
  const editionsCount = recentCurations.length;
  const statsHtml = featured
    ? `
    <section class="stats">
      <div class="stat-cell">
        <span class="stat-label">Historias</span>
        <span class="stat-value">${storyCount.toString().padStart(2, "0")}</span>
        <span class="stat-sub">en esta edición</span>
      </div>
      <div class="stat-cell">
        <span class="stat-label">Secciones</span>
        <span class="stat-value">${sectionCount.toString().padStart(2, "0")}</span>
        <span class="stat-sub">temáticas cubiertas</span>
      </div>
      <div class="stat-cell">
        <span class="stat-label">Lectura</span>
        <span class="stat-value">${readingTime ?? "—"}${readingTime ? " min" : ""}</span>
        <span class="stat-sub">de principio a fin</span>
      </div>
      <div class="stat-cell">
        <span class="stat-label">Tema activo</span>
        <span class="stat-value stat-value-small">${escapeHtml(featured.category || "General")}</span>
        <span class="stat-sub">${editionsCount} ${editionsCount === 1 ? "edición" : "ediciones"} en archivo</span>
      </div>
    </section>`
    : "";

  const sidebarHtml = hideSidebar ? "" : `<aside class="sidebar side">
        <div id="tocContainer" class="toc-container" hidden>
          <h3 class="sidebar-heading side-h">En esta edición</h3>
          <nav id="tocNav" class="toc-nav toc"></nav>
        </div>
        <div class="recent-section">
          <h3 class="sidebar-heading side-h">Ediciones recientes</h3>
          <div class="recent-list recent">${recentLinks || '<p class="empty-text">Sin ediciones aún</p>'}</div>
          ${sidebarPaginationHtml}
        </div>
      </aside>`;

  // Edition strip meta (shown in the segmented row)
  const editionMeta = date
    ? `EDICIÓN · ${escapeHtml(formatDateShort(date))}${generatedAt ? ` · ACTUALIZADA ${escapeHtml(generatedAt)}` : ""}`
    : "DAILY BRIEF";

  // Feed layout — featured story as #1, then extracted body items
  const feedItems = isHomeOrEdition && featured ? buildFeedItems(body) : [];
  const totalFeedItems = featured ? feedItems.length + 1 : feedItems.length;

  const featuredFeedItem = featured
    ? `<article class="feed-item">
          <div class="feed-index">01</div>
          <div class="feed-body">
            <div class="feed-section-pill">${escapeHtml(featured.category || "Noticia principal")}</div>
            <h3 class="feed-headline"><a href="${ctaHref}"${ctaAttrs}>${escapeHtml(featured.headline)}</a></h3>
            ${featured.body ? `<p class="feed-excerpt">${escapeHtml(featured.body)}</p>` : ""}
            <div class="feed-meta">
              <a href="${ctaHref}" class="feed-readmore"${ctaAttrs}>Leer →</a>
            </div>
          </div>
        </article>`
    : "";

  const feedHtml = totalFeedItems > 0
    ? `<section class="feed-layout" id="feedLayout" hidden>
      <div class="feed-header">
        <div class="feed-eyebrow">FEED · ${totalFeedItems} HISTORIAS</div>
        <h2 class="feed-title">Todas las historias</h2>
      </div>
      <div class="feed-list">
        ${featuredFeedItem}
        ${feedItems.map((item, i) => `<article class="feed-item">
          <div class="feed-index">${String(i + 2).padStart(2, "0")}</div>
          <div class="feed-body">
            <div class="feed-section-pill">${escapeHtml(item.section)}</div>
            <h3 class="feed-headline"><a href="${escapeHtml(item.href)}"${item.href.startsWith("http") ? ` target="_blank" rel="noopener noreferrer"` : ""}>${escapeHtml(item.headline)}</a></h3>
            ${item.excerpt ? `<p class="feed-excerpt">${escapeHtml(item.excerpt)}</p>` : ""}
            <div class="feed-meta">
              <a href="${escapeHtml(item.href)}" class="feed-readmore"${item.href.startsWith("http") ? ` target="_blank" rel="noopener noreferrer"` : ""}>Leer →</a>
            </div>
          </div>
        </article>`).join("\n        ")}
      </div>
    </section>`
    : "";

  // Seg-tabs: "Revista/Feed" switcher on article pages, "Revista/Archivo" nav on archive
  const segTabsHtml = isArchive
    ? `<a href="/" class="seg-tab">Revista</a><a href="/ediciones" class="seg-tab active">Archivo</a>`
    : `<button class="seg-tab active" data-view="revista">Revista</button><button class="seg-tab" data-view="feed">Feed</button>`;

  return `<!DOCTYPE html>
<html lang="es" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <meta name="googlebot" content="noindex, nofollow">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <title>${escapeHtml(title)}</title>
  <link rel="icon" type="image/svg+xml" href="/static/favicon.svg">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Daily Brief">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(ogDescription)}">
  <meta property="og:image" content="${escapeHtml(ogImage)}">
  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(ogDescription)}">
  <meta name="twitter:image" content="${escapeHtml(ogImage)}">
  <!-- Theme init runs synchronously before any CSS is applied to prevent dark mode flash -->
  <script src="/static/theme-init.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/static/style.css">
</head>
<body>
  <div id="readProgress" class="read-progress"></div>

  <nav class="navbar">
    <div class="nav-inner">
      <a href="/" class="brand">
        <span class="brand-dot"></span>
        <span>Daily Brief</span>
      </a>
      <div class="nav-links">
        <a href="/" class="nav-link${inicioActive}">Hoy</a>
        <a href="/ediciones" class="nav-link${archivoActive}">Archivo</a>
      </div>
      <button class="hamburger" id="hamburgerBtn" aria-label="Menú">
        <span></span><span></span><span></span>
      </button>
    </div>
    <div class="segmented">
      <div class="seg-wrap">
        ${segTabsHtml}
      </div>
      <div class="seg-meta">
        <span class="live-dot"></span>
        <span>${editionMeta}</span>
      </div>
      <div class="nav-actions">
        <button id="cmdTrigger" class="pill-btn cmd-trigger" aria-label="Buscar ediciones (⌘K)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="cmd-search-icon"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>
          <span class="cmd-trigger-label">Buscar</span>
          <span class="kbd cmd-trigger-kbd">⌘K</span>
        </button>
        <button id="themeToggle" class="round-btn theme-btn" aria-label="Cambiar tema">
          <svg class="icon-auto" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
          <svg class="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
          <svg class="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
        </button>
      </div>
    </div>
    <div class="mobile-menu" id="mobileMenu">
      <a href="/" class="nav-link${inicioActive}">Hoy</a>
      <a href="/ediciones" class="nav-link${archivoActive}">Archivo</a>
    </div>
  </nav>

  <main class="main mag">
    ${heroHtml}
    ${statsHtml}
    ${feedHtml}
    <div class="content-layout${hideSidebar ? " content-full" : ""}">
      <article class="article-body" id="article-body">${body}</article>
      ${sidebarHtml}
    </div>
    ${navHtml}
  </main>

  <button id="scrollTopBtn" class="scroll-top" aria-label="Volver al inicio">↑</button>

  <!-- Mobile floating TOC -->
  <button id="mobileTocBtn" class="mobile-toc-fab" aria-label="Ver índice de la edición">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/>
    </svg>
  </button>
  <div id="mobileTocPanel" class="mobile-toc-panel" aria-hidden="true">
    <div class="mobile-toc-backdrop" id="mobileTocBackdrop"></div>
    <div class="mobile-toc-sheet">
      <div class="mobile-toc-header">
        <span class="mobile-toc-title">En esta edición</span>
        <button id="mobileTocClose" class="mobile-toc-close" aria-label="Cerrar índice">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <nav id="mobileTocNav" class="mobile-toc-nav"></nav>
    </div>
  </div>

  <footer class="footer">
    <div class="footer-inner footer-in">
      <div class="footer-brand">
        <div class="b"><span class="brand-dot"></span>Daily Brief</div>
        <p>Noticias de tecnología, IA y ciencia, curadas diariamente por un agente editorial.</p>
      </div>
    </div>
    <div class="footer-bot">
      <span class="footer-copy">Hermes Agent · ${new Date().getFullYear()}</span>
      <span>${date ? `Edición ${escapeHtml(formatDateShort(date))}` : "Daily Brief"}</span>
    </div>
  </footer>

  <!-- Command Palette -->
  <div id="cmdOverlay" class="cmd-overlay" role="dialog" aria-modal="true" aria-label="Buscar ediciones">
    <div class="cmd-palette">
      <div class="cmd-search-row">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="cmd-search-icon"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>
        <input type="text" id="cmdInput" class="cmd-input" placeholder="Buscar ediciones..." autocomplete="off" spellcheck="false">
        <kbd class="cmd-esc-hint">Esc</kbd>
      </div>
      <div id="cmdResults" class="cmd-results"></div>
    </div>
  </div>

  <!-- Recent data for command palette (CSP-safe) -->
  <div id="recentData" data-recent="${recentJson}" hidden></div>

  <script src="/static/app.js"></script>
</body>
</html>`;
}
