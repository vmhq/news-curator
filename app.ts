import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import { basename, join } from "path";
import { Hono, type Context, type Next } from "hono";
import { compress } from "hono/compress";
import { serveStatic } from "hono/bun";
import type { RuntimeConfigInput } from "./lib/config.ts";
import { createApiKeyGuard } from "./lib/auth.ts";
import { isSafeFilename } from "./lib/security.ts";
import { type AppDeps } from "./lib/app-deps.ts";
import { loadRuntimeConfig } from "./lib/config.ts";
import { getCacheStats, getCurationFiles, invalidateFilesCache, setCurationsDir, startDirWatcher, stopDirWatcher } from "./lib/curations.ts";
import { logEvent } from "./lib/logging.ts";
import { getMetricsSnapshot, recordRequest } from "./lib/observability.ts";
import { InMemoryRateLimiter } from "./lib/rate-limit.ts";
import { runRetentionPass } from "./lib/retention.ts";
import { createApiRouter } from "./routes/api.ts";
import { registerPublicRoutes } from "./routes/public.ts";

export function createApp(overrides: RuntimeConfigInput = {}) {
  const config = loadRuntimeConfig(overrides);
  const curationsDirChanged = setCurationsDir(config.curationsDir);
  if (curationsDirChanged) {
    invalidateFilesCache();
  }

  if (config.enableWatcher) {
    startDirWatcher();
  } else {
    stopDirWatcher();
  }

  runRetentionPass(config).catch((error) => {
    console.error("Failed to run retention pass", error);
  });

  if (!config.apiKey) {
    console.warn("API_KEY not set — authenticated routes are disabled");
  }

  const app = new Hono();
  const deps: AppDeps = {
    config,
    apiKeyGuard: createApiKeyGuard(config.apiKey),
    rateLimiter: new InMemoryRateLimiter(),
    startedAt: Date.now(),
  };

  const MAX_BODY_SIZE = 1_000_000;

  app.use("*", async (c, next) => {
    const contentLength = c.req.header("Content-Length");
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (!Number.isNaN(size) && size > MAX_BODY_SIZE) {
        return c.json({ error: "Request body too large" }, 413);
      }
    }
    await next();
  });

  const selectiveCompress = async (c: Context, next: Next) => {
    const path = c.req.path;
    if (path.startsWith("/api/") || path === "/health" || path === "/health/internal" || path === "/ready") {
      return next();
    }
    return compress({ encoding: "gzip" })(c, next);
  };
  app.use("*", selectiveCompress);

  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    recordRequest(Date.now() - start);
    c.res.headers.set("X-Frame-Options", "DENY");
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    let csp = "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self';";
    if (config.siteUrl.startsWith("https://")) {
      csp += " upgrade-insecure-requests;";
      c.res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    c.res.headers.set("Content-Security-Policy", csp);
  });

  app.use("/static/uploads/*", async (c, next) => {
    const filename = basename(c.req.path.slice("/static/uploads/".length));
    if (!filename || !isSafeFilename(filename)) {
      return c.json({ error: "Invalid filename" }, 400);
    }

    const filePath = join(config.uploadsDir, filename);
    const file = Bun.file(filePath);
    if (!(await file.exists())) return next();

    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const mime: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      gif: "image/gif",
      avif: "image/avif",
      svg: "image/svg+xml",
    };
    return c.body(file, 200, {
      "Content-Type": mime[ext] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });

  app.use(
    "/static/*",
    serveStatic({
      root: "./",
      rewriteRequestPath: (path) => path.replace("/static/", "public/"),
    })
  );

  app.get("/robots.txt", (c) =>
    c.text("User-agent: *\nDisallow: /\n", 200, { "Content-Type": "text/plain" })
  );

  app.get("/health", async (c) => {
    const files = await getCurationFiles();
    const latestEdition = files[0] ?? null;
    return c.json({
      status: "ok",
      uptime: process.uptime(),
      latestEdition,
      files: { total: files.length },
      caches: getCacheStats(),
      metrics: {
        ...getMetricsSnapshot(),
        rateLimiter: deps.rateLimiter.snapshot(),
      },
    });
  });

  app.use("/health/internal", async (c, next) => {
    await deps.apiKeyGuard.requireApiKey(c, next, "Internal health endpoint disabled: API_KEY not configured");
  });
  app.get("/health/internal", async (c) => {
    const files = await getCurationFiles();
    const latestEdition = files[0] ?? null;
    return c.json({
      status: "ok",
      uptime: process.uptime(),
      latestEdition,
      files: { total: files.length },
      caches: getCacheStats(),
      metrics: {
        ...getMetricsSnapshot(),
        rateLimiter: deps.rateLimiter.snapshot(),
      },
      config: {
        apiKeyConfigured: deps.apiKeyGuard.enabled,
        curationsDir: config.curationsDir,
        uploadsDir: config.uploadsDir,
        draftsDir: config.draftsDir,
        versionsDir: config.versionsDir,
        draftTtlHours: config.draftTtlHours,
        maxVersionsPerEdition: config.maxVersionsPerEdition,
      },
    });
  });

  app.get("/ready", async (c) => {
    try {
      await mkdir(config.uploadsDir, { recursive: true });
      await mkdir(config.draftsDir, { recursive: true });
      await mkdir(config.versionsDir, { recursive: true });

      return c.json({
        status: "ready",
        watcherEnabled: config.enableWatcher,
        watcherActive: getCacheStats().watcherActive,
        curationsDirExists: existsSync(config.curationsDir),
      });
    } catch (error) {
      logEvent("app.readiness_failed", { error: error instanceof Error ? error.message : String(error) });
      return c.json({ status: "not_ready" }, 503);
    }
  });

  app.onError((err, c) => {
    logEvent("app.unhandled_error", { error: err instanceof Error ? err.message : String(err), path: c.req.path });
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: "Internal Server Error" }, 500);
    }
    return c.text("Internal Server Error", 500);
  });

  app.notFound((c) => {
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: "Not Found" }, 404);
    }
    return c.text("Not Found", 404);
  });

  app.route("/api", createApiRouter(deps));
  registerPublicRoutes(app, deps);

  return app;
}
