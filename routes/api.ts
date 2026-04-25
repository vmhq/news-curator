import { existsSync } from "fs";
import { mkdir, readFile, readdir, stat, writeFile } from "fs/promises";
import { basename, join } from "path";
import type { Context, Hono, Next } from "hono";
import type { AppDeps } from "../lib/app-deps.ts";
import { renderLineDiff } from "../lib/diff.ts";
import { checkImageUrl, parseFrontmatter, serializeFrontmatter, validateImageUrl } from "../lib/frontmatter.ts";
import {
  CURATIONS_DIR,
  getCachedSummary,
  getCurationFiles,
  invalidateCurationCache,
  invalidateFilesCache,
  isCurationFileId,
  searchCurations,
  type CurationValidationResult,
  validateCurationContent,
} from "../lib/curations.ts";
import { escapeHtml } from "../lib/html.ts";
import { applyCacheHeaders, makeWeakEtag, maybeReturnNotModified } from "../lib/http-cache.ts";
import { isDraftId, isVersionId } from "../lib/ids.ts";
import { logEvent } from "../lib/logging.ts";
import { incrementCounter } from "../lib/observability.ts";
import { getRequestIp } from "../lib/rate-limit.ts";
import { cleanupExpiredDrafts, trimVersionHistory } from "../lib/retention.ts";

function editionIdFromNow(): string {
  const now = new Date();
  const date = now.toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
  const time = now
    .toLocaleTimeString("sv-SE", {
      timeZone: "America/Santiago",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(":", "-");
  return `${date}_${time}`;
}

function versionTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function readRequestContent(c: Context): Promise<string | Response> {
  const contentType = c.req.header("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await c.req.json();
    if (typeof body.content !== "string") {
      return c.json({ error: "Missing 'content' field" }, 400);
    }
    return body.content;
  }
  return c.req.text();
}

async function saveVersionSnapshot(date: string, content: string, reason: string, deps: AppDeps) {
  const safeReason = reason.replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "edit";
  const dir = join(deps.config.versionsDir, date);
  await mkdir(dir, { recursive: true });
  const filename = `${versionTimestamp()}-${safeReason}.md`;
  await writeFile(join(dir, filename), content, "utf-8");
  await trimVersionHistory(date, deps.config);
  logEvent("curation.version_saved", { edition: date, version: filename, reason: safeReason });
}

async function publishCurationContent(
  content: string,
  deps: AppDeps,
  options: {
    metric: Parameters<typeof incrementCounter>[0];
    event: string;
    extraLog?: Record<string, unknown>;
    extraResponse?: Record<string, unknown>;
  }
): Promise<{ status: number; body: Record<string, unknown>; validation: CurationValidationResult } | { status: number; body: Record<string, unknown> }> {
  if (content.length < 10 || content.length > 1_000_000) {
    return { status: 400, body: { error: "Content length out of range (10–1_000_000 chars)" } };
  }

  const validation = validateCurationContent(content);
  if (!validation.valid) {
    return { status: 422, body: { error: "Validation failed", validation }, validation };
  }

  const editionId = editionIdFromNow();
  await mkdir(CURATIONS_DIR, { recursive: true });
  await writeFile(join(CURATIONS_DIR, `${editionId}.md`), content, "utf-8");
  invalidateFilesCache();
  incrementCounter(options.metric);

  const warning = await checkImageUrl(content, deps.config);
  logEvent(options.event, { ...options.extraLog, edition: editionId, warnings: validation.warnings.length });
  const body: Record<string, unknown> = {
    success: true,
    ...options.extraResponse,
    edition: editionId,
    url: `/curacion/${editionId}`,
    validation,
  };
  if (warning) body.warning = warning;
  return { status: 201, body, validation };
}

function createRateLimitMiddleware(deps: AppDeps, bucket: keyof AppDeps["config"]["rateLimits"]) {
  return async (c: Context, next: Next) => {
    const ip = getRequestIp(c);
    const result = deps.rateLimiter.hit(bucket, ip, deps.config.rateLimits[bucket]);
    if (result.limited) {
      incrementCounter("rateLimited");
      c.header("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
      return c.json({ error: "Too many requests" }, 429);
    }
    await next();
  };
}

function withApiKey(deps: AppDeps, disabledMessage: string) {
  return async (c: Context, next: Next) => deps.apiKeyGuard.requireApiKey(c, next, disabledMessage);
}

export function registerApiRoutes(app: Hono, deps: AppDeps) {
  const limitSearch = createRateLimitMiddleware(deps, "search");
  const limitImages = createRateLimitMiddleware(deps, "images");
  const limitPublish = createRateLimitMiddleware(deps, "publish");
  const limitDrafts = createRateLimitMiddleware(deps, "drafts");
  const limitEdits = createRateLimitMiddleware(deps, "edits");

  app.get("/api/curations", async (c) => {
    const files = await getCurationFiles();
    const limit = Math.max(1, Math.min(50, Number.parseInt(c.req.query("limit") || "10", 10) || 10));

    const before = c.req.query("before");
    if (before) {
      if (!isCurationFileId(before)) {
        return c.json({ error: "Invalid 'before' cursor format (expected YYYY-MM-DD or YYYY-MM-DD_HH-MM)" }, 400);
      }
      const subset = files.filter((file) => file < before).slice(0, limit);
      const etag = makeWeakEtag("api-curations-before", before, limit, ...subset);
      const notModified = maybeReturnNotModified(c, {
        etag,
        cacheControl: "private, max-age=60, must-revalidate",
      });
      if (notModified) return notModified;

      const curations = await Promise.all(
        subset.map(async (date) => ({ date, summary: await getCachedSummary(date) }))
      );
      const nextCursor = curations.length === limit ? curations.at(-1)?.date ?? null : null;
      const response = c.json({ curations, nextCursor, total: files.length });
      applyCacheHeaders(response.headers, {
        etag,
        cacheControl: "private, max-age=60, must-revalidate",
      });
      return response;
    }

    const page = Math.max(1, Math.min(1000, Number.parseInt(c.req.query("page") || "1", 10) || 1));
    const start = (page - 1) * limit;
    const subset = files.slice(start, start + limit);
    const etag = makeWeakEtag("api-curations-page", page, limit, ...subset);
    const notModified = maybeReturnNotModified(c, {
      etag,
      cacheControl: "private, max-age=60, must-revalidate",
    });
    if (notModified) return notModified;

    const curations = await Promise.all(
      subset.map(async (date) => ({ date, summary: await getCachedSummary(date) }))
    );
    const nextCursor = start + limit < files.length ? files[start + limit] ?? null : null;
    const response = c.json({
      curations,
      total: files.length,
      page,
      totalPages: Math.ceil(files.length / limit),
      nextCursor,
    });
    applyCacheHeaders(response.headers, {
      etag,
      cacheControl: "private, max-age=60, must-revalidate",
    });
    return response;
  });

  app.get("/api/curations/:date", async (c) => {
    const date = c.req.param("date");
    if (!isCurationFileId(date)) return c.json({ error: "Invalid edition ID format" }, 400);

    const filePath = join(CURATIONS_DIR, `${date}.md`);
    if (!existsSync(filePath)) return c.json({ error: "Edition not found" }, 404);

    const info = await stat(filePath);
    const etag = makeWeakEtag(date, info.size, info.mtimeMs);
    const notModified = maybeReturnNotModified(c, {
      etag,
      lastModified: info.mtime,
      cacheControl: "private, must-revalidate",
    });
    if (notModified) return notModified;

    const content = await readFile(filePath, "utf-8");
    const response = c.json({ edition: date, content });
    applyCacheHeaders(response.headers, {
      etag,
      lastModified: info.mtime,
      cacheControl: "private, must-revalidate",
    });
    return response;
  });

  app.use("/api/search", limitSearch);
  app.get("/api/search", async (c) => {
    incrementCounter("searches");
    const query = c.req.query("q")?.slice(0, 200).toLowerCase();
    if (!query || query.length < 2) return c.json({ results: [] });

    const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const results = (await searchCurations(query, 20)).map((result) => {
      const snippet = escapeHtml(result.snippet);
      const highlighted = snippet.replace(new RegExp(`(${safeQuery})`, "gi"), "<mark>$1</mark>");
      return { date: result.date, snippet: highlighted, summary: result.summary };
    });

    const response = c.json({ results, query });
    response.headers.set("Cache-Control", "no-store");
    return response;
  });

  app.use("/api/images", withApiKey(deps, "Upload endpoint disabled: API_KEY not configured"));
  app.use("/api/images", limitImages);
  app.post("/api/images", async (c) => {
    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json({ error: "Request must be multipart/form-data" }, 400);
    }

    const file = formData.get("image");
    if (!(file instanceof File)) return c.json({ error: "Missing 'image' file field" }, 400);
    if (!deps.config.allowedImageTypes.has(file.type)) {
      return c.json({ error: `Tipo no permitido: ${file.type}. Permitidos: jpeg, png, webp, gif, avif` }, 400);
    }
    if (file.size > deps.config.maxImageSize) {
      return c.json({
        error: `Imagen demasiado grande (max ${Math.round(deps.config.maxImageSize / 1024 / 1024)} MB, recibido ${(file.size / 1024 / 1024).toFixed(1)} MB)`,
      }, 400);
    }

    const ext = deps.config.imageExt[file.type];
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    await mkdir(deps.config.uploadsDir, { recursive: true });
    await writeFile(join(deps.config.uploadsDir, filename), Buffer.from(await file.arrayBuffer()));
    incrementCounter("uploads");

    return c.json({ success: true, url: `/static/uploads/${filename}` }, 201);
  });

  app.use("/api/validate", withApiKey(deps, "Validate endpoint disabled: API_KEY not configured"));
  app.post("/api/validate", async (c) => {
    const contentOrResponse = await readRequestContent(c);
    if (contentOrResponse instanceof Response) return contentOrResponse;
    const validation = validateCurationContent(contentOrResponse);
    logEvent("curation.validated", {
      valid: validation.valid,
      errors: validation.errors.length,
      warnings: validation.warnings.length,
    });
    return c.json({ valid: validation.valid, validation }, validation.valid ? 200 : 422);
  });

  app.use("/api/publish", withApiKey(deps, "Publish endpoint disabled: API_KEY not configured"));
  app.use("/api/publish", limitPublish);
  app.post("/api/publish", async (c) => {
    const contentType = c.req.header("Content-Type") ?? "";
    let content: string;

    if (contentType.includes("application/json")) {
      const body = await c.req.json();
      if (typeof body.draft_id === "string") {
        const draftId = body.draft_id;
        if (!isDraftId(draftId)) return c.json({ error: "Invalid draft_id" }, 400);
        const draftPath = join(deps.config.draftsDir, `${draftId}.md`);
        if (!existsSync(draftPath)) return c.json({ error: "Draft not found" }, 404);
        content = await readFile(draftPath, "utf-8");
      } else if (typeof body.content === "string") {
        content = body.content;
      } else {
        return c.json({ error: "Missing 'content' or 'draft_id' field" }, 400);
      }
    } else {
      content = await c.req.text();
    }

    const published = await publishCurationContent(content, deps, {
      metric: "publishes",
      event: "curation.published",
    });
    if (published.status === 422 && "validation" in published) {
      logEvent("curation.publish_rejected", {
        errors: published.validation.errors.length,
        warnings: published.validation.warnings.length,
      });
    }
    if (published.status !== 201) return c.json(published.body, published.status as 400 | 422);
    await cleanupExpiredDrafts(deps.config);
    return c.json(published.body, 201);
  });

  app.use("/api/drafts", withApiKey(deps, "Draft endpoint disabled: API_KEY not configured"));
  app.use("/api/drafts", limitDrafts);
  app.use("/api/drafts/*", withApiKey(deps, "Draft endpoint disabled: API_KEY not configured"));
  app.use("/api/drafts/*", limitDrafts);

  app.get("/api/drafts/recent", async (c) => {
    if (!existsSync(deps.config.draftsDir)) return c.json({ draft: null });

    const files = (await readdir(deps.config.draftsDir)).filter((file) => file.endsWith(".md"));
    if (files.length === 0) return c.json({ draft: null });

    const sorted = await Promise.all(
      files.map(async (file) => ({
        file,
        info: await stat(join(deps.config.draftsDir, file)),
      }))
    );
    sorted.sort((left, right) => right.info.mtimeMs - left.info.mtimeMs);

    const latest = sorted[0];
    if (!latest) return c.json({ draft: null });

    const draftId = latest.file.replace(/\.md$/, "");
    const content = await readFile(join(deps.config.draftsDir, latest.file), "utf-8");
    return c.json({
      draft: draftId,
      previewUrl: `/drafts/${draftId}`,
      updatedAt: latest.info.mtime.toISOString(),
      validation: validateCurationContent(content),
    });
  });

  app.post("/api/drafts", async (c) => {
    const contentOrResponse = await readRequestContent(c);
    if (contentOrResponse instanceof Response) return contentOrResponse;

    const validation = validateCurationContent(contentOrResponse);
    if (!validation.valid) {
      logEvent("draft.rejected", {
        errors: validation.errors.length,
        warnings: validation.warnings.length,
      });
      return c.json({ error: "Validation failed", validation }, 422);
    }

    const draftId = crypto.randomUUID();
    await mkdir(deps.config.draftsDir, { recursive: true });
    await writeFile(join(deps.config.draftsDir, `${draftId}.md`), contentOrResponse, "utf-8");
    incrementCounter("draftCreates");
    await cleanupExpiredDrafts(deps.config);

    logEvent("draft.created", { draft: draftId, warnings: validation.warnings.length });
    return c.json(
      {
        success: true,
        draft: draftId,
        previewUrl: `/drafts/${draftId}`,
        publish: { method: "POST", path: "/api/publish", body: { draft_id: draftId } },
        validation,
      },
      201
    );
  });

  app.get("/api/drafts/:id", async (c) => {
    const draftId = c.req.param("id");
    if (!isDraftId(draftId)) return c.json({ error: "Invalid draft ID" }, 400);

    const draftPath = join(deps.config.draftsDir, `${draftId}.md`);
    if (!existsSync(draftPath)) return c.json({ error: "Draft not found" }, 404);

    const content = await readFile(draftPath, "utf-8");
    return c.json({ draft: draftId, content, validation: validateCurationContent(content) });
  });

  app.post("/api/drafts/:id/publish", async (c) => {
    const draftId = c.req.param("id");
    if (!isDraftId(draftId)) return c.json({ error: "Invalid draft ID" }, 400);

    const draftPath = join(deps.config.draftsDir, `${draftId}.md`);
    if (!existsSync(draftPath)) return c.json({ error: "Draft not found" }, 404);

    const content = await readFile(draftPath, "utf-8");
    const published = await publishCurationContent(content, deps, {
      metric: "draftPublishes",
      event: "draft.published",
      extraLog: { draft: draftId },
      extraResponse: { draft: draftId },
    });
    return c.json(published.body, published.status as 201 | 400 | 422);
  });

  app.use("/api/curations/:date", async (c, next) => {
    if (c.req.method === "GET") return next();
    return deps.apiKeyGuard.requireApiKey(c, next, "Edit endpoint disabled: API_KEY not configured");
  });
  app.use("/api/curations/:date", async (c, next) => {
    if (c.req.method === "GET") return next();
    return limitEdits(c, next);
  });

  app.use("/api/curations/:date/meta", withApiKey(deps, "Edit endpoint disabled: API_KEY not configured"));
  app.use("/api/curations/:date/meta", limitEdits);
  app.use("/api/curations/:date/versions", withApiKey(deps, "Versions endpoint disabled: API_KEY not configured"));
  app.use("/api/curations/:date/versions", limitEdits);
  app.use("/api/curations/:date/versions/*", withApiKey(deps, "Versions endpoint disabled: API_KEY not configured"));
  app.use("/api/curations/:date/versions/*", limitEdits);
  app.use("/api/curations/:date/diff/latest", withApiKey(deps, "Diff endpoint disabled: API_KEY not configured"));
  app.use("/api/curations/:date/diff/latest", limitEdits);

  app.get("/api/curations/:date/versions", async (c) => {
    const date = c.req.param("date");
    if (!isCurationFileId(date)) return c.json({ error: "Invalid edition ID format" }, 400);

    const versionDir = join(deps.config.versionsDir, date);
    if (!existsSync(versionDir)) return c.json({ edition: date, versions: [] });

    const versions = (await readdir(versionDir))
      .filter((file) => file.endsWith(".md"))
      .sort()
      .reverse()
      .map((file) => ({
        id: file.replace(/\.md$/, ""),
        file,
        path: `/api/curations/${date}/versions/${file.replace(/\.md$/, "")}`,
      }));

    return c.json({ edition: date, versions });
  });

  app.get("/api/curations/:date/versions/:version", async (c) => {
    const date = c.req.param("date");
    const version = c.req.param("version");
    if (!isCurationFileId(date)) return c.json({ error: "Invalid edition ID format" }, 400);
    if (!isVersionId(version)) return c.json({ error: "Invalid version ID format" }, 400);

    const filePath = join(deps.config.versionsDir, date, `${version}.md`);
    if (!existsSync(filePath)) return c.json({ error: "Version not found" }, 404);

    const content = await readFile(filePath, "utf-8");
    return c.json({ edition: date, version, content });
  });

  app.get("/api/curations/:date/diff/latest", async (c) => {
    const date = c.req.param("date");
    if (!isCurationFileId(date)) return c.json({ error: "Invalid edition ID format" }, 400);

    const currentPath = join(CURATIONS_DIR, `${date}.md`);
    const versionDir = join(deps.config.versionsDir, date);
    if (!existsSync(currentPath)) return c.json({ error: "Edition not found" }, 404);
    if (!existsSync(versionDir)) return c.json({ error: "No versions found" }, 404);

    const latestVersionFile = (await readdir(versionDir))
      .filter((file) => file.endsWith(".md"))
      .sort()
      .reverse()[0];
    if (!latestVersionFile) return c.json({ error: "No versions found" }, 404);

    const [current, previous] = await Promise.all([
      readFile(currentPath, "utf-8"),
      readFile(join(versionDir, latestVersionFile), "utf-8"),
    ]);

    return c.json({
      edition: date,
      previousVersion: latestVersionFile.replace(/\.md$/, ""),
      diff: renderLineDiff(previous, current),
    });
  });

  app.put("/api/curations/:date", async (c) => {
    const date = c.req.param("date");
    if (!isCurationFileId(date)) return c.json({ error: "Invalid edition ID format" }, 400);

    const filePath = join(CURATIONS_DIR, `${date}.md`);
    if (!existsSync(filePath)) return c.json({ error: "Edition not found" }, 404);

    const contentOrResponse = await readRequestContent(c);
    if (contentOrResponse instanceof Response) return contentOrResponse;
    if (contentOrResponse.length < 10 || contentOrResponse.length > 1_000_000) {
      return c.json({ error: "Content length out of range (10–1_000_000 chars)" }, 400);
    }

    const validation = validateCurationContent(contentOrResponse);
    if (!validation.valid) {
      logEvent("curation.update_rejected", {
        edition: date,
        errors: validation.errors.length,
        warnings: validation.warnings.length,
      });
      return c.json({ error: "Validation failed", validation }, 422);
    }

    const previous = await readFile(filePath, "utf-8");
    await saveVersionSnapshot(date, previous, "put", deps);
    await writeFile(filePath, contentOrResponse, "utf-8");
    invalidateCurationCache(date);
    incrementCounter("updates");

    const warning = await checkImageUrl(contentOrResponse, deps.config);
    logEvent("curation.updated", { edition: date, warnings: validation.warnings.length });
    const responseBody: Record<string, unknown> = {
      success: true,
      edition: date,
      url: `/curacion/${date}`,
      validation,
    };
    if (warning) responseBody.warning = warning;
    return c.json(responseBody);
  });

  app.patch("/api/curations/:date/meta", async (c) => {
    const date = c.req.param("date");
    if (!isCurationFileId(date)) return c.json({ error: "Invalid edition ID format" }, 400);

    const filePath = join(CURATIONS_DIR, `${date}.md`);
    if (!existsSync(filePath)) return c.json({ error: "Edition not found" }, 404);

    const patch = (await c.req.json()) as Record<string, string | null>;
    if (typeof patch !== "object" || Array.isArray(patch)) {
      return c.json({ error: "Body must be a JSON object of frontmatter fields" }, 400);
    }

    const existing = await readFile(filePath, "utf-8");
    const { meta, body } = parseFrontmatter(existing);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") {
        delete meta[key];
      } else {
        meta[key] = String(value);
      }
    }

    const updated = serializeFrontmatter(meta, body);
    await saveVersionSnapshot(date, existing, "meta", deps);
    await writeFile(filePath, updated, "utf-8");
    invalidateCurationCache(date);
    incrementCounter("updates");

    const warning = meta.image_url ? await validateImageUrl(meta.image_url, deps.config) : null;
    logEvent("curation.meta_updated", { edition: date, fields: Object.keys(patch).length });
    const responseBody: Record<string, unknown> = { success: true, edition: date, meta };
    if (warning) responseBody.warning = warning;
    return c.json(responseBody);
  });
}
