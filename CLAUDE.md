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

**Data source**: Markdown files at the path set by `CURATIONS_DIR` env var (defaults to `/data/curations`). Filenames follow the pattern `YYYY-MM-DD.md` or `YYYY-MM-DD_HH-MM.md` (multiple editions per day). The server reads files at request time — caches in memory, invalidated by a `fs.watch` watcher.

**Constants (in `lib/curations.ts`):**
- `CURATIONS_DIR` — path to markdown files (env var, default `/data/curations`)
- `SITE_URL` — env var, default `http://localhost:8391` — used for canonical URLs and OG tags
- `TZ = "America/Santiago"` — timezone for `todayLocal()`
- `DEFAULT_COVER = "${SITE_URL}/static/cover.svg"` — fallback hero image

---

## Key functions

### `lib/curations.ts`

**File handling & caching:**
- `getCurationFiles()` — reads and sorts all filenames descending (newest first); supports `YYYY-MM-DD_HH-MM` suffixed names; result cached in `filesCache`
- `invalidateFilesCache()` — clears `filesCache`
- `invalidateSummaryCache(date)` — evicts one entry from `summaryCache`
- `startDirWatcher()` — sets up `fs.watch` on `CURATIONS_DIR`; invalidates caches on any file change
- `getCachedSummary(date)` — reads and caches the summary for an edition; evicts oldest when over `MAX_SUMMARY_CACHE = 1000`
- `dateFromFileId(id)` — strips time suffix: `"2026-04-07_22-21"` → `"2026-04-07"`
- `findTodayCuration(files)` — returns the most recent file ID matching today's date (Santiago TZ)
- `groupByDay(files)` — groups file IDs by their date component (returns Map)
- `allEditionsSidebar(files)` — returns files as-is (already sorted desc); used for sidebar listing
- `todayLocal()` — today's date as `YYYY-MM-DD` using `America/Santiago` timezone

**Parsing:**
- `readCuration(date)` — reads a markdown file; extracts `coverImage` from frontmatter (`image_url:` field), strips frontmatter/H1/timestamp line, normalizes `## Noticia principal:` heading (and accepts the legacy `## 🔥 Featured Story:` form) for consistent rendering, returns `{ raw, html, coverImage }`. The featured story block appears in both the hero and the article body.
- `extractFeatured(content)` — parses the `## Noticia principal:` section (and keeps compatibility with the legacy emoji form); excerpt is the first full paragraph (`split("\n\n")[0]`), truncated at 280 chars on a word boundary with `…`; also extracts `firstUrl`
- `getSummary(content)` — extracts a short title from the first `### ` or `## ` heading, trimmed at word boundary
- `formatDateEs(dateStr)` — formats a file ID to Spanish date string; if the ID has a time suffix, appends `(HH:MM)` e.g. `"Miércoles 8 de abril de 2026 (22:21)"`
- `estimateReadingTime(raw)` — returns estimated reading time in minutes (words / 200, minimum 1)

**Image handling:**
- `isBlockedUrl(url)` — rejects private IPs, loopback, link-local, `.internal`/`.local`/`.localhost` domains, and non-http(s) protocols (SSRF protection)
- `isBlockedResolvedUrl(url)` — DNS-aware SSRF protection for hostnames that resolve to blocked IPs
- `isGoodOgImage(imgUrl)` — rejects URLs matching `LOGO_PATTERNS` (logos, icons, favicons) or tiny images
- `extractOgImage(url)` — fetches a URL, scrapes `og:image` or `twitter:image`, validates with `isGoodOgImage()` (5s timeout, reads max 50 KB, best-effort); cached in `ogImageCache` (max 500 entries)
- Hero image priority: `coverImage` from frontmatter → `extractOgImage()` from featured URL → `DEFAULT_COVER`

### `lib/retention.ts`

- `cleanupExpiredDrafts()` — removes drafts older than `DRAFT_TTL_HOURS` (default 72)
- `trimVersionSnapshots()` — enforces `MAX_VERSIONS_PER_EDITION` (default 20) per edition

### `templates/layout.ts`

- `buildPage(title, body, meta)` — assembles full HTML. Key meta options:
  - `hideSidebar: true` — renders `.content-layout.content-full` (no sidebar, max 860px centered)
  - `sidebarHasMore / sidebarHasPrev / sidebarPage` — sidebar pagination controls
  - `canonicalPath` — used for canonical URL and OG tags
  - `readingTime` — displayed in the article header
- `escapeHtml(str)` — HTML-escapes a string; exported and used in routes

---

## Routes

| Route | Description |
|-------|-------------|
| `GET /` | Today's most recent edition (falls back to latest); `?p=N` paginates sidebar (8/page) |
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
| `POST /api/publish` | Publish a new edition — ID generated from current Santiago time (requires `X-Api-Key`) |
| `POST /api/drafts` | Create a validated draft and get preview URL (requires `X-Api-Key`) |
| `GET /api/drafts/recent` | Latest draft available with validation status (requires `X-Api-Key`) |
| `GET /api/drafts/:id` | Read draft raw + validation result (requires `X-Api-Key`) |
| `POST /api/drafts/:id/publish` | Publish a validated draft (requires `X-Api-Key`) |
| `POST /api/images` | Upload an image file (jpeg/png/webp/gif/avif, max 10 MB) (requires `X-Api-Key`) |
| `GET /health` | Operational health — uptime, file totals, cache stats, metrics, effective config |
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
- Security headers via middleware: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Content-Security-Policy`; `Strict-Transport-Security` only when `SITE_URL` starts with `https://`

---

## HTTP and security behavior

- All responses receive `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `Content-Security-Policy`
- `Strict-Transport-Security` is only sent when `SITE_URL` starts with `https://`
- Public edition pages and API reads use conditional caching helpers (`ETag`, `Last-Modified`)
- Search and authenticated mutation endpoints are rate-limited in memory by client IP
- Write routes are disabled when `API_KEY` is not configured
- The app is private: pages include `noindex, nofollow`, and `/robots.txt` blocks crawlers

---

## Tests

Bun test suite in `tests/`:

- `tests/curations.test.ts` — validation, rendering helpers, edition ID validation, and SSRF helpers
- `tests/app.test.ts` — health/readiness, ETag behavior, search rate limiting, draft cleanup, version retention, and diff generation

---

## Client-side (`public/app.js`)

Theme toggle (persisted in localStorage, respects `prefers-color-scheme`), debounced search calling `/api/search`, scroll-to-top button, mobile hamburger menu, mobile floating TOC button with bottom-sheet panel.

---

## Styles (`public/style.css`)

- Sky-blue accent palette (`--blue: #0EA5E9`, `--blue-dark: #0369A1`)
- Light/dark theme via `[data-theme]` attribute on `<html>`
- Navbar and footer background: `#1E293B` (slate-800) — contrasts with dark mode page bg `#0A0F1E`
- Responsive: single-column below 768px, hero stacks vertically on mobile
- Article body: Inter sans-serif, `text-align: justify`, `hyphens: auto`
- `hr` elements in article body are hidden (`display: none`)
- `.content-full` — full-width layout without sidebar (used by `/ediciones`): `max-width: 860px`, centered
- `.edition-meta` — column flex wrapper for `edition-date` + `edition-title` inside `.edition-card`
- Sidebar pagination styles: `.sidebar-pagination`, `.sidebar-page-btn`

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
