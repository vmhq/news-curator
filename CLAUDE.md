# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install        # Install dependencies
bun run server.ts  # Start the server (also: bun run dev / bun run start)
PORT=3000 bun run server.ts  # Custom port (default: 8391)
bun test           # Run test suite
```

Server runs on `http://localhost:8391`. There are Bun tests in `tests/` (no linting configured).

## Stack

- **Runtime:** Bun
- **Framework:** Hono `^4.12.15`
- **Markdown:** Marked `^18.0.2`
- All HTML is server-rendered — no frontend build step or framework.

## Architecture

| File | Responsibility |
|------|---------------|
| `server.ts` | Bun entrypoint; exports `{ port, fetch }` and `createApp` |
| `app.ts` | `createApp()` app assembly, middleware (1 MB body limit, selective gzip, security headers), static files, health/readiness, route registration |
| `routes/public.ts` | Public HTML pages (`/`, `/latest`, `/curacion/:date`, `/ediciones`, `/drafts/:id`) |
| `routes/api.ts` | JSON API, authenticated write endpoints, drafts, versions, diff, uploads |
| `lib/app-deps.ts` | Shared `AppDeps` type for route registration |
| `lib/auth.ts` | API key guard via `X-Api-Key` or `Authorization: Bearer` |
| `lib/config.ts` | Runtime config loading and rate-limit defaults |
| `lib/curations.ts` | File I/O, caches, markdown rendering/parsing, search index |
| `lib/dates.ts` | Date utilities: `todayLocal()`, `dateFromFileId()`, `formatDateEs()` |
| `lib/diff.ts` | Line diff generation for edition snapshots |
| `lib/frontmatter.ts` | Frontmatter parse/serialize and `image_url` validation |
| `lib/html.ts` | Shared HTML escaping helper |
| `lib/http-cache.ts` | ETag / Last-Modified helpers |
| `lib/ids.ts` | Edition, draft, and version ID validation |
| `lib/logging.ts` | JSON structured event logging |
| `lib/observability.ts` | In-memory request/action counters; latency tracking (avg, min, max, P95, last 1000 samples) |
| `lib/og-images.ts` | OG image scraping with timeout, filtering, and cache |
| `lib/rate-limit.ts` | In-memory per-IP rate limiting |
| `lib/retention.ts` | Draft cleanup and version retention |
| `lib/security.ts` | SSRF protection: `isBlockedUrl()`, `isBlockedResolvedUrl()`; filename safety: `isSafeFilename()` |
| `lib/storage.ts` | File-system abstraction for editions, drafts, versions, uploads |
| `lib/validation.ts` | Editorial validation, featured story extraction, reading time |
| `templates/layout.ts` | `buildPage()` and `escapeHtml()` |

**Data source**: Markdown files at the path set by `CURATIONS_DIR` env var (defaults to `/data/curations`). Filenames follow the pattern `YYYY-MM-DD.md` or `YYYY-MM-DD_HH-MM.md` (multiple editions per day). The server reads files at request time — caches in memory, invalidated by a `fs.watch` watcher when enabled.

**Constants (in `lib/config.ts`):**
- `CURATIONS_DIR` — path to markdown files (env var, default `/data/curations`)
- `SITE_URL` — env var, default `http://localhost:8391` — used for canonical URLs and OG tags
- `DEFAULT_COVER = "${SITE_URL}/static/cover.svg"` — fallback hero image
- `TZ = "America/Santiago"` — timezone for `todayLocal()`
- `draftTtlHours` — default 72 h; `maxVersionsPerEdition` — default 20

**Default rate limits (overridable via env):**
- search: 20 req / 10 s
- images: 10 req / 60 s
- publish: 10 req / 60 s
- drafts: 20 req / 60 s
- edits: 30 req / 60 s

---

## Key functions

### `lib/curations.ts`

**File handling & caching:**
- `getCurationFiles()` — reads and sorts all filenames descending (newest first); supports `YYYY-MM-DD_HH-MM` suffixed names; result cached in `filesCache`
- `getRenderedCuration(date)` — reads a file, renders it, and caches the result keyed by `mtimeMs`; invalidates automatically when the file changes
- `renderCurationContent(raw)` — strips frontmatter/H1/timestamp line, normalizes `## Noticia principal:` heading (and accepts the legacy `## 🔥 Featured Story:` form) for consistent rendering, runs `marked.parse()`, and extracts feed items; returns `{ raw, html, coverImage, feedItems }`
- `extractFeedItems(content)` — parses H2/H3 structure into `{ section, headline, excerpt, href }` objects for the feed layout
- `readCuration(date)` — thin wrapper around `renderCurationContent` after reading the file
- `invalidateFilesCache()` — clears `filesCache` and `searchIndexCache`
- `invalidateSummaryCache(date)` — evicts one entry from `summaryCache`
- `invalidateCurationCache(date)` — evicts summary and clears search index after edits
- `invalidateRenderCache(date)` — evicts one entry from `renderCache`
- `startDirWatcher()` / `stopDirWatcher()` — manage `fs.watch` with 100 ms debounce; invalidates all caches on change
- `getCacheStats()` — returns cache sizes and watcher state
- `getSummary(content)` — extracts a short title from the first `### ` or `## ` heading, trimmed at word boundary
- `getCachedSummary(date)` — reads and caches the summary for an edition; evicts oldest when over `MAX_SUMMARY_CACHE = 1000`
- `searchCurations(query, limit)` — full-text search over a cached in-memory index
- `dateFromFileId(id)` — strips time suffix (now in `lib/dates.ts`)
- `findTodayCuration(files)` — returns the most recent file ID matching today's date (Santiago TZ)
- `todayLocal()` — today's date as `YYYY-MM-DD` using `America/Santiago` (now in `lib/dates.ts`)
- `formatDateEs(dateStr)` — Spanish date formatting (now in `lib/dates.ts`)

**Custom renderer security:**
- The `Marked` instance uses a custom `Renderer` that:
  - Opens all links in a new tab with `rel="noopener noreferrer"`
  - Rejects unsafe protocols (`javascript:`, `data:`, `vbscript:`) and renders only the escaped text
  - Escapes raw HTML (`<script>`, event handlers) to prevent stored XSS

### `lib/validation.ts`

- `extractFeatured(content)` — parses the `## Noticia principal:` section (keeps compatibility with the legacy emoji form); excerpt is the first full paragraph, truncated at 280 chars on a word boundary with `…`; also extracts `firstUrl`
- `validateCurationContent(content)` — returns `{ valid, errors, warnings, stats }` with editorial rules:
  - Errors: content too short/large, unclosed frontmatter, missing featured story, missing sections/stories, unsafe link protocols
  - Warnings: missing frontmatter, missing/duplicate H1, short headline/excerpt, missing featured link, duplicate links, relative/invalid links, raw HTML detected
- `estimateReadingTime(raw)` — returns estimated reading time in minutes (words / 200, minimum 1)
- `FEATURED_HEADING_RE` / `FEATURED_HEADING_LABEL_RE` — regex constants for featured story detection

### `lib/security.ts`

- `isBlockedUrl(url)` — rejects private IPs, loopback, link-local, `.internal`/`.local`/`.localhost` domains, and non-http(s) protocols
- `isSafeFilename(filename)` — allows only alphanumeric, dots, dashes, underscores; rejects empty strings and leading dots
- `isBlockedResolvedUrl(url)` — DNS-aware SSRF protection using external resolvers (`1.1.1.1`, `8.8.8.8`) with a 1-hour TTL cache; resolves the hostname and checks if any returned address is blocked

### `lib/og-images.ts`

- `resolveOgImageCandidate(pageUrl, html)` — scrapes `og:image` and `twitter:image` meta tags from HTML, resolves relative URLs against `pageUrl`, and filters out logos/icons via `isGoodOgImage()`
- `extractOgImage(url)` — fetches a URL with 5s timeout, reads max 50 KB, runs `resolveOgImageCandidate()`, caches result in `ogImageCache` (max 500 entries, 24-hour TTL, LRU eviction); returns `string | null`
- `getCachedOgImage(url)` — synchronous cache read; returns `string | null | undefined` (undefined = not cached)
- `getOgImageCacheStats()` / `clearOgImageCache()` — cache introspection

**Hero image priority:** `coverImage` from frontmatter → `extractOgImage()` from featured URL → `DEFAULT_COVER`

### `lib/storage.ts`

Abstracts all file-system operations so routes don't import `fs` directly:

- **Editions:** `editionFilePath()`, `editionExists()`, `readEdition()`, `writeEdition()`, `statEdition()`
- **Drafts:** `draftFilePath()`, `draftExists()`, `readDraft()`, `writeDraft()`, `listDrafts()`
- **Versions:** `versionDirPath()`, `versionFilePath()`, `ensureVersionDir()`, `writeVersion()`, `listVersions()`, `readVersion()`
- **Uploads:** `ensureUploadsDir()`, `writeUpload()`

### `lib/frontmatter.ts`

- `parseFrontmatter(content)` — extracts YAML-like frontmatter into `{ meta: Record<string, string>, body: string }`
- `serializeFrontmatter(meta, body)` — reassembles frontmatter + body; sanitizes keys and values
- `validateImageUrl(url, config)` — validates `image_url`: allows `/static/uploads/` references (checks file exists), rejects blocked URLs, performs a HEAD request to confirm it's an image
- `checkImageUrl(content, config)` — extracts `image_url` from frontmatter and validates it; returns warning string or `null`

### `lib/dates.ts`

- `todayLocal()` — today's date as `YYYY-MM-DD` using `America/Santiago`
- `dateFromFileId(id)` — strips time suffix: `"2026-04-07_22-21"` → `"2026-04-07"`
- `formatDateEs(dateStr)` — formats a file ID to Spanish date string; if the ID has a time suffix, appends `(HH:MM)` e.g. `"Miércoles 8 de abril de 2026 (22:21)"`
- `allEditionsSidebar(files)` — returns files as-is (already sorted desc)

### `lib/rate-limit.ts`

- `InMemoryRateLimiter` — window-based per-IP rate limiter; max 10,000 tracked buckets with LRU eviction
  - `hit(bucket, key, rule)` → `{ limited: boolean, retryAfterMs: number }`
  - `snapshot()` → `{ trackedBuckets: number }`
- `getRequestIp(c, trustProxy)` — extracts client IP; reads `X-Forwarded-For` when `trustProxy=true`, falls back to Cloudflare's `c.env.requestIP.address`, defaults to `"anonymous"`

### `lib/ids.ts`

- `isCurationFileId(id)` — validates `YYYY-MM-DD` or `YYYY-MM-DD_HH-MM`
- `isDraftId(id)` — validates UUID (36-char hex)
- `isVersionId(id)` — validates `YYYY-MM-DDThh-mm-ss-Z-{reason}` (timestamp + reason slug)

### `lib/retention.ts`

- `cleanupExpiredDrafts(config)` — removes drafts older than `DRAFT_TTL_HOURS`
- `trimVersionHistory(date, config)` — enforces `MAX_VERSIONS_PER_EDITION` per edition
- `runRetentionPass(config)` — runs cleanup on startup

### `templates/layout.ts`

- `buildPage(title, body, meta)` — assembles full HTML. Key meta options:
  - `hideSidebar: true` — renders `.content-layout.content-full` (no sidebar, max 860px centered)
  - `sidebarHasMore / sidebarHasPrev / sidebarPage` — sidebar pagination controls
  - `canonicalPath` — used for canonical URL and OG tags
  - `readingTime` — displayed in the article header
  - `featured` — builds the hero section with headline, excerpt, CTA, and hero image (or pastel SVG fallback)
  - `feedItems` — builds the feed-layout view with numbered story cards
  - `siteUrl` — canonical base URL
- `escapeHtml(str)` — HTML-escapes a string; exported and used in routes
- `formatDateShort(fileId)` — compact date for sidebar/recent lists
- `formatDateEsNoYear(fileId)` — `"Viernes 17 de abril"` for hero date
- `heroArtSvg()` — pastel SVG fallback composition when no hero image is available

---

## Routes

| Route | Description |
|-------|-------------|
| `GET /` | Today's most recent edition (falls back to latest); `?p=N` paginates sidebar (8/page) |
| `GET /latest` | Redirect to the canonical latest edition URL |
| `GET /curacion/:date` | Specific edition by file ID (supports `YYYY-MM-DD` and `YYYY-MM-DD_HH-MM`) |
| `GET /ediciones` | Full list of all editions — no sidebar (`hideSidebar: true`), uses `.content-full` |
| `GET /drafts/:id` | HTML preview for a stored draft |
| `GET /api/curations` | Paginated JSON list: `?page=&limit=` (offset) or `?before=&limit=` (cursor) |
| `GET /api/curations/:date` | Raw markdown content of a specific edition (public) |
| `PUT /api/curations/:date` | Replace content of an existing edition; saves snapshot (requires `X-Api-Key`) |
| `PATCH /api/curations/:date/meta` | Update only frontmatter fields; saves snapshot (requires `X-Api-Key`) |
| `GET /api/curations/:date/versions` | List saved snapshots for an edition (requires `X-Api-Key`) |
| `GET /api/curations/:date/versions/:version` | Read one snapshot raw (requires `X-Api-Key`) |
| `GET /api/curations/:date/diff/latest` | Diff current edition vs latest snapshot (requires `X-Api-Key`) |
| `GET /api/search?q=` | Full-text search across all markdown files (min 2 chars) |
| `POST /api/validate` | Validate markdown before publish/edit (requires `X-Api-Key`) |
| `POST /api/publish` | Publish a new edition from content or `draft_id` (requires `X-Api-Key`) |
| `POST /api/drafts` | Create a validated draft and get preview URL (requires `X-Api-Key`) |
| `GET /api/drafts/recent` | Latest draft available with validation status (requires `X-Api-Key`) |
| `GET /api/drafts/:id` | Read draft raw + validation result (requires `X-Api-Key`) |
| `POST /api/drafts/:id/publish` | Publish a validated draft (requires `X-Api-Key`) |
| `POST /api/images` | Upload an image file (jpeg/png/webp/gif/avif, max 10 MB) (requires `X-Api-Key`) |
| `GET /health` | Operational health — uptime, file totals, cache stats, metrics, rate-limiter snapshot |
| `GET /health/internal` | Authenticated health with effective config |
| `GET /ready` | Readiness check — upload/draft/version directory readiness and watcher state |
| `GET /robots.txt` | `Disallow: /` — blocks all crawlers |

---

## Sidebar pagination (`/` only)

- Query param `?p=N` selects which page of 8 editions appears in the sidebar
- All editions (including multiple per day) are shown, sorted newest first
- `sidebarHasMore` / `sidebarHasPrev` / `sidebarPage` passed to `buildPage()`

---

## HTML `<head>` per page

- `noindex, nofollow` + `googlebot: noindex` meta tags (private site)
- Open Graph and Twitter Card meta tags (uses hero image or `DEFAULT_COVER`)
- Canonical URL using `SITE_URL + canonicalPath`
- `theme-init.js` loaded synchronously in `<head>` to prevent dark-mode flash
- Security headers via middleware: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Content-Security-Policy`; `Strict-Transport-Security` only when `SITE_URL` starts with `https://`

---

## HTTP and security behavior

- All responses receive `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `Content-Security-Policy`
- `Strict-Transport-Security` is only sent when `SITE_URL` starts with `https://`
- Public edition pages and API reads use conditional caching helpers (`ETag`, `Last-Modified`)
- Search and authenticated mutation endpoints are rate-limited in memory by client IP
- Write routes are disabled when `API_KEY` is not configured
- The app is private: pages include `noindex, nofollow`, and `/robots.txt` blocks crawlers
- Link rendering rejects unsafe protocols (`javascript:`, `data:`, `vbscript:`) and escapes raw HTML

---

## Tests

Bun test suite in `tests/`:

- `tests/curations.test.ts` — validation, rendering helpers, edition ID validation, SSRF helpers, OG image resolution
- `tests/app.test.ts` — health/readiness, `/latest`, preview-bot redirects, ETag behavior, search rate limiting, draft cleanup, version retention, diff generation, publish, draft publish, edit, frontmatter patch, search invalidation after edit

---

## Client-side (`public/app.js`)

Theme toggle (persisted in localStorage, respects `prefers-color-scheme`), debounced search calling `/api/search` via command palette (`⌘K`), scroll-to-top button, mobile hamburger menu, mobile floating TOC button with bottom-sheet panel, reading progress bar, and revista/feed view switching via segmented tabs.

`public/theme-init.js` runs synchronously before any CSS to prevent dark-mode flash.

---

## Styles (`public/style.css`)

- Sky-blue accent palette (`--blue: #0EA5E9`, `--blue-dark: #0369A1`)
- Light/dark theme via `[data-theme]` attribute on `<html>`
- Navbar and footer background: `#1E293B` (slate-800)
- Responsive: single-column below 768px, hero stacks vertically on mobile
- Article body: Inter sans-serif, `text-align: justify`, `hyphens: auto`
- `hr` elements in article body are hidden (`display: none`)
- `.content-full` — full-width layout without sidebar (used by `/ediciones`): `max-width: 860px`, centered
- `.edition-meta` — column flex wrapper for `edition-date` + `edition-title` inside `.edition-card`
- Sidebar pagination styles: `.sidebar-pagination`, `.sidebar-page-btn`
- Hero visual: image or pastel SVG fallback with geometric composition
- Stats row: 4-column grid showing story count, section count, reading time, and active topic
- Feed layout: numbered story cards with section pills, headlines, excerpts, and read-more links
- Segmented tabs: "Revista/Feed" switcher on article pages, "Revista/Archivo" nav on archive

---

## Markdown content format

Expected structure the server parses:

```
---
image_url: https://...   ← optional cover image (highest priority for hero)
---
# Title (stripped)
*Generado ... * (stripped)
---
## Noticia principal: HEADLINE   ← extracted as hero AND rendered in body
...
## Section
### Item with [link](url)
```

Static assets are served from `public/` via the `/static/*` route.
Uploaded images are served from `UPLOADS_DIR` via `/static/uploads/*` (takes priority over the generic serveStatic).

**Privacy:** The site is private — all pages include `noindex, nofollow` and `/robots.txt` returns `Disallow: /`.
