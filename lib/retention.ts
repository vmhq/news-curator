import { existsSync } from "fs";
import { mkdir, readdir, rm, stat } from "fs/promises";
import { join } from "path";
import type { RuntimeConfig } from "./config.ts";
import { logEvent } from "./logging.ts";

export async function cleanupExpiredDrafts(config: RuntimeConfig): Promise<number> {
  if (config.draftTtlHours <= 0 || !existsSync(config.draftsDir)) return 0;

  const cutoff = Date.now() - config.draftTtlHours * 60 * 60 * 1000;
  let removed = 0;

  for (const file of await readdir(config.draftsDir)) {
    if (!file.endsWith(".md")) continue;
    const path = join(config.draftsDir, file);
    try {
      const info = await stat(path);
      if (info.mtimeMs < cutoff) {
        await rm(path, { force: true });
        removed++;
      }
    } catch {
      // Ignore disappearing files during cleanup.
    }
  }

  if (removed > 0) logEvent("draft.cleanup", { removed });
  return removed;
}

export async function trimVersionHistory(date: string, config: RuntimeConfig): Promise<number> {
  if (config.maxVersionsPerEdition <= 0) return 0;

  const dir = join(config.versionsDir, date);
  if (!existsSync(dir)) return 0;

  const files = (await readdir(dir))
    .filter((file) => file.endsWith(".md"))
    .sort()
    .reverse();

  const surplus = files.slice(config.maxVersionsPerEdition);
  for (const file of surplus) {
    await rm(join(dir, file), { force: true });
  }

  if (surplus.length > 0) {
    logEvent("curation.versions_trimmed", { edition: date, removed: surplus.length });
  }

  return surplus.length;
}

export async function runRetentionPass(config: RuntimeConfig): Promise<void> {
  await mkdir(config.draftsDir, { recursive: true });
  await mkdir(config.versionsDir, { recursive: true });

  await cleanupExpiredDrafts(config);

  if (!existsSync(config.versionsDir) || config.maxVersionsPerEdition <= 0) return;
  for (const entry of await readdir(config.versionsDir)) {
    await trimVersionHistory(entry, config);
  }
}
