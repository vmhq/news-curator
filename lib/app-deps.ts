import type { createApiKeyGuard } from "./auth.ts";
import type { RuntimeConfig } from "./config.ts";
import type { InMemoryRateLimiter } from "./rate-limit.ts";

export type AppDeps = {
  config: RuntimeConfig;
  apiKeyGuard: ReturnType<typeof createApiKeyGuard>;
  rateLimiter: InMemoryRateLimiter;
  startedAt: number;
};
