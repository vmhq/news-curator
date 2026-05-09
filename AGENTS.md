# AGENTS.md

## Commands

```bash
bun install        # Install dependencies
bun run dev        # Start the server with hot reload
bun run start      # Start the server
bun run server.ts  # Equivalent direct entrypoint
PORT=3000 bun run start
bun test           # Run test suite
```

Server runs on `http://localhost:8391` by default. There is no lint script configured.

## Stack

- **Runtime:** Bun
- **Framework:** Hono `^4.12.15`
- **Markdown:** Marked `^18.0.2`
- All HTML is server-rendered; there is no frontend build step.

## Architecture

Multi-file server using **Bun** runtime + **Hono** framework. All HTML is server-rendered; there is no frontend build step.

| File | Responsibility |
|------|---------------|
| `server.ts` | Bun entrypoint; exports `{ port, fetch }` and `createApp` |
| `app.ts` | `createApp()` app assembly, middleware (1 MB body limit, selective gzip, security headers), static files, health/readiness, global `onError`/`notFound` handlers, route registration |
| `routes/public.ts` | Public HTML pages (`/`, `/latest`, `/curacion/:date`, `/ediciones`, `/drafts/:id`) |
| `routes/api.ts` | JSON API, authenticated write endpoints, drafts, versions, diff, uploads |
| `lib/app-deps.ts` | Shared dependency type for route registration |
| `lib/auth.ts` | API key guard via `X-Api-Key` or `Authorization: Bearer` |
| `lib/config.ts` | Runtime config loading and rate-limit defaults |
| `lib/curations.ts` | File I/O, caches, markdown rendering/parsing, search index |
| `lib/dates.ts` | Date utilities: `todayLocal()`, `dateFromFileId()`, `formatDateEs()` |
| `lib/diff.ts` | Line diff generation for edition snapshots |
| `lib/frontmatter.ts` | Frontmatter parse/serialize and `image_url` validation |
| `lib/html.ts` | Shared HTML escaping helper |
| `lib/http-cache.ts` | ETag / Last-Modified helpers |
| `lib/ids.ts` | Shared edition, draft, and version ID validation helpers |
| `lib/logging.ts` | JSON structured event logging |
| `lib/observability.ts` | In-memory request and action counters |
| `lib/og-images.ts` | OG image scraping with timeout, filtering, and cache |
| `lib/rate-limit.ts` | In-memory per-IP rate limiting |
| `lib/retention.ts` | Draft cleanup and version retention |
| `lib/security.ts` | SSRF protection: `isBlockedUrl()`, `isBlockedResolvedUrl()` |
| `lib/storage.ts` | File-system abstraction for editions, drafts, versions, uploads |
| `lib/validation.ts` | Editorial validation, featured story extraction, reading time |
| `templates/layout.ts` | `buildPage()` and `escapeHtml()` |

## Runtime data and configuration

Markdown editions live under `CURATIONS_DIR` and use IDs like `YYYY-MM-DD` or `YYYY-MM-DD_HH-MM`. The app keeps in-memory caches and invalidates them through a `fs.watch` watcher when enabled.

Main runtime settings:

- `PORT` — server port, default `8391`
- `API_KEY` — enables authenticated routes
- `CURATIONS_DIR` — markdown edition directory, default `/data/curations`
- `SITE_URL` — canonical/OG base URL, default `http://localhost:8391`
- `UPLOADS_DIR` — uploaded image directory, default `public/uploads`
- `DRAFTS_DIR` — draft directory, default `${CURATIONS_DIR}/.drafts`
- `VERSIONS_DIR` — version snapshot directory, default `${CURATIONS_DIR}/.versions`
- `DRAFT_TTL_HOURS` — default `72`
- `MAX_VERSIONS_PER_EDITION` — default `20`
- `ENABLE_WATCHER` — default `true`

`app.ts` calls `loadRuntimeConfig()`, starts or stops the directory watcher, and runs a retention pass on startup.

## Key functions

### `lib/curations.ts`

File handling and caches:

- `getCurationFiles()` — reads, validates, sorts, and caches edition IDs descending
- `searchCurations(query, limit)` — full-text search over a cached in-memory index
- `getRenderedCuration(date)` — reads, renders, and caches edition with mtime-based invalidation
- `renderCurationContent(raw)` — renders markdown content without needing a file read; returns `{ raw, html, coverImage, feedItems }`
- `extractFeedItems(content)` — parses H2/H3 structure into `{ section, headline, excerpt, href }` items for feed layout
- `invalidateFilesCache()` — clears file/index caches
- `invalidateSummaryCache(date)` — evicts one summary entry
- `invalidateCurationCache(date)` — evicts summary and clears search index after edits
- `invalidateRenderCache(date)` — evicts one render cache entry
- `startDirWatcher()` / `stopDirWatcher()` — manage `fs.watch` with debounced invalidation
- `getCacheStats()` — cache and watcher status for `/health`
- `isCurationFileId(id)` / `CURATION_FILE_ID_RE` — canonical edition ID validation

Rendering and parsing:

- `readCuration(date)` — reads markdown, parses frontmatter, returns `{ raw, html, coverImage, feedItems }`
- `getSummary(content)` / `getCachedSummary(date)` — summary extraction and caching

### `lib/validation.ts`

- `extractFeatured(content)` — extracts the `Noticia principal` headline, excerpt, and first URL; keeps compatibility with the legacy emoji heading
- `validateCurationContent(content)` — editorial validation with errors, warnings, and stats
- `estimateReadingTime(raw)` — returns estimated reading time in minutes (words / 200, minimum 1)
- `FEATURED_HEADING_RE` / `FEATURED_HEADING_LABEL_RE` — regex constants for featured story detection

### `lib/security.ts`

- `isBlockedUrl(url)` — rejects private/local/non-http(s) URLs before fetch
- `isBlockedResolvedUrl(url)` — DNS-aware SSRF protection using external resolvers (1.1.1.1 / 8.8.8.8) with 5-min TTL cache

### `lib/og-images.ts`

- `resolveOgImageCandidate(pageUrl, html)` — resolves relative OG image URLs against page URL
- `extractOgImage(url)` — best-effort OG image scraping with 5s timeout, max 50 KB read, logo filtering, and LRU cache (max 500)
- `getOgImageCacheStats()` / `clearOgImageCache()` — cache introspection and clearing

### `lib/storage.ts`

Abstracts all file-system operations:

- `editionFilePath()` / `editionExists()` / `readEdition()` / `writeEdition()` / `statEdition()`
- `draftFilePath()` / `draftExists()` / `readDraft()` / `writeDraft()` / `listDrafts()`
- `versionDirPath()` / `versionFilePath()` / `ensureVersionDir()` / `writeVersion()` / `listVersions()` / `readVersion()`
- `ensureUploadsDir()` / `writeUpload()`

### `lib/dates.ts`

- `todayLocal()` — today's date as `YYYY-MM-DD` using `America/Santiago`
- `dateFromFileId(id)` — strips time suffix: `"2026-04-07_22-21"` → `"2026-04-07"`
- `formatDateEs(dateStr)` — Spanish date formatting with optional time suffix
- `allEditionsSidebar(files)` — passes files through (already sorted desc)

### `lib/frontmatter.ts`

- `parseFrontmatter(content)` — extracts YAML-like frontmatter into `{ meta, body }`
- `serializeFrontmatter(meta, body)` — reassembles frontmatter + body
- `validateImageUrl(url, config)` — validates `image_url` is reachable and is an image
- `checkImageUrl(content, config)` — extracts `image_url` from frontmatter and validates it

### `app.ts`

- Global security headers middleware (CSP, `X-Frame-Options`, `Referrer-Policy`, HSTS on HTTPS)
- Selective gzip compression — skips `/api/*`, `/health`, `/ready`
- Global `app.onError()` — logs via `logEvent("app.unhandled_error")`; returns JSON for `/api/*`, plain text for public routes
- Global `app.notFound()` — returns JSON 404 for `/api/*`, plain text for public routes
- Static handling for `/static/*` and `/static/uploads/*` with correct MIME types and immutable caching
- `GET /health` — uptime, file totals, cache stats, metrics, and rate-limiter snapshot
- `GET /health/internal` — authenticated health endpoint with effective config
- `GET /ready` — upload/draft/version directory readiness and watcher state

### `routes/api.ts`

- Applies per-bucket rate limiting for search, images, publish, drafts, and edits
- Supports API key auth for write endpoints
- Saves version snapshots on `PUT` / `PATCH`
- Publishes from raw content or from a stored draft
- Uses `lib/storage.ts` for all file I/O

### `routes/public.ts`

- Renders today/latest edition, edition detail pages, editions index, and draft preview
- Redirects `/latest` and preview bots (Telegram, Slack, Discord, Twitter, etc.) to the canonical latest edition URL
- Handles sidebar pagination on `/` with `SIDEBAR_PAGE_SIZE = 8`
- Builds featured-story hero metadata, reading time, stats row, and feed layout
- Uses `getRenderedCuration()` for mtime-cached rendering

## Routes

| Route | Description |
|------|-------------|
| `GET /` | Today's latest edition; falls back to latest available; `?p=N` paginates sidebar |
| `GET /latest` | Redirect to the canonical latest edition URL |
| `GET /curacion/:date` | Specific edition by ID |
| `GET /ediciones` | Full editions list |
| `GET /drafts/:id` | HTML preview for a stored draft |
| `GET /api/curations` | Paginated JSON list via `?page=` or cursor `?before=` |
| `GET /api/curations/:date` | Raw markdown content of one edition |
| `PUT /api/curations/:date` | Replace an existing edition; saves snapshot; requires `X-Api-Key` |
| `PATCH /api/curations/:date/meta` | Update frontmatter fields only; saves snapshot; requires `X-Api-Key` |
| `GET /api/curations/:date/versions` | List saved snapshots for an edition; requires `X-Api-Key` |
| `GET /api/curations/:date/versions/:version` | Read one snapshot; requires `X-Api-Key` |
| `GET /api/curations/:date/diff/latest` | Diff current edition vs latest snapshot; requires `X-Api-Key` |
| `GET /api/search?q=` | Full-text search; min length 2 |
| `POST /api/images` | Image upload (jpeg/png/webp/gif/avif, max 10 MB); requires `X-Api-Key` |
| `POST /api/validate` | Validate markdown before publish/edit; requires `X-Api-Key` |
| `POST /api/publish` | Publish a new edition from content or `draft_id`; requires `X-Api-Key` |
| `POST /api/drafts` | Create a validated draft; requires `X-Api-Key` |
| `GET /api/drafts/recent` | Return latest draft plus validation result; requires `X-Api-Key` |
| `GET /api/drafts/:id` | Return raw draft content plus validation; requires `X-Api-Key` |
| `POST /api/drafts/:id/publish` | Publish a stored draft; requires `X-Api-Key` |
| `GET /health` | Operational health |
| `GET /health/internal` | Authenticated health with effective config |
| `GET /ready` | Readiness probe |
| `GET /robots.txt` | `Disallow: /` |

## HTTP and security behavior

- All responses receive `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `Content-Security-Policy`
- `Strict-Transport-Security` is only sent when `SITE_URL` starts with `https://`
- Global `app.onError()` and `app.notFound()` handle uncaught errors and unmatched routes; API paths get JSON, public paths get plain text
- Public edition pages and API reads use conditional caching helpers (`ETag`, `Last-Modified`)
- Search and authenticated mutation endpoints are rate-limited in memory by client IP
- Write routes are disabled when `API_KEY` is not configured
- The app is private: pages include `noindex, nofollow`, `<meta name="description">`, and `/robots.txt` blocks crawlers
- Link rendering rejects unsafe protocols (`javascript:`, `data:`, `vbscript:`) and escapes raw HTML to prevent stored XSS

## Client-side and assets

`public/app.js` handles theme toggle (persisted in localStorage, respects `prefers-color-scheme`), debounced command palette search calling `/api/search`, scroll-to-top button, mobile hamburger menu, mobile floating TOC button with bottom-sheet panel, reading progress bar, and revista/feed view switching.

`public/theme-init.js` runs synchronously in `<head>` to prevent dark-mode flash before CSS loads.

Static assets are served from `public/`, and uploaded images are served from `UPLOADS_DIR` through `/static/uploads/*`.

## Tests

There is a Bun test suite in `tests/`:

- `tests/curations.test.ts` covers validation, rendering helpers, edition ID validation, SSRF helpers, and OG image resolution
- `tests/app.test.ts` covers health/readiness, `/latest`, preview-bot redirects, ETag behavior, search rate limiting, publish, draft publish, edit, frontmatter patch, search invalidation after edit, draft cleanup, version retention, and diff generation

## Markdown content format

Expected structure:

```md
---
image_url: https://...
---
# Title

*Generado ...*

---

## Noticia principal: HEADLINE

...

## Section
### [Story title](https://example.com)
```

The validator expects a `## Noticia principal: ...` section, regular content sections, and story links. Legacy content using `## 🔥 Featured Story: ...` is still accepted for backward compatibility. Frontmatter `image_url` is the highest-priority hero image; otherwise the app tries OG image extraction from the featured link, then falls back to `DEFAULT_COVER`.
