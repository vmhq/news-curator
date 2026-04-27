import type { Hono } from "hono";
import type { AppDeps } from "../lib/app-deps.ts";
import {
  getCachedSummary,
  getCurationFiles,
  getRenderedCuration,
  renderCurationContent,
} from "../lib/curations.ts";
import { extractOgImage } from "../lib/og-images.ts";
import {
  estimateReadingTime,
  extractFeatured,
  validateCurationContent,
} from "../lib/validation.ts";
import {
  allEditionsSidebar,
  dateFromFileId,
  formatDateEs,
  todayLocal,
} from "../lib/dates.ts";
import { isCurationFileId } from "../lib/ids.ts";
import { escapeHtml } from "../lib/html.ts";
import { isDraftId } from "../lib/ids.ts";
import { applyCacheHeaders, makeWeakEtag, maybeReturnNotModified } from "../lib/http-cache.ts";
import { buildPage } from "../templates/layout.ts";
import {
  statEdition,
  draftExists,
  readDraft,
} from "../lib/storage.ts";

const SIDEBAR_PAGE_SIZE = 8;
const PREVIEW_BOT_RE =
  /(TelegramBot|Slackbot|Discordbot|Twitterbot|facebookexternalhit|Facebot|LinkedInBot|WhatsApp|SkypeUriPreview)/i;

function extractGeneratedAt(raw: string): string | undefined {
  const generatedMatch = raw.match(/\*(?:Generated at|Generado .+?)\s(.+?)\*/);
  return generatedMatch?.[1];
}

async function getRecentCurations(files: string[], limit: number) {
  const settled = await Promise.allSettled(
    files.slice(0, limit).map(async (date) => ({ date, summary: await getCachedSummary(date) }))
  );

  return settled
    .filter((result): result is PromiseFulfilledResult<{ date: string; summary: string }> => result.status === "fulfilled")
    .map((result) => result.value);
}

function buildDraftValidationPanel(validation: {
  valid: boolean;
  errors: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
}) {
  const errorItems = validation.errors
    .map((issue) => `<li><strong>${escapeHtml(issue.code)}</strong>: ${escapeHtml(issue.message)}</li>`)
    .join("");
  const warningItems = validation.warnings
    .map((issue) => `<li><strong>${escapeHtml(issue.code)}</strong>: ${escapeHtml(issue.message)}</li>`)
    .join("");

  return `
    <section class="empty-state">
      <h2>Preview de draft</h2>
      <p>Publicable: <strong>${validation.valid ? "si" : "no"}</strong>. Errores: ${validation.errors.length}. Advertencias: ${validation.warnings.length}.</p>
      ${validation.errors.length ? `<h3>Errores</h3><ul>${errorItems}</ul>` : ""}
      ${validation.warnings.length ? `<h3>Advertencias</h3><ul>${warningItems}</ul>` : ""}
    </section>
  `;
}

function getLatestEditionTarget(files: string[]) {
  const todayEdition = files.find((file) => dateFromFileId(file) === todayLocal()) ?? null;
  if (todayEdition) return { targetDate: todayEdition, isToday: true };

  return {
    targetDate: files[0] ?? null,
    isToday: false,
  };
}

async function buildEditionPageContext(
  date: string,
  curation: NonNullable<Awaited<ReturnType<typeof getRenderedCuration>>>,
  files: string[],
  options: { page?: number; pageSize?: number } = {}
) {
  const generatedAt = extractGeneratedAt(curation.raw);
  const featured = extractFeatured(curation.raw);
  const readingTime = estimateReadingTime(curation.raw);

  let heroImage: string | null = curation.coverImage;
  if (!heroImage && featured?.firstUrl) heroImage = await extractOgImage(featured.firstUrl);

  const page = Math.max(1, options.page ?? 1);
  const pageSize = options.pageSize ?? SIDEBAR_PAGE_SIZE;
  const sidebarFiles = allEditionsSidebar(files);
  const sidebarOffset = (page - 1) * pageSize;
  const recentCurations = await getRecentCurations(
    sidebarFiles.slice(sidebarOffset, sidebarOffset + pageSize),
    pageSize
  );

  const idx = files.indexOf(date);
  const nextDate = idx > 0 ? files[idx - 1] : null;
  const prevDate = idx >= 0 && idx < files.length - 1 ? files[idx + 1] : null;

  return {
    generatedAt,
    featured,
    readingTime,
    heroImage,
    recentCurations,
    prevDate,
    nextDate,
    sidebarHasMore: sidebarOffset + pageSize < sidebarFiles.length,
    sidebarHasPrev: page > 1,
    sidebarPage: page,
  };
}

function isPreviewBot(userAgent: string | undefined | null): boolean {
  if (!userAgent) return false;
  return PREVIEW_BOT_RE.test(userAgent);
}

export function registerPublicRoutes(app: Hono, deps: AppDeps) {
  app.get("/latest", async (c) => {
    const files = await getCurationFiles();
    const { targetDate } = getLatestEditionTarget(files);

    if (!targetDate) {
      return c.redirect("/", 302);
    }

    const response = c.redirect(`/curacion/${targetDate}`, 302);
    response.headers.set("Cache-Control", "no-store");
    return response;
  });

  app.get("/", async (c) => {
    const files = await getCurationFiles();
    const { targetDate, isToday } = getLatestEditionTarget(files);

    if (!targetDate) {
      const response = c.html(
        buildPage(
          "Daily Brief",
          `
        <div class="empty-state">
          <div class="empty-icon">📰</div>
          <h2>Daily Brief</h2>
          <p>Las curaciones apareceran aqui una vez generadas.<br>Vuelve pronto.</p>
        </div>
      `,
          { recentCurations: [], siteUrl: deps.config.siteUrl }
        )
      );
      response.headers.set("Cache-Control", "no-store");
      return response;
    }

    if (isPreviewBot(c.req.header("user-agent"))) {
      const response = c.redirect(`/curacion/${targetDate}`, 302);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }

    const curation = await getRenderedCuration(targetDate);
    if (!curation) {
      const response = c.html(
        buildPage(
          "Daily Brief",
          `
        <div class="empty-state">
          <div class="empty-icon">📰</div>
          <h2>Daily Brief</h2>
          <p>Error al leer la curacion.</p>
        </div>
      `,
          { recentCurations: [], siteUrl: deps.config.siteUrl }
        )
      );
      response.headers.set("Cache-Control", "no-store");
      return response;
    }

    const page = Math.max(1, Number.parseInt(c.req.query("p") || "1", 10) || 1);
    const ctx = await buildEditionPageContext(targetDate, curation, files, { page, pageSize: SIDEBAR_PAGE_SIZE });

    const response = c.html(
      buildPage(`Daily Brief — ${formatDateEs(targetDate)}`, curation.html, {
        date: targetDate,
        isToday,
        canonicalPath: isToday ? "/" : `/curacion/${targetDate}`,
        feedItems: curation.feedItems,
        siteUrl: deps.config.siteUrl,
        ...ctx,
      })
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  });

  app.get("/curacion/:date", async (c) => {
    const date = c.req.param("date");
    if (!isCurationFileId(date)) return c.text("Fecha invalida", 400);

    let info: Awaited<ReturnType<typeof statEdition>> | null = null;
    try {
      info = await statEdition(date);
    } catch {
      // file does not exist
    }

    if (info) {
      const etag = makeWeakEtag(date, info.size, info.mtimeMs);
      const notModified = maybeReturnNotModified(c, {
        etag,
        lastModified: info.mtime,
        cacheControl: "private, must-revalidate",
      });
      if (notModified) return notModified;
    }

    const files = await getCurationFiles();
    const curation = await getRenderedCuration(date);

    if (!curation) {
      return c.html(
        buildPage(
          "Daily Brief — No encontrada",
          `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <h2>Edicion no encontrada</h2>
          <p>No existe curacion para <strong>${escapeHtml(date)}</strong>.</p>
          <a href="/" class="back-link">← Volver a hoy</a>
        </div>
      `,
          { recentCurations: (await getRecentCurations(allEditionsSidebar(files), SIDEBAR_PAGE_SIZE)), siteUrl: deps.config.siteUrl }
        ),
        404
      );
    }

    const ctx = await buildEditionPageContext(date, curation, files);

    const response = c.html(
      buildPage(`Daily Brief — ${formatDateEs(date)}`, curation.html, {
        date,
        isToday: dateFromFileId(date) === todayLocal(),
        canonicalPath: `/curacion/${date}`,
        sidebarHasMore: allEditionsSidebar(files).length > SIDEBAR_PAGE_SIZE,
        sidebarHasPrev: false,
        sidebarPage: 1,
        feedItems: curation.feedItems,
        siteUrl: deps.config.siteUrl,
        ...ctx,
      })
    );

    if (info) {
      applyCacheHeaders(response.headers, {
        etag: makeWeakEtag(date, info.size, info.mtimeMs),
        lastModified: info.mtime,
        cacheControl: "private, must-revalidate",
      });
    }

    return response;
  });

  app.get("/ediciones", async (c) => {
    const files = await getCurationFiles();
    const etag = makeWeakEtag("ediciones", ...files);
    const notModified = maybeReturnNotModified(c, {
      etag,
      cacheControl: "private, max-age=60, must-revalidate",
    });
    if (notModified) return notModified;

    const allCurations = await getRecentCurations(files, files.length);
    const listHtml = allCurations.length
      ? allCurations
          .map(
            (curation) => `
    <a href="/curacion/${escapeHtml(curation.date)}" class="edition-card">
      <div class="edition-meta">
        <span class="edition-date">${escapeHtml(formatDateEs(curation.date))}</span>
        <h3 class="edition-title">${escapeHtml(curation.summary)}</h3>
      </div>
      <span class="edition-arrow">→</span>
    </a>
  `
          )
          .join("\n")
      : '<div class="empty-state"><div class="empty-icon">📋</div><h2>Sin ediciones</h2></div>';

    const response = c.html(
      buildPage("Daily Brief — Todas las Ediciones", listHtml, {
        recentCurations: allCurations.slice(0, 5),
        canonicalPath: "/ediciones",
        hideSidebar: true,
        siteUrl: deps.config.siteUrl,
      })
    );
    applyCacheHeaders(response.headers, {
      etag,
      cacheControl: "private, max-age=60, must-revalidate",
    });
    return response;
  });

  app.get("/drafts/:id", async (c) => {
    const draftId = c.req.param("id");
    if (!isDraftId(draftId)) return c.text("Draft invalido", 400);

    if (!draftExists(deps.config.draftsDir, draftId)) return c.text("Draft no encontrado", 404);

    const content = await readDraft(deps.config.draftsDir, draftId);
    if (!content) return c.text("Draft no encontrado", 404);

    const rendered = await renderCurationContent(content);
    const validation = validateCurationContent(content);
    const featured = extractFeatured(content);
    const readingTime = estimateReadingTime(content);
    const validationPanel = buildDraftValidationPanel(validation);

    return c.html(
      buildPage(`Daily Brief — Draft ${draftId.slice(0, 8)}`, `${validationPanel}${rendered.html}`, {
        featured,
        heroImage: rendered.coverImage,
        canonicalPath: `/drafts/${draftId}`,
        hideSidebar: true,
        readingTime,
        siteUrl: deps.config.siteUrl,
      })
    );
  });
}
