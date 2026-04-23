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

## Architecture

Multi-file server using **Bun** runtime + **Hono** framework. All HTML is server-rendered; there is no frontend build step.

| File | Responsibility |
|------|---------------|
| `server.ts` | Bun entrypoint; exports `{ port, fetch }` |
| `app.ts` | `createApp()` app assembly, middleware, static files, health/readiness, route registration |
| `routes/public.ts` | Public HTML pages (`/`, `/curacion/:date`, `/ediciones`, `/drafts/:id`) |
| `routes/api.ts` | JSON API, authenticated write endpoints, drafts, versions, diff, uploads |
| `lib/config.ts` | Runtime config loading and rate-limit defaults |
| `lib/curations.ts` | File I/O, caches, markdown rendering/parsing, search index, validation, OG image helpers |
| `lib/frontmatter.ts` | Frontmatter parse/serialize and `image_url` validation |
| `lib/http-cache.ts` | ETag / Last-Modified helpers |
| `lib/rate-limit.ts` | In-memory per-IP rate limiting |
| `lib/retention.ts` | Draft cleanup and version retention |
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

`app.ts` calls `loadRuntimeConfig()` and `configureCurationsEnv()`, starts or stops the directory watcher, and runs a retention pass on startup.

## Key functions

### `lib/curations.ts`

File handling and caches:

- `getCurationFiles()` — reads, validates, sorts, and caches edition IDs descending
- `searchCurations(query, limit)` — full-text search over a cached in-memory index
- `invalidateFilesCache()` — clears file/index caches
- `invalidateSummaryCache(date)` — evicts one summary entry
- `startDirWatcher()` / `stopDirWatcher()` — manage `fs.watch`
- `getCacheStats()` — cache and watcher status for `/health`
- `isCurationFileId(id)` / `CURATION_FILE_ID_RE` — canonical edition ID validation
- `dateFromFileId(id)` / `todayLocal()` / `findTodayCuration(files)` / `groupByDay(files)` / `allEditionsSidebar(files)` — edition/date utilities

Rendering and parsing:

- `readCuration(date)` — reads markdown, parses frontmatter, returns `{ raw, html, coverImage }`
- `renderCurationContent(content)` — renders markdown content without needing a file read
- `extractFeatured(content)` — extracts featured story headline, excerpt, and first URL
- `getSummary(content)` / `getCachedSummary(date)` — summary extraction and caching
- `validateCurationContent(content)` — editorial validation with errors, warnings, and stats
- `estimateReadingTime(raw)` / `formatDateEs(dateStr)` — article metadata helpers

Image safety:

- `isBlockedUrl(url)` — rejects private/local/non-http(s) URLs before fetch
- `isBlockedResolvedUrl(url)` — DNS-aware SSRF protection for hostnames that resolve to blocked IPs
- `resolveOgImageCandidate(pageUrl, html)` — resolves relative OG image URLs
- `extractOgImage(url)` — best-effort OG image scraping with timeout and cache

### `app.ts`

- Global security headers middleware
- Static handling for `/static/*` and `/static/uploads/*`
- `GET /health` — uptime, file totals, cache stats, metrics, effective config
- `GET /ready` — upload/draft/version directory readiness and watcher state

### `routes/api.ts`

- Applies per-bucket rate limiting for search, images, publish, drafts, and edits
- Supports API key auth for write endpoints
- Saves version snapshots on `PUT` / `PATCH`
- Publishes from raw content or from a stored draft

### `routes/public.ts`

- Renders today/latest edition, edition detail pages, editions index, and draft preview
- Handles sidebar pagination on `/` with `SIDEBAR_PAGE_SIZE = 8`
- Builds featured-story hero metadata and reading time

## Routes

| Route | Description |
|------|-------------|
| `GET /` | Today's latest edition; falls back to latest available; `?p=N` paginates sidebar |
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
| `POST /api/images` | Image upload; requires `X-Api-Key` |
| `POST /api/validate` | Validate markdown before publish/edit; requires `X-Api-Key` |
| `POST /api/publish` | Publish a new edition from content or `draft_id`; requires `X-Api-Key` |
| `POST /api/drafts` | Create a validated draft; requires `X-Api-Key` |
| `GET /api/drafts/recent` | Return latest draft plus validation result; requires `X-Api-Key` |
| `GET /api/drafts/:id` | Return raw draft content plus validation; requires `X-Api-Key` |
| `POST /api/drafts/:id/publish` | Publish a stored draft; requires `X-Api-Key` |
| `GET /health` | Operational health |
| `GET /ready` | Readiness probe |
| `GET /robots.txt` | `Disallow: /` |

## HTTP and security behavior

- All responses receive `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `Content-Security-Policy`
- `Strict-Transport-Security` is only sent when `SITE_URL` starts with `https://`
- Public edition pages and API reads use conditional caching helpers (`ETag`, `Last-Modified`)
- Search and authenticated mutation endpoints are rate-limited in memory by client IP
- Write routes are disabled when `API_KEY` is not configured
- The app is private: pages include `noindex, nofollow`, and `/robots.txt` blocks crawlers

## Client-side and assets

`public/app.js` handles theme toggle, debounced search, mobile menu, scroll-to-top, and floating mobile TOC behavior. Static assets are served from `public/`, and uploaded images are served from `UPLOADS_DIR` through `/static/uploads/*`.

## Tests

There is a Bun test suite in `tests/`:

- `tests/curations.test.ts` covers validation, rendering helpers, edition ID validation, and SSRF helpers
- `tests/app.test.ts` covers health/readiness, ETag behavior, search rate limiting, draft cleanup, version retention, and diff generation

## Markdown content format

Expected structure:

```md
---
image_url: https://...
---
# Title

*Generado ...*

---

## 🔥 Featured Story: HEADLINE

...

## Section
### [Story title](https://example.com)
```

The validator expects a featured story, section structure, and story links. Frontmatter `image_url` is the highest-priority hero image; otherwise the app tries OG image extraction from the featured link, then falls back to `DEFAULT_COVER`.
