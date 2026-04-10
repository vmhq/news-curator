import { readdir, readFile } from "fs/promises";
import { existsSync, watch } from "fs";
import { join } from "path";
import { marked, Renderer } from "marked";

export const CURATIONS_DIR =
  process.env.CURATIONS_DIR ?? "/home/ai/llm-wiki/raw/curations";
export const SITE_URL = "https://dailyb.vmhq.cl";
export const DEFAULT_COVER = `${SITE_URL}/static/cover.svg`;
const TZ = "America/Santiago";

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
  return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
};
renderer.html = function ({ text }: { text: string }) {
  return escapeHtmlInternal(text);
};
marked.use({ renderer });

// ── In-memory caches ──────────────────────────────────────────────────────────
let filesCache: string[] | null = null;
const summaryCache = new Map<string, string>();
const ogImageCache = new Map<string, string | null>();

export function invalidateFilesCache() {
  filesCache = null;
}

export function startDirWatcher() {
  if (!existsSync(CURATIONS_DIR)) return;
  watch(CURATIONS_DIR, (_event: string, filename: string | null) => {
    filesCache = null;
    if (filename) {
      summaryCache.delete(filename.replace(/\.md$/, ""));
    } else {
      summaryCache.clear();
    }
  });
}

export async function getCurationFiles(): Promise<string[]> {
  if (filesCache) return filesCache;
  try {
    const files = await readdir(CURATIONS_DIR);
    const sorted = files
      .filter((f: string) => f.endsWith(".md"))
      .map((f: string) => f.replace(".md", ""))
      .sort()
      .reverse();
    filesCache = sorted;
    return sorted;
  } catch {
    return [];
  }
}

export function getSummary(content: string): string {
  const clean = content.replace(/^---\n[\s\S]*?\n---\n*/, "");
  const h3 = clean.match(/^### (.+)$/m);
  if (h3) return h3[1].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\S+$/, "").trimEnd() || h3[1].slice(0, 80);
  const h2 = clean.match(/^## (.+)$/m);
  if (h2) {
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
    const coverMatch = raw.match(/image_url:\s*["']?([^"'\n]+)["']?/);
    const coverImage = coverMatch ? coverMatch[1].trim() : null;
    let display = raw;
    display = display.replace(/^---\n[\s\S]*?\n---\n+/, "");
    display = display.replace(/^# .+\n+/, "");
    display = display.replace(/^\*Generado .+\*\n+/, "");
    display = display.replace(/^---\n+/, "");
    const html = await marked.parse(display);
    return { raw, html, coverImage };
  } catch {
    return null;
  }
}

export function extractFeatured(
  content: string
): { category: string; headline: string; body: string; firstUrl: string | null } | null {
  const match = content.match(/## 🔥(?:\s*Featured Story:\s*)?(.+?)\n\n([\s\S]*?)(?=\n---|\n## [^🔥])/);
  if (!match) return null;
  const headline = match[1].trim().replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const rawBody = match[2].trim().split("\n\n")[0].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const body = rawBody.length > 280 ? rawBody.slice(0, 280).replace(/\S+$/, "").trimEnd() + "…" : rawBody;
  const urlMatch = match[2].match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
  const firstUrl = urlMatch ? urlMatch[2] : null;
  return { category: "Noticia Principal", headline, body, firstUrl };
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

function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const h = parsed.hostname;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
    if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0") return true;
    if (h.startsWith("10.") || h.startsWith("192.168.")) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    if (h === "169.254.169.254") return true;
    if (h.endsWith(".internal") || h.endsWith(".local") || h.endsWith(".localhost")) return true;
    return false;
  } catch {
    return true;
  }
}

const MAX_OG_CACHE = 500;
const MAX_SUMMARY_CACHE = 1000;

export async function extractOgImage(url: string): Promise<string | null> {
  if (ogImageCache.has(url)) return ogImageCache.get(url)!;
  if (isBlockedUrl(url)) return null;
  let result: string | null = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DailyBrief/1.0)" },
    });
    clearTimeout(timeout);
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
    const ogMatch =
      html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    if (ogMatch && isGoodOgImage(ogMatch[1])) {
      result = ogMatch[1];
    } else {
      const twMatch =
        html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i);
      if (twMatch && isGoodOgImage(twMatch[1])) result = twMatch[1];
    }
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
  return todayFiles.length > 0 ? todayFiles[0] : null;
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
