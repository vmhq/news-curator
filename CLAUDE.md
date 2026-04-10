# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install        # Install dependencies
bun run server.ts  # Start the server (also: bun run dev / bun run start)
PORT=3000 bun run server.ts  # Custom port (default: 8080)
```

Server runs on `http://localhost:8080`. There are no tests or linting configured.

## Architecture

Single-file server (`server.ts`) using **Bun** runtime + **Hono** framework. All HTML is server-rendered via the `buildPage()` function — no frontend build step or framework.

**Data source**: Markdown files at `/home/ai/llm-wiki/raw/curations/` (external directory, not in this repo). Filenames follow the pattern `YYYY-MM-DD.md` or `YYYY-MM-DD_HH-MM.md` (multiple editions per day). The server reads files at request time — no cache, no database.

**Constants:**
- `CURATIONS_DIR` — path to markdown files
- `SITE_URL = "https://dailyb.vmhq.cl"` — used for canonical URLs and OG tags
- `TZ = "America/Santiago"` — timezone for `todayLocal()`
- `DEFAULT_COVER = "${SITE_URL}/static/cover.svg"` — fallback hero image

---

## Key functions

**File handling:**
- `getCurationFiles()` — reads and sorts all filenames descending (newest first); supports `YYYY-MM-DD_HH-MM` suffixed names
- `dateFromFileId(id)` — strips time suffix: `"2026-04-07_22-21"` → `"2026-04-07"`
- `findTodayCuration(files)` — returns the most recent file ID matching today's date (Santiago TZ), supporting multiple editions per day
- `groupByDay(files)` — groups file IDs by their date component (returns Map)
- `allEditionsSidebar(files)` — returns files as-is (already sorted desc); used for sidebar listing
- `todayLocal()` — today's date as `YYYY-MM-DD` using `America/Santiago` timezone

**Parsing:**
- `readCuration(date)` — reads a markdown file; extracts `coverImage` from frontmatter (`image_url:` field), strips frontmatter/H1/timestamp line, returns `{ raw, html, coverImage }`. The featured story block is **not** stripped — it appears in both the hero and the article body.
- `extractFeatured(content)` — parses the `## 🔥 Featured Story` section; excerpt is the first full paragraph (`split("\n\n")[0]`), truncated at 280 chars on a word boundary with `…`; also extracts `firstUrl`
- `getSummary(content)` — extracts a short title from the first `### ` or `## ` heading, trimmed at word boundary
- `formatDateEs(dateStr)` — formats a file ID to Spanish date string; if the ID has a time suffix, appends `(HH:MM)` e.g. `"Miércoles 8 de abril de 2026 (22:21)"`

**Image handling:**
- `isGoodOgImage(imgUrl)` — rejects URLs matching `LOGO_PATTERNS` (logos, icons, favicons) or tiny images
- `extractOgImage(url)` — fetches a URL, scrapes `og:image` or `twitter:image`, validates with `isGoodOgImage()` (5s timeout, best-effort)
- Hero image priority: `coverImage` from frontmatter → `extractOgImage()` from featured URL → `DEFAULT_COVER`

**Rendering:**
- `buildPage(title, body, meta)` — assembles full HTML. Key meta options:
  - `hideSidebar: true` — renders `.content-layout.content-full` (no sidebar, max 860px centered)
  - `sidebarHasMore / sidebarHasPrev / sidebarPage` — sidebar pagination controls
  - `canonicalPath` — used for canonical URL and OG tags

---

## Routes

| Route | Description |
|-------|-------------|
| `GET /` | Today's most recent edition (falls back to latest); `?p=N` paginates sidebar (8/page) |
| `GET /curacion/:date` | Specific edition by file ID (supports `YYYY-MM-DD` and `YYYY-MM-DD_HH-MM`) |
| `GET /ediciones` | Full list of all editions — no sidebar (`hideSidebar: true`), uses `.content-full` |
| `GET /api/curations?page=&limit=` | Paginated JSON list of editions |
| `GET /api/search?q=` | Full-text search across all markdown files (min 2 chars) |
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

---

## Client-side (`public/app.js`)

Theme toggle (persisted in localStorage, respects `prefers-color-scheme`), debounced search calling `/api/search`, scroll-to-top button, mobile hamburger menu.

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
## 🔥 Featured Story: HEADLINE   ← extracted as hero AND rendered in body
...
## Section
### Item with [link](url)
```

Static assets are served from `public/` via the `/static/*` route.

**Privacy:** The site is private — all pages include `noindex, nofollow` and `/robots.txt` returns `Disallow: /`.
