import { isBlockedResolvedUrl } from "./security.ts";

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

const MAX_OG_CACHE = 500;
const ogImageCache = new Map<string, string | null>();

export function getOgImageCacheStats() {
  return {
    size: ogImageCache.size,
  };
}

export function clearOgImageCache() {
  ogImageCache.clear();
}

export function resolveOgImageCandidate(pageUrl: string, html: string): string | null {
  const ogMatch =
    html.match(/<meta[^\u003e]*property=["']og:image["'][^\u003e]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^\u003e]*content=["']([^"']+)["'][^\u003e]*property=["']og:image["']/i);
  const ogImage = ogMatch?.[1] ? new URL(ogMatch[1], pageUrl).toString() : null;
  if (ogImage && isGoodOgImage(ogImage)) return ogImage;

  const twitterMatch =
    html.match(/<meta[^\u003e]*name=["']twitter:image["'][^\u003e]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^\u003e]*content=["']([^"']+)["'][^\u003e]*name=["']twitter:image["']/i);
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
