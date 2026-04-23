import { existsSync } from "fs";
import { basename, join } from "path";
import type { RuntimeConfig } from "./config.ts";
import { isBlockedResolvedUrl } from "./curations.ts";

export function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta: Record<string, string> = {};
  const rawMeta = match[1] ?? "";
  const rawBody = match[2] ?? "";

  for (const line of rawMeta.split("\n")) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (key) meta[key] = value;
  }

  return { meta, body: rawBody };
}

export function serializeFrontmatter(meta: Record<string, string>, body: string): string {
  const entries = Object.entries(meta);
  if (entries.length === 0) return body;

  const frontmatter = entries
    .map(([key, value]) => {
      const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "");
      const safeValue = String(value).replace(/[\r\n]/g, " ").replace(/"/g, "'");
      return `${safeKey}: "${safeValue}"`;
    })
    .join("\n");

  return `---\n${frontmatter}\n---\n${body}`;
}

export async function validateImageUrl(url: string, config: RuntimeConfig): Promise<string | null> {
  if (url.startsWith("/static/uploads/")) {
    const raw = url.slice("/static/uploads/".length);
    const filename = basename(raw);
    if (!filename || filename !== raw) return "image_url local invalida";
    if (!existsSync(join(config.uploadsDir, filename))) {
      return "image_url apunta a un archivo subido que no existe";
    }
    return null;
  }

  if (await isBlockedResolvedUrl(url)) {
    return "image_url points to a blocked or internal address";
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "error",
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) return `image_url responded with HTTP ${response.status}`;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      return `image_url is not an image (Content-Type: ${contentType || "unknown"})`;
    }
    return null;
  } catch {
    return "image_url is not reachable";
  }
}

export async function checkImageUrl(content: string, config: RuntimeConfig): Promise<string | null> {
  const match = content.match(/^---\n[\s\S]*?image_url:\s*["']?([^"'\n]+)["']?[\s\S]*?\n---/);
  if (!match?.[1]) return null;
  return validateImageUrl(match[1].trim(), config);
}
