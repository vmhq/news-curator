import type { Context } from "hono";
import type { RateLimitRule } from "./config.ts";

type BucketEntry = {
  count: number;
  resetAt: number;
};

export class InMemoryRateLimiter {
  private buckets = new Map<string, BucketEntry>();

  constructor(private readonly maxEntries = 10_000) {}

  hit(bucket: string, key: string, rule: RateLimitRule) {
    const now = Date.now();
    const compositeKey = `${bucket}:${key}`;
    const entry = this.buckets.get(compositeKey);

    if (!entry || now > entry.resetAt) {
      if (this.buckets.size >= this.maxEntries) {
        const oldestKey = this.buckets.keys().next().value;
        if (oldestKey !== undefined) this.buckets.delete(oldestKey);
      }
      this.buckets.set(compositeKey, { count: 1, resetAt: now + rule.windowMs });
      return { limited: false, retryAfterMs: 0 };
    }

    if (entry.count >= rule.limit) {
      return { limited: true, retryAfterMs: Math.max(0, entry.resetAt - now) };
    }

    entry.count += 1;
    return { limited: false, retryAfterMs: 0 };
  }

  snapshot() {
    return { trackedBuckets: this.buckets.size };
  }


}

export function getRequestIp(c: Context): string {
  const connIp = (c.env as { requestIP?: { address: string } } | undefined)?.requestIP?.address;
  return connIp ?? "anonymous";
}
