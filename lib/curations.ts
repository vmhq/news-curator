import { readdir, readFile } from "fs/promises";
import { existsSync, watch, type FSWatcher } from "fs";
import { join } from "path";
import { escapeHtml } from "./html.ts";
import { isCurationFileId } from "./ids.ts";
import { CURATIONS_DIR, SITE_URL } from "./config.ts";
import { marked, Renderer } from "marked";
import { dateFromFileId } from "./dates.ts";
import { extractOgImage, getOgImageCacheStats, clearOgImageCache } from "./og-images.ts";
import { logEvent } from "./logging.ts";

let watcher: FSWatcher | null = null;
let watcherDir: string | null = null;
let watcherEventCount = 0;
let lastWatcherEventAt: string | null = null;

// Custom renderer: open links in new tab + strip raw HTML to prevent stored XSS
const renderer = new Renderer();
renderer.link = function ({ href, text }: { href: string; text: string }) {
  // Only allow safe protocols — reject javascript:, data:, vbscript:, etc.
  let safeParsed: URL | null = null;
  try { safeParsed = new URL(href); } catch { /* relative URLs are fine */ }
  if (safeParsed && safeParsed.protocol !== "http:" && safeParsed.protocol !== "https:") {
    return escapeHtml(text);
  }
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
};
renderer.html = function ({ text }: { text: string }) {
  return escapeHtml(text);
};
marked.use({ renderer });

// ── In-memory caches ──────────────────────────────────────────────────────────
let filesCache: string[] | null = null;
let searchIndexCache: Array<{ date: string; content: string; lower: string; summary: string }> | null = null;
const summaryCache = new Map<string, string>();

export function invalidateFilesCache() {
  filesCache = null;
  searchIndexCache = null;
}

export function invalidateSummaryCache(date: string) {
  summaryCache.delete(date);
}

export function invalidateCurationCache(date: string) {
  summaryCache.delete(date);
  searchIndexCache = null;
}

export function stopDirWatcher() {
  watcher?.close();
  watcher = null;
  watcherDir = null;
}

export function startDirWatcher() {
  if (watcher && watcherDir === CURATIONS_DIR) return true;
  stopDirWatcher();
  if (!existsSync(CURATIONS_DIR)) return false;

  watcher = watch(CURATIONS_DIR, (_event: string, filename: string | null) => {
    watcherEventCount++;
    lastWatcherEventAt = new Date().toISOString();
    filesCache = null;
    searchIndexCache = null;
    if (filename) {
      summaryCache.delete(filename.replace(/\.md$/, ""));
    } else {
      summaryCache.clear();
    }
  });
  watcherDir = CURATIONS_DIR;
  return true;
}

export function getCacheStats() {
  return {
    filesCached: filesCache !== null,
    filesCount: filesCache?.length ?? 0,
    searchIndexEntries: searchIndexCache?.length ?? 0,
    summaryEntries: summaryCache.size,
    ogImageEntries: getOgImageCacheStats().size,
    watcherActive: watcher !== null,
    watcherDir,
    watcherEventCount,
    lastWatcherEventAt,
  };
}

const CURATION_FILENAME_RE = /^\d{4}-\d{2}-\d{2}(_\d{2}-\d{2})?\.md$/;
import { FEATURED_HEADING_RE } from "./validation.ts";

export async function getCurationFiles(): Promise<string[]> {
  if (filesCache) return filesCache;
  try {
    const files = await readdir(CURATIONS_DIR);
    const sorted = files
      .filter((f: string) => CURATION_FILENAME_RE.test(f))
      .map((f: string) => f.replace(".md", ""))
      .sort()
      .reverse();
    filesCache = sorted;
    return sorted;
  } catch (error) {
    logEvent("curations.list_failed", { error: String(error) });
    return [];
  }
}

async function getSearchIndex(): Promise<Array<{ date: string; content: string; lower: string; summary: string }>> {
  if (searchIndexCache) return searchIndexCache;
  const files = await getCurationFiles();
  const index: Array<{ date: string; content: string; lower: string; summary: string }> = [];
  for (const date of files) {
    try {
      const content = await readFile(join(CURATIONS_DIR, `${date}.md`), "utf-8");
      index.push({ date, content, lower: content.toLowerCase(), summary: getSummary(content) });
    } catch (error) {
      logEvent("curations.index_read_failed", { date, error: String(error) });
    }
  }
  searchIndexCache = index;
  return searchIndexCache;
}

export async function searchCurations(
  query: string,
  limit = 20
): Promise<Array<{ date: string; snippet: string; summary: string }>> {
  const normalized = query.slice(0, 200).toLowerCase();
  if (normalized.length < 2) return [];
  const index = await getSearchIndex();
  const results: Array<{ date: string; snippet: string; summary: string }> = [];

  for (const entry of index) {
    const idx = entry.lower.indexOf(normalized);
    if (idx === -1) continue;
    const start = Math.max(0, idx - 60);
    const end = Math.min(entry.content.length, idx + normalized.length + 60);
    let snippet = entry.content.slice(start, end).replace(/\n/g, " ").trim();
    if (start > 0) snippet = "..." + snippet;
    if (end < entry.content.length) snippet += "...";
    results.push({ date: entry.date, snippet, summary: entry.summary });
    if (results.length >= limit) break;
  }

  return results;
}

export function getSummary(content: string): string {
  const clean = content.replace(/^---\n[\s\S]*?\n---\n*/, "");
  const h3 = clean.match(/^### (.+)$/m);
  if (h3?.[1]) return h3[1].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\S+$/, "").trimEnd() || h3[1].slice(0, 80);
  const h2 = clean.match(/^## (.+)$/m);
  if (h2?.[1]) {
    const text = h2[1].replace(/^[^\w]*/, "");
    return text.length > 80 ? text.slice(0, 80).replace(/\S+$/, "").trimEnd() + "…" : text;
  }
  return "Curación diaria";
}

export async function getCachedSummary(date: string): Promise<string> {
  if (summaryCache.has(date)) return summaryCache.get(date)!;
  try {
    const fc = await readFile(join(CURATIONS_DIR, `${date}.md`), "utf-8");
    const summary = getSummary(fc);
    if (summaryCache.size >= MAX_SUMMARY_CACHE) {
      const firstKey = summaryCache.keys().next().value;
      if (firstKey !== undefined) summaryCache.delete(firstKey);
    }
    summaryCache.set(date, summary);
    return summary;
  } catch (error) {
    logEvent("curations.summary_read_failed", { date, error: String(error) });
    return date;
  }
}

export async function readCuration(
  date: string
): Promise<{ raw: string; html: string; coverImage: string | null } | null> {
  try {
    const raw = await readFile(join(CURATIONS_DIR, `${date}.md`), "utf-8");
    return renderCurationContent(raw);
  } catch (error) {
    logEvent("curations.read_failed", { error: String(error) });
    return null;
  }
}

export async function renderCurationContent(
  raw: string
): Promise<{ raw: string; html: string; coverImage: string | null }> {
  const coverMatch = raw.match(/image_url:\s*["']?([^"'\n]*)["']?/);
  const coverImage = coverMatch?.[1] ? coverMatch[1].trim() || null : null;
  let display = raw;
  display = display.replace(/^---\n[\s\S]*?\n---\n+/, "");
  display = display.replace(/^# .+\n+/, "");
  display = display.replace(/^\*Generado .+\*\n+/, "");
  display = display.replace(/^\*Generated at .+\*\n+/, "");
  display = display.replace(/^---\n+/, "");
  // Normalize featured heading to a plain editorial H2 for consistent rendering.
  display = display.replace(FEATURED_HEADING_RE, "## ");
  const html = await marked.parse(display);
  return { raw, html, coverImage };
}

const MAX_SUMMARY_CACHE = 1000;

