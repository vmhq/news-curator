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
  } = {}
): string {
  const {
    date, isToday, generatedAt, recentCurations = [],
    prevDate, nextDate, featured, heroImage,
    canonicalPath = "/",
    sidebarHasMore = false, sidebarHasPrev = false, sidebarPage = 1,
    hideSidebar = false,
  } = meta;

  const canonicalUrl = `${SITE_URL}${canonicalPath}`;
  const ogDescription =
    featured?.body ?? "Noticias de tecnología e inteligencia artificial curadas diariamente por IA.";
  const ogImage = heroImage ?? DEFAULT_COVER;

  const recentLinks = recentCurations
    .map(
      (c) =>
        `<a href="/curacion/${escapeHtml(c.date)}" class="recent-item${c.date === date ? " active" : ""}">
      <span class="recent-date">${escapeHtml(formatDateEs(c.date))}</span>
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

  const heroImageHtml = heroImage
    ? `<div class="hero-image"><img src="${escapeHtml(heroImage)}" alt="${escapeHtml(featured?.headline || "")}" loading="eager" onerror="this.parentElement.innerHTML='<div class=\\'hero-image-placeholder\\'><span class=\\'hero-emoji\\'>📰</span></div>'"></div>`
    : featured
    ? `<div class="hero-image"><div class="hero-image-placeholder"><span class="hero-emoji">📰</span></div></div>`
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
        </div>
      </div>
    </section>`
    : "";

  return `<!DOCTYPE html>
<html lang="es" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <meta name="googlebot" content="noindex, nofollow">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self';">
  <meta http-equiv="X-Frame-Options" content="DENY">
  <meta http-equiv="X-Content-Type-Options" content="nosniff">
  <meta http-equiv="Referrer-Policy" content="strict-origin-when-cross-origin">
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
  <nav class="navbar">
    <div class="nav-inner">
      <a href="/" class="nav-logo">📰 Daily Brief</a>
      <div class="nav-links">
        <a href="/" class="nav-link">Inicio</a>
        <a href="/ediciones" class="nav-link">Ediciones</a>
      </div>
      <div class="nav-actions">
        <div class="search-box">
          <input type="search" id="searchInput" placeholder="Buscar ediciones..." class="search-input" autocomplete="off">
          <div id="searchResults" class="search-dropdown"></div>
        </div>
        <button id="themeToggle" class="theme-btn" aria-label="Modo oscuro">
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
      ${
        hideSidebar
          ? ""
          : `<aside class="sidebar">
        <h3 class="sidebar-heading">Ediciones Recientes</h3>
        <div class="recent-list">${recentLinks || '<p class="empty-text">Sin ediciones aún</p>'}</div>
        ${sidebarPaginationHtml}
      </aside>`
      }
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

  <script src="/static/app.js"></script>
</body>
</html>`;
}
