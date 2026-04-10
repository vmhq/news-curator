import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { marked, Renderer } from "marked";
import { readdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Custom renderer: open links in new tab
const renderer = new Renderer();
renderer.link = function({ href, text }: { href: string; text: string }) {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
};
marked.use({ renderer });

const app = new Hono();
const CURATIONS_DIR = "/home/ai/llm-wiki/raw/curations";
const SITE_URL = "https://dailyb.vmhq.cl";

app.use("/static/*", serveStatic({ root: "./", rewriteRequestPath: (p) => p.replace("/static/", "public/") }));
app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n", 200, { "Content-Type": "text/plain" }));

async function getCurationFiles(): Promise<string[]> {
  if (!existsSync(CURATIONS_DIR)) return [];
  const files = await readdir(CURATIONS_DIR);
  return files.filter((f) => f.endsWith(".md")).map((f) => f.replace(".md", "")).sort().reverse();
}

async function readCuration(date: string): Promise<{ raw: string; html: string; coverImage: string | null } | null> {
  const filePath = join(CURATIONS_DIR, `${date}.md`);
  if (!existsSync(filePath)) return null;
  const raw = await readFile(filePath, "utf-8");
  // Extract cover image from frontmatter
  const coverMatch = raw.match(/image_url:\s*["']?([^"'\n]+)["']?/);
  const coverImage = coverMatch ? coverMatch[1].trim() : null;
  // Strip frontmatter, H1, timestamp
  let display = raw;
  display = display.replace(/^---\n[\s\S]*?\n---\n+/, "");
  display = display.replace(/^# .+\n+/, "");
  display = display.replace(/^\*Generado .+\*\n+/, "");
  display = display.replace(/^---\n+/, "");
  const html = await marked.parse(display);
  return { raw, html, coverImage };
}

function getSummary(content: string): string {
  // Strip frontmatter first
  const clean = content.replace(/^---\n[\s\S]*?\n---\n*/, "");
  const h3 = clean.match(/^### (.+)$/m);
  if (h3) return h3[1].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\S+$/, "").trimEnd() || h3[1].slice(0, 80);
  const h2 = clean.match(/^## (.+)$/m);
  if (h2) {
    const text = h2[1].replace(/^[^\w]*/, "");
    return text.length > 80 ? text.slice(0, 80).replace(/\S+$/, "").trimEnd() + "…" : text;
  }
  return "Curación diaria";
}

const TZ = "America/Santiago";

function todayLocal(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: TZ }); // YYYY-MM-DD
}

function dateFromFileId(id: string): string {
  return id.replace(/_\d{2}-\d{2}$/, "");
}

function findTodayCuration(files: string[]): string | null {
  const today = todayLocal();
  const todayFiles = files.filter((f) => dateFromFileId(f) === today);
  return todayFiles.length > 0 ? todayFiles[0] : null; // files sorted desc, so first = most recent
}

// Group files by date — for sidebar we show all editions
function groupByDay(files: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const day = dateFromFileId(f);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(f);
  }
  return groups;
}

// Flatten grouped files for sidebar — show all editions, sorted desc
function allEditionsSidebar(files: string[]): string[] {
  // files is already sorted desc, just return as-is
  return files;
}

function formatDateEs(dateStr: string): string {
  const cleanDate = dateFromFileId(dateStr);
  const dt = new Date(cleanDate + "T12:00:00");
  const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const dateFormatted = `${days[dt.getDay()]} ${dt.getDate()} de ${months[dt.getMonth()]} de ${dt.getFullYear()}`;
  // Check for time suffix like _22-21
  const timeMatch = dateStr.match(/_(\d{2})-(\d{2})$/);
  if (timeMatch) {
    return `${dateFormatted} (${timeMatch[1]}:${timeMatch[2]})`;
  }
  return dateFormatted;
}

// Extract featured story info from markdown content
function extractFeatured(content: string): { category: string; headline: string; body: string; firstUrl: string | null } | null {
  // Match: ## 🔥 Featured Story: TITLE\n\nBODY...
  const match = content.match(/## 🔥(?:\s*Featured Story:\s*)?(.+?)\n\n([\s\S]*?)(?=\n---|\n## [^🔥])/);
  if (!match) return null;
  const headline = match[1].trim().replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // First paragraph as excerpt (all text before first blank line)
  const rawBody = match[2].trim().split("\n\n")[0].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const body = rawBody.length > 280
    ? rawBody.slice(0, 280).replace(/\S+$/, "").trimEnd() + "…"
    : rawBody;
  // Extract first URL from the body
  const urlMatch = match[2].match(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/);
  const firstUrl = urlMatch ? urlMatch[2] : null;
  return { category: "Noticia Principal", headline, body, firstUrl };
}

const DEFAULT_COVER = `${SITE_URL}/static/cover.svg`;

// Known logo/icon patterns that shouldn't be used as cover images
const LOGO_PATTERNS = [
  /\/logo\./i, /\/icon\./i, /\/favicon/i, /\/apple-touch/i,
  /opengraph.*logo/i, /og-logo/i, /brand.*logo/i,
  /logo-seo/i, /logo\.svg/i, /logo\.png/i,
];

function isGoodOgImage(imgUrl: string): boolean {
  // Reject if it matches known logo patterns
  if (LOGO_PATTERNS.some(p => p.test(imgUrl))) return false;
  // Reject if it's a tiny image (contains size hints in URL)
  if (/\/\d{1,2}x\d{1,2}/.test(imgUrl)) return false;
  // Reject very short URLs that are likely site-level defaults
  if (/favicon\.ico$/i.test(imgUrl)) return false;
  return true;
}

// Try to extract og:image from a URL (with timeout)
async function extractOgImage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DailyBrief/1.0)" },
    });
    clearTimeout(timeout);
    const html = await resp.text();
    // Try og:image
    const ogMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
                    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    if (ogMatch && isGoodOgImage(ogMatch[1])) return ogMatch[1];
    // Try twitter:image
    const twMatch = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i) ||
                    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i);
    if (twMatch && isGoodOgImage(twMatch[1])) return twMatch[1];
    return null;
  } catch {
    return null;
  }
}

function buildPage(title: string, body: string, meta: {
  date?: string; isToday?: boolean; generatedAt?: string;
  recentCurations?: Array<{ date: string; summary: string }>;
  prevDate?: string | null; nextDate?: string | null;
  featured?: { category: string; headline: string; body: string; firstUrl?: string | null } | null;
  heroImage?: string | null;
  canonicalPath?: string;
  sidebarHasMore?: boolean; sidebarHasPrev?: boolean; sidebarPage?: number;
  hideSidebar?: boolean;
} = {}): string {
  const { date, isToday, generatedAt, recentCurations = [], prevDate, nextDate, featured, heroImage, canonicalPath = "/", sidebarHasMore = false, sidebarHasPrev = false, sidebarPage = 1, hideSidebar = false } = meta;
  const canonicalUrl = `${SITE_URL}${canonicalPath}`;
  const ogDescription = featured?.body ?? "Noticias de tecnología e inteligencia artificial curadas diariamente por IA.";
  const ogImage = heroImage ?? DEFAULT_COVER;

  const recentLinks = recentCurations.map((c) =>
    `<a href="/curacion/${escapeHtml(c.date)}" class="recent-item${c.date === date ? " active" : ""}">
      <span class="recent-date">${escapeHtml(formatDateEs(c.date))}</span>
      <span class="recent-headline">${escapeHtml(c.summary)}</span>
    </a>`
  ).join("\n");

  const sidebarPaginationHtml = (sidebarHasPrev || sidebarHasMore) ? `
    <div class="sidebar-pagination">
      ${sidebarHasPrev ? `<a href="/?p=${sidebarPage - 1}" class="sidebar-page-btn">← Más recientes</a>` : ''}
      ${sidebarHasMore ? `<a href="/?p=${sidebarPage + 1}" class="sidebar-page-btn">Más antiguas →</a>` : ''}
    </div>` : "";

  const navHtml = (prevDate || nextDate) ? `
    <div class="pagination">
      ${prevDate ? `<a href="/curacion/${escapeHtml(prevDate)}" class="page-btn">← Anterior</a>` : '<span class="page-btn disabled">← Anterior</span>'}
      ${nextDate ? `<a href="/curacion/${escapeHtml(nextDate)}" class="page-btn">Siguiente →</a>` : '<span class="page-btn disabled">Siguiente →</span>'}
    </div>` : "";

  const heroImageHtml = heroImage
    ? `<div class="hero-image"><img src="${escapeHtml(heroImage)}" alt="${escapeHtml(featured?.headline || '')}" loading="eager" onerror="this.parentElement.innerHTML='<div class=\\'hero-image-placeholder\\'><span class=\\'hero-emoji\\'>📰</span></div>'"></div>`
    : featured ? `<div class="hero-image"><div class="hero-image-placeholder"><span class="hero-emoji">📰</span></div></div>` : '';

  const heroHtml = featured ? `
    <section class="hero">
      ${heroImageHtml}
      <div class="hero-content">
        <span class="hero-category">${escapeHtml(featured.category)}</span>
        <h1 class="hero-headline">${escapeHtml(featured.headline)}</h1>
        <p class="hero-excerpt">${escapeHtml(featured.body)}</p>
        <div class="hero-meta">
          ${date ? `<span>${formatDateEs(date)}</span>` : ""}
          ${generatedAt ? `<span class="hero-dot">·</span><span>${generatedAt}</span>` : ""}
        </div>
      </div>
    </section>` : "";

  return `<!DOCTYPE html>
<html lang="es" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <meta name="googlebot" content="noindex, nofollow">
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
    <div class="content-layout${hideSidebar ? ' content-full' : ''}">
      <article class="article-body">${body}</article>
      ${hideSidebar ? '' : `<aside class="sidebar">
        <h3 class="sidebar-heading">Ediciones Recientes</h3>
        <div class="recent-list">${recentLinks || '<p class="empty-text">Sin ediciones aún</p>'}</div>
        ${sidebarPaginationHtml}
      </aside>`}
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

// Routes
app.get("/", async (c) => {
  const files = await getCurationFiles();

  // Find most recent curation for today
  let targetDate = findTodayCuration(files);
  let isToday = true;

  if (!targetDate && files.length > 0) {
    targetDate = files[0];
    isToday = false;
  }

  if (!targetDate) {
    return c.html(buildPage("Daily Brief", `
      <div class="empty-state">
        <div class="empty-icon">📰</div>
        <h2>Daily Brief</h2>
        <p>Las curaciones aparecerán aquí una vez generadas.<br>¡Vuelve pronto!</p>
      </div>
    `, { recentCurations: [] }));
  }

  const curation = await readCuration(targetDate);
  if (!curation) {
    return c.html(buildPage("Daily Brief", `
      <div class="empty-state">
        <div class="empty-icon">📰</div>
        <h2>Daily Brief</h2>
        <p>Error al leer la curación.</p>
      </div>
    `, { recentCurations: [] }));
  }

  const genTimeMatch = curation.raw.match(/\*Generated at (.+?)\*/);
  const generatedAt = genTimeMatch ? genTimeMatch[1] : undefined;
  const featured = extractFeatured(curation.raw);

  // Try to get hero image: frontmatter cover > extracted og:image > fallback
  let heroImage: string | null = curation.coverImage;
  if (!heroImage && featured?.firstUrl) {
    heroImage = await extractOgImage(featured.firstUrl);
  }

  // Sidebar — show ALL editions (including multiple per day)
  const sidebarAllFiles = allEditionsSidebar(files);
  const PAGE_SIZE = 8;
  const pageParam = parseInt(c.req.query("p") || "1");
  const sidebarPage = Math.max(1, pageParam);
  const sidebarOffset = (sidebarPage - 1) * PAGE_SIZE;
  const sidebarFiles = sidebarAllFiles.slice(sidebarOffset, sidebarOffset + PAGE_SIZE);
  const sidebarHasMore = sidebarOffset + PAGE_SIZE < sidebarAllFiles.length;
  const sidebarHasPrev = sidebarPage > 1;

  const recentCurations = await Promise.all(
    sidebarFiles.map(async (d) => {
      const fc = await readFile(join(CURATIONS_DIR, `${d}.md`), "utf-8");
      return { date: d, summary: getSummary(fc) };
    })
  );

  const idx = files.indexOf(targetDate);
  const nextDate = idx > 0 ? files[idx - 1] : null;
  const prevDate = idx < files.length - 1 ? files[idx + 1] : null;

  return c.html(buildPage(`Daily Brief — ${formatDateEs(targetDate)}`, curation.html, {
    date: targetDate, isToday, generatedAt, recentCurations, prevDate, nextDate, featured, heroImage,
    canonicalPath: isToday ? "/" : `/curacion/${targetDate}`,
    sidebarHasMore, sidebarHasPrev, sidebarPage,
  }));
});

app.get("/curacion/:date", async (c) => {
  const date = c.req.param("date");
  if (!/^\d{4}-\d{2}-\d{2}(_\d{2}-\d{2})?$/.test(date)) {
    return c.text("Fecha inválida", 400);
  }
  const files = await getCurationFiles();
  const curation = await readCuration(date);

  if (!curation) {
    const allEditions = allEditionsSidebar(files);
    return c.html(buildPage("Daily Brief — No encontrada", `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <h2>Edición no encontrada</h2>
        <p>No existe curación para <strong>${escapeHtml(date)}</strong>.</p>
        <a href="/" class="back-link">← Volver a hoy</a>
      </div>
    `, { recentCurations: allEditions.slice(0, 8).map((d) => ({ date: d, summary: d })) }));
  }

  const genTimeMatch = curation.raw.match(/\*Generated at (.+?)\*/);
  const generatedAt = genTimeMatch ? genTimeMatch[1] : undefined;
  const featured = extractFeatured(curation.raw);

  let heroImage: string | null = curation.coverImage;
  if (!heroImage && featured?.firstUrl) {
    heroImage = await extractOgImage(featured.firstUrl);
  }

  const allEditions = allEditionsSidebar(files);
  const recentCurations = await Promise.all(
    allEditions.slice(0, 8).map(async (d) => {
      const fc = await readFile(join(CURATIONS_DIR, `${d}.md`), "utf-8");
      return { date: d, summary: getSummary(fc) };
    })
  );

  const idx = files.indexOf(date);
  const nextDate = idx > 0 ? files[idx - 1] : null;
  const prevDate = idx < files.length - 1 ? files[idx + 1] : null;

  return c.html(buildPage(`Daily Brief — ${formatDateEs(date)}`, curation.html, {
    date, isToday: dateFromFileId(date) === todayLocal(),
    generatedAt, recentCurations, prevDate, nextDate, featured, heroImage,
    canonicalPath: `/curacion/${date}`,
    sidebarHasMore: allEditions.length > 8, sidebarHasPrev: false, sidebarPage: 1,
  }));
});

app.get("/ediciones", async (c) => {
  const files = await getCurationFiles();
  const allCurations = await Promise.all(
    files.map(async (d) => {
      const fc = await readFile(join(CURATIONS_DIR, `${d}.md`), "utf-8");
      return { date: d, summary: getSummary(fc) };
    })
  );

  const listHtml = allCurations.length ? allCurations.map((cur) => `
    <a href="/curacion/${cur.date}" class="edition-card">
      <div class="edition-meta">
        <span class="edition-date">${formatDateEs(cur.date)}</span>
        <h3 class="edition-title">${cur.summary}</h3>
      </div>
      <span class="edition-arrow">→</span>
    </a>
  `).join("\n") : '<div class="empty-state"><div class="empty-icon">📋</div><h2>Sin ediciones</h2></div>';

  return c.html(buildPage("Daily Brief — Todas las Ediciones", listHtml, { recentCurations: allCurations.slice(0, 5), canonicalPath: "/ediciones", hideSidebar: true }));
});

app.get("/api/curations", async (c) => {
  const files = await getCurationFiles();
  const page = Math.max(1, Math.min(1000, parseInt(c.req.query("page") || "1")));
  const limit = Math.max(1, Math.min(50, parseInt(c.req.query("limit") || "10")));
  const start = (page - 1) * limit;
  const paginated = files.slice(start, start + limit);
  const curations = await Promise.all(
    paginated.map(async (d) => {
      const fc = await readFile(join(CURATIONS_DIR, `${d}.md`), "utf-8");
      return { date: d, summary: getSummary(fc) };
    })
  );
  return c.json({ curations, total: files.length, page, totalPages: Math.ceil(files.length / limit) });
});

app.get("/api/search", async (c) => {
  const query = c.req.query("q")?.slice(0, 200).toLowerCase();
  if (!query || query.length < 2) return c.json({ results: [] });
  const files = await getCurationFiles();
  const results: Array<{ date: string; snippet: string; summary: string }> = [];
  for (const date of files) {
    const fc = await readFile(join(CURATIONS_DIR, `${date}.md`), "utf-8");
    const lower = fc.toLowerCase();
    const idx = lower.indexOf(query);
    if (idx !== -1) {
      const start = Math.max(0, idx - 60);
      const end = Math.min(fc.length, idx + query.length + 60);
      let snippet = fc.slice(start, end).replace(/\n/g, " ").trim();
      if (start > 0) snippet = "..." + snippet;
      if (end < fc.length) snippet += "...";
      snippet = escapeHtml(snippet);
      const highlighted = snippet.replace(
        new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"),
        "<mark>$1</mark>"
      );
      results.push({ date, snippet: highlighted, summary: getSummary(fc) });
    }
  }
  return c.json({ results, query });
});

const port = parseInt(process.env.PORT || "8080");
console.log(`📋 Daily Brief corriendo en http://localhost:${port}`);

export default { port, fetch: app.fetch };
