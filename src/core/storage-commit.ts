import type { StoragePort } from "./client";
import { revisionOf, type StoredRecord } from "./stored-record";
// Loaded on first use by the client's storage writes, outside the core
// bundle.
// One commit operation per storage key, coordinated across runtimes. Each
// stored record carries a persisted revision; a commit reads the record,
// lets the caller build the next one from it, and writes revision + 1 only
// if the record is still the one it read:
// - with the port's `compareAndSet`, atomically;
// - otherwise, where the platform has Web Locks, under a lock on the key
//   that every runtime sharing the store takes;
// - otherwise by writing, reading back and retrying on a changed revision.
// Within one runtime commits to a key also run one at a time.
interface Locks {
  request<T>(name: string, task: () => Promise<T>): Promise<T>;
}
const queues = new WeakMap<StoragePort, Map<string, Promise<unknown>>>();
function parse(raw: string | null): StoredRecord | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null
      ? (value as StoredRecord)
      : null;
  } catch {
    return null;
  }
}
/**
 * Builds the next record from the stored one and commits it. `build`
 * returns `null` to drop the write. Resolves to the committed revision, or
 * `undefined` when the write was dropped.
 */
export function commitRecord(
  port: StoragePort,
  key: string,
  build: (
    stored: StoredRecord | null,
    revision: number,
  ) => Record<string, unknown> | null,
): Promise<number | undefined> {
  const attempt = async (verify: boolean) => {
    const raw = await port.get(key);
    const stored = parse(raw);
    const revision = revisionOf(stored);
    const next = build(stored, revision);
    if (!next) return { done: true, committed: undefined };
    const value = JSON.stringify({ ...next, revision: revision + 1 });
    if (port.compareAndSet) {
      if (!(await port.compareAndSet(key, raw, value)))
        return { done: false, committed: undefined };
    } else {
      await port.set(key, value);
      // Read back: another runtime may have written between our read and
      // our write; then build again from what it wrote.
      if (verify && (await port.get(key)) !== value)
        return { done: false, committed: undefined };
    }
    return { done: true, committed: revision + 1 };
  };
  const run = async () => {
    const locks = port.compareAndSet
      ? undefined
      : (globalThis as { navigator?: { locks?: Locks } }).navigator?.locks;
    const once = () => attempt(!locks);
    for (let round = 0; round < 5; round++) {
      const result = locks
        ? await locks.request(`waypoint-storage:${key}`, once)
        : await once();
      if (result.done) return result.committed;
    }
    throw new Error("Storage revision conflict");
  };
  let byKey = queues.get(port);
  if (!byKey) queues.set(port, (byKey = new Map()));
  const result = (byKey.get(key) ?? Promise.resolve()).then(run, run);
  byKey.set(
    key,
    result.catch(() => {}),
  );
  return result;
}
