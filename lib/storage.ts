import { existsSync } from "fs";
import { mkdir, readFile, readdir, stat, writeFile } from "fs/promises";
import { join } from "path";
import { CURATIONS_DIR } from "./config.ts";

// Editions
export function editionFilePath(date: string, curationsDir = CURATIONS_DIR): string {
  return join(curationsDir, `${date}.md`);
}

export function editionExists(date: string, curationsDir = CURATIONS_DIR): boolean {
  return existsSync(editionFilePath(date, curationsDir));
}

export async function readEdition(date: string, curationsDir = CURATIONS_DIR): Promise<string | null> {
  try {
    return await readFile(editionFilePath(date, curationsDir), "utf-8");
  } catch {
    return null;
  }
}

export async function writeEdition(date: string, content: string, curationsDir = CURATIONS_DIR): Promise<void> {
  await mkdir(curationsDir, { recursive: true });
  await writeFile(editionFilePath(date, curationsDir), content, "utf-8");
}

export async function statEdition(date: string, curationsDir = CURATIONS_DIR) {
  return stat(editionFilePath(date, curationsDir));
}

// Drafts
export function draftFilePath(draftsDir: string, draftId: string): string {
  return join(draftsDir, `${draftId}.md`);
}

export function draftExists(draftsDir: string, draftId: string): boolean {
  return existsSync(draftFilePath(draftsDir, draftId));
}

export async function readDraft(draftsDir: string, draftId: string): Promise<string | null> {
  try {
    return await readFile(draftFilePath(draftsDir, draftId), "utf-8");
  } catch {
    return null;
  }
}

export async function writeDraft(draftsDir: string, draftId: string, content: string): Promise<void> {
  await mkdir(draftsDir, { recursive: true });
  await writeFile(draftFilePath(draftsDir, draftId), content, "utf-8");
}

export async function listDrafts(draftsDir: string): Promise<{ file: string; mtimeMs: number }[]> {
  if (!existsSync(draftsDir)) return [];
  const files = (await readdir(draftsDir)).filter((f) => f.endsWith(".md"));
  const settled = await Promise.allSettled(
    files.map(async (file) => ({
      file,
      mtimeMs: (await stat(join(draftsDir, file))).mtimeMs,
    }))
  );
  return settled
    .filter((r): r is PromiseFulfilledResult<{ file: string; mtimeMs: number }> => r.status === "fulfilled")
    .map((r) => r.value);
}

// Versions
export function versionDirPath(versionsDir: string, date: string): string {
  return join(versionsDir, date);
}

export function versionFilePath(versionsDir: string, date: string, filename: string): string {
  return join(versionDirPath(versionsDir, date), filename);
}

export async function ensureVersionDir(versionsDir: string, date: string): Promise<void> {
  await mkdir(versionDirPath(versionsDir, date), { recursive: true });
}

export async function writeVersion(
  versionsDir: string,
  date: string,
  filename: string,
  content: string
): Promise<void> {
  await ensureVersionDir(versionsDir, date);
  await writeFile(versionFilePath(versionsDir, date, filename), content, "utf-8");
}

export async function listVersions(versionsDir: string, date: string): Promise<string[]> {
  const dir = versionDirPath(versionsDir, date);
  if (!existsSync(dir)) return [];
  return (await readdir(dir))
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse();
}

export async function readVersion(versionsDir: string, date: string, version: string): Promise<string | null> {
  try {
    return await readFile(versionFilePath(versionsDir, date, `${version}.md`), "utf-8");
  } catch {
    return null;
  }
}

// Uploads
export async function ensureUploadsDir(uploadsDir: string): Promise<void> {
  await mkdir(uploadsDir, { recursive: true });
}

export async function writeUpload(uploadsDir: string, filename: string, data: Buffer): Promise<void> {
  await ensureUploadsDir(uploadsDir);
  await writeFile(join(uploadsDir, filename), data);
}
