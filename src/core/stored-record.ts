export interface StoredRecord {
  revision?: unknown;
  [field: string]: unknown;
}
export function revisionOf(record: StoredRecord | null): number {
  const revision = record?.revision;
  return typeof revision === "number" && Number.isSafeInteger(revision)
    ? revision
    : 0;
}
