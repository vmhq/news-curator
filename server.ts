import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { readFile } from "fs/promises";
import { join } from "path";
import {
  CURATIONS_DIR,
  startDirWatcher,
  getCurationFiles,
  getCachedSummary,
  readCuration,
  getSummary,
  extractFeatured,
  extractOgImage,
  allEditionsSidebar,
  findTodayCuration,
  dateFromFileId,
  todayLocal,
  formatDateEs,
} from "./lib/curations.ts";
import { buildPage, escapeHtml } from "./templates/layout.ts";

const app = new Hono();

app.use("/static/*", serveStatic({ root: "./", rewriteRequestPath: (p) => p.replace("/static/", "public/") }));
app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n", 200, { "Content-Type": "text/plain" }));

app.get("/health", (c) => c.json({ status: "ok", uptime: process.uptime() }));

startDirWatcher();

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/", async (c) => {
  const files = await getCurationFiles();

  let targetDate = findTodayCuration(files);
  let isToday = true;

  if (!targetDate && files.length > 0) {
    targetDate = files[0];
    isToday = false;
  }

  if (!targetDate) {
    return c.html(
      buildPage("Daily Brief", `
        <div class="empty-state">
          <div class="empty-icon">📰</div>
          <h2>Daily Brief</h2>
          <p>Las curaciones aparecerán aquí una vez generadas.<br>¡Vuelve pronto!</p>
        </div>
      `, { recentCurations: [] })
    );
  }

  const curation = await readCuration(targetDate);
  if (!curation) {
    return c.html(
      buildPage("Daily Brief", `
        <div class="empty-state">
          <div class="empty-icon">📰</div>
          <h2>Daily Brief</h2>
          <p>Error al leer la curación.</p>
        </div>
      `, { recentCurations: [] })
    );
  }

  const genTimeMatch = curation.raw.match(/\*Generated at (.+?)\*/);
  const generatedAt = genTimeMatch ? genTimeMatch[1] : undefined;
  const featured = extractFeatured(curation.raw);

  let heroImage: string | null = curation.coverImage;
  if (!heroImage && featured?.firstUrl) {
    heroImage = await extractOgImage(featured.firstUrl);
  }

  const sidebarAllFiles = allEditionsSidebar(files);
  const PAGE_SIZE = 8;
  const pageParam = parseInt(c.req.query("p") || "1");
  const sidebarPage = Math.max(1, pageParam);
  const sidebarOffset = (sidebarPage - 1) * PAGE_SIZE;
  const sidebarFiles = sidebarAllFiles.slice(sidebarOffset, sidebarOffset + PAGE_SIZE);
  const sidebarHasMore = sidebarOffset + PAGE_SIZE < sidebarAllFiles.length;
  const sidebarHasPrev = sidebarPage > 1;

  const settled = await Promise.allSettled(
    sidebarFiles.map(async (d) => ({ date: d, summary: await getCachedSummary(d) }))
  );
  const recentCurations = settled
    .filter((r): r is PromiseFulfilledResult<{ date: string; summary: string }> => r.status === "fulfilled")
    .map((r) => r.value);

  const idx = files.indexOf(targetDate);
  const nextDate = idx > 0 ? files[idx - 1] : null;
  const prevDate = idx < files.length - 1 ? files[idx + 1] : null;

  return c.html(
    buildPage(`Daily Brief — ${formatDateEs(targetDate)}`, curation.html, {
      date: targetDate, isToday, generatedAt, recentCurations, prevDate, nextDate, featured, heroImage,
      canonicalPath: isToday ? "/" : `/curacion/${targetDate}`,
      sidebarHasMore, sidebarHasPrev, sidebarPage,
    })
  );
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
    return c.html(
      buildPage("Daily Brief — No encontrada", `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <h2>Edición no encontrada</h2>
          <p>No existe curación para <strong>${escapeHtml(date)}</strong>.</p>
          <a href="/" class="back-link">← Volver a hoy</a>
        </div>
      `, { recentCurations: allEditions.slice(0, 8).map((d) => ({ date: d, summary: d })) })
    );
  }

  const genTimeMatch = curation.raw.match(/\*Generated at (.+?)\*/);
  const generatedAt = genTimeMatch ? genTimeMatch[1] : undefined;
  const featured = extractFeatured(curation.raw);

  let heroImage: string | null = curation.coverImage;
  if (!heroImage && featured?.firstUrl) {
    heroImage = await extractOgImage(featured.firstUrl);
  }

  const allEditions = allEditionsSidebar(files);
  const settled = await Promise.allSettled(
    allEditions.slice(0, 8).map(async (d) => ({ date: d, summary: await getCachedSummary(d) }))
  );
  const recentCurations = settled
    .filter((r): r is PromiseFulfilledResult<{ date: string; summary: string }> => r.status === "fulfilled")
    .map((r) => r.value);

  const idx = files.indexOf(date);
  const nextDate = idx > 0 ? files[idx - 1] : null;
  const prevDate = idx < files.length - 1 ? files[idx + 1] : null;

  return c.html(
    buildPage(`Daily Brief — ${formatDateEs(date)}`, curation.html, {
      date, isToday: dateFromFileId(date) === todayLocal(),
      generatedAt, recentCurations, prevDate, nextDate, featured, heroImage,
      canonicalPath: `/curacion/${date}`,
      sidebarHasMore: allEditions.length > 8, sidebarHasPrev: false, sidebarPage: 1,
    })
  );
});

app.get("/ediciones", async (c) => {
  const files = await getCurationFiles();
  const settled = await Promise.allSettled(
    files.map(async (d) => ({ date: d, summary: await getCachedSummary(d) }))
  );
  const allCurations = settled
    .filter((r): r is PromiseFulfilledResult<{ date: string; summary: string }> => r.status === "fulfilled")
    .map((r) => r.value);

  const listHtml = allCurations.length
    ? allCurations
        .map(
          (cur) => `
    <a href="/curacion/${cur.date}" class="edition-card">
      <div class="edition-meta">
        <span class="edition-date">${escapeHtml(formatDateEs(cur.date))}</span>
        <h3 class="edition-title">${escapeHtml(cur.summary)}</h3>
      </div>
      <span class="edition-arrow">→</span>
    </a>
  `
        )
        .join("\n")
    : '<div class="empty-state"><div class="empty-icon">📋</div><h2>Sin ediciones</h2></div>';

  return c.html(
    buildPage("Daily Brief — Todas las Ediciones", listHtml, {
      recentCurations: allCurations.slice(0, 5),
      canonicalPath: "/ediciones",
      hideSidebar: true,
    })
  );
});

app.get("/api/curations", async (c) => {
  const files = await getCurationFiles();
  const page = Math.max(1, Math.min(1000, parseInt(c.req.query("page") || "1")));
  const limit = Math.max(1, Math.min(50, parseInt(c.req.query("limit") || "10")));
  const start = (page - 1) * limit;
  const paginated = files.slice(start, start + limit);
  const settled = await Promise.allSettled(
    paginated.map(async (d) => ({ date: d, summary: await getCachedSummary(d) }))
  );
  const curations = settled
    .filter((r): r is PromiseFulfilledResult<{ date: string; summary: string }> => r.status === "fulfilled")
    .map((r) => r.value);
  return c.json({ curations, total: files.length, page, totalPages: Math.ceil(files.length / limit) });
});

app.get("/api/search", async (c) => {
  const query = c.req.query("q")?.slice(0, 200).toLowerCase();
  if (!query || query.length < 2) return c.json({ results: [] });
  const files = await getCurationFiles();
  const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const settled = await Promise.allSettled(
    files.map(async (date) => {
      const fc = await readFile(join(CURATIONS_DIR, `${date}.md`), "utf-8");
      const lower = fc.toLowerCase();
      const idx = lower.indexOf(query);
      if (idx === -1) return null;
      const start = Math.max(0, idx - 60);
      const end = Math.min(fc.length, idx + query.length + 60);
      let snippet = fc.slice(start, end).replace(/\n/g, " ").trim();
      if (start > 0) snippet = "..." + snippet;
      if (end < fc.length) snippet += "...";
      snippet = escapeHtml(snippet);
      const highlighted = snippet.replace(new RegExp(`(${safeQuery})`, "gi"), "<mark>$1</mark>");
      const summary = getSummary(fc);
      return { date, snippet: highlighted, summary };
    })
  );
  const results = settled
    .filter((r): r is PromiseFulfilledResult<{ date: string; snippet: string; summary: string } | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter(Boolean);
  return c.json({ results, query });
});

// ─────────────────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT || "8080");
console.log(`📋 Daily Brief corriendo en http://localhost:${port}`);

export default { port, fetch: app.fetch };
