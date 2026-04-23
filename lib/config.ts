import { join } from "path";
import { CURATIONS_DIR, SITE_URL } from "./curations.ts";

export type RateLimitRule = {
  limit: number;
  windowMs: number;
};

export type RuntimeConfig = {
  apiKey?: string;
  curationsDir: string;
  siteUrl: string;
  uploadsDir: string;
  draftsDir: string;
  versionsDir: string;
  enableWatcher: boolean;
  maxImageSize: number;
  allowedImageTypes: Set<string>;
  imageExt: Record<string, string>;
  draftTtlHours: number;
  maxVersionsPerEdition: number;
  rateLimits: {
    search: RateLimitRule;
    images: RateLimitRule;
    publish: RateLimitRule;
    drafts: RateLimitRule;
    edits: RateLimitRule;
  };
};

export type RuntimeConfigInput = Partial<
  Omit<RuntimeConfig, "allowedImageTypes" | "imageExt" | "rateLimits"> & {
    rateLimits: Partial<RuntimeConfig["rateLimits"]>;
  }
>;

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadRuntimeConfig(overrides: RuntimeConfigInput = {}): RuntimeConfig {
  const curationsDir = overrides.curationsDir ?? process.env.CURATIONS_DIR ?? CURATIONS_DIR;
  const siteUrl = overrides.siteUrl ?? process.env.SITE_URL ?? SITE_URL;

  const defaultRateLimits = {
    search: { limit: 20, windowMs: 10_000 },
    images: { limit: 10, windowMs: 60_000 },
    publish: { limit: 10, windowMs: 60_000 },
    drafts: { limit: 20, windowMs: 60_000 },
    edits: { limit: 30, windowMs: 60_000 },
  };

  return {
    apiKey: overrides.apiKey ?? process.env.API_KEY,
    curationsDir,
    siteUrl,
    uploadsDir: overrides.uploadsDir ?? process.env.UPLOADS_DIR ?? join("public", "uploads"),
    draftsDir: overrides.draftsDir ?? process.env.DRAFTS_DIR ?? join(curationsDir, ".drafts"),
    versionsDir: overrides.versionsDir ?? process.env.VERSIONS_DIR ?? join(curationsDir, ".versions"),
    enableWatcher: overrides.enableWatcher ?? true,
    maxImageSize: overrides.maxImageSize ?? 10 * 1024 * 1024,
    allowedImageTypes: new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]),
    imageExt: {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/avif": "avif",
    },
    draftTtlHours: overrides.draftTtlHours ?? readNumber(process.env.DRAFT_TTL_HOURS, 72),
    maxVersionsPerEdition:
      overrides.maxVersionsPerEdition ?? readNumber(process.env.MAX_VERSIONS_PER_EDITION, 20),
    rateLimits: {
      search: overrides.rateLimits?.search ?? defaultRateLimits.search,
      images: overrides.rateLimits?.images ?? defaultRateLimits.images,
      publish: overrides.rateLimits?.publish ?? defaultRateLimits.publish,
      drafts: overrides.rateLimits?.drafts ?? defaultRateLimits.drafts,
      edits: overrides.rateLimits?.edits ?? defaultRateLimits.edits,
    },
  };
}
