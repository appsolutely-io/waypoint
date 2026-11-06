import { useSyncExternalStore } from "react";
// A chunk loaded on first use: idle, then loading, then ready or failed.
// A load asked for again after a failure is `retrying`. Every chunk tells
// the same listeners when its state changes.
type ChunkLoad<Module> =
  | { status: "idle" | "failed" }
  | { status: "loading"; retrying?: true }
  | { status: "ready"; module: Module };
interface Chunk<Module> {
  load: ChunkLoad<Module>;
  // Asks for the chunk if it was never asked for, or, `again`, after it
  // failed.
  request(again?: boolean): void;
}
const chunkListeners = new Set<() => void>();
const subscribeChunks = (listener: () => void) => {
  chunkListeners.add(listener);
  return () => chunkListeners.delete(listener);
};
export function lazyChunk<Module>(load: () => Promise<Module>): Chunk<Module> {
  const set = (next: ChunkLoad<Module>) => {
    chunk.load = next;
    for (const listener of chunkListeners) listener();
  };
  const chunk: Chunk<Module> = {
    load: { status: "idle" },
    request(again) {
      const { status } = chunk.load;
      if (status !== "idle" && !(again && status === "failed")) return;
      set({
        status: "loading",
        ...(status === "failed" && { retrying: true }),
      });
      load().then(
        (module) => set({ status: "ready", module }),
        () => set({ status: "failed" }),
      );
    },
  };
  return chunk;
}
export function useChunk<Module>(chunk: Chunk<Module>): ChunkLoad<Module> {
  return useSyncExternalStore(
    subscribeChunks,
    () => chunk.load,
    () => chunk.load,
  );
}
