import { readdir, readFile } from "fs/promises";
import { existsSync, watch, type FSWatcher } from "fs";
import { join } from "path";
import { lookup } from "node:dns/promises";
import { marked, Renderer } from "marked";

export let CURATIONS_DIR =
  process.env.CURATIONS_DIR ?? "/data/curations";
export let SITE_URL =
  process.env.SITE_URL ?? "http://localhost:8391";
export let DEFAULT_COVER = `${SITE_URL}/static/cover.svg`;
const TZ = "America/Santiago";
let watcher: FSWatcher | null = null;
let watcherDir: string | null = null;
let watcherEventCount = 0;
let lastWatcherEventAt: string | null = null;

export function configureCurationsEnv(config: {
  curationsDir?: string;
  siteUrl?: string;
}) {
  const nextCurationsDir = config.curationsDir?.trim();
  const nextSiteUrl = config.siteUrl?.trim();

  if (nextCurationsDir && nextCurationsDir !== CURATIONS_DIR) {
    CURATIONS_DIR = nextCurationsDir;
    invalidateFilesCache();
    summaryCache.clear();
    ogImageCache.clear();
  }

  if (nextSiteUrl && nextSiteUrl !== SITE_URL) {
    SITE_URL = nextSiteUrl;
    DEFAULT_COVER = `${SITE_URL}/static/cover.svg`;
  }
}

function escapeHtmlInternal(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Custom renderer: open links in new tab + strip raw HTML to prevent stored XSS
const renderer = new Renderer();
renderer.link = function ({ href, text }: { href: string; text: string }) {
  // Only allow safe protocols — reject javascript:, data:, vbscript:, etc.
  let safeParsed: URL | null = null;
  try { safeParsed = new URL(href); } catch { /* relative URLs are fine */ }
  if (safeParsed && safeParsed.protocol !== "http:" && safeParsed.protocol !== "https:") {
    return escapeHtmlInternal(text);
  }
  return `<a href="${escapeHtmlInternal(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
};
renderer.html = function ({ text }: { text: string }) {
  return escapeHtmlInternal(text);
};
marked.use({ renderer });

// ── In-memory caches ──────────────────────────────────────────────────────────
let filesCache: string[] | null = null;
let searchIndexCache: Array<{ date: string; content: string; lower: string; summary: string }> | null = null;
const summaryCache = new Map<string, string>();
const ogImageCache = new Map<string, string | null>();

export function invalidateFilesCache() {
  filesCache = null;
  searchIndexCache = null;
}

export function invalidateSummaryCache(date: string) {
  summaryCache.delete(date);
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
    ogImageEntries: ogImageCache.size,
    watcherActive: watcher !== null,
    watcherDir,
    watcherEventCount,
    lastWatcherEventAt,
  };
}

export const CURATION_FILE_ID_RE = /^\d{4}-\d{2}-\d{2}(_\d{2}-\d{2})?$/;
const CURATION_FILENAME_RE = /^\d{4}-\d{2}-\d{2}(_\d{2}-\d{2})?\.md$/;
const FEATURED_HEADING_RE = /^## (?:(?:🔥\s*(?:Featured Story:\s*)?)|Noticia principal:\s*)/gim;
const FEATURED_SECTION_RE =
  /## (?:(?:🔥\s*(?:Featured Story:\s*)?)|Noticia principal:\s*)(.+?)\n\n([\s\S]*?)(?=\n---|\n## (?!\s*(?:(?:🔥\s*(?:Featured Story:\s*)?)|Noticia principal:\s*))|$)/i;
const FEATURED_HEADING_LABEL_RE = /^(?:🔥(?:\s*Featured Story:)?|Noticia principal:)\s*/i;

export function isCurationFileId(id: string): boolean {
  return CURATION_FILE_ID_RE.test(id);
}

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
  } catch {
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
    } catch {
      // Ignore files that disappear between directory read and index build.
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
  } catch {
    return date;
  }
}

export async function readCuration(
  date: string
): Promise<{ raw: string; html: string; coverImage: string | null } | null> {
  try {
    const raw = await readFile(join(CURATIONS_DIR, `${date}.md`), "utf-8");
    return renderCurationContent(raw);
  } catch {
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

export function extractFeatured(
  content: string
): { category: string; headline: string; body: string; firstUrl: string | null } | null {
  const match = content.match(FEATURED_SECTION_RE);
  if (!match?.[1] || !match[2]) return null;
  const headline = match[1].trim().replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const rawBody = (match[2].trim().split("\n\n")[0] ?? "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const body = rawBody.length > 280 ? rawBody.slice(0, 280).replace(/\S+$/, "").trimEnd() + "…" : rawBody;
  const urlMatch = match[2].match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
  const firstUrl = urlMatch?.[2] ?? null;
  return { category: "Noticia Principal", headline, body, firstUrl };
}

export type CurationValidationIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

export type CurationValidationResult = {
  valid: boolean;
  errors: CurationValidationIssue[];
  warnings: CurationValidationIssue[];
  stats: {
    headings: number;
    sections: number;
    stories: number;
    links: number;
    duplicateLinks: number;
    readingTime: number;
  };
};

function pushIssue(
  list: CurationValidationIssue[],
  severity: CurationValidationIssue["severity"],
  code: string,
  message: string
) {
  list.push({ severity, code, message });
}

export function validateCurationContent(content: string): CurationValidationResult {
  const errors: CurationValidationIssue[] = [];
  const warnings: CurationValidationIssue[] = [];
  const trimmed = content.trim();

  if (trimmed.length < 10) {
    pushIssue(errors, "error", "content_too_short", "El contenido debe tener al menos 10 caracteres.");
  }
  if (content.length > 1_000_000) {
    pushIssue(errors, "error", "content_too_large", "El contenido no puede superar 1.000.000 caracteres.");
  }

  const hasFrontmatterStart = content.startsWith("---\n");
  if (hasFrontmatterStart && !content.match(/^---\n[\s\S]*?\n---\n/)) {
    pushIssue(errors, "error", "frontmatter_unclosed", "El frontmatter empieza con --- pero no tiene cierre válido.");
  }
  if (!hasFrontmatterStart) {
    pushIssue(warnings, "warning", "frontmatter_missing", "Se recomienda incluir frontmatter aunque sea solo image_url.");
  }

  const h1Count = (content.match(/^# .+$/gm) || []).length;
  if (h1Count === 0) {
    pushIssue(warnings, "warning", "title_missing", "Se recomienda incluir un título H1 al inicio de la edición.");
  } else if (h1Count > 1) {
    pushIssue(warnings, "warning", "multiple_titles", "La edición debería tener un solo título H1.");
  }

  const featured = extractFeatured(content);
  if (!featured) {
    pushIssue(
      errors,
      "error",
      "featured_missing",
      "Falta la sección destacada con heading ## Noticia principal: ..."
    );
  } else {
    if (featured.headline.length < 12) {
      pushIssue(errors, "error", "featured_headline_short", "El titular destacado es demasiado corto.");
    }
    if (featured.body.length < 80) {
      pushIssue(warnings, "warning", "featured_excerpt_short", "La historia destacada debería tener un primer párrafo más descriptivo.");
    }
    if (!featured.firstUrl) {
      pushIssue(warnings, "warning", "featured_link_missing", "La historia destacada no contiene un link principal.");
    }
  }

  const h2Headings = Array.from(content.matchAll(/^## (.+)$/gm)).map((m) => m[1]?.trim() ?? "");
  const sections = h2Headings.filter((h) => !FEATURED_HEADING_LABEL_RE.test(h)).length;
  if (sections === 0) {
    pushIssue(errors, "error", "sections_missing", "Debe existir al menos una sección H2 además de la historia destacada.");
  }

  const h3Matches = Array.from(content.matchAll(/^### (.+)$/gm));
  const stories = h3Matches.length;
  if (stories === 0) {
    pushIssue(errors, "error", "stories_missing", "Debe existir al menos una historia con heading H3.");
  } else if (stories < 3) {
    pushIssue(warnings, "warning", "few_stories", "La edición tiene pocas historias; revisa si está completa.");
  }

  const links = Array.from(content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)).map((m) => m[2]?.trim() ?? "");
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const href of links) {
    if (seen.has(href)) duplicates.add(href);
    seen.add(href);
    try {
      const parsed = new URL(href);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        pushIssue(errors, "error", "unsafe_link_protocol", `Link con protocolo no permitido: ${href}`);
      }
    } catch {
      if (!href.startsWith("/") && !href.startsWith("#")) {
        pushIssue(warnings, "warning", "relative_or_invalid_link", `Link relativo o inválido: ${href}`);
      }
    }
  }
  if (duplicates.size > 0) {
    pushIssue(warnings, "warning", "duplicate_links", `Hay ${duplicates.size} link(s) duplicado(s).`);
  }

  if (/<script[\s>]/i.test(content) || /on\w+=["']/i.test(content)) {
    pushIssue(warnings, "warning", "raw_html_detected", "Se detectó HTML potencialmente riesgoso; será escapado al renderizar.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      headings: (content.match(/^#{1,6} .+$/gm) || []).length,
      sections,
      stories,
      links: links.length,
      duplicateLinks: duplicates.size,
      readingTime: estimateReadingTime(content),
    },
  };
}

const LOGO_PATTERNS = [
  /\/logo\./i, /\/icon\./i, /\/favicon/i, /\/apple-touch/i,
  /opengraph.*logo/i, /og-logo/i, /brand.*logo/i,
  /logo-seo/i, /logo\.svg/i, /logo\.png/i,
];

function isGoodOgImage(imgUrl: string): boolean {
  if (LOGO_PATTERNS.some((p) => p.test(imgUrl))) return false;
  if (/\/\d{1,2}x\d{1,2}/.test(imgUrl)) return false;
  if (/favicon\.ico$/i.test(imgUrl)) return false;
  return true;
}

export function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const h = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
    return isBlockedHost(h);
  } catch {
    return true;
  }
}

export async function isBlockedResolvedUrl(url: string): Promise<boolean> {
  if (isBlockedUrl(url)) return true;
  try {
    const parsed = new URL(url);
    const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
    if (addresses.length === 0) return true;
    return addresses.some((addr) => isBlockedHost(addr.address));
  } catch {
    return true;
  }
}

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0") return true;
  if (h.startsWith("10.") || h.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h.startsWith("169.254.")) return true;
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("::ffff:")) return true;
  if (/^f[cd]/i.test(h)) return true;
  if (/^fe[89ab]/i.test(h)) return true;
  if (h.endsWith(".internal") || h.endsWith(".local") || h.endsWith(".localhost")) return true;
  return false;
}

const MAX_OG_CACHE = 500;
const MAX_SUMMARY_CACHE = 1000;

export function resolveOgImageCandidate(pageUrl: string, html: string): string | null {
  const ogMatch =
    html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  const ogImage = ogMatch?.[1] ? new URL(ogMatch[1], pageUrl).toString() : null;
  if (ogImage && isGoodOgImage(ogImage)) return ogImage;

  const twitterMatch =
    html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i);
  const twitterImage = twitterMatch?.[1] ? new URL(twitterMatch[1], pageUrl).toString() : null;
  return twitterImage && isGoodOgImage(twitterImage) ? twitterImage : null;
}

export async function extractOgImage(url: string): Promise<string | null> {
  if (ogImageCache.has(url)) return ogImageCache.get(url)!;
  if (await isBlockedResolvedUrl(url)) return null;
  let result: string | null = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: "error",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DailyBrief/1.0)" },
    }).finally(() => clearTimeout(timeout));
    if (!resp.ok) {
      ogImageCache.set(url, null);
      return null;
    }
    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) {
      ogImageCache.set(url, null);
      return null;
    }
    const reader = resp.body?.getReader();
    let html = "";
    if (reader) {
      const decoder = new TextDecoder();
      let bytesRead = 0;
      while (bytesRead < 50 * 1024) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        bytesRead += value.length;
      }
      reader.cancel();
    }
    result = resolveOgImageCandidate(url, html);
  } catch {
    // best-effort
  }
  if (ogImageCache.size >= MAX_OG_CACHE) {
    const firstKey = ogImageCache.keys().next().value;
    if (firstKey !== undefined) ogImageCache.delete(firstKey);
  }
  ogImageCache.set(url, result);
  return result;
}

export function todayLocal(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
}

export function dateFromFileId(id: string): string {
  return id.replace(/_\d{2}-\d{2}$/, "");
}

export function findTodayCuration(files: string[]): string | null {
  const today = todayLocal();
  const todayFiles = files.filter((f) => dateFromFileId(f) === today);
  return todayFiles[0] ?? null;
}

export function groupByDay(files: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const day = dateFromFileId(f);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(f);
  }
  return groups;
}

export function allEditionsSidebar(files: string[]): string[] {
  return files;
}

export function estimateReadingTime(raw: string): number {
  const words = raw.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

export function formatDateEs(dateStr: string): string {
  const cleanDate = dateFromFileId(dateStr);
  const dt = new Date(cleanDate + "T12:00:00");
  const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const months = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  const dateFormatted = `${days[dt.getDay()]} ${dt.getDate()} de ${months[dt.getMonth()]} de ${dt.getFullYear()}`;
  const timeMatch = dateStr.match(/_(\d{2})-(\d{2})$/);
  if (timeMatch) return `${dateFormatted} (${timeMatch[1]}:${timeMatch[2]})`;
  return dateFormatted;
}
