import { createHash } from "node:crypto";
import type { Context } from "hono";

export function makeWeakEtag(...parts: Array<string | number | null | undefined>): string {
  const hash = createHash("sha1");
  for (const part of parts) hash.update(String(part ?? ""));
  return `W/"${hash.digest("hex").slice(0, 16)}"`;
}

export function maybeReturnNotModified(
  c: Context,
  options: { etag: string; lastModified?: Date; cacheControl?: string }
): Response | null {
  const ifNoneMatch = c.req.header("If-None-Match");
  if (ifNoneMatch && ifNoneMatch === options.etag) {
    const headers = new Headers();
    headers.set("ETag", options.etag);
    if (options.cacheControl) headers.set("Cache-Control", options.cacheControl);
    if (options.lastModified) headers.set("Last-Modified", options.lastModified.toUTCString());
    return new Response(null, { status: 304, headers });
  }
  return null;
}

export function applyCacheHeaders(
  headers: Headers,
  options: { etag?: string; lastModified?: Date; cacheControl?: string }
) {
  if (options.etag) headers.set("ETag", options.etag);
  if (options.lastModified) headers.set("Last-Modified", options.lastModified.toUTCString());
  if (options.cacheControl) headers.set("Cache-Control", options.cacheControl);
}
