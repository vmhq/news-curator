import { Hono, type Context, type Next } from "hono";
import { serveStatic } from "hono/bun";
import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, basename } from "path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  CURATIONS_DIR,
  SITE_URL,
  startDirWatcher,
  getCurationFiles,
  getCachedSummary,
  readCuration,
  getSummary,
  extractFeatured,
  extractOgImage,
  isBlockedUrl,
  allEditionsSidebar,
  findTodayCuration,
  dateFromFileId,
  todayLocal,
  formatDateEs,
  estimateReadingTime,
  invalidateFilesCache,
  invalidateSummaryCache,
  renderCurationContent,
  validateCurationContent,
} from "./lib/curations.ts";
import { buildPage, escapeHtml } from "./templates/layout.ts";

const app = new Hono();

// ── Security headers (HTTP level — meta tags alone are insufficient) ──────────
app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  c.res.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self';"
  );
  // HSTS only makes sense over HTTPS — skip on local/http deployments
  if (SITE_URL.startsWith("https://")) {
    c.res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
});

// Serve uploaded images from UPLOADS_DIR — must be registered BEFORE the generic
// serveStatic so it takes priority when UPLOADS_DIR points to an external volume.
app.use("/static/uploads/*", async (c, next) => {
  const filename = basename(c.req.path.slice("/static/uploads/".length));
  if (!filename) return next();
  const filePath = join(UPLOADS_DIR, filename);
  try {
    const data = await readFile(filePath);
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const mime: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      webp: "image/webp", gif: "image/gif", avif: "image/avif", svg: "image/svg+xml",
    };
    return c.body(data, 200, { "Content-Type": mime[ext] ?? "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" });
  } catch {
    return next();
  }
});

app.use("/static/*", serveStatic({ root: "./", rewriteRequestPath: (p) => p.replace("/static/", "public/") }));
app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n", 200, { "Content-Type": "text/plain" }));

app.get("/health", (c) => c.json({ status: "ok", uptime: process.uptime() }));

// ── Publish API ───────────────────────────────────────────────────────────────

const API_KEY = process.env.API_KEY;
if (!API_KEY) console.warn("⚠️  API_KEY not set — POST /api/publish is disabled");


/** Timing-safe API key check to prevent timing attacks. */
function isValidApiKey(provided: string): boolean {
  if (!API_KEY) return false;
  if (provided.length !== API_KEY.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(API_KEY));
}

// ── Image upload API ──────────────────────────────────────────────────────────

// UPLOADS_DIR can be overridden via env var so uploads persist in Docker volumes.
// Default: public/uploads (works for local dev).
// In Docker: set UPLOADS_DIR=/data/uploads and mount it as a named volume.
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? join("public", "uploads");
const DRAFTS_DIR = process.env.DRAFTS_DIR ?? join(CURATIONS_DIR, ".drafts");
const VERSIONS_DIR = process.env.VERSIONS_DIR ?? join(CURATIONS_DIR, ".versions");
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const IMAGE_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "image/gif": "gif", "image/avif": "avif",
};

function logEvent(event: string, details: Record<string, unknown> = {}) {
  console.info(JSON.stringify({ level: "info", event, ts: new Date().toISOString(), ...details }));
}

async function requireApiKey(c: Context, next: Next, disabledMessage: string) {
  if (!API_KEY) return c.json({ error: disabledMessage }, 503);
  const key =
    c.req.header("X-Api-Key") ??
    c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!key || !isValidApiKey(key)) return c.json({ error: "Unauthorized" }, 401);
  await next();
}

async function readRequestContent(c: Context): Promise<string | Response> {
  const ct = c.req.header("Content-Type") ?? "";
  if (ct.includes("application/json")) {
    const body = await c.req.json();
    if (typeof body.content !== "string") {
      return c.json({ error: "Missing 'content' field" }, 400);
    }
    return body.content;
  }
  return c.req.text();
}

function editionIdFromNow(): string {
  const now = new Date();
  const date = now.toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });
  const time = now
    .toLocaleTimeString("sv-SE", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit" })
    .replace(":", "-");
  return `${date}_${time}`;
}

function versionTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function saveVersionSnapshot(date: string, content: string, reason: string) {
  const safeReason = reason.replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "edit";
  const dir = join(VERSIONS_DIR, date);
  await mkdir(dir, { recursive: true });
  const filename = `${versionTimestamp()}-${safeReason}.md`;
  await writeFile(join(dir, filename), content, "utf-8");
  logEvent("curation.version_saved", { edition: date, version: filename, reason: safeReason });
}

app.use("/api/images", async (c, next) => {
  return requireApiKey(c, next, "Upload endpoint disabled: API_KEY not configured");
});

app.post("/api/images", async (c) => {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: "Request must be multipart/form-data" }, 400);
  }

  const file = formData.get("image");
  if (!(file instanceof File)) return c.json({ error: "Missing 'image' file field" }, 400);

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return c.json({ error: `Tipo no permitido: ${file.type}. Permitidos: jpeg, png, webp, gif, avif` }, 400);
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return c.json({ error: `Imagen demasiado grande (máx 10 MB, recibido ${(file.size / 1024 / 1024).toFixed(1)} MB)` }, 400);
  }

  const ext = IMAGE_EXT[file.type];
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const filename = `${ts}-${rand}.${ext}`;

  await mkdir(UPLOADS_DIR, { recursive: true });
  await writeFile(join(UPLOADS_DIR, filename), Buffer.from(await file.arrayBuffer()));

  const url = `/static/uploads/${filename}`;
  return c.json({ success: true, url }, 201);
});

// ─────────────────────────────────────────────────────────────────────────────

app.use("/api/publish", async (c, next) => {
  return requireApiKey(c, next, "Publish endpoint disabled: API_KEY not configured");
});

app.post("/api/publish", async (c) => {
  let contentOrResponse: string | Response;
  const ct = c.req.header("Content-Type") ?? "";
  if (ct.includes("application/json")) {
    const body = await c.req.json();
    if (typeof body.draft_id === "string") {
      const draftId = body.draft_id;
      if (!/^[a-f0-9-]{36}$/i.test(draftId)) return c.json({ error: "Invalid draft_id" }, 400);
      const draftPath = join(DRAFTS_DIR, `${draftId}.md`);
      if (!existsSync(draftPath)) return c.json({ error: "Draft not found" }, 404);
      contentOrResponse = await readFile(draftPath, "utf-8");
    } else if (typeof body.content === "string") {
      contentOrResponse = body.content;
    } else {
      return c.json({ error: "Missing 'content' or 'draft_id' field" }, 400);
    }
  } else {
    contentOrResponse = await c.req.text();
  }
  if (contentOrResponse instanceof Response) return contentOrResponse;
  const content = contentOrResponse;

  if (content.length < 10 || content.length > 1_000_000) {
    return c.json({ error: "Content length out of range (10–1_000_000 chars)" }, 400);
  }
  const validation = validateCurationContent(content);
  if (!validation.valid) {
    logEvent("curation.publish_rejected", { errors: validation.errors.length, warnings: validation.warnings.length });
    return c.json({ error: "Validation failed", validation }, 422);
  }

  const editionId = editionIdFromNow();
  const filePath = join(CURATIONS_DIR, `${editionId}.md`);

  await mkdir(CURATIONS_DIR, { recursive: true });
  await writeFile(filePath, content, "utf-8");
  invalidateFilesCache();

  const warning = await checkImageUrl(content);
  logEvent("curation.published", { edition: editionId, warnings: validation.warnings.length });
  const resp: Record<string, unknown> = { success: true, edition: editionId, url: `/curacion/${editionId}`, validation };
  if (warning) resp.warning = warning;
  return c.json(resp, 201);
});

// ── Agent validation + draft workflow ────────────────────────────────────────

app.use("/api/validate", async (c, next) => {
  return requireApiKey(c, next, "Validate endpoint disabled: API_KEY not configured");
});

app.post("/api/validate", async (c) => {
  const contentOrResponse = await readRequestContent(c);
  if (contentOrResponse instanceof Response) return contentOrResponse;
  const validation = validateCurationContent(contentOrResponse);
  logEvent("curation.validated", { valid: validation.valid, errors: validation.errors.length, warnings: validation.warnings.length });
  return c.json({ valid: validation.valid, validation }, validation.valid ? 200 : 422);
});

app.use("/api/drafts", async (c, next) => {
  return requireApiKey(c, next, "Draft endpoint disabled: API_KEY not configured");
});
app.use("/api/drafts/*", async (c, next) => {
  return requireApiKey(c, next, "Draft endpoint disabled: API_KEY not configured");
});

app.post("/api/drafts", async (c) => {
  const contentOrResponse = await readRequestContent(c);
  if (contentOrResponse instanceof Response) return contentOrResponse;
  const content = contentOrResponse;
  const validation = validateCurationContent(content);
  if (!validation.valid) {
    logEvent("draft.rejected", { errors: validation.errors.length, warnings: validation.warnings.length });
    return c.json({ error: "Validation failed", validation }, 422);
  }

  const draftId = randomUUID();
  await mkdir(DRAFTS_DIR, { recursive: true });
  await writeFile(join(DRAFTS_DIR, `${draftId}.md`), content, "utf-8");
  logEvent("draft.created", { draft: draftId, warnings: validation.warnings.length });

  return c.json({
    success: true,
    draft: draftId,
    previewUrl: `/drafts/${draftId}`,
    publish: { method: "POST", path: "/api/publish", body: { draft_id: draftId } },
    validation,
  }, 201);
});

app.get("/api/drafts/:id", async (c) => {
  const draftId = c.req.param("id");
  if (!/^[a-f0-9-]{36}$/i.test(draftId)) return c.json({ error: "Invalid draft ID" }, 400);
  const draftPath = join(DRAFTS_DIR, `${draftId}.md`);
  if (!existsSync(draftPath)) return c.json({ error: "Draft not found" }, 404);
  const content = await readFile(draftPath, "utf-8");
  return c.json({ draft: draftId, content, validation: validateCurationContent(content) });
});

app.post("/api/drafts/:id/publish", async (c) => {
  const draftId = c.req.param("id");
  if (!/^[a-f0-9-]{36}$/i.test(draftId)) return c.json({ error: "Invalid draft ID" }, 400);
  const draftPath = join(DRAFTS_DIR, `${draftId}.md`);
  if (!existsSync(draftPath)) return c.json({ error: "Draft not found" }, 404);

  const content = await readFile(draftPath, "utf-8");
  const validation = validateCurationContent(content);
  if (!validation.valid) return c.json({ error: "Validation failed", validation }, 422);

  const editionId = editionIdFromNow();
  await mkdir(CURATIONS_DIR, { recursive: true });
  await writeFile(join(CURATIONS_DIR, `${editionId}.md`), content, "utf-8");
  invalidateFilesCache();
  logEvent("draft.published", { draft: draftId, edition: editionId, warnings: validation.warnings.length });

  const warning = await checkImageUrl(content);
  const resp: Record<string, unknown> = { success: true, draft: draftId, edition: editionId, url: `/curacion/${editionId}`, validation };
  if (warning) resp.warning = warning;
  return c.json(resp, 201);
});

app.get("/drafts/:id", async (c) => {
  const draftId = c.req.param("id");
  if (!/^[a-f0-9-]{36}$/i.test(draftId)) return c.text("Draft inválido", 400);
  const draftPath = join(DRAFTS_DIR, `${draftId}.md`);
  if (!existsSync(draftPath)) return c.text("Draft no encontrado", 404);

  const content = await readFile(draftPath, "utf-8");
  const rendered = await renderCurationContent(content);
  const featured = extractFeatured(content);
  const readingTime = estimateReadingTime(content);
  const validation = validateCurationContent(content);
  const validationHtml = validation.warnings.length
    ? `<div class="empty-state"><h2>Preview de draft</h2><p>${validation.warnings.length} advertencia(s). Publicable: ${validation.valid ? "sí" : "no"}.</p></div>`
    : `<div class="empty-state"><h2>Preview de draft</h2><p>Validación correcta.</p></div>`;

  return c.html(
    buildPage(`Daily Brief — Draft ${draftId.slice(0, 8)}`, `${validationHtml}${rendered.html}`, {
      featured,
      heroImage: rendered.coverImage,
      canonicalPath: `/drafts/${draftId}`,
      hideSidebar: true,
      readingTime,
    })
  );
});

// ── Shared helpers ───────────────────────────────────────────────────────────

/** HEAD-check image_url from frontmatter; returns a warning string or null. */
async function validateImageUrl(url: string): Promise<string | null> {
  // Local uploaded images — validate by file existence, not HTTP
  if (url.startsWith("/static/uploads/")) {
    const raw = url.slice("/static/uploads/".length);
    // basename() strips any directory components (including encoded traversals)
    const filename = basename(raw);
    if (!filename || filename !== raw) {
      return "image_url local inválida";
    }
    if (!existsSync(join(UPLOADS_DIR, filename))) {
      return "image_url apunta a un archivo subido que no existe";
    }
    return null;
  }
  if (isBlockedUrl(url)) return "image_url points to a blocked or internal address";
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(url, { method: "HEAD", signal: controller.signal, redirect: "error" });
    if (!resp.ok) return `image_url responded with HTTP ${resp.status}`;
    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/")) return `image_url is not an image (Content-Type: ${ct || "unknown"})`;
    return null;
  } catch {
    return "image_url is not reachable";
  }
}

/** Extract and validate image_url from markdown frontmatter; returns warning or null. */
async function checkImageUrl(content: string): Promise<string | null> {
  const m = content.match(/^---\n[\s\S]*?image_url:\s*["']?([^"'\n]+)["']?[\s\S]*?\n---/);
  if (!m?.[1]) return null;
  return validateImageUrl(m[1].trim());
}

/** Parse frontmatter into a key→value map and the body below it. */
function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const m = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: content };
  const meta: Record<string, string> = {};
  const rawMeta = m[1] ?? "";
  const rawBody = m[2] ?? "";
  for (const line of rawMeta.split("\n")) {
    const ci = line.indexOf(":");
    if (ci === -1) continue;
    const key = line.slice(0, ci).trim();
    const val = line.slice(ci + 1).trim().replace(/^["']|["']$/g, "");
    if (key) meta[key] = val;
  }
  return { meta, body: rawBody };
}

function serializeFrontmatter(meta: Record<string, string>, body: string): string {
  const entries = Object.entries(meta);
  if (entries.length === 0) return body;
  // Keys must be simple identifiers; values are quoted and newlines stripped to prevent injection
  const fm = entries.map(([k, v]) => {
    const safeKey = k.replace(/[^a-zA-Z0-9_-]/g, "");
    const safeVal = String(v).replace(/[\r\n]/g, " ").replace(/"/g, "'");
    return `${safeKey}: "${safeVal}"`;
  }).join("\n");
  return `---\n${fm}\n---\n${body}`;
}

// ─────────────────────────────────────────────────────────────────────────────

app.use("/api/curations/:date", async (c, next) => {
  // Only guard write methods; GET is public
  if (c.req.method === "GET") return next();
  return requireApiKey(c, next, "Edit endpoint disabled: API_KEY not configured");
});

app.use("/api/curations/:date/versions", async (c, next) => {
  return requireApiKey(c, next, "Versions endpoint disabled: API_KEY not configured");
});
app.use("/api/curations/:date/versions/*", async (c, next) => {
  return requireApiKey(c, next, "Versions endpoint disabled: API_KEY not configured");
});

app.get("/api/curations/:date/versions", async (c) => {
  const date = c.req.param("date");
  if (!/^\d{4}-\d{2}-\d{2}(_\d{2}-\d{2})?$/.test(date)) {
    return c.json({ error: "Invalid edition ID format" }, 400);
  }
  const versionDir = join(VERSIONS_DIR, date);
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
  if (!/^\d{4}-\d{2}-\d{2}(_\d{2}-\d{2})?$/.test(date)) {
    return c.json({ error: "Invalid edition ID format" }, 400);
  }
  if (!/^[\dTZ-]+-[a-z0-9_-]+$/i.test(version)) {
    return c.json({ error: "Invalid version ID format" }, 400);
  }
  const filePath = join(VERSIONS_DIR, date, `${version}.md`);
  if (!existsSync(filePath)) return c.json({ error: "Version not found" }, 404);
  const content = await readFile(filePath, "utf-8");
  return c.json({ edition: date, version, content });
});

app.get("/api/curations/:date", async (c) => {
  const date = c.req.param("date");
  if (!/^\d{4}-\d{2}-\d{2}(_\d{2}-\d{2})?$/.test(date)) {
    return c.json({ error: "Invalid edition ID format" }, 400);
  }
  const filePath = join(CURATIONS_DIR, `${date}.md`);
  if (!existsSync(filePath)) {
    return c.json({ error: "Edition not found" }, 404);
  }
  const content = await readFile(filePath, "utf-8");
  return c.json({ edition: date, content });
});

app.put("/api/curations/:date", async (c) => {
  const date = c.req.param("date");
  if (!/^\d{4}-\d{2}-\d{2}(_\d{2}-\d{2})?$/.test(date)) {
    return c.json({ error: "Invalid edition ID format" }, 400);
  }

  const filePath = join(CURATIONS_DIR, `${date}.md`);
  if (!existsSync(filePath)) {
    return c.json({ error: "Edition not found" }, 404);
  }

  let content: string;
  const ct = c.req.header("Content-Type") ?? "";
  if (ct.includes("application/json")) {
    const body = await c.req.json();
    if (typeof body.content !== "string") return c.json({ error: "Missing 'content' field" }, 400);
    content = body.content;
  } else {
    content = await c.req.text();
  }

  if (content.length < 10 || content.length > 1_000_000) {
    return c.json({ error: "Content length out of range (10–1_000_000 chars)" }, 400);
  }
  const validation = validateCurationContent(content);
  if (!validation.valid) {
    logEvent("curation.update_rejected", { edition: date, errors: validation.errors.length, warnings: validation.warnings.length });
    return c.json({ error: "Validation failed", validation }, 422);
  }

  const previous = await readFile(filePath, "utf-8");
  await saveVersionSnapshot(date, previous, "put");
  await writeFile(filePath, content, "utf-8");
  invalidateSummaryCache(date);

  const warning = await checkImageUrl(content);
  logEvent("curation.updated", { edition: date, warnings: validation.warnings.length });
  const resp: Record<string, unknown> = { success: true, edition: date, url: `/curacion/${date}`, validation };
  if (warning) resp.warning = warning;
  return c.json(resp);
});

app.use("/api/curations/:date/meta", async (c, next) => {
  return requireApiKey(c, next, "Edit endpoint disabled: API_KEY not configured");
});

app.patch("/api/curations/:date/meta", async (c) => {
  const date = c.req.param("date");
  if (!/^\d{4}-\d{2}-\d{2}(_\d{2}-\d{2})?$/.test(date)) {
    return c.json({ error: "Invalid edition ID format" }, 400);
  }

  const filePath = join(CURATIONS_DIR, `${date}.md`);
  if (!existsSync(filePath)) {
    return c.json({ error: "Edition not found" }, 404);
  }

  const patch = await c.req.json() as Record<string, string | null>;
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
  await saveVersionSnapshot(date, existing, "meta");
  await writeFile(filePath, updated, "utf-8");
  invalidateSummaryCache(date);

  const warning = meta.image_url ? await validateImageUrl(meta.image_url) : null;
  logEvent("curation.meta_updated", { edition: date, fields: Object.keys(patch).length });
  const resp: Record<string, unknown> = { success: true, edition: date, meta };
  if (warning) resp.warning = warning;
  return c.json(resp);
});

// ─────────────────────────────────────────────────────────────────────────────

startDirWatcher();

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/", async (c) => {
  const files = await getCurationFiles();

  let targetDate = findTodayCuration(files);
  let isToday = true;

  if (!targetDate && files.length > 0) {
    targetDate = files[0] ?? null;
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
  const readingTime = estimateReadingTime(curation.raw);

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
      sidebarHasMore, sidebarHasPrev, sidebarPage, readingTime,
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
  const readingTime = estimateReadingTime(curation.raw);

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
      readingTime,
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
  const limit = Math.max(1, Math.min(50, parseInt(c.req.query("limit") || "10")));

  // Cursor-based pagination: ?before=YYYY-MM-DD[_HH-MM] (exclusive)
  const before = c.req.query("before");
  if (before) {
    if (!/^\d{4}-\d{2}-\d{2}(_\d{2}-\d{2})?$/.test(before)) {
      return c.json({ error: "Invalid 'before' cursor format (expected YYYY-MM-DD or YYYY-MM-DD_HH-MM)" }, 400);
    }
    const subset = files.filter((f) => f < before).slice(0, limit);
    const settled = await Promise.allSettled(
      subset.map(async (d) => ({ date: d, summary: await getCachedSummary(d) }))
    );
    const curations = settled
      .filter((r): r is PromiseFulfilledResult<{ date: string; summary: string }> => r.status === "fulfilled")
      .map((r) => r.value);
    const nextCursor = curations.length === limit ? curations.at(-1)?.date ?? null : null;
    return c.json({ curations, nextCursor, total: files.length });
  }

  // Offset-based pagination (legacy): ?page=&limit=
  const page = Math.max(1, Math.min(1000, parseInt(c.req.query("page") || "1")));
  const start = (page - 1) * limit;
  const paginated = files.slice(start, start + limit);
  const settled = await Promise.allSettled(
    paginated.map(async (d) => ({ date: d, summary: await getCachedSummary(d) }))
  );
  const curations = settled
    .filter((r): r is PromiseFulfilledResult<{ date: string; summary: string }> => r.status === "fulfilled")
    .map((r) => r.value);
  const nextCursor = start + limit < files.length ? files[start + limit] : null;
  return c.json({ curations, total: files.length, page, totalPages: Math.ceil(files.length / limit), nextCursor });
});

// Simple in-memory rate limiter: max 20 search requests per IP per 10 seconds
const searchRateMap = new Map<string, { count: number; resetAt: number }>();
const MAX_RATE_MAP_SIZE = 10_000;
// Periodic cleanup to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of searchRateMap) {
    if (now > entry.resetAt) searchRateMap.delete(ip);
  }
}, 60_000);

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = searchRateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    // Evict oldest entry if map is at capacity
    if (searchRateMap.size >= MAX_RATE_MAP_SIZE) {
      const firstKey = searchRateMap.keys().next().value;
      if (firstKey !== undefined) searchRateMap.delete(firstKey);
    }
    searchRateMap.set(ip, { count: 1, resetAt: now + 10_000 });
    return false;
  }
  if (entry.count >= 20) return true;
  entry.count++;
  return false;
}

app.get("/api/search", async (c) => {
  // Use the real connection IP for rate limiting. x-forwarded-for is not used
  // as it can be spoofed by clients. If connIp is unavailable, all requests
  // share one "anonymous" bucket.
  const connIp = (c.env as { requestIP?: { address: string } } | undefined)?.requestIP?.address;
  const ip = connIp ?? "anonymous";
  if (isRateLimited(ip)) {
    return c.json({ error: "Too many requests" }, 429);
  }
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

const port = parseInt(process.env.PORT || "8391");
console.log(`📋 Daily Brief corriendo en http://localhost:${port}`);

export default { port, fetch: app.fetch };
