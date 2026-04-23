import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";

export function createApiKeyGuard(apiKey?: string) {
  function isValidApiKey(provided: string): boolean {
    if (!apiKey) return false;
    if (provided.length !== apiKey.length) return false;
    return timingSafeEqual(Buffer.from(provided), Buffer.from(apiKey));
  }

  async function requireApiKey(c: Context, next: Next, disabledMessage: string) {
    if (!apiKey) return c.json({ error: disabledMessage }, 503);
    const key =
      c.req.header("X-Api-Key") ??
      c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!key || !isValidApiKey(key)) return c.json({ error: "Unauthorized" }, 401);
    await next();
  }

  return {
    enabled: Boolean(apiKey),
    requireApiKey,
  };
}
