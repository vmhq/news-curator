export const CURATION_FILE_ID_RE = /^\d{4}-\d{2}-\d{2}(_\d{2}-\d{2})?$/;
export const DRAFT_ID_RE = /^[a-f0-9-]{36}$/i;
export const VERSION_ID_RE = /^[\dTZ-]+-[a-z0-9_-]+$/i;

export function isCurationFileId(id: string): boolean {
  return CURATION_FILE_ID_RE.test(id);
}

export function isDraftId(id: string): boolean {
  return DRAFT_ID_RE.test(id);
}

export function isVersionId(id: string): boolean {
  return VERSION_ID_RE.test(id);
}
