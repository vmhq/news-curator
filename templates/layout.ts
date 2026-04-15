import { SITE_URL, DEFAULT_COVER, formatDateEs } from "../lib/curations.ts";

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

  // Embed recent curations for the command palette (CSP-safe via data attribute)
  const recentForPalette = recentCurations.slice(0, 6).map(c => ({
    date: c.date,
    summary: c.summary,
    url: `/curacion/${c.date}`,
    dateFormatted: formatDateEs(c.date),
  }));
  // JSON embedded via data attribute — escapeHtml handles safe embedding
  const recentJson = escapeHtml(JSON.stringify(recentForPalette));

  const recentLinks = recentCurations
    .map(
      (c) =>
        `<a href="/curacion/${escapeHtml(c.date)}" class="recent-item${c.date === date ? " active" : ""}">
      <span class="recent-date" data-iso="${escapeHtml(c.date)}">${escapeHtml(formatDateEs(c.date))}</span>
      <span class="recent-headline">${escapeHtml(c.summary)}</span>
    </a>`
    )
    .join("\n");

  const sidebarPaginationHtml =
    sidebarHasPrev || sidebarHasMore
      ? `
    <div class="sidebar-pagination">
      ${sidebarHasPrev ? `<a href="/?p=${sidebarPage - 1}" class="sidebar-page-btn">← Más recientes</a>` : ""}
      ${sidebarHasMore ? `<a href="/?p=${sidebarPage + 1}" class="sidebar-page-btn">Más antiguas →</a>` : ""}
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

  // Hero image — add loading class when there's a real image to show skeleton shimmer
  const heroImageHtml = heroImage
    ? `<div class="hero-image loading" id="heroImageWrap"><img src="${escapeHtml(heroImage)}" alt="${escapeHtml(featured?.headline || "")}" loading="eager" id="heroImg" onerror="this.parentElement.classList.remove('loading');this.parentElement.innerHTML='<div class=\\'hero-image-placeholder\\'><span class=\\'hero-emoji\\'>📰</span></div>'"></div>`
    : featured
    ? `<div class="hero-image"><div class="hero-image-placeholder"><span class="hero-emoji">📰</span></div></div>`
    : "";

  const readingTimeMeta = readingTime
    ? `<span class="hero-dot">·</span><span>${readingTime} min de lectura</span>`
    : "";

  const heroHtml = featured
    ? `
    <section class="hero">
      ${heroImageHtml}
      <div class="hero-content">
        <span class="hero-category">${escapeHtml(featured.category)}</span>
        <h1 class="hero-headline">${escapeHtml(featured.headline)}</h1>
        <p class="hero-excerpt">${escapeHtml(featured.body)}</p>
        <div class="hero-meta">
          ${date ? `<span>${formatDateEs(date)}</span>` : ""}
          ${generatedAt ? `<span class="hero-dot">·</span><span>${escapeHtml(generatedAt)}</span>` : ""}
          ${readingTimeMeta}
        </div>
      </div>
    </section>`
    : "";

  const sidebarHtml = hideSidebar ? "" : `<aside class="sidebar">
        <div id="tocContainer" class="toc-container" hidden>
          <h3 class="sidebar-heading">En esta edición</h3>
          <nav id="tocNav" class="toc-nav"></nav>
        </div>
        <h3 class="sidebar-heading">Ediciones Recientes</h3>
        <div class="recent-list">${recentLinks || '<p class="empty-text">Sin ediciones aún</p>'}</div>
        ${sidebarPaginationHtml}
      </aside>`;

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
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/static/style.css">
</head>
<body>
  <div id="readProgress" class="read-progress"></div>
  <nav class="navbar">
    <div class="nav-inner">
      <a href="/" class="nav-logo">📰 Daily Brief</a>
      <div class="nav-links">
        <a href="/" class="nav-link">Inicio</a>
        <a href="/ediciones" class="nav-link">Ediciones</a>
      </div>
      <div class="nav-actions">
        <button id="cmdTrigger" class="cmd-trigger" aria-label="Buscar ediciones (⌘K)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <span class="cmd-trigger-label">Buscar</span>
          <kbd class="cmd-trigger-kbd">⌘K</kbd>
        </button>
        <button id="themeToggle" class="theme-btn" aria-label="Cambiar tema">
          <svg class="icon-auto" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
          <svg class="icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
          <svg class="icon-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
        </button>
      </div>
      <button class="hamburger" id="hamburgerBtn" aria-label="Menú">
        <span></span><span></span><span></span>
      </button>
    </div>
    <div class="mobile-menu" id="mobileMenu">
      <a href="/" class="nav-link">Inicio</a>
      <a href="/ediciones" class="nav-link">Ediciones</a>
    </div>
  </nav>

  <main class="main">
    ${heroHtml}
    <div class="content-layout${hideSidebar ? " content-full" : ""}">
      <article class="article-body">${body}</article>
      ${sidebarHtml}
    </div>
    ${navHtml}
  </main>

  <button id="scrollTopBtn" class="scroll-top" aria-label="Volver al inicio">↑</button>

  <footer class="footer">
    <div class="footer-inner">
      <span>📰 Daily Brief — Noticias curadas por IA, entregadas diariamente.</span>
      <span class="footer-copy">Creado con 🤖 por Hermes Agent</span>
    </div>
  </footer>

  <!-- Command Palette -->
  <div id="cmdOverlay" class="cmd-overlay" role="dialog" aria-modal="true" aria-label="Buscar ediciones">
    <div class="cmd-palette">
      <div class="cmd-search-row">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="cmd-search-icon"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
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
