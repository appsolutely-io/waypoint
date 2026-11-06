// One cancellation primitive for every asynchronous effect. A scope wraps a
// standard AbortController; a child's signal is derived from its parent with
// AbortSignal.any where the platform has it, so aborting a parent reaches
// every child. Effects check `signal.aborted` where they land.
//
// The core compiles without DOM types and runs on platforms whose
// AbortController lacks AbortSignal.any (React Native), so the shapes are
// declared structurally here and linked by listener as a fallback.
export interface ScopeSignal {
  readonly aborted: boolean;
  addEventListener(
    type: "abort",
    listener: () => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(type: "abort", listener: () => void): void;
}
export interface Scope {
  readonly signal: ScopeSignal;
  abort(): void;
  /** Releases the link to the parent once the work has finished. */
  end(): void;
}
interface Platform {
  AbortController: new () => { signal: ScopeSignal; abort(): void };
  AbortSignal?: { any?(signals: ScopeSignal[]): ScopeSignal };
}
/**
 * Every scope kind and the kinds its parent may have. `createScope` refuses
 * any other parent, so the tree is fixed here rather than at each call site;
 * a root kind may also be created without a parent.
 */
export const SCOPE_PARENTS = {
  client: [],
  conversation: ["client"],
  // One stream binding: the conversation's stream under one agreement, with
  // its connections and recovery episodes.
  stream: ["conversation"],
  connection: ["stream"],
  // One stream recovery episode: its delays, probe and reopen.
  recovery: ["stream"],
  "plan-read": ["conversation", "connection"],
  "flow-load": ["client"],
  "flow-run": ["client"],
  binding: ["client"],
  // A runner may also be tied to any standard AbortSignal its caller passes.
  runner: ["conversation", "external"],
  invocation: ["runner"],
} as const satisfies Record<string, readonly string[]>;
export type ScopeKind = keyof typeof SCOPE_PARENTS;
/** Parent kinds include `external`: a signal not made by `createScope`. */
export type ScopeParentKind = ScopeKind | "external";
const kinds = new WeakMap<ScopeSignal, ScopeKind>();
export function createScope(kind: ScopeKind, parent?: ScopeSignal): Scope {
  if (parent) {
    const allowed: readonly string[] = SCOPE_PARENTS[kind];
    const parentKind = kinds.get(parent) ?? "external";
    if (!allowed.includes(parentKind))
      throw new Error(`A ${kind} scope cannot have this parent`);
  } else if (kind !== "client" && kind !== "runner")
    throw new Error(`A ${kind} scope needs a parent`);
  const platform = globalThis as unknown as Platform;
  const own = new platform.AbortController();
  const any = platform.AbortSignal?.any;
  const make = (
    signal: ScopeSignal,
    end: () => void,
    abort = () => own.abort(),
  ) => {
    kinds.set(signal, kind);
    return { signal, abort, end };
  };
  if (!parent) return make(own.signal, () => {});
  if (any)
    return make(any.call(platform.AbortSignal, [parent, own.signal]), () => {});
  const forward = () => own.abort();
  if (parent.aborted) own.abort();
  else parent.addEventListener("abort", forward, { once: true });
  const end = () => parent.removeEventListener("abort", forward);
  return make(own.signal, end, () => {
    end();
    own.abort();
  });
}
/** Calls `fn` once when `signal` aborts, or at once if it already has. */
export function onAbort(signal: ScopeSignal, fn: () => void): () => void {
  if (signal.aborted) {
    fn();
    return () => {};
  }
  signal.addEventListener("abort", fn, { once: true });
  return () => signal.removeEventListener("abort", fn);
}
