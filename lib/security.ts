import { Resolver } from "node:dns/promises";

const ssrfResolver = new Resolver();
ssrfResolver.setServers(["1.1.1.1", "8.8.8.8"]);

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
    const addresses = await ssrfResolver.resolve(parsed.hostname);
    if (addresses.length === 0) return true;
    return addresses.some((addr: string) => isBlockedHost(addr));
  } catch {
    return true;
  }
}
