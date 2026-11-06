import type { Problem } from "../protocol/generated";
/** The problem a failed load of the read handlers' code rejects with. */
export const STREAM_READS_UNAVAILABLE = {
  code: "retryable",
  id: "stream-reads-load",
} as const satisfies Problem;
// The handlers are loaded on first use, outside the core bundle. Every
// caller waits on the same load, so calls start in the order they were made,
// and once loaded a call starts at once; a failed load is not kept, and the
// next call loads again.
export let loaded: typeof import("./reads-impl") | undefined;
let loading: Promise<typeof import("./reads-impl")> | undefined;
export const load = () =>
  (loading ??= import("./reads-impl").then(
    (module) => (loaded = module),
    () => {
      loading = undefined;
      throw { ...STREAM_READS_UNAVAILABLE };
    },
  ));
